import { PublishCommand } from "@aws-sdk/client-sns";
import { clients, requireEnv } from "./aws.js";
import type { Application, ApplicationEvent, ApplicationEventType } from "./types.js";

/**
 * Publish a domain event to the application-events SNS topic. `eventType` is
 * also sent as a message attribute so subscriptions can use filter policies.
 */
export async function publishEvent(
  type: ApplicationEventType,
  app: Pick<Application, "id" | "status">,
  detail?: Record<string, unknown>,
): Promise<ApplicationEvent> {
  const event: ApplicationEvent = {
    type,
    applicationId: app.id,
    status: app.status,
    occurredAt: new Date().toISOString(),
    detail,
  };
  await clients.sns.send(
    new PublishCommand({
      TopicArn: requireEnv("EVENTS_TOPIC_ARN"),
      Message: JSON.stringify(event),
      MessageAttributes: {
        eventType: { DataType: "String", StringValue: type },
        status: { DataType: "String", StringValue: app.status },
      },
    }),
  );
  return event;
}

/** Unwrap an SQS body that may be a raw event or an SNS notification envelope. */
export function parseEventBody(body: string): ApplicationEvent {
  const parsed = JSON.parse(body);
  if (parsed && parsed.Type === "Notification" && typeof parsed.Message === "string") {
    return JSON.parse(parsed.Message);
  }
  return parsed;
}
