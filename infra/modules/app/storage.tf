# ---------------------------------------------------------------------------
# DynamoDB — single table with a listing GSI and a stream for the projector
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "applications" {
  name             = "${var.name}-applications"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "pk"
  range_key        = "sk"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1"
    projection_type = "ALL"
    key_schema {
      attribute_name = "gsi1pk"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "gsi1sk"
      key_type       = "RANGE"
    }
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# S3 — intake (bulk CSV uploads), results (decision letters), audit (events)
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "data" {
  for_each      = toset(["intake", "results", "audit"])
  bucket        = "${var.name}-${each.key}"
  force_destroy = true
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "data" {
  for_each                = aws_s3_bucket.data
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "intake" {
  bucket = aws_s3_bucket.data["intake"].id
  rule {
    id     = "expire-processed-uploads"
    status = "Enabled"
    filter {
      prefix = "uploads/"
    }
    expiration {
      days = 30
    }
  }
}

resource "aws_s3_bucket_notification" "intake" {
  bucket = aws_s3_bucket.data["intake"].id

  lambda_function {
    lambda_function_arn = aws_lambda_function.fn["ingest"].arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "uploads/"
    filter_suffix       = ".csv"
  }

  depends_on = [aws_lambda_permission.s3_ingest]
}
