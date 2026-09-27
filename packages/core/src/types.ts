export type ApplicationStatus =
  | "SUBMITTED"
  | "VALIDATED"
  | "REJECTED"
  | "UNDERWRITING"
  | "APPROVED"
  | "DECLINED";

export const ALL_STATUSES: ApplicationStatus[] = [
  "SUBMITTED",
  "VALIDATED",
  "REJECTED",
  "UNDERWRITING",
  "APPROVED",
  "DECLINED",
];

/** What a client (web form or CSV row) submits. */
export interface ApplicationInput {
  applicantName: string;
  email: string;
  amount: number;
  annualIncome: number;
  creditScore: number;
  termMonths: number;
}

export type ApplicationSource = "web" | "bulk-upload";

export interface Application extends ApplicationInput {
  id: string;
  status: ApplicationStatus;
  source: ApplicationSource;
  createdAt: string;
  updatedAt: string;
  validationErrors?: string[];
  decision?: Decision;
  /** Kafka job that claimed underwriting; useful when tracing replays. */
  underwritingJobId?: string;
  /** S3 key of the generated decision letter, once underwriting finishes. */
  decisionLetterKey?: string;
}

export interface Decision {
  outcome: "APPROVED" | "DECLINED";
  riskScore: number;
  apr?: number;
  monthlyPayment?: number;
  reasons: string[];
  decidedAt: string;
}

export type ApplicationEventType =
  | "ApplicationSubmitted"
  | "ApplicationValidated"
  | "ApplicationRejected"
  | "ApplicationDecided";

export interface ApplicationEvent {
  type: ApplicationEventType;
  applicationId: string;
  status: ApplicationStatus;
  occurredAt: string;
  detail?: Record<string, unknown>;
}

/** Message placed on the underwriting outbox queue and relayed onto Kafka. */
export interface UnderwritingJob {
  jobId: string;
  applicationId: string;
  requestedAt: string;
}

export interface Stats {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
}
