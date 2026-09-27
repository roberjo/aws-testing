import type { Status } from "@/lib/api";

const styles: Record<Status, string> = {
  SUBMITTED: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  VALIDATED: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  UNDERWRITING: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  DECLINED: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200",
  REJECTED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}
