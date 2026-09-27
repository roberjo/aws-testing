import type { ApplicationInput } from "./types.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LIMITS = {
  minAmount: 1_000,
  maxAmount: 250_000,
  minCreditScore: 300,
  maxCreditScore: 850,
  terms: [12, 24, 36, 48, 60, 72],
} as const;

/** Coerce loosely-typed input (JSON body, CSV row) into an ApplicationInput. */
export function normalizeInput(raw: Record<string, unknown>): ApplicationInput {
  return {
    applicantName: String(raw.applicantName ?? "").trim(),
    email: String(raw.email ?? "").trim().toLowerCase(),
    amount: Number(raw.amount),
    annualIncome: Number(raw.annualIncome),
    creditScore: Number(raw.creditScore),
    termMonths: Number(raw.termMonths ?? 36),
  };
}

/** Shape checks performed synchronously by the API before accepting a request. */
export function checkShape(input: ApplicationInput): string[] {
  const errors: string[] = [];
  if (!input.applicantName) errors.push("applicantName is required");
  if (!input.email) errors.push("email is required");
  for (const key of ["amount", "annualIncome", "creditScore", "termMonths"] as const) {
    if (!Number.isFinite(input[key])) errors.push(`${key} must be a number`);
  }
  return errors;
}

/**
 * Business-rule validation performed asynchronously by the validator Lambda.
 * An application that fails these is REJECTED and never reaches underwriting.
 */
export function validateApplication(input: ApplicationInput): string[] {
  const errors = checkShape(input);
  if (errors.length) return errors;

  if (!EMAIL_RE.test(input.email)) errors.push("email is not a valid address");
  if (input.amount < LIMITS.minAmount || input.amount > LIMITS.maxAmount) {
    errors.push(`amount must be between ${LIMITS.minAmount} and ${LIMITS.maxAmount}`);
  }
  if (input.annualIncome <= 0) errors.push("annualIncome must be positive");
  if (input.creditScore < LIMITS.minCreditScore || input.creditScore > LIMITS.maxCreditScore) {
    errors.push(`creditScore must be between ${LIMITS.minCreditScore} and ${LIMITS.maxCreditScore}`);
  }
  if (!(LIMITS.terms as readonly number[]).includes(input.termMonths)) {
    errors.push(`termMonths must be one of ${LIMITS.terms.join(", ")}`);
  }
  return errors;
}
