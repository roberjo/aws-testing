import type { ApplicationInput, Decision } from "./types.js";

/** Standard amortized monthly payment. */
export function monthlyPayment(principal: number, aprPercent: number, termMonths: number): number {
  const r = aprPercent / 100 / 12;
  if (r === 0) return principal / termMonths;
  return (principal * r) / (1 - Math.pow(1 + r, -termMonths));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Deterministic underwriting model. This is the "heavy" job that runs off the
 * Kafka topic: it scores risk, prices the loan and decides.
 */
export function underwrite(input: ApplicationInput, now = new Date()): Decision {
  const reasons: string[] = [];

  // 0 (best) .. 100 (worst)
  const creditRisk = ((850 - input.creditScore) / 550) * 60;
  const loanToIncome = input.amount / input.annualIncome;
  const ltiRisk = Math.min(loanToIncome, 1) * 40;
  const riskScore = Math.round(creditRisk + ltiRisk);

  if (input.creditScore < 580) reasons.push("credit score below 580");
  if (loanToIncome > 0.6) reasons.push("loan amount exceeds 60% of annual income");
  if (riskScore > 65) reasons.push(`risk score ${riskScore} exceeds threshold 65`);

  const decidedAt = now.toISOString();
  if (reasons.length) {
    return { outcome: "DECLINED", riskScore, reasons, decidedAt };
  }

  const apr = round2(5.5 + riskScore * 0.2);
  const payment = monthlyPayment(input.amount, apr, input.termMonths);
  const dti = (payment * 12) / input.annualIncome;
  if (dti > 0.4) {
    return {
      outcome: "DECLINED",
      riskScore,
      reasons: [`payments would be ${Math.round(dti * 100)}% of income (max 40%)`],
      decidedAt,
    };
  }

  return {
    outcome: "APPROVED",
    riskScore,
    apr,
    monthlyPayment: round2(payment),
    reasons: ["meets credit and affordability policy"],
    decidedAt,
  };
}
