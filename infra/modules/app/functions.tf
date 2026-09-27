# ---------------------------------------------------------------------------
# IAM — one execution role per function, scoped to what that function touches
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

locals {
  table_arns = [aws_dynamodb_table.applications.arn, "${aws_dynamodb_table.applications.arn}/index/*"]

  function_permissions = {
    api = [
      { actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"], resources = local.table_arns },
      { actions = ["sns:Publish"], resources = [aws_sns_topic.events.arn] },
      { actions = ["s3:PutObject"], resources = ["${aws_s3_bucket.data["intake"].arn}/uploads/*"] },
      { actions = ["s3:GetObject"], resources = ["${aws_s3_bucket.data["results"].arn}/*"] },
      { actions = ["s3:ListBucket"], resources = [aws_s3_bucket.data["results"].arn] },
    ]
    ingest = [
      { actions = ["s3:GetObject"], resources = ["${aws_s3_bucket.data["intake"].arn}/*"] },
      { actions = ["dynamodb:PutItem"], resources = local.table_arns },
      { actions = ["sns:Publish"], resources = [aws_sns_topic.events.arn] },
    ]
    validator = [
      { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [aws_sqs_queue.work["validation"].arn] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.work["underwriting"].arn] },
      { actions = ["dynamodb:GetItem", "dynamodb:UpdateItem"], resources = local.table_arns },
      { actions = ["sns:Publish"], resources = [aws_sns_topic.events.arn] },
    ]
    audit = [
      { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [aws_sqs_queue.work["audit"].arn] },
      { actions = ["dynamodb:PutItem"], resources = local.table_arns },
      { actions = ["s3:PutObject"], resources = ["${aws_s3_bucket.data["audit"].arn}/*"] },
    ]
    projector = [
      { actions = ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:ListStreams"], resources = [aws_dynamodb_table.applications.stream_arn] },
      { actions = ["dynamodb:UpdateItem"], resources = local.table_arns },
    ]
  }
}

resource "aws_iam_role" "fn" {
  for_each           = local.handlers
  name               = "${var.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "logs" {
  for_each   = local.handlers
  role       = aws_iam_role.fn[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "fn" {
  for_each = local.function_permissions
  dynamic "statement" {
    for_each = each.value
    content {
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource "aws_iam_role_policy" "fn" {
  for_each = data.aws_iam_policy_document.fn
  name     = "${var.name}-${each.key}"
  role     = aws_iam_role.fn[each.key].id
  policy   = each.value.json
}

# ---------------------------------------------------------------------------
# Lambda functions — bundled by services/functions/build.mjs
# ---------------------------------------------------------------------------
data "archive_file" "fn" {
  for_each    = local.handlers
  type        = "zip"
  source_dir  = "${var.functions_dist_dir}/${each.key}"
  output_path = "${path.root}/build/${each.key}.zip"
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.handlers
  name              = "/aws/lambda/${var.name}-${each.key}"
  retention_in_days = 14
  tags              = var.tags
}

resource "aws_lambda_function" "fn" {
  for_each         = local.handlers
  function_name    = "${var.name}-${each.key}"
  role             = aws_iam_role.fn[each.key].arn
  runtime          = var.lambda_runtime
  handler          = "index.handler"
  filename         = data.archive_file.fn[each.key].output_path
  source_code_hash = data.archive_file.fn[each.key].output_base64sha256
  architectures    = [var.lambda_architecture]
  memory_size      = 256
  timeout          = 30

  environment {
    variables = merge({
      TABLE_NAME             = aws_dynamodb_table.applications.name
      EVENTS_TOPIC_ARN       = aws_sns_topic.events.arn
      INTAKE_BUCKET          = aws_s3_bucket.data["intake"].bucket
      RESULTS_BUCKET         = aws_s3_bucket.data["results"].bucket
      AUDIT_BUCKET           = aws_s3_bucket.data["audit"].bucket
      UNDERWRITING_QUEUE_URL = aws_sqs_queue.work["underwriting"].url
      NODE_OPTIONS           = "--enable-source-maps"
    }, var.lambda_environment)
  }

  depends_on = [aws_cloudwatch_log_group.fn, aws_iam_role_policy_attachment.logs]
  tags       = var.tags
}

# ---------------------------------------------------------------------------
# Triggers
# ---------------------------------------------------------------------------
resource "aws_lambda_permission" "s3_ingest" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn["ingest"].function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.data["intake"].arn

  # fakecloud (<= 0.46) returns the condition key as "aws:SourceArn" rather than
  # AWS's "AWS:SourceArn", so the provider reads source_arn back as empty and
  # would replace the permission on every plan.
  lifecycle {
    ignore_changes = [source_arn]
  }
}

resource "aws_lambda_event_source_mapping" "validation" {
  function_name           = aws_lambda_function.fn["validator"].arn
  event_source_arn        = aws_sqs_queue.work["validation"].arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
  tags                    = var.tags
}

resource "aws_lambda_event_source_mapping" "audit" {
  function_name    = aws_lambda_function.fn["audit"].arn
  event_source_arn = aws_sqs_queue.work["audit"].arn
  batch_size       = 10
  tags             = var.tags
}

# Only application rows (sk=META) move the counters; timeline/stat rows are ignored.
resource "aws_lambda_event_source_mapping" "projector" {
  function_name     = aws_lambda_function.fn["projector"].arn
  event_source_arn  = aws_dynamodb_table.applications.stream_arn
  starting_position = "TRIM_HORIZON"
  batch_size        = 25
  tags              = var.tags

  filter_criteria {
    filter {
      pattern = jsonencode({ dynamodb = { Keys = { sk = { S = ["META"] } } } })
    }
  }
}
