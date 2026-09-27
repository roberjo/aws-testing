import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { clients, requireEnv } from "./aws.js";
import type { Application, Decision } from "./types.js";

export const letterKey = (id: string) => `decisions/${id}.json`;

export async function writeDecisionLetter(app: Application, decision: Decision): Promise<string> {
  const key = letterKey(app.id);
  const letter = {
    applicationId: app.id,
    applicantName: app.applicantName,
    amount: app.amount,
    termMonths: app.termMonths,
    ...decision,
  };
  await clients.s3.send(
    new PutObjectCommand({
      Bucket: requireEnv("RESULTS_BUCKET"),
      Key: key,
      Body: JSON.stringify(letter, null, 2),
      ContentType: "application/json",
      Metadata: { outcome: decision.outcome },
    }),
  );
  return key;
}

export async function readDecisionLetter(id: string): Promise<unknown | undefined> {
  try {
    const res = await clients.s3.send(
      new GetObjectCommand({ Bucket: requireEnv("RESULTS_BUCKET"), Key: letterKey(id) }),
    );
    return JSON.parse(await res.Body!.transformToString());
  } catch (err) {
    if ((err as Error).name === "NoSuchKey") return undefined;
    throw err;
  }
}
