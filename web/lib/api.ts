export type Status = "SUBMITTED" | "VALIDATED" | "REJECTED" | "UNDERWRITING" | "APPROVED" | "DECLINED";

export interface Decision {
  outcome: "APPROVED" | "DECLINED";
  riskScore: number;
  apr?: number;
  monthlyPayment?: number;
  reasons: string[];
  decidedAt: string;
}

export interface Application {
  id: string;
  applicantName: string;
  email: string;
  amount: number;
  annualIncome: number;
  creditScore: number;
  termMonths: number;
  status: Status;
  source: "web" | "bulk-upload";
  createdAt: string;
  updatedAt: string;
  validationErrors?: string[];
  decision?: Decision;
  timeline?: { type: string; status: Status; occurredAt: string; detail?: Record<string, unknown> }[];
}

export interface Stats {
  total: number;
  byStatus: Record<Status, number>;
}

let base: Promise<string> | undefined;

/** NEXT_PUBLIC_API_BASE_URL (for `next dev`) wins over the deployed /config.json. */
function apiBase(): Promise<string> {
  const override = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (override) return Promise.resolve(override.replace(/\/$/, ""));
  base ??= fetch("/config.json", { cache: "no-store" })
    .then((r) => r.json())
    .then((c: { apiBaseUrl: string }) => c.apiBaseUrl.replace(/\/$/, ""))
    .catch(() => "/api");
  return base;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${await apiBase()}${path}`, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.errors?.join("; ") ?? body.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export const api = {
  stats: () => call<Stats>("/stats"),
  list: () => call<{ items: Application[] }>("/applications").then((r) => r.items),
  get: (id: string) => call<Application>(`/applications/${id}`),
  submit: (input: Record<string, unknown>) =>
    call<Application>("/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  upload: (csv: string) =>
    call<{ bucket: string; key: string }>("/uploads", {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: csv,
    }),
};

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
