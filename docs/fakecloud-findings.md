# fakecloud evaluation findings

This is what we learned by building a realistic AWS application and deploying and
testing it **only** against [fakecloud](https://fakecloud.dev) (v0.46.0,
`ghcr.io/faiscadev/fakecloud:latest`, September 2026), using Terraform
(`hashicorp/aws` v6.66) and the AWS SDK for JavaScript v3.

Everything below was observed while building this repository. Each issue lists
the evidence, the workaround in this repo (all tagged `fakecloud` in comments,
so `grep -rn fakecloud infra/` finds them), and the suggested upstream fix.

## Verdict

fakecloud ran the **entire** application locally: ~70 Terraform-managed infrastructure resources, five
real Node.js 24 Lambdas, SNS fan-out with filter policies, SQS with DLQs,
DynamoDB Streams, S3 notifications, API Gateway, a CloudFront data plane, Route 53
DNS, and a **real Apache Kafka broker** provisioned through the MSK API. A cold
`make up` takes about 2 minutes. The 22-test suite (8 unit, 14 end-to-end) runs in
about 15 seconds against it.

It took 11 workarounds to get there, all small, local-only and documented. Two of
the underlying bugs would have silently broken production-shaped behavior in
tests (the SQS batching window and the redrive loop), and the tests caught them.
That is exactly the kind of fidelity question a POC like this should answer.

| Area | Works out of the box | Needed a workaround |
|---|---|---|
| Lambda (real containers, Node 24) | ✅ | credentials; warm-container env |
| SQS → Lambda ESM | ✅ basic, `ReportBatchItemFailures` | batching window; failure redrive |
| DynamoDB + Streams → Lambda (with `FilterCriteria`) | ✅ | |
| SNS → SQS (filter policies, raw delivery, SSE) | ✅ | |
| S3 → Lambda notifications, lifecycle, website | ✅ | directory index docs |
| API Gateway v2 HTTP API → Lambda | ✅ | integration URI form |
| CloudFront data plane (Host routing, path behaviors) | ✅ | origin groups; function association; error TTL |
| Route 53 + `--dns` resolver | ✅ | alias records; escaped wildcards |
| MSK → real Kafka broker | ✅ | broker address when fakecloud runs in Docker |
| Kafka → Lambda event source mapping | ❌ not implemented | worker consumes Kafka instead |
| Terraform provider round-trips | ✅ mostly | S3 Control tags; Lambda policy condition key |

## Issues found

### 1. CloudFront: `GetDistribution` omits empty `OriginGroups` → Terraform provider panic

- **Evidence:** `terraform-provider-aws` v6.66.0 crashes with a nil pointer dereference
  in `resourceDistributionFlatten` (`internal/service/cloudfront/distribution.go:1150`,
  `distributionConfig.OriginGroups.Quantity`). fakecloud models `origin_groups` as
  `Option<OriginGroups>` and only echoes it when the request included it. Real
  CloudFront always returns `<OriginGroups><Quantity>0</Quantity></OriginGroups>`.
- **Workaround:** `fakecloud_origin_group_workaround = true` declares an unused
  origin group so the field round-trips (`infra/modules/app/edge.tf`).
- **Upstream fix:** always serialize `OriginGroups` (and other list wrappers) with `Quantity 0`.

### 2. CloudFront: `FunctionAssociation.FunctionARN` parsed as `FunctionArn`

- **Evidence:** `UpdateDistribution` → `InvalidArgument: invalid DistributionConfig XML: missing field FunctionArn`.
  `model.rs` uses `#[serde(rename_all = "PascalCase")]` on `function_arn`. The Smithy
  member name is `FunctionARN`.
- **Workaround:** `attach_viewer_functions = false` locally. The function is still
  created and its logic is verified through `TestFunction`, which fakecloud does execute.
- **Upstream fix:** `#[serde(rename = "FunctionARN")]`.
- **Related, documented limitation:** CloudFront Functions and Lambda@Edge are not run in-path.

### 3. CloudFront: `ErrorCachingMinTTL` not persisted

- **Evidence:** `custom_error_response.error_caching_min_ttl = 10` read back as `0`, so every plan showed a diff.
- **Workaround:** the attribute is omitted.

### 4. SQS → Lambda: `MaximumBatchingWindowInSeconds` prevents delivery entirely

- **Evidence:** with a 1s window and a partial batch, the message sat on the queue
  indefinitely and the Lambda was never invoked. In `sqs_lambda_poller.rs` the
  poller sets `visible_at = now + VisibilityTimeout` on the batch *before* checking
  the window and then returns early. On the next tick the queue looks empty, so the
  window state is discarded. The message reappears 60s later and the cycle repeats.
- **Workaround:** the window is not set (AWS's default for SQS is 0).
- **Upstream fix:** only hide messages once the batch is actually dispatched.

### 5. SQS → Lambda: failed items retried in a hot loop and never dead-lettered

- **Evidence:** a poison message reported through `batchItemFailures` was redelivered
  immediately. It reached **receiveCount 932** in a few minutes despite the queue's
  60s visibility timeout and `maxReceiveCount = 3`. On failure the poller sets
  `visible_at = None`, and the redrive policy is not consulted.
- **Workaround:** the e2e test asserts redelivery happens, then performs the redrive
  AWS would do through `fc.sqs.forceDlq()` and asserts the DLQ receives the message.
- **Upstream fix:** keep failed messages invisible until the visibility timeout,
  and move them to the DLQ once `receive_count >= maxReceiveCount`.

### 6. Lambda: permission policy condition key casing

- **Evidence:** `GetPolicy` returns `"aws:SourceArn"`, but AWS returns `"AWS:SourceArn"`.
  The provider's lookup is case-sensitive, so `source_arn` reads back empty and every
  plan wants to **replace** the permission.
- **Workaround:** `lifecycle { ignore_changes = [source_arn] }` on both permissions.

### 7. Lambda: no execution-role credentials

- **Evidence:** the SDK inside the function failed with `Could not load credentials from any providers`.
- **Workaround:** the local env passes `AWS_ACCESS_KEY_ID/SECRET=test` as function
  environment variables. Real AWS reserves these names and injects role credentials itself.

### 8. Lambda: warm containers keep stale configuration

- **Evidence:** after `UpdateFunctionConfiguration` changed environment variables,
  invocations kept failing until `POST /_fakecloud/lambda/{fn}/evict-container`.
- **Workaround:** none needed after the first deploy. Evict, or `make down && make up`.

### 9. API Gateway v2: standard Lambda invoke ARN rejected

- **Evidence:** `integration_uri = aws_lambda_function.invoke_arn`
  (`arn:aws:apigateway:…:lambda:path/2015-03-31/functions/…/invocations`) →
  `501 NotImplemented: AWS_PROXY integration target not supported`.
- **Workaround:** use the function ARN, which HTTP APIs also accept on AWS. No local-only code.

### 10. S3 website endpoint: index document only at the root

- **Evidence:** `GET /apply/` → 404, but `GET /apply/index.html` → 200. Real S3 website
  hosting resolves `folder/` to `folder/index.html`.
- **Workaround:** `fakecloud_directory_index_workaround` also stores each page under its
  directory key (`apply/`), so deep links and reloads work locally.

### 11. Route 53 resolver: alias records and escaped wildcards

- **Evidence:** `A`/`AAAA` alias records to CloudFront resolve as `NODATA`. A
  `*.execute-api.<zone>` record is stored as `\052.execute-api.<zone>` (the correct
  Route 53 wire form), but the resolver doesn't match it (`NXDOMAIN`).
- **Workaround:** tests assert the alias target through the Route 53 API. The API
  origin uses an exact record name instead of a wildcard.

### 12. Terraform: S3 Control tagging not implemented; unrouted calls reach real AWS

- **Evidence:** when the provider knows the account ID it lists bucket tags through
  **S3 Control**. With no `s3control` endpoint override, those calls went to
  **real AWS** with the dummy `test` keys and were rejected (403). With the override
  they return 404 from fakecloud.
- **Workaround:** `skip_requesting_account_id = true` (as in fakecloud's own
  Terraform example), plus an `s3control` endpoint override so nothing can fall
  through to AWS. **Lesson:** override the endpoint of *every* service the provider
  might touch, not just the ones you declare resources for.

### 13. MSK: broker address is only reachable from containers

Not a bug, but it shapes the design. When fakecloud itself runs in Docker, the MSK
broker's bootstrap and advertised listener is `host.docker.internal:<port>`, which
does not resolve on a macOS host. The Kafka worker therefore runs as a container
(`docker compose --profile worker`), which is also how it ships to ECS.

### 14. Gap: no Kafka → Lambda event source mapping

fakecloud implements SQS, Kinesis and DynamoDB Streams mappings, but not MSK or
self-managed Kafka. Underwriting jobs are therefore consumed by the Node.js worker
(Confluent's `@confluentinc/kafka-javascript` client), not by a Lambda.

## What worked notably well

- **Real execution.** Lambdas ran in the official `public.ecr.aws/lambda/nodejs:24`
  images, and MSK started a real `apache/kafka:3.8.0` broker. Nothing is mocked.
- **CloudFront data plane.** Distributions are served on `:4566` by `Host` header,
  including alias CNAMEs, so a browser at `http://app.fcpoc.localhost:4566` gets the
  real CloudFront → S3 / API Gateway routing.
- **Introspection SDK.** `fc.lambda.getInvocations()`, `fc.sns.getMessages()`,
  `fc.sqs.getMessages()`, `fc.dnsResolve()` and `fc.apigatewayv2.getRequests()` made
  assertions on async side effects straightforward. Note that `getMessages()`
  returns SSE-encrypted queue bodies as ciphertext.
- **Endpoint rewriting.** `localhost` URLs in Lambda environment variables are
  rewritten to reach fakecloud from inside the container, so function code needs
  no emulator-specific logic.
- **Speed.** Startup takes under a second. The whole stack applies in about 90s,
  mostly pulling Lambda and Kafka images on first run.
