import kafkaJavascript from "@confluentinc/kafka-javascript";
import { DeleteMessageBatchCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import { clients, type UnderwritingJob } from "@poc/core";
import { loadConfig } from "./config.js";
import { processJob } from "./processor.js";

const { Kafka, logLevel } = kafkaJavascript.KafkaJS;

/**
 * Job worker with two loops:
 *  1. Relay: long-polls the SQS underwriting outbox and produces each job onto
 *     the Kafka topic (keyed by applicationId, so one application's jobs stay
 *     ordered on one partition). SQS messages are deleted only after the broker
 *     acks, giving at-least-once delivery end to end.
 *  2. Consumer group: consumes the topic and runs the underwriting job.
 * In AWS the relay is typically a Confluent SQS source connector; here it is
 * in-process so the whole flow runs locally against fakecloud + a real broker.
 */
async function main() {
  const cfg = await loadConfig();
  console.log(JSON.stringify({ msg: "starting job worker", brokers: cfg.brokers, topic: cfg.topic }));

  const kafka = new Kafka({
    kafkaJS: {
      clientId: "poc-job-worker",
      brokers: cfg.brokers,
      ssl: cfg.ssl,
      // The Confluent client checks for the key, not its value.
      ...(cfg.sasl ? { sasl: cfg.sasl } : {}),
      logLevel: logLevel.WARN,
    },
  });

  const admin = kafka.admin();
  await admin.connect();
  const topics = await admin.listTopics();
  if (!topics.includes(cfg.topic)) {
    await admin.createTopics({ topics: [{ topic: cfg.topic, numPartitions: 3 }] });
    console.log(JSON.stringify({ msg: "created topic", topic: cfg.topic }));
  }
  await admin.disconnect();

  const producer = kafka.producer({ kafkaJS: { idempotent: true } });
  await producer.connect();

  const consumer = kafka.consumer({ kafkaJS: { groupId: cfg.groupId, fromBeginning: true } });
  await consumer.connect();
  await consumer.subscribe({ topics: [cfg.topic] });
  await consumer.run({
    eachMessage: async ({ message, partition }) => {
      const job = JSON.parse(message.value!.toString()) as UnderwritingJob;
      console.log(JSON.stringify({ msg: "consumed job", jobId: job.jobId, partition, offset: message.offset }));
      await processJob(job);
    },
  });

  let running = true;
  const stop = async () => {
    running = false;
    await Promise.allSettled([consumer.disconnect(), producer.disconnect()]);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (running) {
    try {
      const res = await clients.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: cfg.underwritingQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 10,
        }),
      );
      const messages = res.Messages ?? [];
      if (!messages.length) continue;

      await producer.send({
        topic: cfg.topic,
        messages: messages.map((m) => {
          const job = JSON.parse(m.Body!) as UnderwritingJob;
          return { key: job.applicationId, value: m.Body!, headers: { jobId: job.jobId } };
        }),
      });
      await clients.sqs.send(
        new DeleteMessageBatchCommand({
          QueueUrl: cfg.underwritingQueueUrl,
          Entries: messages.map((m, i) => ({ Id: String(i), ReceiptHandle: m.ReceiptHandle! })),
        }),
      );
      console.log(JSON.stringify({ msg: "relayed jobs to kafka", count: messages.length }));
    } catch (err) {
      console.error(JSON.stringify({ msg: "relay error", error: String(err) }));
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
