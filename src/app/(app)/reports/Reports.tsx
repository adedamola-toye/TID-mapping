"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Download, Search } from "lucide-react";
import { api, ApiError, download } from "@/lib/client/api";
import { Alert, Card, Spinner, StatusBadge, Tabs, TypeTag } from "@/components/ui";
import { HBars } from "@/components/charts";
import { fmtDateTime, fmtDuration, fmtNumber } from "@/lib/format";
import { REGIONS, REGION_LABELS, ROLE_LABELS, type Region, type RequestStatus, type Role } from "@/lib/constants";

const TABS = [
  { value: "daily", label: "Daily mapping" },
  { value: "vendor", label: "Vendor performance" },
  { value: "outstanding", label: "Outstanding" },
  { value: "anm", label: "ANM" },
  { value: "location", label: "Location (N/S Bank)" },
  { value: "activity", label: "Activity" },
  { value: "terminal", label: "Terminal history" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/* eslint-disable @typescript-eslint/no-explicit-any */
export function Reports({ initialTab, canExport }: { initialTab: string; canExport: boolean }) {
  const [tab, setTab] = useState(TABS.some((t) => t.value === initialTab) ? initialTab : "daily");
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [region, setRegion] = useState<Region | "">("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "terminal") return;
    setLoading(true);
    setErr(null);
    setData(null);
    api(`/api/reports/${tab}`, { body: { from, to, region: region || undefined } })
      .then(setData)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Could not load report."))
      .finally(() => setLoading(false));
  }, [tab, from, to, region]);

  const usesRange = !["outstanding", "terminal"].includes(tab);

  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-2"><Tabs tabs={TABS} value={tab} onChange={setTab} /></div>
      {tab !== "terminal" && (
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
          {tab === "location" && (
            <label className="text-xs">
              <span className="label">Bank</span>
              <select className="input" value={region} onChange={(e) => setRegion(e.target.value as Region | "")}>
                <option value="">All banks</option>
                {REGIONS.map((x) => <option key={x} value={x}>{REGION_LABELS[x]}</option>)}
              </select>
            </label>
          )}
          {usesRange && (
            <>
              <label className="text-xs"><span className="label">From</span><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="text-xs"><span className="label">To</span><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
              <div className="flex gap-1 pb-0.5">
                {[7, 30, 90].map((n) => (
                  <button key={n} className="btn-ghost btn-sm" onClick={() => { setFrom(iso(new Date(Date.now() - (n - 1) * 86400_000))); setTo(iso(new Date())); }}>Last {n} days</button>
                ))}
              </div>
            </>
          )}
          <div className="flex-1" />
          {canExport && (
            <button className="btn-secondary" onClick={() => download(`/api/reports/${tab}`, { from, to, region: region || undefined, format: "xlsx" })}>
              <Download className="h-4 w-4" aria-hidden /> Export to Excel
            </button>
          )}
        </div>
      )}
      <div className="p-4 sm:p-5">
        {err && <Alert tone="bad">{err}</Alert>}
        {loading && <div className="flex justify-center py-12"><Spinner className="h-6 w-6 text-brand-700" /></div>}
        {data && tab === "daily" && <Daily d={data} />}
        {data && tab === "vendor" && <Vendor d={data} />}
        {data && tab === "outstanding" && <Outstanding d={data} />}
        {data && tab === "anm" && (
          <T head={["Code", "ANM", "Status", "Current portfolio", "Mapped (period)", "Remapped (period)", "Outstanding"]}>
            {data.rows.map((r: any) => (
              <tr key={r.id}>
                <td className="table-td ident">{r.code}</td>
                <td className="table-td"><Link className="text-brand-700 hover:underline" href={`/anms/${r.id}`}>{r.fullName}</Link></td>
                <td className="table-td text-xs">{r.isActive ? "Active" : "Inactive"}</td>
                <N v={r.portfolio} /><N v={r.mapped} /><N v={r.remapped} /><N v={r.outstanding} />
              </tr>
            ))}
          </T>
        )}
        {data && tab === "location" && (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.banks.map((b: any) => (
                <button
                  key={b.label}
                  onClick={() => b.region && setRegion(region === b.region ? "" : b.region)}
                  className={`rounded border p-4 text-left transition-colors ${region && region === b.region ? "border-brand-600 bg-brand-50/60" : "border-line hover:border-line-strong"}`}
                  aria-pressed={region === b.region}
                >
                  <div className="flex items-baseline justify-between"><span className="text-sm font-semibold">{b.label}</span><span className="text-xs text-ink-subtle">{b.states} states</span></div>
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                    {[["Terminals", b.terminals], ["Mapped", b.mappings], ["Remapped", b.remappings], ["Outstanding", b.outstanding]].map(([l, v]) => (
                      <div key={l}><dd className="num text-lg font-semibold">{fmtNumber(v)}</dd><dt className="text-2xs uppercase tracking-wide text-ink-subtle">{l}</dt></div>
                    ))}
                  </dl>
                </button>
              ))}
            </div>
            <T head={["Bank", "State", "Mapped terminals", "Mappings (period)", "Remappings (period)", "Outstanding"]}>
              {data.rows.map((r: any) => (
                <tr key={r.state}><td className="table-td text-xs text-ink-muted">{r.regionLabel}</td><td className="table-td">{r.state}</td><N v={r.terminals} /><N v={r.mappings} /><N v={r.remappings} /><N v={r.outstanding} /></tr>
              ))}
            </T>
          </div>
        )}
        {data && tab === "activity" && (
          <T head={["User", "Role", "Created", "Submitted", "Treated", "Exceptions", "Returned", "Amended", "Total actions"]}>
            {data.byUser.map((r: any, i: number) => (
              <tr key={i}>
                <td className="table-td">{r.actorName}</td>
                <td className="table-td text-xs">{ROLE_LABELS[r.actorRole as Role] ?? r.actorRole}</td>
                <N v={r.created} /><N v={r.submitted} /><N v={r.treated} /><N v={r.exceptions} /><N v={r.returned} /><N v={r.amended} /><N v={r.total} />
              </tr>
            ))}
          </T>
        )}
        {tab === "terminal" && <TerminalLookup />}
      </div>
    </div>
  );
}

function N({ v }: { v: number }) {
  return <td className="table-td num text-right">{fmtNumber(v)}</td>;
}

function T({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-line">
      <table className="w-full min-w-[420px] border-separate border-spacing-0">
        <thead><tr>{head.map((h, i) => <th key={h} className={`table-th ${i > 0 && !["ANM", "Role", "Status", "User", "State"].includes(h) ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Daily({ d }: { d: any }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Created", d.totals.created], ["Submitted", d.totals.submitted], ["Treated", d.totals.treated], ["Exceptions", d.totals.exceptions]].map(([l, v]) => (
          <div key={l} className="rounded border border-line p-4"><div className="text-xs text-ink-muted">Total {String(l).toLowerCase()}</div><div className="num mt-1 text-2xl font-semibold">{fmtNumber(v as number)}</div></div>
        ))}
      </div>
      <T head={["Day", "Created", "Submitted", "Treated", "Exceptions", "Outstanding (end of day)"]}>
        {d.rows.map((r: any) => (
          <tr key={r.day}><td className="table-td num">{r.day}</td><N v={r.created} /><N v={r.submitted} /><N v={r.treated} /><N v={r.exceptions} /><N v={r.outstanding} /></tr>
        ))}
      </T>
    </div>
  );
}

function Vendor({ d }: { d: any }) {
  return (
    <div className="space-y-6">
      {d.byVendor.map((v: any) => (
        <div key={v.vendor} className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {[
            ["Vendor", v.vendor],
            ["Received", fmtNumber(v.received)],
            ["Treated", fmtNumber(v.treated)],
            ["Outstanding now", fmtNumber(v.outstanding)],
            ["Avg / P90 treatment", `${fmtDuration(v.avgTreatMs)} / ${fmtDuration(v.p90TreatMs)}`],
            ["Exception rate", `${(v.exceptionRate * 100).toFixed(1)}%`],
          ].map(([l, val]) => (
            <div key={l} className="rounded border border-line p-4"><div className="text-xs text-ink-muted">{l}</div><div className="num mt-1 text-lg font-semibold">{val}</div></div>
          ))}
        </div>
      ))}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Treated by vendor user">
          <T head={["User", "Treated", "Avg time"]}>
            {d.byUser.map((u: any) => <tr key={u.user}><td className="table-td">{u.user}</td><N v={u.treated} /><td className="table-td num text-right">{fmtDuration(u.avgTreatMs)}</td></tr>)}
          </T>
        </Card>
        <Card title="Exceptions by reason"><HBars rows={d.exceptionReasons.map((e: any) => ({ label: e.label, n: e.n }))} empty="No exceptions in this period." /></Card>
      </div>
    </div>
  );
}

function Outstanding({ d }: { d: any }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries(d.buckets).map(([k, v]) => (
          <div key={k} className="rounded border border-line p-4"><div className="text-xs text-ink-muted">Waiting {k}</div><div className={`num mt-1 text-2xl font-semibold ${k === "> 7 days" && (v as number) > 0 ? "text-bad-700" : ""}`}>{v as number}</div></div>
        ))}
      </div>
      <T head={["Request", "Type", "Status", "Priority", "Serial", "TID", "Agent / merchant", "State", "ANM", "Waiting since", "Age"]}>
        {d.rows.map((r: any) => (
          <tr key={r.id}>
            <td className="table-td"><Link href={`/requests/${r.id}`} className="ident text-brand-700 hover:underline">{r.reference}</Link></td>
            <td className="table-td"><TypeTag type={r.type} /></td>
            <td className="table-td"><StatusBadge status={r.status as RequestStatus} /></td>
            <td className="table-td text-xs">{r.priority}</td>
            <td className="table-td ident">{r.serialNumber}</td>
            <td className="table-td ident">{r.tid}</td>
            <td className="table-td">{r.agentName}</td>
            <td className="table-td">{r.state}</td>
            <td className="table-td whitespace-nowrap">{r.anmName}</td>
            <td className="table-td num whitespace-nowrap text-xs">{fmtDateTime(r.submittedAt ?? r.createdAt)}</td>
            <td className="table-td num text-right">{fmtDuration(r.ageHours * 3600_000)}</td>
          </tr>
        ))}
        {d.rows.length === 0 && <tr><td colSpan={11} className="table-td py-8 text-center text-ink-muted">Nothing outstanding.</td></tr>}
      </T>
    </div>
  );
}

function TerminalLookup() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ rows: any[] }>("/api/terminals/search", { body: { q, pageSize: 20 } });
      setRows(r.rows);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-3xl">
      <p className="mb-3 text-sm text-ink-muted">Search one terminal by serial number or TID to see its complete lifecycle — every mapping version, who requested it, when it was sent to Elnexu, who treated it and any exceptions.</p>
      <form onSubmit={go} className="flex gap-2">
        <input className="input ident flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Serial number or TID" aria-label="Serial number or TID" />
        <button className="btn-primary" disabled={!q.trim() || busy}>{busy ? <Spinner /> : <Search className="h-4 w-4" aria-hidden />} Search</button>
      </form>
      {rows && (
        <ul className="mt-4 divide-y divide-line rounded border border-line">
          {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-muted">No terminal found.</li>}
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/terminals/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-sunken">
                <span className="ident">{r.serialNumber} · {r.tid ?? "—"}</span>
                <span className="truncate text-sm text-ink-muted">{r.agentName ?? "Not mapped"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
