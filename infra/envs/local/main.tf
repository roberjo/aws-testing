# Local environment: every AWS API call goes to fakecloud on :4566.
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
  }
}

variable "fakecloud_endpoint" {
  description = "Where Terraform reaches fakecloud. Use http://host.docker.internal:4566 when Terraform itself runs in a container."
  type        = string
  default     = "http://localhost:4566"
}

variable "lambda_architecture" {
  description = "Match your Docker host (arm64 on Apple Silicon, x86_64 on most CI runners)."
  type        = string
  default     = "arm64"
}

variable "domain" {
  description = "Hosted zone for the app. *.localhost resolves to 127.0.0.1 in browsers, so the app is reachable at http://app.<domain>:4566."
  type        = string
  default     = "fcpoc.localhost"
}

locals {
  name = "fcpoc"
  tags = { project = "fakecloud-poc", env = "local" }
}

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true # fakecloud lacks S3 Control tag APIs the provider uses when it knows the account
  s3_use_path_style           = true

  endpoints {
    apigatewayv2 = var.fakecloud_endpoint
    cloudfront   = var.fakecloud_endpoint
    cloudwatch   = var.fakecloud_endpoint
    dynamodb     = var.fakecloud_endpoint
    ec2          = var.fakecloud_endpoint
    iam          = var.fakecloud_endpoint
    kafka        = var.fakecloud_endpoint
    lambda       = var.fakecloud_endpoint
    logs         = var.fakecloud_endpoint
    route53      = var.fakecloud_endpoint
    s3           = var.fakecloud_endpoint
    s3control    = var.fakecloud_endpoint # never let a call fall through to real AWS
    sns          = var.fakecloud_endpoint
    sqs          = var.fakecloud_endpoint
    sts          = var.fakecloud_endpoint
  }
}

resource "aws_route53_zone" "main" {
  name          = var.domain
  force_destroy = true
  tags          = local.tags
}

# CloudFront's /api/* origin is <api-id>.execute-api.<domain>. fakecloud's own
# DNS resolver (--dns, and the container's only nameserver in docker-compose.yml)
# answers it from this record, so the route works identically on any host.
resource "aws_route53_record" "execute_api" {
  zone_id = aws_route53_zone.main.zone_id
  # An exact name rather than "*.execute-api": fakecloud (<= 0.46) stores the
  # wildcard as "\052" and its resolver does not match the escaped form.
  name    = "${module.app.api_id}.execute-api.${var.domain}"
  type    = "A"
  ttl     = 60
  records = ["127.0.0.1"]
}

module "kafka" {
  source = "../../modules/kafka-msk"
  name   = local.name
  tags   = local.tags
}

module "app" {
  source = "../../modules/app"

  name                = local.name
  functions_dist_dir  = abspath("${path.root}/../../../services/functions/dist")
  web_dist_dir        = fileexists("${path.root}/../../../web/out/index.html") ? abspath("${path.root}/../../../web/out") : null
  lambda_architecture = var.lambda_architecture

  # Inside Lambda containers fakecloud rewrites localhost URLs to the host,
  # so the functions' SDK clients reach fakecloud with no code changes.
  # fakecloud does not vend execution-role credentials, so give the SDK static
  # test keys (real AWS injects these itself and reserves the names).
  lambda_environment = {
    AWS_ENDPOINT_URL      = "http://localhost:4566"
    AWS_ACCESS_KEY_ID     = "test"
    AWS_SECRET_ACCESS_KEY = "test"
    S3_FORCE_PATH_STYLE   = "true"
  }

  hosted_zone_id  = aws_route53_zone.main.zone_id
  app_domain      = "app.${var.domain}"
  web_origin_mode = "website"

  # Works around a fakecloud CloudFront response gap; see the module variable.
  fakecloud_origin_group_workaround    = true
  attach_viewer_functions              = false
  fakecloud_directory_index_workaround = true

  # fakecloud routes execute-api traffic by Host header; the name resolves via
  # aws_route53_record.execute_api to fakecloud itself.
  api_origin = {
    domain_suffix = "execute-api.${var.domain}"
    protocol      = "http-only"
    http_port     = 4566
    https_port    = 443
  }

  tags = local.tags
}
