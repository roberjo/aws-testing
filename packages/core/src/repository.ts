import { randomUUID } from "node:crypto";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { clients, requireEnv } from "./aws.js";
import {
  ALL_STATUSES,
  type Application,
  type ApplicationEvent,
  type ApplicationInput,
  type ApplicationSource,
  type ApplicationStatus,
  type Stats,
} from "./types.js";

/**
 * Single-table layout:
 *   pk=APP#<id>  sk=META                      -> the application
 *   pk=APP#<id>  sk=EVT#<iso>#<type>          -> timeline entry (written by audit Lambda)
 *   pk=STATS     sk=GLOBAL                    -> counters (written by stream projector)
 * GSI1 (gsi1pk="APPLICATION", gsi1sk=<createdAt>#<id>) lists applications newest-first.
 */
const table = () => requireEnv("TABLE_NAME");
const appKey = (id: string) => ({ pk: `APP#${id}`, sk: "META" });

type AppItem = Application & { pk: string; sk: string; gsi1pk: string; gsi1sk: string };

function strip(item: Record<string, unknown>): Application {
  const { pk: _pk, sk: _sk, gsi1pk: _g1, gsi1sk: _g2, ...app } = item;
  return app as unknown as Application;
}

export async function createApplication(
  input: ApplicationInput,
  source: ApplicationSource,
  id: string = randomUUID(),
): Promise<Application> {
  const now = new Date().toISOString();
  const app: Application = { ...input, id, source, status: "SUBMITTED", createdAt: now, updatedAt: now };
  const item: AppItem = { ...app, ...appKey(id), gsi1pk: "APPLICATION", gsi1sk: `${now}#${id}` };
  await clients.ddb.send(
    new PutCommand({ TableName: table(), Item: item, ConditionExpression: "attribute_not_exists(pk)" }),
  );
  return app;
}

export async function getApplication(id: string): Promise<Application | undefined> {
  const res = await clients.ddb.send(new GetCommand({ TableName: table(), Key: appKey(id), ConsistentRead: true }));
  return res.Item ? strip(res.Item) : undefined;
}

export async function listApplications(limit = 50): Promise<Application[]> {
  const res = await clients.ddb.send(
    new QueryCommand({
      TableName: table(),
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :p",
      ExpressionAttributeValues: { ":p": "APPLICATION" },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (res.Items ?? []).map(strip);
}

/**
 * Move an application to a new status, but only from one of the expected
 * states. Guards against duplicate / out-of-order deliveries, which every
 * at-least-once hop in this pipeline (SNS, SQS, Kafka) can produce.
 * Returns the updated application, or undefined if the transition was stale.
 */
export async function transition(
  id: string,
  from: ApplicationStatus[],
  to: ApplicationStatus,
  extra: Partial<Application> = {},
): Promise<Application | undefined> {
  const sets = ["#status = :to", "updatedAt = :now"];
  const names: Record<string, string> = { "#status": "status" };
  const values: Record<string, unknown> = { ":to": to, ":now": new Date().toISOString() };
  Object.entries(extra).forEach(([k, v], i) => {
    names[`#x${i}`] = k;
    values[`:x${i}`] = v;
    sets.push(`#x${i} = :x${i}`);
  });
  const fromKeys = from.map((s, i) => {
    values[`:f${i}`] = s;
    return `:f${i}`;
  });

  try {
    const res = await clients.ddb.send(
      new UpdateCommand({
        TableName: table(),
        Key: appKey(id),
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: `attribute_exists(pk) AND #status IN (${fromKeys.join(", ")})`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return res.Attributes ? strip(res.Attributes) : undefined;
  } catch (err) {
    if ((err as Error).name === "ConditionalCheckFailedException") return undefined;
    throw err;
  }
}

export async function recordTimelineEvent(event: ApplicationEvent): Promise<void> {
  await clients.ddb.send(
    new PutCommand({
      TableName: table(),
      Item: {
        pk: `APP#${event.applicationId}`,
        sk: `EVT#${event.occurredAt}#${event.type}`,
        ...event,
      },
    }),
  );
}

export async function getTimeline(id: string): Promise<ApplicationEvent[]> {
  const res = await clients.ddb.send(
    new QueryCommand({
      TableName: table(),
      KeyConditionExpression: "pk = :p AND begins_with(sk, :e)",
      ExpressionAttributeValues: { ":p": `APP#${id}`, ":e": "EVT#" },
    }),
  );
  return (res.Items ?? []).map(({ pk: _pk, sk: _sk, ...e }) => e as ApplicationEvent);
}

export async function adjustStats(deltas: Partial<Record<ApplicationStatus | "total", number>>): Promise<void> {
  const entries = Object.entries(deltas).filter(([, v]) => v);
  if (!entries.length) return;
  const names: Record<string, string> = {};
  const values: Record<string, number> = {};
  const adds = entries.map(([k, v], i) => {
    names[`#k${i}`] = k;
    values[`:v${i}`] = v!;
    return `#k${i} :v${i}`;
  });
  await clients.ddb.send(
    new UpdateCommand({
      TableName: table(),
      Key: { pk: "STATS", sk: "GLOBAL" },
      UpdateExpression: `ADD ${adds.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function getStats(): Promise<Stats> {
  const res = await clients.ddb.send(
    new GetCommand({ TableName: table(), Key: { pk: "STATS", sk: "GLOBAL" }, ConsistentRead: true }),
  );
  const item = res.Item ?? {};
  const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, Number(item[s] ?? 0)])) as Stats["byStatus"];
  return { total: Number(item.total ?? 0), byStatus };
}
