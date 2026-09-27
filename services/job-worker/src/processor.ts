import {
  getApplication,
  publishEvent,
  transition,
  underwrite,
  writeDecisionLetter,
  type UnderwritingJob,
} from "@poc/core";

/**
 * The Kafka job: underwrite one application. Idempotent — replays of the same
 * job (Kafka is at-least-once) are no-ops once the application is decided.
 */
export async function processJob(job: UnderwritingJob): Promise<"decided" | "skipped"> {
  const started = await transition(job.applicationId, ["VALIDATED", "UNDERWRITING"], "UNDERWRITING", {
    underwritingJobId: job.jobId,
  });
  if (!started) {
    const current = await getApplication(job.applicationId);
    console.log(JSON.stringify({ msg: "skip job", jobId: job.jobId, status: current?.status ?? "missing" }));
    return "skipped";
  }

  const decision = underwrite(started);
  const decisionLetterKey = await writeDecisionLetter(started, decision);
  const decided = await transition(job.applicationId, ["UNDERWRITING"], decision.outcome, {
    decision,
    decisionLetterKey,
  });
  if (decided) {
    await publishEvent("ApplicationDecided", decided, {
      outcome: decision.outcome,
      riskScore: decision.riskScore,
      jobId: job.jobId,
    });
  }
  console.log(JSON.stringify({ msg: "decided", applicationId: job.applicationId, outcome: decision.outcome }));
  return "decided";
}
