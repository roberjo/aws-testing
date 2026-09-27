import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    globalSetup: ["e2e/global-setup.ts"],
    // Lambda cold starts (container pulls) and the Kafka round trip take a while.
    testTimeout: 180_000,
    hookTimeout: 120_000,
    // The suites share one deployed stack; run them one after another.
    fileParallelism: false,
  },
});
