data "aws_region" "current" {}

locals {
  handlers = toset(["api", "ingest", "validator", "audit", "projector"])

  api_origin = coalesce(var.api_origin, {
    domain_suffix = "execute-api.${data.aws_region.current.region}.amazonaws.com"
    protocol      = "https-only"
    http_port     = 80
    https_port    = 443
  })
}
