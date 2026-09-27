# ---------------------------------------------------------------------------
# SNS — every domain event goes to one topic and fans out by filter policy
# ---------------------------------------------------------------------------
resource "aws_sns_topic" "events" {
  name = "${var.name}-application-events"
  tags = var.tags
}

# ---------------------------------------------------------------------------
# SQS — each work queue gets a DLQ with a redrive policy
# ---------------------------------------------------------------------------
locals {
  queues = {
    validation   = { visibility = 60 }  # SNS(ApplicationSubmitted) -> validator Lambda
    audit        = { visibility = 60 }  # SNS(all events)           -> audit Lambda
    underwriting = { visibility = 120 } # validator Lambda          -> job worker -> Kafka
  }
}

resource "aws_sqs_queue" "dlq" {
  for_each                  = local.queues
  name                      = "${var.name}-${each.key}-dlq"
  message_retention_seconds = 1209600
  tags                      = var.tags
}

resource "aws_sqs_queue" "work" {
  for_each                   = local.queues
  name                       = "${var.name}-${each.key}"
  visibility_timeout_seconds = each.value.visibility
  receive_wait_time_seconds  = 10
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = 3
  })
  tags = var.tags
}

data "aws_iam_policy_document" "sns_to_sqs" {
  for_each = toset(["validation", "audit"])
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.work[each.key].arn]
    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_sns_topic.events.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "sns_to_sqs" {
  for_each  = data.aws_iam_policy_document.sns_to_sqs
  queue_url = aws_sqs_queue.work[each.key].id
  policy    = each.value.json
}

# Only newly submitted applications need validating.
resource "aws_sns_topic_subscription" "validation" {
  topic_arn            = aws_sns_topic.events.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.work["validation"].arn
  raw_message_delivery = true
  filter_policy_scope  = "MessageAttributes"
  filter_policy        = jsonencode({ eventType = ["ApplicationSubmitted"] })
}

# The audit trail wants everything.
resource "aws_sns_topic_subscription" "audit" {
  topic_arn            = aws_sns_topic.events.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.work["audit"].arn
  raw_message_delivery = true
}
