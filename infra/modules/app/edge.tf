# ---------------------------------------------------------------------------
# Web bucket — holds the Next.js static export
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "web" {
  bucket        = "${var.name}-web"
  force_destroy = true
  tags          = var.tags
}

locals {
  website = var.web_origin_mode == "website"
}

# "website" mode: public S3 website endpoint as a custom origin.
resource "aws_s3_bucket_website_configuration" "web" {
  count  = local.website ? 1 : 0
  bucket = aws_s3_bucket.web.id
  index_document {
    suffix = "index.html"
  }
  error_document {
    key = "404.html"
  }
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = !local.website
  restrict_public_buckets = !local.website
}

data "aws_iam_policy_document" "web" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = local.website ? "*" : "Service"
      identifiers = local.website ? ["*"] : ["cloudfront.amazonaws.com"]
    }

    dynamic "condition" {
      for_each = local.website ? [] : [1]
      content {
        test     = "StringEquals"
        variable = "AWS:SourceArn"
        values   = [aws_cloudfront_distribution.site.arn]
      }
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket     = aws_s3_bucket.web.id
  policy     = data.aws_iam_policy_document.web.json
  depends_on = [aws_s3_bucket_public_access_block.web]
}

# "oac" mode: private bucket, CloudFront signs requests with SigV4.
resource "aws_cloudfront_origin_access_control" "web" {
  count                             = local.website ? 0 : 1
  name                              = "${var.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ---------------------------------------------------------------------------
# Site content. The runtime config tells the SPA where the API lives, so the
# same build works in every environment.
# ---------------------------------------------------------------------------
locals {
  # config.json is owned by aws_s3_object.runtime_config, not the build.
  web_files = var.web_dist_dir == null ? toset([]) : setsubtract(fileset(var.web_dist_dir, "**"), ["config.json"])
  mime = {
    html  = "text/html; charset=utf-8"
    js    = "application/javascript"
    css   = "text/css"
    json  = "application/json"
    txt   = "text/plain; charset=utf-8"
    svg   = "image/svg+xml"
    ico   = "image/x-icon"
    png   = "image/png"
    woff2 = "font/woff2"
  }
}

resource "aws_s3_object" "site" {
  for_each      = local.web_files
  bucket        = aws_s3_bucket.web.id
  key           = each.value
  source        = "${var.web_dist_dir}/${each.value}"
  etag          = filemd5("${var.web_dist_dir}/${each.value}")
  content_type  = lookup(local.mime, reverse(split(".", each.value))[0], "application/octet-stream")
  cache_control = startswith(each.value, "_next/static/") ? "public, max-age=31536000, immutable" : "no-cache"
}

# fakecloud (<= 0.46) applies the website index document only at the bucket
# root, so a hard load of /apply/ would 404. Store each page again under its
# directory key, which the emulator serves verbatim. Local only.
resource "aws_s3_object" "directory_index" {
  for_each = var.fakecloud_directory_index_workaround ? toset([
    for f in local.web_files : trimsuffix(f, "index.html") if endswith(f, "/index.html")
  ]) : toset([])
  bucket        = aws_s3_bucket.web.id
  key           = each.value
  source        = "${var.web_dist_dir}/${each.value}index.html"
  etag          = filemd5("${var.web_dist_dir}/${each.value}index.html")
  content_type  = local.mime.html
  cache_control = "no-cache"
}

resource "aws_s3_object" "runtime_config" {
  bucket        = aws_s3_bucket.web.id
  key           = "config.json"
  content_type  = "application/json"
  cache_control = "no-cache"
  content = jsonencode({
    apiBaseUrl  = "/api"
    environment = var.name
  })
}

# ---------------------------------------------------------------------------
# CloudFront — / from S3, /api/* to API Gateway (uncached)
# ---------------------------------------------------------------------------
locals {
  web_origin_id = "web"
  api_origin_id = "api"
  # AWS managed policies
  caching_optimized             = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  caching_disabled              = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  all_viewer_except_host_header = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
}

resource "aws_cloudfront_function" "rewrite_index" {
  name    = "${var.name}-rewrite-index"
  runtime = "cloudfront-js-2.0"
  comment = "Directory URLs -> index.html for the static export"
  publish = true
  code    = file("${path.module}/functions/rewrite-index.js")
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "${var.name} web + api"
  default_root_object = "index.html"
  aliases             = [var.app_domain]
  price_class         = "PriceClass_100"
  http_version        = "http2and3"

  origin {
    origin_id                = local.web_origin_id
    domain_name              = local.website ? aws_s3_bucket_website_configuration.web[0].website_endpoint : aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = local.website ? null : aws_cloudfront_origin_access_control.web[0].id

    dynamic "custom_origin_config" {
      for_each = local.website ? [1] : []
      content {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "http-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  # See var.fakecloud_origin_group_workaround. Not referenced by any behavior.
  dynamic "origin" {
    for_each = var.fakecloud_origin_group_workaround ? [1] : []
    content {
      origin_id   = "${local.web_origin_id}-secondary"
      domain_name = aws_s3_bucket_website_configuration.web[0].website_endpoint
      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "http-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  dynamic "origin_group" {
    for_each = var.fakecloud_origin_group_workaround ? [1] : []
    content {
      origin_id = "${local.web_origin_id}-group"
      failover_criteria {
        status_codes = [500, 502, 503, 504]
      }
      member {
        origin_id = local.web_origin_id
      }
      member {
        origin_id = "${local.web_origin_id}-secondary"
      }
    }
  }

  origin {
    origin_id   = local.api_origin_id
    domain_name = "${aws_apigatewayv2_api.http.id}.${local.api_origin.domain_suffix}"

    custom_origin_config {
      http_port              = local.api_origin.http_port
      https_port             = local.api_origin.https_port
      origin_protocol_policy = local.api_origin.protocol
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = local.web_origin_id
    viewer_protocol_policy = var.acm_certificate_arn == null ? "allow-all" : "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = local.caching_optimized
    compress               = true

    dynamic "function_association" {
      for_each = var.attach_viewer_functions ? [1] : []
      content {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.rewrite_index.arn
      }
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = local.api_origin_id
    viewer_protocol_policy   = var.acm_certificate_arn == null ? "allow-all" : "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = local.caching_disabled
    origin_request_policy_id = local.all_viewer_except_host_header
  }

  # Custom error responses apply to every origin, including /api/*, so a
  # blanket 404 page would replace the API's JSON 404s. Website mode already
  # serves 404.html via the bucket's error document; a private (OAC) bucket
  # answers 403 for missing keys, which the API never returns.
  dynamic "custom_error_response" {
    for_each = local.website ? [] : [1]
    content {
      error_code         = 403
      response_code      = 404
      response_page_path = "/404.html"
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == null
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = var.acm_certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.acm_certificate_arn == null ? null : "TLSv1.2_2021"
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# Route 53 — app domain -> CloudFront
# ---------------------------------------------------------------------------
resource "aws_route53_record" "app" {
  for_each = toset(["A", "AAAA"])
  zone_id  = var.hosted_zone_id
  name     = var.app_domain
  type     = each.key

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
