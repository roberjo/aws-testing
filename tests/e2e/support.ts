import { randomUUID } from "node:crypto";
import http from "node:http";
import { FakeCloud } from "fakecloud";

export const ENDPOINT = process.env.FAKECLOUD_URL ?? "http://localhost:4566";
export const fc = new FakeCloud(ENDPOINT);

export interface Outputs {
  app_domain: string;
  api_id: string;
  hosted_zone_id: string;
  cloudfront_distribution_id: string;
  cloudfront_domain_name: string;
  rewrite_function_name: string;
  table_name: string;
  events_topic_arn: string;
  queue_urls: Record<"validation" | "audit" | "underwriting", string>;
  dlq_urls: Record<"validation" | "audit" | "underwriting", string>;
  buckets: Record<"intake" | "results" | "audit" | "web", string>;
  function_names: Record<"api" | "ingest" | "validator" | "audit" | "projector", string>;
}

export const tf = (): Outputs => JSON.parse(process.env.TF_OUTPUTS!);

export const awsConfig = {
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
};

/**
 * Talk to the app the way a browser does: through CloudFront. fakecloud serves
 * distributions on its main port and routes by Host header, so we send the
 * Route 53 / CloudFront alias as Host (a browser gets the same effect because
 * *.localhost resolves to 127.0.0.1). node:http is used because fetch() does
 * not let callers override Host.
 */
export function viaCloudFront(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  const url = new URL(path, ENDPOINT);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: init.method ?? "GET",
        headers: { ...init.headers, host: tf().app_domain },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

export async function api<T = any>(
  path: string,
  init: Parameters<typeof viaCloudFront>[1] = {},
): Promise<{ status: number; body: T }> {
  const res = await viaCloudFront(`/api${path}`, init);
  return { status: res.status, body: res.text ? JSON.parse(res.text) : undefined };
}

export const postJson = (path: string, body: unknown) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Poll until `check` returns a truthy value or the deadline passes. */
export async function eventually<T>(
  check: () => Promise<T | undefined | false>,
  { timeoutMs = 150_000, intervalMs = 1_000, what = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await check();
      if (v) return v;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`);
}

export async function waitForStatus(id: string, statuses: string[]) {
  return eventually(
    async () => {
      const { status, body } = await api(`/applications/${id}`);
      return status === 200 && statuses.includes(body.status) ? body : undefined;
    },
    { what: `application ${id} to reach ${statuses.join("|")}` },
  );
}

export function applicant(overrides: Record<string, unknown> = {}) {
  return {
    applicantName: `Test ${randomUUID().slice(0, 8)}`,
    email: "test.applicant@example.com",
    amount: 15_000,
    annualIncome: 110_000,
    creditScore: 760,
    termMonths: 36,
    ...overrides,
  };
}

export const invocationsOf = async (functionName: string) =>
  (await fc.lambda.getInvocations()).invocations.filter((i) => i.functionArn.endsWith(`:function:${functionName}`));
