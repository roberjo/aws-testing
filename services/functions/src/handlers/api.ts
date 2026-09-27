import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  checkShape,
  clients,
  createApplication,
  getApplication,
  getStats,
  getTimeline,
  listApplications,
  normalizeInput,
  publishEvent,
  readDecisionLetter,
  requireEnv,
} from "@poc/core";
import { json } from "../http.js";

/**
 * HTTP API behind API Gateway (payload v2). CloudFront forwards /api/* here,
 * so an optional /api prefix is stripped before routing.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = (event.rawPath || "/").replace(/^\/api(?=\/|$)/, "") || "/";
  const parts = path.split("/").filter(Boolean);

  try {
    if (method === "GET" && path === "/health") return json(200, { ok: true });

    if (method === "GET" && path === "/stats") return json(200, await getStats());

    if (parts[0] === "applications") {
      if (method === "POST" && parts.length === 1) {
        const input = normalizeInput(JSON.parse(bodyOf(event) || "{}"));
        const errors = checkShape(input);
        if (errors.length) return json(400, { errors });
        const app = await createApplication(input, "web");
        await publishEvent("ApplicationSubmitted", app, { source: "web" });
        return json(202, app);
      }
      if (method === "GET" && parts.length === 1) {
        return json(200, { items: await listApplications() });
      }
      if (method === "GET" && parts.length === 2) {
        const app = await getApplication(parts[1]);
        return app ? json(200, { ...app, timeline: await getTimeline(app.id) }) : json(404, { error: "not found" });
      }
      if (method === "GET" && parts.length === 3 && parts[2] === "decision") {
        const letter = await readDecisionLetter(parts[1]);
        return letter ? json(200, letter) : json(404, { error: "no decision yet" });
      }
    }

    // Bulk upload: the CSV lands in the intake bucket; the S3 notification
    // drives the ingest Lambda asynchronously.
    if (method === "POST" && path === "/uploads") {
      const csv = bodyOf(event);
      if (!csv.trim()) return json(400, { error: "empty body; send text/csv" });
      const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.csv`;
      await clients.s3.send(
        new PutObjectCommand({ Bucket: requireEnv("INTAKE_BUCKET"), Key: key, Body: csv, ContentType: "text/csv" }),
      );
      return json(202, { bucket: requireEnv("INTAKE_BUCKET"), key });
    }

    return json(404, { error: `no route for ${method} ${path}` });
  } catch (err) {
    console.error(err);
    return json(500, { error: (err as Error).message });
  }
}

function bodyOf(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}
