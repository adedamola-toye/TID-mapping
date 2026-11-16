"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { api, ApiError, download } from "@/lib/client/api";
import { EmptyState, Pagination, Spinner, Tabs, TerminalBadge } from "@/components/ui";
import { useToast } from "@/components/toast";
import { type Region, type RegionMap, type TerminalStatus } from "@/lib/constants";
import { RegionStatePicker } from "@/components/RegionStatePicker";
import { fmtDate } from "@/lib/format";

interface Row {
  id: string;
  serialNumber: string;
  tid: string | null;
  iswTid: string | null;
  status: TerminalStatus;
  agentName: string | null;
  account: string;
  state: string | null;
  anmName: string | null;
  version: number | null;
  mappedAt: string | null;
  lastRemappedAt: string | null;
  stockLocation: string | null;
  legacyStatus: string | null;
  legacyAgentName: string | null;
}

const TABS: { value: string; label: string; status?: TerminalStatus[]; remapped?: boolean }[] = [
  { value: "all", label: "All terminals" },
  { value: "active", label: "Active", status: ["AVAILABLE", "MAPPING_PENDING", "MAPPED", "REMAPPING_PENDING"] },
  { value: "available", label: "Available", status: ["AVAILABLE"] },
  { value: "mapped", label: "Mapped", status: ["MAPPED"] },
  { value: "pending", label: "Pending", status: ["MAPPING_PENDING", "REMAPPING_PENDING"] },
  { value: "remapped", label: "Remapped", remapped: true },
  { value: "inactive", label: "Inactive", status: ["INACTIVE"] },
];

export function TerminalsTable({ anms, canExport, canRemap, regions }: { anms: { id: string; fullName: string }[]; canExport: boolean; canRemap: boolean; regions: RegionMap }) {
  const toast = useToast();
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [state, setState] = useState("");
  const [region, setRegion] = useState<Region | "">("");
  const [anmId, setAnmId] = useState("");
  const [account, setAccount] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<{ rows: Row[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setQd(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const t = TABS.find((x) => x.value === tab)!;
  const body = useMemo(
    () => ({ q: qd || undefined, region: region || undefined, state: state || undefined, anmId: anmId || undefined, accountNumber: account || undefined, status: t.status, remapped: t.remapped, page, pageSize }),
    [qd, region, state, anmId, account, t, page, pageSize],
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api("/api/terminals/search", { body: JSON.parse(JSON.stringify(body)) }));
    } catch (e) {
      toast.push("bad", e instanceof ApiError ? e.message : "Could not load terminals.");
    } finally {
      setLoading(false);
    }
  }, [body, toast]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [tab, qd, region, state, anmId, account, pageSize]);

  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-2"><Tabs tabs={TABS.map((x) => ({ value: x.value, label: x.label }))} value={tab} onChange={setTab} /></div>
      <div className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-[1fr_9rem_11rem_12rem_9rem_auto] md:items-end">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <input className="input pl-9" placeholder="Serial, TID, ISW TID, agent or ANM…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search terminals" />
        </div>
        <RegionStatePicker mode="filter" regions={regions} region={region} state={state} onChange={(x) => { setRegion(x.region); setState(x.state); }} />
        <select className="input" value={anmId} onChange={(e) => setAnmId(e.target.value)} aria-label="ANM">
          <option value="">All ANMs</option>
          {anms.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
        </select>
        <input className="input" inputMode="numeric" autoComplete="off" placeholder="Account no." value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, "").slice(0, 10))} aria-label="Account number" />
        {canExport && (
          <button className="btn-secondary" onClick={() => download("/api/terminals/export", JSON.parse(JSON.stringify({ ...body, page: undefined, pageSize: undefined }))).catch((e) => toast.push("bad", e.message))}>
            <Download className="h-4 w-4" aria-hidden /> Export
          </button>
        )}
      </div>
      <div className="relative max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[1000px] border-separate border-spacing-0">
          <thead>
            <tr>
              {["Serial number", "TID", "ISW TID", "Status", "Current agent / merchant", "Account", "Location", "ANM", "Ver.", "Mapped", "Last remapped", ""].map((h) => (
                <th key={h} className="table-th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.id} className="hover:bg-surface-sunken/70">
                <td className="table-td"><Link href={`/terminals/${r.id}`} className="ident font-medium text-brand-700 hover:underline">{r.serialNumber}</Link></td>
                <td className="table-td ident">{r.tid ?? "—"}</td>
                <td className="table-td ident text-ink-muted">{r.iswTid ?? "—"}</td>
                <td className="table-td"><TerminalBadge status={r.status} /></td>
                <td className="table-td">
                  {r.agentName ? (
                    <span className="block max-w-[16rem] truncate">{r.agentName}</span>
                  ) : r.legacyAgentName ? (
                    <span className="block max-w-[16rem] truncate text-ink-muted" title="From the vendor sheet — account and ANM not yet captured">
                      {r.legacyAgentName} <span className="text-2xs uppercase tracking-wide text-accent-700">sheet</span>
                    </span>
                  ) : (
                    <span className="text-ink-subtle">{r.legacyStatus ? `Legacy: ${r.legacyStatus}` : "Not mapped"}</span>
                  )}
                </td>
                <td className="table-td ident text-ink-muted">{r.agentName ? r.account : "—"}</td>
                <td className="table-td">{r.state ?? (r.stockLocation ? <span className="text-ink-subtle">{r.stockLocation} (stock)</span> : "—")}</td>
                <td className="table-td whitespace-nowrap">{r.anmName ?? "—"}</td>
                <td className="table-td num">{r.version ?? "—"}</td>
                <td className="table-td num whitespace-nowrap text-xs text-ink-muted">{fmtDate(r.mappedAt)}</td>
                <td className="table-td num whitespace-nowrap text-xs text-ink-muted">{fmtDate(r.lastRemappedAt)}</td>
                <td className="table-td text-right whitespace-nowrap">
                  {canRemap && r.status === "MAPPED" && <Link href={`/requests/new/remapping?terminal=${encodeURIComponent(r.serialNumber)}`} className="btn-ghost btn-sm">Remap</Link>}
                  <Link href={`/terminals/${r.id}`} className="btn-secondary btn-sm">History</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="absolute inset-0 flex items-start justify-center bg-surface/60 pt-16"><Spinner className="h-6 w-6 text-brand-700" /></div>}
        {!loading && !data?.rows.length && <EmptyState title="No terminals found." body="Try another search, or upload a vendor TID batch." />}
      </div>
      <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={setPageSize} />
    </div>
  );
}
