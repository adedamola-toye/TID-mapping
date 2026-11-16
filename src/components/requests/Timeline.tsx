import { clsx } from "clsx";
import { fmtDateTime } from "@/lib/format";
import { EXCEPTION_REASON_LABELS } from "@/lib/constants";

const LABELS: Record<string, string> = {
  CREATED: "Created",
  UPDATED: "Edited",
  MARK_READY: "Marked ready for review",
  SUBMIT_TO_VENDOR: "Reviewed & submitted to Elnexu",
  RESUBMIT: "Resubmitted to Elnexu",
  AMENDED: "Amended after release",
  VENDOR_OPENED: "Opened by vendor",
  START: "Treatment started",
  RELEASE: "Released back to queue",
  TREAT: "Treated in TMS",
  RAISE_EXCEPTION: "Exception raised",
  RETURN: "Returned for correction",
  CANCEL: "Cancelled",
  CLOSE: "Closed",
};
const TONE: Record<string, string> = {
  TREAT: "bg-ok-700",
  CLOSE: "bg-brand-700",
  RAISE_EXCEPTION: "bg-bad-600",
  RETURN: "bg-bad-600",
  CANCEL: "bg-ink-subtle",
  SUBMIT_TO_VENDOR: "bg-warn-700",
  RESUBMIT: "bg-warn-700",
  START: "bg-accent-600",
  AMENDED: "bg-accent-600",
};

export interface TimelineEvent {
  id: number;
  action: string;
  actorName: string | null;
  comment: string | null;
  details?: Record<string, unknown> | null;
  createdAt: string | Date;
}

function Diff({ details }: { details: Record<string, unknown> }) {
  const before = (details.before ?? {}) as Record<string, unknown>;
  const after = (details.after ?? {}) as Record<string, unknown>;
  const keys = Object.keys(after);
  if (!keys.length) return null;
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? Object.values(v as object).filter(Boolean).join(" / ") : String(v));
  return (
    <dl className="mt-1.5 space-y-0.5 rounded bg-surface-sunken px-2.5 py-1.5 text-xs">
      {keys.map((k) => (
        <div key={k} className="flex flex-wrap gap-1">
          <dt className="text-ink-muted">{k.replace(/([A-Z])/g, " $1").toLowerCase()}:</dt>
          <dd><span className="text-ink-subtle line-through">{show(before[k])}</span> → <span className="font-medium">{show(after[k])}</span></dd>
        </div>
      ))}
    </dl>
  );
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative space-y-5 border-l border-line pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className={clsx("absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-surface", TONE[e.action] ?? "bg-line-strong")} aria-hidden />
          <div className="text-sm font-medium text-ink">{LABELS[e.action] ?? e.action}</div>
          <div className="text-xs text-ink-muted">{e.actorName ?? "System"} · <time className="num">{fmtDateTime(e.createdAt)}</time></div>
          {e.comment && <p className="mt-1 text-sm text-ink-muted">{e.comment}</p>}
          {e.details && "after" in e.details && <Diff details={e.details} />}
        </li>
      ))}
    </ol>
  );
}

export function exceptionLabel(r: string | null) {
  return r ? EXCEPTION_REASON_LABELS[r as keyof typeof EXCEPTION_REASON_LABELS] ?? r : "";
}
