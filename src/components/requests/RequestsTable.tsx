"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Columns3, Download, Filter, Search, X } from "lucide-react";
import { api, ApiError, download } from "@/lib/client/api";
import { EmptyState, Modal, Pagination, PriorityTag, Spinner, StatusBadge, Tabs, TypeTag, clsx } from "@/components/ui";
import { useToast } from "@/components/toast";
import { NIGERIAN_STATES, PRIORITIES, REQUEST_STATUSES, STATUS_LABELS, type RequestStatus } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";

export interface Row {
  id: string;
  reference: string;
  type: "MAPPING" | "REMAPPING";
  status: RequestStatus;
  priority: string;
  serialNumber: string;
  tid: string;
  iswTid: string | null;
  agentName: string;
  account: string;
  state: string;
  anmName: string;
  createdAt: string;
  submittedAt: string | null;
  treatedAt: string | null;
  createdByName: string | null;
  treatedByName: string | null;
  exceptionReason: string | null;
  assignedToMe?: boolean;
}

export interface TabDef {
  value: string;
  label: string;
  status?: RequestStatus[];
  type?: "MAPPING" | "REMAPPING";
}

type Mode = "internal" | "mine" | "vendor";

const COLS = [
  { key: "status", label: "Status", sort: "status" },
  { key: "reference", label: "Request", sort: "reference" },
  { key: "type", label: "Type" },
  { key: "serialNumber", label: "Terminal serial", sort: "serialNumber" },
  { key: "tid", label: "TID", sort: "tid" },
  { key: "iswTid", label: "ISW TID" },
  { key: "agentName", label: "Agent / merchant", sort: "agentName" },
  { key: "account", label: "Account" },
  { key: "state", label: "Location", sort: "state" },
  { key: "anmName", label: "ANM", sort: "anmName" },
  { key: "priority", label: "Priority", sort: "priority" },
  { key: "createdByName", label: "Requested by" },
  { key: "createdAt", label: "Created", sort: "createdAt" },
  { key: "submittedAt", label: "Submitted", sort: "submittedAt" },
  { key: "treatedAt", label: "Treated", sort: "treatedAt" },
  { key: "treatedByName", label: "Treated by" },
] as const;
type ColKey = (typeof COLS)[number]["key"];

const DEFAULT_COLS: Record<Mode, ColKey[]> = {
  internal: ["status", "reference", "type", "serialNumber", "tid", "agentName", "account", "state", "anmName", "createdByName", "submittedAt", "treatedAt"],
  mine: ["status", "reference", "type", "serialNumber", "tid", "agentName", "state", "anmName", "createdAt"],
  vendor: ["status", "priority", "type", "serialNumber", "tid", "agentName", "account", "state", "anmName", "submittedAt"],
};

interface Props {
  mode: Mode;
  tabs: TabDef[];
  initialTab: string;
  anms?: { id: string; fullName: string }[];
  canExport?: boolean;
  canExportFull?: boolean;
  bulkActions?: ("submit" | "close" | "start" | "treat")[];
  fixedType?: "MAPPING" | "REMAPPING";
  batchId?: string;
}

export function RequestsTable({ mode, tabs, initialTab, anms = [], canExport, canExportFull, bulkActions = [], fixedType, batchId }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState(initialTab);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [filters, setFilters] = useState<{ accountNumber?: string; state?: string; anmId?: string; type?: string; priority?: string; dateFrom?: string; dateTo?: string; dateField?: string; status?: RequestStatus[] }>({});
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<{ sort: string; dir: "asc" | "desc" }>({ sort: mode === "vendor" ? "submittedAt" : "createdAt", dir: mode === "vendor" ? "asc" : "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<{ rows: Row[]; total: number } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<ColKey[]>(DEFAULT_COLS[mode]);
  const [colMenu, setColMenu] = useState(false);
  const [bulk, setBulk] = useState<null | "submit" | "close" | "start" | "treat">(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkComment, setBulkComment] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Remember column choice per mode (convenience only).
  useEffect(() => {
    try {
      const s = localStorage.getItem(`wk-cols-${mode}`);
      if (s) setCols(JSON.parse(s));
    } catch {
      /* ignore */
    }
  }, [mode]);
  const toggleCol = (k: ColKey) => {
    const next = cols.includes(k) ? cols.filter((c) => c !== k) : COLS.map((c) => c.key).filter((c) => cols.includes(c) || c === k);
    setCols(next);
    try {
      localStorage.setItem(`wk-cols-${mode}`, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const tabDef = tabs.find((t) => t.value === tab) ?? tabs[0];
  const body = useMemo(() => {
    const status = filters.status?.length ? filters.status : tabDef.status;
    return {
      q: qDebounced || undefined,
      ...filters,
      accountNumber: filters.accountNumber || undefined,
      status,
      type: fixedType ?? tabDef.type ?? (filters.type || undefined),
      mine: mode === "mine" ? true : undefined,
      batchId,
      ...sort,
      page,
      pageSize,
    };
  }, [qDebounced, filters, tabDef, fixedType, mode, batchId, sort, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== ""));
      const res = await api<{ rows: Row[]; total: number }>("/api/requests/search", { body: clean });
      setData(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load records.");
    } finally {
      setLoading(false);
    }
  }, [body]);

  useEffect(() => {
    load();
  }, [load]);

  // Tab counts (lightweight count queries)
  const loadCounts = useCallback(async () => {
    const out: Record<string, number> = {};
    await Promise.all(
      tabs.map(async (t) => {
        try {
          const r = await api<{ total: number }>("/api/requests/search", {
            body: { status: t.status, type: fixedType ?? t.type, mine: mode === "mine" ? true : undefined, batchId, page: 1, pageSize: 1 },
          });
          out[t.value] = r.total;
        } catch {
          /* ignore */
        }
      }),
    );
    setCounts(out);
  }, [tabs, fixedType, mode, batchId]);
  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [tab, qDebounced, filters, pageSize]);

  const rows = data?.rows ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    const n = new Set(selected);
    if (allSelected) rows.forEach((r) => n.delete(r.id));
    else rows.forEach((r) => n.add(r.id));
    setSelected(n);
  };
  const activeFilterCount = Object.values(filters).filter((v) => (Array.isArray(v) ? v.length : !!v)).length;
  const detailHref = (id: string) => (mode === "vendor" ? `/vendor/requests/${id}` : `/requests/${id}`);

  async function runBulk() {
    if (!bulk) return;
    setBulkBusy(true);
    try {
      const res = await api<{ succeeded: string[]; failed: { reference?: string; error: string }[] }>("/api/requests/bulk", {
        body: { action: bulk, ids: [...selected], confirm: bulkConfirm, comment: bulkComment || null },
      });
      if (res.succeeded.length) toast.push("ok", `${res.succeeded.length} request${res.succeeded.length === 1 ? "" : "s"} updated.`);
      if (res.failed.length) toast.push("bad", `${res.failed.length} could not be updated: ${res.failed.slice(0, 3).map((f) => `${f.reference ?? ""} ${f.error}`).join("; ")}`);
      setBulk(null);
      setSelected(new Set());
      setBulkConfirm(false);
      setBulkComment("");
      load();
      loadCounts();
    } catch (e) {
      toast.push("bad", e instanceof ApiError ? e.message : "Bulk action failed.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function doExport(full: boolean) {
    try {
      const { page: _p, pageSize: _ps, ...f } = body;
      void _p;
      void _ps;
      await download("/api/requests/export", { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "")), includeFullAccount: full });
    } catch (e) {
      toast.push("bad", e instanceof ApiError ? e.message : "Export failed.");
    }
  }

  const BULK_LABEL = { submit: "Submit to Elnexu", close: "Close", start: "Start treatment", treat: "Mark as treated" } as const;

  const cell = (r: Row, k: ColKey) => {
    switch (k) {
      case "status":
        return (
          <div className="flex items-center gap-1.5">
            <StatusBadge status={r.status} vendorView={mode === "vendor"} />
            {r.assignedToMe && <span className="text-2xs font-medium text-accent-700">You</span>}
          </div>
        );
      case "reference":
        return <Link href={detailHref(r.id)} className="ident font-medium text-brand-700 hover:underline">{r.reference}</Link>;
      case "type":
        return <TypeTag type={r.type} />;
      case "serialNumber":
      case "tid":
      case "iswTid":
        return <span className="ident">{r[k] ?? "—"}</span>;
      case "agentName":
        return <span className="block max-w-[16rem] truncate font-medium" title={r.agentName}>{r.agentName}</span>;
      case "account":
        return <span className="ident text-ink-muted">{r.account}</span>;
      case "priority":
        return <PriorityTag priority={r.priority} />;
      case "createdAt":
      case "submittedAt":
      case "treatedAt":
        return <span className="num whitespace-nowrap text-xs text-ink-muted">{fmtDateTime(r[k])}</span>;
      default:
        return <span className="whitespace-nowrap">{(r[k] as string) ?? "—"}</span>;
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-2">
        <Tabs tabs={tabs.map((t) => ({ value: t.value, label: t.label, count: counts[t.value] }))} value={tab} onChange={setTab} />
      </div>
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <input
            className="input pl-9"
            placeholder="Search serial, TID, ISW TID, agent, ANM or request ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search requests"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={clsx("btn-secondary", activeFilterCount && "border-brand-600 text-brand-800")} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
            <Filter className="h-4 w-4" aria-hidden /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
          <div className="relative">
            <button className="btn-secondary" onClick={() => setColMenu((s) => !s)} aria-expanded={colMenu} aria-label="Choose columns">
              <Columns3 className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Columns</span>
            </button>
            {colMenu && (
              <div className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-line bg-surface p-2 shadow-pop">
                {COLS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-sunken">
                    <input type="checkbox" checked={cols.includes(c.key)} onChange={() => toggleCol(c.key)} className="accent-brand-700" />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          {canExport && (
            <button className="btn-secondary" onClick={() => doExport(false)}>
              <Download className="h-4 w-4" aria-hidden /> Export
            </button>
          )}
          {canExportFull && (
            <button className="btn-ghost text-xs" onClick={() => doExport(true)} title="Includes full account numbers — audited">
              Export with full accounts
            </button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="grid gap-3 border-b border-line bg-surface-sunken px-4 py-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label className="text-xs">
            <span className="label">Account number</span>
            <input className="input" inputMode="numeric" autoComplete="off" placeholder="10 digits or last 4" value={filters.accountNumber ?? ""} onChange={(e) => setFilters({ ...filters, accountNumber: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
          </label>
          <label className="text-xs">
            <span className="label">Location</span>
            <select className="input" value={filters.state ?? ""} onChange={(e) => setFilters({ ...filters, state: e.target.value || undefined })}>
              <option value="">All states</option>
              {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          {anms.length > 0 && (
            <label className="text-xs">
              <span className="label">ANM</span>
              <select className="input" value={filters.anmId ?? ""} onChange={(e) => setFilters({ ...filters, anmId: e.target.value || undefined })}>
                <option value="">All ANMs</option>
                {anms.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
              </select>
            </label>
          )}
          {!fixedType && (
            <label className="text-xs">
              <span className="label">Request type</span>
              <select className="input" value={filters.type ?? ""} onChange={(e) => setFilters({ ...filters, type: e.target.value || undefined })}>
                <option value="">All</option>
                <option value="MAPPING">New mapping</option>
                <option value="REMAPPING">Remapping</option>
              </select>
            </label>
          )}
          <label className="text-xs">
            <span className="label">Status</span>
            <select className="input" value={filters.status?.[0] ?? ""} onChange={(e) => setFilters({ ...filters, status: e.target.value ? [e.target.value as RequestStatus] : undefined })}>
              <option value="">Per tab</option>
              {REQUEST_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="label">Priority</span>
            <select className="input" value={filters.priority ?? ""} onChange={(e) => setFilters({ ...filters, priority: e.target.value || undefined })}>
              <option value="">All</option>
              {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="label">Date field</span>
            <select className="input" value={filters.dateField ?? "createdAt"} onChange={(e) => setFilters({ ...filters, dateField: e.target.value })}>
              <option value="createdAt">Created</option>
              <option value="submittedAt">Submitted</option>
              <option value="treatedAt">Treated</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="label">From</span>
            <input type="date" className="input" value={filters.dateFrom ?? ""} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value || undefined })} />
          </label>
          <label className="text-xs">
            <span className="label">To</span>
            <input type="date" className="input" value={filters.dateTo ?? ""} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value || undefined })} />
          </label>
          <div className="flex items-end">
            <button className="btn-ghost" onClick={() => setFilters({})}><X className="h-4 w-4" aria-hidden /> Clear filters</button>
          </div>
        </div>
      )}

      {selected.size > 0 && bulkActions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-50 px-4 py-2.5 text-sm">
          <span className="font-medium text-brand-800">{selected.size} selected</span>
          <div className="flex-1" />
          {bulkActions.map((a) => (
            <button key={a} className={a === "treat" || a === "submit" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setBulk(a)}>
              {BULK_LABEL[a]}
            </button>
          ))}
          <button className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {error && <div className="px-4 py-3 text-sm text-bad-700" role="alert">{error}</div>}

      <div className="relative max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0">
          <caption className="sr-only">Requests</caption>
          <thead>
            <tr>
              {bulkActions.length > 0 && (
                <th className="table-th w-10">
                  <input type="checkbox" aria-label="Select all on this page" checked={allSelected} onChange={toggleAll} className="accent-brand-700" />
                </th>
              )}
              {COLS.filter((c) => cols.includes(c.key)).map((c) => {
                const sortable = "sort" in c;
                const active = sortable && sort.sort === c.sort;
                return (
                  <th key={c.key} className="table-th" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                    {sortable ? (
                      <button
                        className="inline-flex items-center gap-1 uppercase hover:text-ink"
                        onClick={() => setSort({ sort: c.sort, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
                      >
                        {c.label}
                        {active && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
              <th className="table-th text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={clsx("hover:bg-surface-sunken/70", selected.has(r.id) && "bg-brand-50/60")}>
                {bulkActions.length > 0 && (
                  <td className="table-td">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.reference}`}
                      checked={selected.has(r.id)}
                      onChange={() => {
                        const n = new Set(selected);
                        if (n.has(r.id)) n.delete(r.id);
                        else n.add(r.id);
                        setSelected(n);
                      }}
                      className="accent-brand-700"
                    />
                  </td>
                )}
                {COLS.filter((c) => cols.includes(c.key)).map((c) => (
                  <td key={c.key} className="table-td">{cell(r, c.key)}</td>
                ))}
                <td className="table-td text-right">
                  <Link href={detailHref(r.id)} className={mode === "vendor" && (r.status === "SUBMITTED" || r.status === "IN_PROGRESS") ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>
                    {mode === "vendor" && (r.status === "SUBMITTED" || r.status === "IN_PROGRESS") ? "Treat" : "Open"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && (
          <div className="absolute inset-0 flex items-start justify-center bg-surface/60 pt-16">
            <Spinner className="h-6 w-6 text-brand-700" />
          </div>
        )}
        {!loading && rows.length === 0 && !error && (
          <EmptyState
            title={mode === "vendor" && tab === "pending" ? "No pending terminal mappings." : activeFilterCount || qDebounced ? "No records match your search." : "Nothing here yet."}
            body={mode === "vendor" && tab === "pending" ? "New requests released by Wakeel will appear here." : activeFilterCount || qDebounced ? "Try a different search or clear the filters." : undefined}
          />
        )}
      </div>
      <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={setPageSize} />

      <Modal
        open={!!bulk}
        onClose={() => setBulk(null)}
        title={bulk ? `${BULK_LABEL[bulk]} — ${selected.size} request${selected.size === 1 ? "" : "s"}` : ""}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setBulk(null)}>Cancel</button>
            <button className="btn-primary" disabled={bulkBusy || ((bulk === "submit" || bulk === "treat") && !bulkConfirm)} onClick={runBulk}>
              {bulkBusy && <Spinner />} Confirm
            </button>
          </>
        }
      >
        {bulk === "submit" && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 accent-brand-700" checked={bulkConfirm} onChange={(e) => setBulkConfirm(e.target.checked)} />
            I have reviewed the information and it is ready for vendor treatment.
          </label>
        )}
        {bulk === "treat" && (
          <div className="space-y-4">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 accent-brand-700" checked={bulkConfirm} onChange={(e) => setBulkConfirm(e.target.checked)} />
              I confirm that each selected terminal has been successfully mapped in the TMS.
            </label>
            <label className="block text-sm">
              <span className="label">Treatment comment (optional)</span>
              <textarea className="input" rows={2} maxLength={1000} value={bulkComment} onChange={(e) => setBulkComment(e.target.value)} />
            </label>
          </div>
        )}
        {bulk === "start" && <p className="text-sm text-ink-muted">The selected requests will be marked In Progress and assigned to you.</p>}
        {bulk === "close" && <p className="text-sm text-ink-muted">Closing marks the selected treated requests as fully completed.</p>}
        <p className="mt-4 text-xs text-ink-subtle">Each request is processed individually; any that are not in the right state will be reported and left unchanged.</p>
      </Modal>
    </div>
  );
}
