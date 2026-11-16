"use client";

import { clsx } from "clsx";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Loader2, X, Inbox } from "lucide-react";
import {
  STATUS_LABELS,
  TERMINAL_STATUS_LABELS,
  type RequestStatus,
  type TerminalStatus,
} from "@/lib/constants";

export { clsx };

/* ───────── Status badges ───────── */

const STATUS_STYLE: Record<RequestStatus, string> = {
  DRAFT: "bg-surface-sunken text-ink-muted ring-line-strong",
  READY_FOR_REVIEW: "bg-info-50 text-info-700 ring-info-700/20",
  SUBMITTED: "bg-warn-50 text-warn-700 ring-warn-700/25",
  IN_PROGRESS: "bg-accent-100 text-accent-700 ring-accent-600/30",
  TREATED: "bg-ok-50 text-ok-700 ring-ok-700/25",
  EXCEPTION: "bg-bad-50 text-bad-700 ring-bad-600/25",
  RETURNED: "bg-bad-50 text-bad-700 ring-bad-600/20",
  CANCELLED: "bg-surface-sunken text-ink-subtle ring-line",
  CLOSED: "bg-brand-50 text-brand-800 ring-brand-700/20",
};
const DOT: Record<RequestStatus, string> = {
  DRAFT: "bg-ink-subtle",
  READY_FOR_REVIEW: "bg-info-700",
  SUBMITTED: "bg-warn-700",
  IN_PROGRESS: "bg-accent-600",
  TREATED: "bg-ok-700",
  EXCEPTION: "bg-bad-600",
  RETURNED: "bg-bad-600",
  CANCELLED: "bg-ink-subtle",
  CLOSED: "bg-brand-700",
};

export function StatusBadge({ status, vendorView }: { status: RequestStatus; vendorView?: boolean }) {
  const label = vendorView && status === "SUBMITTED" ? "Pending" : STATUS_LABELS[status];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", STATUS_STYLE[status])}>
      <span aria-hidden className={clsx("h-1.5 w-1.5 rounded-full", DOT[status])} />
      {label}
    </span>
  );
}

const TSTYLE: Record<TerminalStatus, string> = {
  AVAILABLE: "bg-surface-sunken text-ink-muted ring-line-strong",
  MAPPING_PENDING: "bg-warn-50 text-warn-700 ring-warn-700/25",
  REMAPPING_PENDING: "bg-accent-100 text-accent-700 ring-accent-600/30",
  MAPPED: "bg-ok-50 text-ok-700 ring-ok-700/25",
  INACTIVE: "bg-bad-50 text-bad-700 ring-bad-600/20",
};
export function TerminalBadge({ status }: { status: TerminalStatus }) {
  return <span className={clsx("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TSTYLE[status])}>{TERMINAL_STATUS_LABELS[status]}</span>;
}

export function TypeTag({ type }: { type: "MAPPING" | "REMAPPING" }) {
  return (
    <span className={clsx("inline-flex rounded px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider", type === "MAPPING" ? "bg-brand-50 text-brand-800" : "bg-accent-100 text-accent-700")}>
      {type === "MAPPING" ? "Map" : "Remap"}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: string }) {
  if (priority === "NORMAL" || priority === "LOW") return <span className="text-xs text-ink-subtle">{priority === "LOW" ? "Low" : "Normal"}</span>;
  return <span className={clsx("text-xs font-semibold", priority === "URGENT" ? "text-bad-700" : "text-accent-700")}>{priority === "URGENT" ? "Urgent" : "High"}</span>;
}

/* ───────── Layout primitives ───────── */

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wider text-brand-700">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={clsx("card", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={clsx(bodyClass ?? "p-5")}>{children}</div>
    </section>
  );
}

export function KV({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={clsx("mt-0.5 break-words text-sm text-ink", mono && "ident")}>{children ?? "—"}</dd>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={clsx("h-4 w-4 animate-spin", className)} />;
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-700">{icon ?? <Inbox className="h-5 w-5" aria-hidden />}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "ok"; title?: ReactNode; children?: ReactNode }) {
  const s = { info: "bg-info-50 text-info-700 border-info-700/20", warn: "bg-warn-50 text-warn-700 border-warn-700/25", bad: "bg-bad-50 text-bad-700 border-bad-600/25", ok: "bg-ok-50 text-ok-700 border-ok-700/25" }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={clsx("rounded border px-4 py-3 text-sm", s)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={clsx(title && "mt-0.5")}>{children}</div>}
    </div>
  );
}

/* ───────── Forms ───────── */

export function Field({
  label,
  error,
  hint,
  required,
  children,
  id,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
  id?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  const descId = error ? `${fid}-err` : hint ? `${fid}-hint` : undefined;
  return (
    <div>
      <label htmlFor={fid} className="label">
        {label}
        {required && <span className="ml-0.5 text-bad-600" aria-hidden>*</span>}
      </label>
      {children({ id: fid, "aria-invalid": !!error, "aria-describedby": descId })}
      {error ? (
        <p id={`${fid}-err`} className="mt-1 text-xs text-bad-700">{error}</p>
      ) : hint ? (
        <p id={`${fid}-hint`} className="mt-1 text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

/* ───────── Modal (native <dialog>: focus trap + Esc handled by the browser) ───────── */

export function Modal({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "md" | "lg" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={clsx("w-[calc(100%-2rem)] rounded-lg border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-ink/40", size === "lg" ? "max-w-2xl" : "max-w-lg")}
      aria-labelledby="modal-title"
    >
      {open && (
        <div>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <h2 id="modal-title" className="text-base font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="btn-ghost -m-1.5 p-1.5" aria-label="Close dialog">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-sunken px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/* ───────── Pagination ───────── */

export function Pagination({ page, pageSize, total, onPage, onPageSize }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize?: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-ink-muted sm:flex-row">
      <div className="num">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </div>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <label className="flex items-center gap-2 text-xs">
            Rows
            <select className="input w-auto py-1 text-xs" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
        <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="num text-xs">Page {page} / {pages}</span>
        <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            value === t.value ? "border-brand-700 text-brand-800" : "border-transparent text-ink-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={clsx("num rounded-full px-1.5 text-2xs", value === t.value ? "bg-brand-700 text-white" : "bg-surface-sunken text-ink-muted")}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
