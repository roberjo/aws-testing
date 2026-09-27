import { describe, expect, it } from "vitest";
import { CloudFrontClient, DescribeFunctionCommand, TestFunctionCommand } from "@aws-sdk/client-cloudfront";
import { ListResourceRecordSetsCommand, Route53Client } from "@aws-sdk/client-route-53";
import { api, awsConfig, fc, tf, viaCloudFront } from "./support.js";

describe("edge: Route 53 -> CloudFront -> S3 / API Gateway", () => {
  it("has an alias record for the app domain pointing at the distribution", async () => {
    const r53 = new Route53Client(awsConfig);
    const { ResourceRecordSets = [] } = await r53.send(
      new ListResourceRecordSetsCommand({ HostedZoneId: tf().hosted_zone_id }),
    );
    const alias = ResourceRecordSets.find((r) => r.Name === `${tf().app_domain}.` && r.Type === "A");
    expect(alias?.AliasTarget?.DNSName?.replace(/\.$/, "")).toBe(tf().cloudfront_domain_name);

    // The zone is authoritative in fakecloud's resolver (alias targets are not
    // synthesised into addresses by fakecloud, so we assert authority only).
    const res = await fc.dnsResolve(tf().app_domain, "A");
    expect(res.status).not.toBe("NOT_AUTHORITATIVE");
  });

  it("resolves the CloudFront -> API Gateway origin through Route 53", async () => {
    const origin = `${tf().api_id}.execute-api.${tf().app_domain.replace(/^app\./, "")}`;
    const res = await fc.dnsResolve(origin, "A");
    expect(res.status).toBe("ANSWERED");
    expect(res.records.map((r) => r.value)).toContain("127.0.0.1");
  });

  it("serves directory URLs of the static export (deep links)", async () => {
    for (const path of ["/apply/", "/upload/", "/application/?id=abc"]) {
      const page = await viaCloudFront(path);
      expect(page.status, path).toBe(200);
    }
  });

  it("serves the Next.js site and runtime config from S3 through CloudFront", async () => {
    const index = await viaCloudFront("/");
    expect(index.status).toBe(200);
    expect(index.text).toContain("<html");

    const config = await viaCloudFront("/config.json");
    expect(config.status).toBe(200);
    expect(JSON.parse(config.text)).toMatchObject({ apiBaseUrl: "/api" });
  });

  it("rewrites directory URLs to index.html in the CloudFront Function", async () => {
    // fakecloud does not run functions in-path, but TestFunction executes the
    // real source in a JS engine, so the logic is still covered.
    const cf = new CloudFrontClient(awsConfig);
    const name = tf().rewrite_function_name;
    const { ETag } = await cf.send(new DescribeFunctionCommand({ Name: name, Stage: "LIVE" }));

    const rewrite = async (uri: string) => {
      const event = { version: "1.0", context: { eventType: "viewer-request" }, viewer: { ip: "127.0.0.1" }, request: { method: "GET", uri, headers: {}, querystring: {}, cookies: {} } };
      const res = await cf.send(
        new TestFunctionCommand({ Name: name, IfMatch: ETag, Stage: "LIVE", EventObject: new TextEncoder().encode(JSON.stringify(event)) }),
      );
      expect(res.TestResult?.FunctionErrorMessage ?? "").toBe("");
      return JSON.parse(res.TestResult!.FunctionOutput!).request?.uri ?? JSON.parse(res.TestResult!.FunctionOutput!).uri;
    };

    expect(await rewrite("/apply/")).toBe("/apply/index.html");
    expect(await rewrite("/apply")).toBe("/apply/index.html");
    expect(await rewrite("/_next/static/app.js")).toBe("/_next/static/app.js");
  });

  it("routes /api/* to API Gateway and the api Lambda", async () => {
    const { status, body } = await api("/health");
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });

    const { requests } = await fc.apigatewayv2.getRequests();
    expect(requests.some((r: any) => JSON.stringify(r).includes("/api/health"))).toBe(true);
  });

  it("rejects malformed submissions synchronously", async () => {
    const { status, body } = await api("/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ applicantName: "", amount: "lots" }),
    });
    expect(status).toBe(400);
    expect(body.errors).toEqual(expect.arrayContaining(["applicantName is required", "amount must be a number"]));
  });
});
