output "app_url" {
  value = "${var.acm_certificate_arn == null ? "http" : "https"}://${var.app_domain}"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.site.domain_name
}

output "api_id" {
  value = aws_apigatewayv2_api.http.id
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "table_name" {
  value = aws_dynamodb_table.applications.name
}

output "events_topic_arn" {
  value = aws_sns_topic.events.arn
}

output "queue_urls" {
  value = { for k, q in aws_sqs_queue.work : k => q.url }
}

output "dlq_urls" {
  value = { for k, q in aws_sqs_queue.dlq : k => q.url }
}

output "underwriting_queue_url" {
  value = aws_sqs_queue.work["underwriting"].url
}

output "underwriting_queue_arn" {
  value = aws_sqs_queue.work["underwriting"].arn
}

output "buckets" {
  value = merge({ for k, b in aws_s3_bucket.data : k => b.bucket }, { web = aws_s3_bucket.web.bucket })
}

output "function_names" {
  value = { for k, f in aws_lambda_function.fn : k => f.function_name }
}

output "results_bucket_arn" {
  value = aws_s3_bucket.data["results"].arn
}

output "table_arn" {
  value = aws_dynamodb_table.applications.arn
}

output "rewrite_function_name" {
  value = aws_cloudfront_function.rewrite_index.name
}
