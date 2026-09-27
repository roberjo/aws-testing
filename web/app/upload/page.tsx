"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

const sample = `applicantName,email,amount,annualIncome,creditScore,termMonths
Grace Hopper,grace@example.com,18000,140000,805,36
Alan Turing,alan@example.com,95000,52000,590,60
Katherine Johnson,katherine@example.com,40000,98000,720,48
Invalid Row,not-an-email,500,30000,650,13`;

export default function Upload() {
  const [csv, setCsv] = useState(sample);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();

  async function onUpload() {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const r = await api.upload(csv);
      setResult(`Stored s3://${r.bucket}/${r.key}. The ingest Lambda is loading the rows.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setCsv(await file.text());
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Bulk upload</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        The CSV lands in the intake S3 bucket, and an S3 event notification triggers the ingest Lambda. It loads each row
        into DynamoDB and publishes it to the same event pipeline.
      </p>
      <div className="card mt-6 space-y-4 p-6">
        <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={8}
          spellCheck={false}
          className="input font-mono text-xs"
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {result && (
          <p className="text-sm text-emerald-600">
            {result} <Link href="/" className="underline">Watch the dashboard →</Link>
          </p>
        )}
        <button onClick={onUpload} disabled={busy || !csv.trim()} className="btn">
          {busy ? "Uploading…" : "Upload CSV"}
        </button>
      </div>
    </div>
  );
}
