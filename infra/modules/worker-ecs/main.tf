# Runs services/job-worker on ECS Fargate: relays the SQS underwriting outbox
# onto Kafka and consumes the topic to underwrite applications.
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

variable "name" {
  type = string
}

variable "image" {
  description = "Worker image URI. Defaults to :latest in the ECR repo this module creates."
  type        = string
  default     = null
}

variable "subnet_ids" {
  description = "Subnets with outbound internet access (to reach Confluent Cloud)."
  type        = list(string)
}

variable "vpc_id" {
  type = string
}

variable "assign_public_ip" {
  type    = bool
  default = true
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "environment" {
  description = "Plain environment variables (table, topic, queue, bucket...)."
  type        = map(string)
}

variable "kafka_credentials" {
  type      = object({ username = string, password = string })
  sensitive = true
}

variable "permissions" {
  description = "IAM statements for the task role."
  type        = list(object({ actions = list(string), resources = list(string) }))
}

variable "tags" {
  type    = map(string)
  default = {}
}

data "aws_region" "current" {}

resource "aws_ecr_repository" "worker" {
  name                 = "${var.name}-job-worker"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  image_scanning_configuration {
    scan_on_push = true
  }
  tags = var.tags
}

resource "aws_secretsmanager_secret" "kafka" {
  name                    = "${var.name}/job-worker/kafka"
  recovery_window_in_days = 0
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "kafka" {
  secret_id     = aws_secretsmanager_secret.kafka.id
  secret_string = jsonencode(var.kafka_credentials)
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${var.name}-job-worker"
  retention_in_days = 14
  tags              = var.tags
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name}-job-worker-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-kafka-secret"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = aws_secretsmanager_secret.kafka.arn }]
  })
}

resource "aws_iam_role" "task" {
  name               = "${var.name}-job-worker-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "task" {
  dynamic "statement" {
    for_each = var.permissions
    content {
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "job-worker"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

resource "aws_ecs_cluster" "this" {
  name = "${var.name}-workers"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = var.tags
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name}-job-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name        = "job-worker"
    image       = coalesce(var.image, "${aws_ecr_repository.worker.repository_url}:latest")
    essential   = true
    environment = [for k, v in var.environment : { name = k, value = v }]
    secrets = [
      { name = "KAFKA_SASL_USERNAME", valueFrom = "${aws_secretsmanager_secret.kafka.arn}:username::" },
      { name = "KAFKA_SASL_PASSWORD", valueFrom = "${aws_secretsmanager_secret.kafka.arn}:password::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.worker.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = "worker"
      }
    }
  }])

  tags = var.tags
}

resource "aws_security_group" "worker" {
  name   = "${var.name}-job-worker"
  vpc_id = var.vpc_id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}

resource "aws_ecs_service" "worker" {
  name            = "${var.name}-job-worker"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = var.assign_public_ip
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = var.tags
}

output "ecr_repository_url" {
  value = aws_ecr_repository.worker.repository_url
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "service_name" {
  value = aws_ecs_service.worker.name
}
