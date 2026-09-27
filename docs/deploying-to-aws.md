# Deploying to real AWS

`infra/envs/aws` deploys the same application module to AWS, with Confluent
Cloud for Kafka and the job worker on ECS Fargate. It exists to show that the
fakecloud-tested stack is the real thing, not a local-only variant.

> **Status:** `terraform validate` passes and the module is shared with the
> fakecloud stack, but this environment has **not** been applied to a real AWS
> account as part of this POC. Treat it as a starting point and review costs
> (CloudFront, NAT-free Fargate, a Confluent Basic cluster) before applying.

## Prerequisites

- An AWS account and credentials in your shell (`aws sts get-caller-identity`)
- A public Route 53 hosted zone you control (e.g. `example.com`)
- A Confluent Cloud account with a Cloud API key:
  `export CONFLUENT_CLOUD_API_KEY=… CONFLUENT_CLOUD_API_SECRET=…`
- Docker, to build and push the worker image

## Steps

```bash
make build                                   # Lambdas + static site

cd infra/envs/aws
terraform init                               # configure the S3 backend in main.tf first
terraform apply -var domain=example.com

# push the worker image to the ECR repo Terraform created, then redeploy
REPO=$(terraform output -raw worker_ecr_repository)
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
docker build --platform linux/arm64 -f ../../../services/job-worker/Dockerfile -t "$REPO:latest" ../../..
docker push "$REPO:latest"
aws ecs update-service --cluster loandesk-workers --service loandesk-job-worker --force-new-deployment
```

The app is served at `https://app.example.com`.

## What differs from the local stack

- **Private web bucket** with Origin Access Control, plus the `rewrite-index`
  CloudFront Function for directory URLs (`web_origin_mode = "oac"`).
- **ACM certificate** (us-east-1) with DNS validation in your zone.
- **Confluent Cloud:** environment, Basic cluster, `underwriting.jobs` topic, and
  a service account whose API key is stored in Secrets Manager and injected into
  the ECS task.
- **No fakecloud workarounds.** Every `fakecloud_*` variable in the app module
  defaults to off.
- CORS on the HTTP API is restricted to `https://app.<domain>`.
