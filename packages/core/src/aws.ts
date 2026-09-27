import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";

/**
 * AWS SDK v3 honours AWS_ENDPOINT_URL natively, so the same code talks to real
 * AWS or to fakecloud depending only on the environment. The one extra knob is
 * path-style S3 addressing, which local emulators need because
 * `<bucket>.host.docker.internal` does not resolve.
 */
const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true" || !!process.env.AWS_ENDPOINT_URL;

let ddb: DynamoDBDocumentClient | undefined;
let s3: S3Client | undefined;
let sns: SNSClient | undefined;
let sqs: SQSClient | undefined;

export const clients = {
  get ddb() {
    return (ddb ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    }));
  },
  get s3() {
    return (s3 ??= new S3Client({ region, forcePathStyle }));
  },
  get sns() {
    return (sns ??= new SNSClient({ region }));
  },
  get sqs() {
    return (sqs ??= new SQSClient({ region }));
  },
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
