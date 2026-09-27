import type { SQSEvent } from "aws-lambda";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { clients, parseEventBody, recordTimelineEvent, requireEnv } from "@poc/core";

/**
 * SQS (audit queue, raw SNS delivery of every event) -> timeline rows in
 * DynamoDB plus an immutable JSON copy in the audit bucket.
 */
export async function handler(event: SQSEvent) {
  for (const record of event.Records) {
    const evt = parseEventBody(record.body);
    await recordTimelineEvent(evt);
    const day = evt.occurredAt.slice(0, 10);
    await clients.s3.send(
      new PutObjectCommand({
        Bucket: requireEnv("AUDIT_BUCKET"),
        Key: `events/${day}/${evt.applicationId}/${evt.occurredAt}-${evt.type}.json`,
        Body: JSON.stringify(evt),
        ContentType: "application/json",
      }),
    );
  }
}
