# Confluent Cloud Kafka: environment, cluster, topic and an API key scoped to a
# dedicated service account. Used by the aws environment.
terraform {
  required_providers {
    confluent = {
      source  = "confluentinc/confluent"
      version = "~> 2.0"
    }
  }
}

variable "name" {
  type = string
}

variable "cloud_region" {
  description = "AWS region for the Confluent cluster (keep it next to the workload)."
  type        = string
}

variable "topic" {
  type    = string
  default = "underwriting.jobs"
}

variable "partitions" {
  type    = number
  default = 3
}

resource "confluent_environment" "this" {
  display_name = var.name
}

resource "confluent_kafka_cluster" "this" {
  display_name = "${var.name}-jobs"
  availability = "SINGLE_ZONE"
  cloud        = "AWS"
  region       = var.cloud_region
  basic {}

  environment {
    id = confluent_environment.this.id
  }
}

resource "confluent_service_account" "worker" {
  display_name = "${var.name}-job-worker"
  description  = "Underwriting job worker (produce + consume ${var.topic})"
}

resource "confluent_role_binding" "worker" {
  principal   = "User:${confluent_service_account.worker.id}"
  role_name   = "CloudClusterAdmin"
  crn_pattern = confluent_kafka_cluster.this.rbac_crn
}

resource "confluent_api_key" "worker" {
  display_name = "${var.name}-job-worker"
  owner {
    id          = confluent_service_account.worker.id
    api_version = confluent_service_account.worker.api_version
    kind        = confluent_service_account.worker.kind
  }
  managed_resource {
    id          = confluent_kafka_cluster.this.id
    api_version = confluent_kafka_cluster.this.api_version
    kind        = confluent_kafka_cluster.this.kind
    environment {
      id = confluent_environment.this.id
    }
  }
  depends_on = [confluent_role_binding.worker]
}

resource "confluent_kafka_topic" "jobs" {
  topic_name       = var.topic
  partitions_count = var.partitions
  rest_endpoint    = confluent_kafka_cluster.this.rest_endpoint

  kafka_cluster {
    id = confluent_kafka_cluster.this.id
  }
  credentials {
    key    = confluent_api_key.worker.id
    secret = confluent_api_key.worker.secret
  }
}

output "bootstrap_servers" {
  value = replace(confluent_kafka_cluster.this.bootstrap_endpoint, "SASL_SSL://", "")
}

output "topic" {
  value = confluent_kafka_topic.jobs.topic_name
}

output "api_key" {
  value     = confluent_api_key.worker.id
  sensitive = true
}

output "api_secret" {
  value     = confluent_api_key.worker.secret
  sensitive = true
}
