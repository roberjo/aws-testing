import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { FakeCloud } from "fakecloud";

/**
 * Reads the local Terraform outputs once and hands them to the suites via
 * TF_OUTPUTS. The stack must already be applied (`make up`), and the Kafka
 * job worker running (`make worker`).
 */
export default async function setup() {
  const fc = new FakeCloud(process.env.FAKECLOUD_URL ?? "http://localhost:4566");
  await fc.health().catch(() => {
    throw new Error("fakecloud is not reachable on :4566 — run `make up` first");
  });

  const root = resolve(import.meta.dirname, "../..");
  const raw = execFileSync(`${root}/scripts/tf.sh`, ["local", "output", "-json"], { encoding: "utf8" });
  const outputs = Object.fromEntries(
    Object.entries(JSON.parse(raw) as Record<string, { value: unknown }>).map(([k, v]) => [k, v.value]),
  );
  if (!outputs.app_domain) throw new Error("no Terraform outputs — run `make up` first");
  process.env.TF_OUTPUTS = JSON.stringify(outputs);
}
