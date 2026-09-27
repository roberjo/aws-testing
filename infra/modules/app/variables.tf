variable "name" {
  description = "Prefix for every resource name."
  type        = string
}

variable "functions_dist_dir" {
  description = "Directory containing one bundled folder per Lambda handler (services/functions/dist)."
  type        = string
}

variable "web_dist_dir" {
  description = "Next.js static export output (web/out). Set to null to skip uploading the site."
  type        = string
  default     = null
}

variable "lambda_runtime" {
  type    = string
  default = "nodejs24.x"
}

variable "lambda_architecture" {
  description = "arm64 or x86_64. Match the Docker host when running under fakecloud to avoid emulation."
  type        = string
  default     = "arm64"
}

variable "lambda_environment" {
  description = "Extra environment variables for every function (e.g. AWS_ENDPOINT_URL for fakecloud)."
  type        = map(string)
  default     = {}
}

# --- edge / DNS ---------------------------------------------------------------

variable "hosted_zone_id" {
  description = "Route 53 hosted zone that receives the app record."
  type        = string
}

variable "app_domain" {
  description = "Fully-qualified name users browse to, e.g. app.example.com."
  type        = string
}

variable "acm_certificate_arn" {
  description = "us-east-1 ACM certificate for app_domain. Null uses the default CloudFront certificate."
  type        = string
  default     = null
}

variable "web_origin_mode" {
  description = "\"oac\" = private bucket via Origin Access Control (AWS). \"website\" = public S3 website endpoint (what fakecloud's CloudFront data plane serves)."
  type        = string
  default     = "oac"
  validation {
    condition     = contains(["oac", "website"], var.web_origin_mode)
    error_message = "web_origin_mode must be \"oac\" or \"website\"."
  }
}

variable "api_origin" {
  description = "How CloudFront reaches API Gateway. Defaults to the real execute-api hostname over HTTPS."
  type = object({
    domain_suffix = string
    protocol      = string
    http_port     = number
    https_port    = number
  })
  default = null
}

variable "cors_allowed_origins" {
  type    = list(string)
  default = ["*"]
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "fakecloud_origin_group_workaround" {
  description = <<-EOT
    fakecloud (<= 0.46) omits DistributionConfig.OriginGroups from GetDistribution when
    none were sent, and terraform-provider-aws dereferences it unconditionally (panic).
    When true, an unused origin group is declared so the field round-trips. Local only.
  EOT
  type        = bool
  default     = false
}

variable "attach_viewer_functions" {
  description = <<-EOT
    Attach the rewrite-index CloudFront Function to the default behavior. fakecloud
    (<= 0.46) parses FunctionAssociation.FunctionARN as "FunctionArn" and rejects the
    distribution, and does not run functions in-path anyway, so local sets false.
  EOT
  type        = bool
  default     = true
}

variable "fakecloud_directory_index_workaround" {
  description = "Also store <dir>/index.html under the key <dir>/ so fakecloud's S3 website endpoint serves directory URLs. Local only."
  type        = bool
  default     = false
}
