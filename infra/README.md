# Infrastructure

```
infra/
├── modules/
│   ├── app/              # everything the application needs: S3, DynamoDB, SNS, SQS+DLQs,
│   │                     # Lambdas + triggers, API Gateway, CloudFront (+ Function), Route 53 records
│   ├── kafka-msk/        # VPC + MSK cluster (fakecloud turns this into a real Kafka broker)
│   ├── kafka-confluent/  # Confluent Cloud environment, cluster, topic, service account, API key
│   └── worker-ecs/       # ECR, ECS Fargate service, IAM, Secrets Manager for the job worker
└── envs/
    ├── local/            # fakecloud: every provider endpoint -> http://localhost:4566
    └── aws/              # real AWS + Confluent Cloud
```

Both environments use the **same `app` module**. Differences are inputs, not
forks. The module's `fakecloud_*` variables switch on narrow compatibility
workarounds that the local environment needs. Each is documented in
[`docs/fakecloud-findings.md`](../docs/fakecloud-findings.md) and defaults to
`false`.

## Running Terraform

`scripts/tf.sh <env> <args…>` runs a local `terraform` if one is installed.
Otherwise it runs the official Docker image with the repo mounted at the same
path. In the container it points the provider at `host.docker.internal:4566`.

```bash
scripts/tf.sh local init
scripts/tf.sh local apply -auto-approve
scripts/tf.sh local output
```

`make infra` does the same. Local state is disposable: fakecloud keeps
everything in memory, so `make down` deletes `terraform.tfstate` too.

## Guard rails for the local environment

- **Every service endpoint is overridden**, including `s3control`, which the
  provider uses implicitly. An un-overridden service would send calls to real
  AWS (with dummy keys). See finding 12.
- `lambda_architecture` defaults to the Docker host's architecture (set by the
  Makefile) so Lambda containers never run under emulation.
