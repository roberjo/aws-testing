import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  clients,
  getApplication,
  parseEventBody,
  publishEvent,
  requireEnv,
  transition,
  validateApplication,
  type UnderwritingJob,
} from "@poc/core";

/**
 * SQS (validation queue, fed by SNS with an eventType=ApplicationSubmitted
 * filter policy) -> business-rule validation.
 *  - invalid: REJECTED + ApplicationRejected event
 *  - valid:   VALIDATED + ApplicationValidated event + UnderwritingJob placed on
 *             the underwriting outbox queue, which the job worker relays to Kafka.
 * Uses partial batch responses so one bad message doesn't redrive the batch.
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      const evt = parseEventBody(record.body);
      const app = await getApplication(evt.applicationId);
      if (!app) throw new Error(`application ${evt.applicationId} not found`);

      const errors = validateApplication(app);
      if (errors.length) {
        const updated = await transition(app.id, ["SUBMITTED"], "REJECTED", { validationErrors: errors });
        if (updated) await publishEvent("ApplicationRejected", updated, { errors });
        continue;
      }

      const updated = await transition(app.id, ["SUBMITTED"], "VALIDATED");
      if (!updated) continue; // duplicate delivery; already handled

      const job: UnderwritingJob = { jobId: randomUUID(), applicationId: app.id, requestedAt: new Date().toISOString() };
      await clients.sqs.send(
        new SendMessageCommand({ QueueUrl: requireEnv("UNDERWRITING_QUEUE_URL"), MessageBody: JSON.stringify(job) }),
      );
      await publishEvent("ApplicationValidated", updated, { jobId: job.jobId });
    } catch (err) {
      console.error(JSON.stringify({ msg: "validation failed", messageId: record.messageId, error: String(err) }));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
