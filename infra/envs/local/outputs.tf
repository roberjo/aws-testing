output "app_url" {
  description = "Open in a browser (Chrome/Firefox/Safari resolve *.localhost to 127.0.0.1)."
  value       = "http://app.${var.domain}:4566"
}

output "app_domain" {
  value = "app.${var.domain}"
}

output "hosted_zone_id" {
  value = aws_route53_zone.main.zone_id
}

output "cloudfront_distribution_id" {
  value = module.app.cloudfront_distribution_id
}

output "cloudfront_domain_name" {
  value = module.app.cloudfront_domain_name
}

output "rewrite_function_name" {
  value = module.app.rewrite_function_name
}

output "api_id" {
  value = module.app.api_id
}

output "api_direct_url" {
  description = "API Gateway without CloudFront."
  value       = "http://${module.app.api_id}.execute-api.${var.domain}:4566"
}

output "table_name" {
  value = module.app.table_name
}

output "events_topic_arn" {
  value = module.app.events_topic_arn
}

output "queue_urls" {
  value = module.app.queue_urls
}

output "dlq_urls" {
  value = module.app.dlq_urls
}

output "buckets" {
  value = module.app.buckets
}

output "function_names" {
  value = module.app.function_names
}

output "kafka_cluster_arn" {
  value = module.kafka.cluster_arn
}

output "worker_env" {
  description = "Environment for services/job-worker (written to .env.local by scripts/worker-env.sh)."
  value = {
    AWS_ENDPOINT_URL       = "http://localhost:4566"
    AWS_REGION             = "us-east-1"
    AWS_ACCESS_KEY_ID      = "test"
    AWS_SECRET_ACCESS_KEY  = "test"
    TABLE_NAME             = module.app.table_name
    EVENTS_TOPIC_ARN       = module.app.events_topic_arn
    RESULTS_BUCKET         = module.app.buckets["results"]
    UNDERWRITING_QUEUE_URL = module.app.underwriting_queue_url
    KAFKA_CLUSTER_ARN      = module.kafka.cluster_arn
    KAFKA_TOPIC            = "underwriting.jobs"
  }
}
