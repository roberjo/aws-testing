import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.js";
import { parseEventBody } from "./events.js";
import { monthlyPayment, underwrite } from "./underwriting.js";
import { normalizeInput, validateApplication } from "./validation.js";

const good = {
  applicantName: "Ada Lovelace",
  email: "ada@example.com",
  amount: 20_000,
  annualIncome: 120_000,
  creditScore: 780,
  termMonths: 36,
};

describe("validateApplication", () => {
  it("accepts a well-formed application", () => {
    expect(validateApplication(good)).toEqual([]);
  });

  it("reports every business-rule violation", () => {
    const errors = validateApplication({ ...good, email: "nope", amount: 5, creditScore: 900, termMonths: 7 });
    expect(errors).toHaveLength(4);
  });

  it("normalizes CSV-style string input", () => {
    const input = normalizeInput({ ...good, amount: "20000", email: " ADA@Example.com " });
    expect(input.amount).toBe(20_000);
    expect(input.email).toBe("ada@example.com");
  });
});

describe("underwrite", () => {
  it("approves a strong applicant with a priced offer", () => {
    const d = underwrite(good);
    expect(d.outcome).toBe("APPROVED");
    expect(d.apr).toBeGreaterThan(5.5);
    expect(d.monthlyPayment).toBeGreaterThan(0);
  });

  it("declines low credit and high loan-to-income", () => {
    const d = underwrite({ ...good, creditScore: 520, amount: 100_000, annualIncome: 40_000 });
    expect(d.outcome).toBe("DECLINED");
    expect(d.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("computes amortized payments", () => {
    expect(monthlyPayment(12_000, 0, 12)).toBe(1_000);
    expect(monthlyPayment(10_000, 12, 12)).toBeCloseTo(888.49, 2);
  });
});

describe("parseCsv", () => {
  it("handles quotes, embedded commas and CRLF", () => {
    const rows = parseCsv('name,note\r\n"Doe, Jane","said ""hi"""\r\nBob,ok\r\n\r\n');
    expect(rows).toEqual([
      { name: "Doe, Jane", note: 'said "hi"' },
      { name: "Bob", note: "ok" },
    ]);
  });
});

describe("parseEventBody", () => {
  it("unwraps SNS envelopes and passes raw events through", () => {
    const evt = { type: "ApplicationSubmitted", applicationId: "a1" };
    expect(parseEventBody(JSON.stringify(evt))).toEqual(evt);
    expect(parseEventBody(JSON.stringify({ Type: "Notification", Message: JSON.stringify(evt) }))).toEqual(evt);
  });
});
