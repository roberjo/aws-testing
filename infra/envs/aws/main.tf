# Real AWS + Confluent Cloud. Same app module as the local fakecloud stack.
#
#   export CONFLUENT_CLOUD_API_KEY=... CONFLUENT_CLOUD_API_SECRET=...
#   terraform init && terraform apply -var domain=example.com
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    confluent = {
      source  = "confluentinc/confluent"
      version = "~> 2.0"
    }
  }

  # Configure remote state before sharing this stack, e.g.:
  # backend "s3" {
  #   bucket       = "my-tf-state"
  #   key          = "fakecloud-poc/aws.tfstate"
  #   region       = "us-east-1"
  #   use_lockfile = true
  # }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "loandesk"
}

variable "domain" {
  description = "An existing public Route 53 hosted zone, e.g. example.com. The app is served at app.<domain>."
  type        = string
}

variable "worker_image" {
  description = "Job worker image. Defaults to <ecr repo>:latest (push it after the first apply)."
  type        = string
  default     = null
}

locals {
  tags       = { project = "fakecloud-poc", env = "aws" }
  app_domain = "app.${var.domain}"
}

provider "aws" {
  region = var.region
  default_tags {
    tags = local.tags
  }
}

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = local.tags
  }
}

# Reads CONFLUENT_CLOUD_API_KEY / CONFLUENT_CLOUD_API_SECRET from the environment.
provider "confluent" {}

data "aws_route53_zone" "main" {
  name         = var.domain
  private_zone = false
}

resource "aws_acm_certificate" "app" {
  provider          = aws.us_east_1
  domain_name       = local.app_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.app.domain_validation_options : o.domain_name => o
  }
  zone_id         = data.aws_route53_zone.main.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "app" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.app.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

module "app" {
  source = "../../modules/app"

  name                 = var.name
  functions_dist_dir   = abspath("${path.root}/../../../services/functions/dist")
  web_dist_dir         = abspath("${path.root}/../../../web/out")
  hosted_zone_id       = data.aws_route53_zone.main.zone_id
  app_domain           = local.app_domain
  acm_certificate_arn  = aws_acm_certificate_validation.app.certificate_arn
  web_origin_mode      = "oac"
  cors_allowed_origins = ["https://${local.app_domain}"]
  tags                 = local.tags
}

module "kafka" {
  source       = "../../modules/kafka-confluent"
  name         = var.name
  cloud_region = var.region
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

module "worker" {
  source     = "../../modules/worker-ecs"
  name       = var.name
  image      = var.worker_image
  vpc_id     = data.aws_vpc.default.id
  subnet_ids = data.aws_subnets.default.ids

  environment = {
    AWS_REGION              = var.region
    TABLE_NAME              = module.app.table_name
    EVENTS_TOPIC_ARN        = module.app.events_topic_arn
    RESULTS_BUCKET          = module.app.buckets["results"]
    UNDERWRITING_QUEUE_URL  = module.app.underwriting_queue_url
    KAFKA_BOOTSTRAP_SERVERS = module.kafka.bootstrap_servers
    KAFKA_TOPIC             = module.kafka.topic
  }

  kafka_credentials = {
    username = module.kafka.api_key
    password = module.kafka.api_secret
  }

  permissions = [
    { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [module.app.underwriting_queue_arn] },
    { actions = ["dynamodb:GetItem", "dynamodb:UpdateItem"], resources = [module.app.table_arn] },
    { actions = ["s3:PutObject"], resources = ["${module.app.results_bucket_arn}/*"] },
    { actions = ["sns:Publish"], resources = [module.app.events_topic_arn] },
  ]

  tags = local.tags
}

output "app_url" {
  value = module.app.app_url
}

output "api_endpoint" {
  value = module.app.api_endpoint
}

output "cloudfront_distribution_id" {
  value = module.app.cloudfront_distribution_id
}

output "worker_ecr_repository" {
  value = module.worker.ecr_repository_url
}

output "kafka_bootstrap_servers" {
  value = module.kafka.bootstrap_servers
}
