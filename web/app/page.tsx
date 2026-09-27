"use client";
import Link from "next/link";
import { api, money, type Status } from "@/lib/api";
import { usePoll } from "@/lib/usePoll";
import { StatusBadge } from "@/components/StatusBadge";

const pipeline: Status[] = ["SUBMITTED", "VALIDATED", "UNDERWRITING", "APPROVED", "DECLINED", "REJECTED"];

export default function Dashboard() {
  const stats = usePoll(api.stats);
  const apps = usePoll(api.list);
  const error = stats.error ?? apps.error;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Live view of the pipeline: API → SNS → SQS → validator Lambda → Kafka → underwriting worker. Refreshes every 2s.
        </p>
      </div>

      {error && <p className="card border-rose-300 p-3 text-sm text-rose-600">API error: {error}</p>}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <div className="card p-4">
          <div className="text-xs text-[var(--muted)]">Total</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{stats.data?.total ?? "–"}</div>
        </div>
        {pipeline.map((s) => (
          <div key={s} className="card p-4">
            <StatusBadge status={s} />
            <div className="mt-2 text-2xl font-semibold tabular-nums">{stats.data?.byStatus[s] ?? "–"}</div>
          </div>
        ))}
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-[var(--muted)]">
            <tr className="border-b border-[var(--border)]">
              <th className="px-4 py-3 font-medium">Applicant</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Credit</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {apps.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[var(--muted)]">
                  No applications yet. <Link href="/apply/" className="text-[var(--accent)] underline">Submit one</Link> or{" "}
                  <Link href="/upload/" className="text-[var(--accent)] underline">upload a CSV</Link>.
                </td>
              </tr>
            )}
            {apps.data?.map((a) => (
              <tr key={a.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)]">
                <td className="px-4 py-3">
                  <Link href={`/application/?id=${a.id}`} className="font-medium hover:underline">
                    {a.applicantName}
                  </Link>
                  <div className="text-xs text-[var(--muted)]">{a.email}</div>
                </td>
                <td className="px-4 py-3 tabular-nums">{money(a.amount)}</td>
                <td className="px-4 py-3 tabular-nums">{a.creditScore}</td>
                <td className="px-4 py-3 text-[var(--muted)]">{a.source}</td>
                <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                <td className="px-4 py-3 text-[var(--muted)]">{new Date(a.createdAt).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
