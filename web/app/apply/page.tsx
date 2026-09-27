"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const fields = [
  { name: "applicantName", label: "Full name", type: "text", initial: "Ada Lovelace" },
  { name: "email", label: "Email", type: "email", initial: "ada@example.com" },
  { name: "amount", label: "Loan amount (USD)", type: "number", initial: "25000" },
  { name: "annualIncome", label: "Annual income (USD)", type: "number", initial: "120000" },
  { name: "creditScore", label: "Credit score", type: "number", initial: "760" },
] as const;

export default function Apply() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const app = await api.submit(Object.fromEntries(new FormData(e.currentTarget)));
      router.push(`/application/?id=${app.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold tracking-tight">New application</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        The API accepts it immediately (202). Validation and underwriting happen asynchronously.
      </p>
      <form onSubmit={onSubmit} className="card mt-6 space-y-4 p-6">
        {fields.map((f) => (
          <label key={f.name} className="block text-sm">
            <span className="mb-1 block font-medium">{f.label}</span>
            <input name={f.name} type={f.type} defaultValue={f.initial} required className="input" />
          </label>
        ))}
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Term</span>
          <select name="termMonths" defaultValue="36" className="input">
            {[12, 24, 36, 48, 60, 72].map((t) => (
              <option key={t} value={t}>{t} months</option>
            ))}
          </select>
        </label>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button type="submit" disabled={busy} className="btn w-full">
          {busy ? "Submitting…" : "Submit application"}
        </button>
      </form>
    </div>
  );
}
