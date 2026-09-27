import { describe, expect, it } from "vitest";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { PurgeQueueCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  api,
  applicant,
  awsConfig,
  eventually,
  fc,
  invocationsOf,
  postJson,
  tf,
  viaCloudFront,
  waitForStatus,
} from "./support.js";

const s3 = new S3Client({ ...awsConfig, forcePathStyle: true });
const sqs = new SQSClient(awsConfig);
const ddb = new DynamoDBClient(awsConfig);

describe("event-driven application pipeline", () => {
  it("approves a strong application: API -> SNS -> SQS -> validator -> SQS -> Kafka -> worker", async () => {
    const { status, body: created } = await postJson("/applications", applicant());
    expect(status).toBe(202);
    expect(created.status).toBe("SUBMITTED");

    const decided = await waitForStatus(created.id, ["APPROVED", "DECLINED"]);
    expect(decided.status).toBe("APPROVED");
    expect(decided.decision).toMatchObject({ outcome: "APPROVED" });
    expect(decided.decision.apr).toBeGreaterThan(0);
    expect(decided.underwritingJobId).toBeTruthy();

    // Decision letter written to S3 by the Kafka consumer.
    const letter = await s3.send(
      new GetObjectCommand({ Bucket: tf().buckets.results, Key: decided.decisionLetterKey }),
    );
    expect(letter.Metadata?.outcome).toBe("APPROVED");
    expect(JSON.parse(await letter.Body!.transformToString())).toMatchObject({ applicationId: created.id });

    // Every domain event was published to SNS...
    const { messages } = await fc.sns.getMessages();
    const types = messages
      .filter((m) => m.topicArn === tf().events_topic_arn)
      .map((m) => JSON.parse(m.message))
      .filter((e) => e.applicationId === created.id)
      .map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(["ApplicationSubmitted", "ApplicationValidated", "ApplicationDecided"]),
    );

    // ...and the audit Lambda turned them into a timeline (eventually consistent).
    const timeline = await eventually(
      async () => {
        const { body } = await api(`/applications/${created.id}`);
        return body.timeline?.length >= 3 ? body.timeline : undefined;
      },
      { what: "audit timeline" },
    );
    expect(timeline.map((e: any) => e.type)).toContain("ApplicationDecided");

    const audited = await s3.send(
      new ListObjectsV2Command({ Bucket: tf().buckets.audit, Prefix: "events/" }),
    );
    expect(audited.Contents?.some((o) => o.Key!.includes(created.id))).toBe(true);

    // The decision is downloadable through the API.
    const { status: letterStatus, body: letterBody } = await api(`/applications/${created.id}/decision`);
    expect(letterStatus).toBe(200);
    expect(letterBody.outcome).toBe("APPROVED");
  });

  it("declines a risky application during underwriting", async () => {
    const { body } = await postJson("/applications", applicant({ creditScore: 540, amount: 90_000, annualIncome: 45_000 }));
    const decided = await waitForStatus(body.id, ["APPROVED", "DECLINED"]);
    expect(decided.status).toBe("DECLINED");
    expect(decided.decision.reasons.length).toBeGreaterThan(0);
  });

  it("rejects business-rule violations in the validator without reaching Kafka", async () => {
    const { body } = await postJson("/applications", applicant({ email: "not-an-email", termMonths: 7 }));
    const rejected = await waitForStatus(body.id, ["REJECTED"]);
    expect(rejected.validationErrors).toEqual(
      expect.arrayContaining(["email is not a valid address", expect.stringContaining("termMonths")]),
    );
    expect(rejected.underwritingJobId).toBeUndefined();
    expect((await api(`/applications/${body.id}/decision`)).status).toBe(404);
  });

  it("loads a bulk CSV upload: API -> S3 -> ingest Lambda -> pipeline", async () => {
    const tag = Date.now();
    const csv = [
      "applicantName,email,amount,annualIncome,creditScore,termMonths",
      `"Bulk, Alice ${tag}",alice@example.com,12000,95000,790,24`,
      `Bulk Bob ${tag},bob@example.com,80000,40000,560,60`,
      `Bulk Carol ${tag},carol-at-example,5000,50000,700,36`,
    ].join("\n");

    const res = await api("/uploads", { method: "POST", headers: { "content-type": "text/csv" }, body: csv });
    expect(res.status).toBe(202);
    expect(res.body.key).toMatch(/^uploads\/.*\.csv$/);

    const rows = await eventually(
      async () => {
        const { body } = await api("/applications");
        const mine = body.items.filter((a: any) => a.applicantName.includes(String(tag)));
        return mine.length === 3 && mine.every((a: any) => ["APPROVED", "DECLINED", "REJECTED"].includes(a.status))
          ? mine
          : undefined;
      },
      { what: "bulk rows to finish processing" },
    );

    const byName = Object.fromEntries(rows.map((a: any) => [a.applicantName.split(" ")[1].replace(",", ""), a]));
    expect(byName.Alice.status).toBe("APPROVED");
    expect(byName.Bob.status).toBe("DECLINED");
    expect(byName.Carol.status).toBe("REJECTED");
    expect(rows.every((a: any) => a.source === "bulk-upload")).toBe(true);

    const ingests = await invocationsOf(tf().function_names.ingest);
    expect(ingests.some((i) => i.payload.includes(res.body.key))).toBe(true);
  });

  it("keeps stats in sync via the DynamoDB stream projector", async () => {
    const { body } = await postJson("/applications", applicant());
    await waitForStatus(body.id, ["APPROVED"]);

    // The projector is eventually consistent, so compare the counters against
    // the source of truth (every application row) until they converge, rather
    // than against a before/after snapshot that can race earlier tests.
    const truth = async () => {
      const counts: Record<string, number> = {};
      let total = 0;
      let ExclusiveStartKey: Record<string, any> | undefined;
      do {
        const page = await ddb.send(
          new QueryCommand({
            TableName: tf().table_name,
            IndexName: "gsi1",
            KeyConditionExpression: "gsi1pk = :p",
            ExpressionAttributeValues: { ":p": { S: "APPLICATION" } },
            ExpressionAttributeNames: { "#s": "status" },
            ProjectionExpression: "#s",
            ExclusiveStartKey,
          }),
        );
        for (const item of page.Items ?? []) {
          total++;
          counts[item.status.S!] = (counts[item.status.S!] ?? 0) + 1;
        }
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return { total, counts };
    };

    const converged = await eventually(
      async () => {
        const [{ body: stats }, actual] = await Promise.all([api("/stats"), truth()]);
        const matches =
          stats.total === actual.total &&
          Object.entries(stats.byStatus).every(([k, v]) => v === (actual.counts[k] ?? 0));
        return matches ? stats : undefined;
      },
      { what: "stats projection to match the table" },
    );
    expect(converged.byStatus.APPROVED).toBeGreaterThanOrEqual(1);
    expect((await invocationsOf(tf().function_names.projector)).length).toBeGreaterThan(0);
  });

  it("ignores duplicate deliveries (at-least-once safety)", async () => {
    const { body } = await postJson("/applications", applicant());
    const decided = await waitForStatus(body.id, ["APPROVED"]);

    // Replay the original SubmittedEvent straight onto the validation queue.
    const deliveries = async () =>
      (await invocationsOf(tf().function_names.validator)).filter((i) => i.payload.includes(body.id)).length;
    const before = await deliveries();
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: tf().queue_urls.validation,
        MessageBody: JSON.stringify({
          type: "ApplicationSubmitted",
          applicationId: body.id,
          status: "SUBMITTED",
          occurredAt: new Date().toISOString(),
        }),
      }),
    );
    await eventually(async () => (await deliveries()) > before, { what: "replayed message to be delivered" });

    const after = (await api(`/applications/${body.id}`)).body;
    expect(after.status).toBe("APPROVED");
    expect(after.updatedAt).toBe(decided.updatedAt);
  });

  it("reports partial batch failures so poison messages are retried, then dead-lettered", async () => {
    const poison = `missing-${Date.now()}`;
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: tf().queue_urls.validation,
        MessageBody: JSON.stringify({ type: "ApplicationSubmitted", applicationId: poison }),
      }),
    );

    // The validator runs and reports the record in batchItemFailures, so the
    // message is not deleted and is redelivered with a rising receive count.
    await eventually(
      async () => {
        const deliveries = (await invocationsOf(tf().function_names.validator)).filter((i) =>
          i.payload.includes(poison),
        );
        return deliveries.length >= 2;
      },
      { what: "poison message to be redelivered" },
    );

    // AWS moves the message to the DLQ after maxReceiveCount (3) receives.
    // fakecloud <= 0.46 does not apply redrive for event-source-mapping
    // failures, so perform that step through its admin API and verify the DLQ.
    // (Retried because the message may be in flight at the moment we force.)
    await eventually(
      async () => {
        await fc.sqs.forceDlq("fcpoc-validation");
        const dlq = await sqs.send(
          new ReceiveMessageCommand({ QueueUrl: tf().dlq_urls.validation, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }),
        );
        return dlq.Messages?.some((m) => m.Body?.includes(poison));
      },
      { what: "poison message in the DLQ", timeoutMs: 30_000 },
    );
    await sqs.send(new PurgeQueueCommand({ QueueUrl: tf().dlq_urls.validation }));
  });
});
