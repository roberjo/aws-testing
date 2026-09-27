"use client";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, money } from "@/lib/api";
import { usePoll } from "@/lib/usePoll";
import { StatusBadge } from "@/components/StatusBadge";

export default function ApplicationPage() {
  return (
    <Suspense fallback={<p className="text-[var(--muted)]">Loading…</p>}>
      <Detail />
    </Suspense>
  );
}

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const { data: app, error } = usePoll(() => api.get(id), 1500, [id]);

  if (error) return <p className="text-rose-600">{error}</p>;
  if (!app) return <p className="text-[var(--muted)]">Loading…</p>;

  const d = app.decision;
  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-[var(--muted)] hover:underline">← All applications</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{app.applicantName}</h1>
        <StatusBadge status={app.status} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card p-6">
          <h2 className="text-sm font-medium text-[var(--muted)]">Request</h2>
          <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-[var(--muted)]">Amount</dt><dd className="tabular-nums">{money(app.amount)}</dd>
            <dt className="text-[var(--muted)]">Term</dt><dd>{app.termMonths} months</dd>
            <dt className="text-[var(--muted)]">Annual income</dt><dd className="tabular-nums">{money(app.annualIncome)}</dd>
            <dt className="text-[var(--muted)]">Credit score</dt><dd className="tabular-nums">{app.creditScore}</dd>
            <dt className="text-[var(--muted)]">Email</dt><dd className="truncate">{app.email}</dd>
            <dt className="text-[var(--muted)]">Source</dt><dd>{app.source}</dd>
          </dl>
        </section>

        <section className="card p-6">
          <h2 className="text-sm font-medium text-[var(--muted)]">Decision</h2>
          {app.validationErrors?.length ? (
            <ul className="mt-3 list-disc pl-5 text-sm text-rose-600">
              {app.validationErrors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          ) : d ? (
            <div className="mt-3 space-y-2 text-sm">
              {d.outcome === "APPROVED" && (
                <p className="text-lg font-semibold">
                  {d.apr}% APR · {money(d.monthlyPayment ?? 0)}/mo
                </p>
              )}
              <p>Risk score <span className="tabular-nums font-medium">{d.riskScore}</span> / 100</p>
              <ul className="list-disc pl-5 text-[var(--muted)]">
                {d.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">Processing. This page updates automatically.</p>
          )}
        </section>
      </div>

      <section className="card p-6">
        <h2 className="text-sm font-medium text-[var(--muted)]">Event timeline (from the audit queue)</h2>
        <ol className="mt-4 space-y-3 border-l border-[var(--border)] pl-5">
          {(app.timeline ?? []).map((e) => (
            <li key={`${e.occurredAt}-${e.type}`} className="text-sm">
              <span className="font-medium">{e.type}</span>{" "}
              <span className="text-[var(--muted)]">· {new Date(e.occurredAt).toLocaleTimeString()}</span>
            </li>
          ))}
          {!app.timeline?.length && <li className="text-sm text-[var(--muted)]">No events recorded yet.</li>}
        </ol>
      </section>
    </div>
  );
}
