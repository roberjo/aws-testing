import type { S3Event } from "aws-lambda";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { clients, createApplication, normalizeInput, parseCsv, publishEvent } from "@poc/core";
import { createHash } from "node:crypto";

/**
 * S3 ObjectCreated (uploads/*.csv) -> load every row as a SUBMITTED application.
 * Row ids are derived from bucket/key/etag/row so a redelivered notification
 * cannot create duplicates (createApplication is conditional on a new pk).
 */
export async function handler(event: S3Event) {
  let loaded = 0;
  let skipped = 0;
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const obj = await clients.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const rows = parseCsv(await obj.Body!.transformToString());

    for (const [i, row] of rows.entries()) {
      const id = deterministicId(`${bucket}/${key}/${record.s3.object.eTag ?? ""}/${i}`);
      try {
        const app = await createApplication(normalizeInput(row), "bulk-upload", id);
        await publishEvent("ApplicationSubmitted", app, { source: "bulk-upload", bucket, key, row: i + 1 });
        loaded++;
      } catch (err) {
        if ((err as Error).name !== "ConditionalCheckFailedException") throw err;
        skipped++;
      }
    }
    console.log(JSON.stringify({ msg: "ingested", bucket, key, rows: rows.length }));
  }
  return { loaded, skipped };
}

function deterministicId(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
