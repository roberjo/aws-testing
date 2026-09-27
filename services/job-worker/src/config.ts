import { GetBootstrapBrokersCommand, KafkaClient } from "@aws-sdk/client-kafka";
import { requireEnv } from "@poc/core";

export interface WorkerConfig {
  brokers: string[];
  topic: string;
  groupId: string;
  underwritingQueueUrl: string;
  sasl?: { mechanism: "plain"; username: string; password: string };
  ssl: boolean;
}

/**
 * Brokers come from one of:
 *  - KAFKA_BOOTSTRAP_SERVERS (Confluent Cloud, or any Kafka), or
 *  - KAFKA_CLUSTER_ARN, resolved through the MSK GetBootstrapBrokers API.
 *    Against fakecloud this returns the address of a real broker container.
 */
export async function loadConfig(): Promise<WorkerConfig> {
  let brokers = process.env.KAFKA_BOOTSTRAP_SERVERS?.split(",").filter(Boolean) ?? [];
  if (!brokers.length) {
    const arn = requireEnv("KAFKA_CLUSTER_ARN");
    const res = await new KafkaClient({}).send(new GetBootstrapBrokersCommand({ ClusterArn: arn }));
    const list = res.BootstrapBrokerString ?? res.BootstrapBrokerStringTls ?? "";
    brokers = list.split(",").filter(Boolean);
    if (!brokers.length) throw new Error(`MSK cluster ${arn} returned no bootstrap brokers`);
  }

  const username = process.env.KAFKA_SASL_USERNAME;
  const password = process.env.KAFKA_SASL_PASSWORD;
  return {
    brokers,
    topic: process.env.KAFKA_TOPIC ?? "underwriting.jobs",
    groupId: process.env.KAFKA_GROUP_ID ?? "underwriters",
    underwritingQueueUrl: requireEnv("UNDERWRITING_QUEUE_URL"),
    sasl: username && password ? { mechanism: "plain", username, password } : undefined,
    ssl: process.env.KAFKA_SSL === "true" || !!username,
  };
}
