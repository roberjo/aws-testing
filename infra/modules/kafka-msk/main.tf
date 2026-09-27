# Amazon MSK cluster. Against fakecloud, CreateCluster starts a real
# single-node Apache Kafka broker container and GetBootstrapBrokers returns a
# reachable host:port, so the job worker talks to genuine Kafka.
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

variable "kafka_version" {
  type    = string
  default = "3.8.x"
}

variable "tags" {
  type    = map(string)
  default = {}
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "kafka" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_hostnames = true
  tags                 = merge(var.tags, { Name = "${var.name}-kafka" })
}

resource "aws_subnet" "kafka" {
  count             = 2
  vpc_id            = aws_vpc.kafka.id
  cidr_block        = cidrsubnet(aws_vpc.kafka.cidr_block, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = merge(var.tags, { Name = "${var.name}-kafka-${count.index}" })
}

resource "aws_security_group" "kafka" {
  name   = "${var.name}-kafka"
  vpc_id = aws_vpc.kafka.id

  ingress {
    description = "Kafka plaintext from inside the VPC"
    from_port   = 9092
    to_port     = 9092
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.kafka.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_msk_cluster" "this" {
  cluster_name           = "${var.name}-jobs"
  kafka_version          = var.kafka_version
  number_of_broker_nodes = 2

  broker_node_group_info {
    instance_type   = "kafka.t3.small"
    client_subnets  = aws_subnet.kafka[*].id
    security_groups = [aws_security_group.kafka.id]
    storage_info {
      ebs_storage_info {
        volume_size = 10
      }
    }
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "PLAINTEXT"
      in_cluster    = false
    }
  }

  tags = var.tags
}

output "cluster_arn" {
  value = aws_msk_cluster.this.arn
}

output "bootstrap_brokers" {
  value = aws_msk_cluster.this.bootstrap_brokers
}
