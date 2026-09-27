# Tests

| Suite | Location | Needs | What it proves |
|---|---|---|---|
| Unit | `packages/core/src/*.test.ts` | nothing | validation rules, underwriting model, CSV parsing, SNS envelope handling |
| End-to-end | `tests/e2e/*.test.ts` | `make up` | the deployed stack behaves correctly through every AWS hop, on fakecloud |

```bash
make test-unit
make up && make test-e2e
```

## How the e2e suite works

- **Black-box entry points only.** Requests go through CloudFront the way a
  browser's would: to `localhost:4566` with `Host: app.fcpoc.localhost`. fakecloud
  routes that to the distribution, then to S3 or API Gateway.
- **Assert on side effects with the fakecloud SDK.** `fc.lambda.getInvocations()`,
  `fc.sns.getMessages()`, `fc.sqs.getMessages()`, `fc.dnsResolve()` and
  `fc.apigatewayv2.getRequests()` inspect what really happened, alongside normal AWS
  SDK reads of S3, SQS and Route 53.
- **Poll, don't sleep.** The pipeline is asynchronous. `eventually()` retries
  until a condition holds or times out.
- **No reset between tests.** `fc.reset()` would delete the Terraform-provisioned
  stack, so tests use unique data and filter by it.
- Terraform outputs are loaded once in `e2e/global-setup.ts`.

## Coverage

`platform.test.ts`: Route 53 alias record and zone authority; API origin
resolution through fakecloud's DNS; static site, deep links and runtime config
through CloudFront; the CloudFront Function via `TestFunction`; `/api/*` routing
to API Gateway and Lambda; synchronous input validation.

`pipeline.test.ts`: approved path end to end (SNS → SQS → validator → outbox →
Kafka → worker → S3 letter → audit timeline); declined path; validator
rejection that never reaches Kafka; bulk CSV (API → S3 → ingest Lambda); stats
via DynamoDB Streams; duplicate delivery idempotency; partial batch failure and
dead-lettering.
