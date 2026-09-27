import type { DynamoDBStreamEvent } from "aws-lambda";
import { adjustStats, type ApplicationStatus } from "@poc/core";

/**
 * DynamoDB Streams (NEW_AND_OLD_IMAGES, filtered to sk=META items) -> keeps the
 * STATS counters in sync with application status changes.
 */
export async function handler(event: DynamoDBStreamEvent) {
  for (const record of event.Records) {
    const oldStatus = record.dynamodb?.OldImage?.status?.S as ApplicationStatus | undefined;
    const newStatus = record.dynamodb?.NewImage?.status?.S as ApplicationStatus | undefined;
    if (oldStatus === newStatus) continue;

    const deltas: Partial<Record<ApplicationStatus | "total", number>> = {};
    if (record.eventName === "INSERT") deltas.total = 1;
    if (record.eventName === "REMOVE") deltas.total = -1;
    if (oldStatus) deltas[oldStatus] = (deltas[oldStatus] ?? 0) - 1;
    if (newStatus) deltas[newStatus] = (deltas[newStatus] ?? 0) + 1;
    await adjustStats(deltas);
  }
}
