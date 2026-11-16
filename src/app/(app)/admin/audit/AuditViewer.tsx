"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, Search, ShieldCheck, ShieldAlert } from "lucide-react";
import { api, ApiError, download } from "@/lib/client/api";
import { Alert, Pagination, Spinner, clsx } from "@/components/ui";
import { useToast } from "@/components/toast";
import { fmtDateTime } from "@/lib/format";

interface Row {
  id: number;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  hash: string;
}

export function AuditViewer({ canExport, initialEntityId }: { canExport: boolean; initialEntityId?: string }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Row[]; total: number; actions: string[] } | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [verify, setVerify] = useState<null | { ok: boolean; checked: number; brokenAt: number | null }>(null);
  useEffect(() => {
    const t = setTimeout(() => setQd(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const filters = { q: qd || undefined, action: action || undefined, entityType: entityType || undefined, entityId: initialEntityId, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined };
  const key = JSON.stringify(filters);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api("/api/audit", { body: { op: "search", ...JSON.parse(key), page, pageSize: 50 } }));
    } catch (e) {
      toast.push("bad", e instanceof ApiError ? e.message : "Could not load audit log.");
    } finally {
      setLoading(false);
    }
  }, [key, page, toast]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [key]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-secondary" onClick={() => api<typeof verify>("/api/audit").then(setVerify).catch(() => toast.push("bad", "Verification failed."))}>
          <ShieldCheck className="h-4 w-4" aria-hidden />Verify integrity
        </button>
        {verify && (
          <span className={clsx("inline-flex items-center gap-1.5 text-sm", verify.ok ? "text-ok-700" : "text-bad-700")}>
            {verify.ok ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <ShieldAlert className="h-4 w-4" aria-hidden />}
            {verify.ok ? `Hash chain intact — ${verify.checked.toLocaleString()} records verified.` : `Chain broken at record #${verify.brokenAt}. Escalate to Information Security.`}
          </span>
        )}
        <div className="flex-1" />
        {canExport && <button className="btn-secondary" onClick={() => download("/api/audit", { op: "export", ...filters })}><Download className="h-4 w-4" aria-hidden />Export</button>}
      </div>
      {initialEntityId && <Alert tone="info">Showing audit events for record <span className="ident">{initialEntityId}</span>.</Alert>}
      <div className="card overflow-hidden">
        <div className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-[1fr_14rem_10rem_9rem_9rem]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
            <input className="input pl-9" placeholder="User email, record or action…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit log" />
          </div>
          <select className="input" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
            <option value="">All actions</option>
            {(data?.actions ?? []).map((a) => <option key={a}>{a}</option>)}
          </select>
          <select className="input" value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="Record type">
            <option value="">All records</option>
            {["request", "terminal", "user", "anm", "vendor", "import_batch", "export", "report", "audit"].map((t) => <option key={t}>{t}</option>)}
          </select>
          <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
          <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
        </div>
        <div className="relative max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0">
            <thead><tr>{["", "#", "When", "User", "Role", "Action", "Record", "IP"].map((h, i) => <th key={i} className="table-th">{h}</th>)}</tr></thead>
            <tbody>
              {(data?.rows ?? []).map((r) => {
                const isOpen = open.has(r.id);
                const hasDetail = r.oldValue || r.newValue || r.userAgent;
                return (
                  <Fragment key={r.id}>
                    <tr className="hover:bg-surface-sunken/70">
                      <td className="table-td w-8">
                        {hasDetail && (
                          <button aria-label={isOpen ? "Hide details" : "Show details"} aria-expanded={isOpen} onClick={() => { const n = new Set(open); if (isOpen) n.delete(r.id); else n.add(r.id); setOpen(n); }} className="text-ink-subtle hover:text-ink">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        )}
                      </td>
                      <td className="table-td num text-xs text-ink-subtle">{r.id}</td>
                      <td className="table-td num whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</td>
                      <td className="table-td text-sm">{r.actorEmail ?? "—"}</td>
                      <td className="table-td text-xs text-ink-muted">{r.actorRole}</td>
                      <td className="table-td"><span className="ident text-xs">{r.action}</span></td>
                      <td className="table-td text-sm">{r.entityType && <span className="text-xs text-ink-subtle">{r.entityType} </span>}{r.entityLabel ?? (r.entityId ? `${r.entityId.slice(0, 8)}…` : "")}</td>
                      <td className="table-td ident text-xs text-ink-muted">{r.ip ?? "—"}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td />
                        <td colSpan={7} className="border-b border-line bg-surface-sunken px-3 py-3">
                          <div className="grid gap-3 md:grid-cols-2">
                            <div><div className="mb-1 text-xs font-medium text-ink-muted">Old value</div><pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-xs">{r.oldValue ? JSON.stringify(r.oldValue, null, 2) : "—"}</pre></div>
                            <div><div className="mb-1 text-xs font-medium text-ink-muted">New value</div><pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-xs">{r.newValue ? JSON.stringify(r.newValue, null, 2) : "—"}</pre></div>
                          </div>
                          <div className="mt-2 text-2xs text-ink-subtle">Device: {r.userAgent ?? "—"} · hash <span className="ident">{r.hash.slice(0, 16)}…</span></div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {loading && <div className="absolute inset-0 flex items-start justify-center bg-surface/60 pt-16"><Spinner className="h-6 w-6 text-brand-700" /></div>}
        </div>
        <Pagination page={page} pageSize={50} total={data?.total ?? 0} onPage={setPage} />
      </div>
    </div>
  );
}
