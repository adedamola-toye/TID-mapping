import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/http";
import { getTerminalDetail } from "@/server/services/terminals";
import { AppError } from "@/server/errors";
import { can } from "@/server/rbac";
import { Card, KV, PageHeader, StatusBadge, TerminalBadge, TypeTag } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { exceptionLabel } from "@/components/requests/Timeline";
import { TerminalAdmin } from "./TerminalAdmin";

export const metadata: Metadata = { title: "Terminal" };

export default async function TerminalPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePage("terminal:view");
  const { id } = await params;
  let d;
  try {
    d = await getTerminalDetail(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const t = d.terminal;
  const current = d.mappings.find((m) => m.isCurrent);
  return (
    <>
      <PageHeader
        eyebrow="Terminal lifecycle"
        title={<span className="ident text-2xl">{t.serialNumber}</span>}
        subtitle={`TID ${t.tid ?? "not assigned"}${t.iswTid ? ` · ISW TID ${t.iswTid}` : ""} · vendor ${t.vendorName ?? "—"}`}
        actions={
          <>
            <TerminalBadge status={t.status} />
            {can(actor.role, "request:create") && t.status === "MAPPED" && (
              <Link href={`/requests/new/remapping?terminal=${encodeURIComponent(t.serialNumber)}`} className="btn-primary">Remap terminal</Link>
            )}
            {can(actor.role, "request:create") && t.status === "AVAILABLE" && <Link href="/requests/new/mapping" className="btn-primary">Map terminal</Link>}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Current state" className="xl:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-3">
            <KV label="Serial number" mono>{t.serialNumber}</KV>
            <KV label="TID" mono>{t.tid ?? "—"}</KV>
            <KV label="ISW TID" mono>{t.iswTid ?? "—"}</KV>
            <KV label="Current agent / merchant">{current?.agentName ?? "—"}</KV>
            <KV label="Account" mono>{current?.account ?? "—"}</KV>
            <KV label="Location">{current ? `${current.state}${current.area ? ` — ${current.area}` : ""}` : "—"}</KV>
            <KV label="Current ANM">{current?.anmName ?? "—"}</KV>
            <KV label="First mapped">{fmtDateTime(t.mappedAt)}</KV>
            <KV label="Last remapped">{fmtDateTime(t.lastRemappedAt)}</KV>
          </dl>
        </Card>
        <Card title="Vendor batch record">
          <dl className="space-y-3">
            <KV label="Merchant on vendor sheet">{t.legacyAgentName ?? "—"}</KV>
            <KV label="Vendor location">{t.stockLocation ?? "—"}</KV>
            <KV label="Legacy status">{t.legacyStatus ?? "—"}</KV>
            <KV label="Legacy comment">{t.legacyComment ?? "—"}</KV>
            <KV label="Registered">{fmtDateTime(t.createdAt)}</KV>
            {Object.keys(t.extraIdentifiers).length > 0 && (
              <KV label="Other values on the vendor sheet">
                <ul className="space-y-0.5">
                  {Object.entries(t.extraIdentifiers).map(([k, v]) => (
                    <li key={k}><span className="text-ink-muted">{k}:</span> <span className="ident">{v}</span></li>
                  ))}
                </ul>
              </KV>
            )}
          </dl>
          {can(actor.role, "terminal:manage") && <TerminalAdmin id={t.id} status={t.status} iswTid={t.iswTid} legacyComment={t.legacyComment} />}
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-ink-muted">Mapping history</h2>
      {d.mappings.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            {t.legacyAgentName
              ? `The vendor sheet shows this terminal with ${t.legacyAgentName}${t.legacyStatus ? ` (status "${t.legacyStatus}")` : ""}, but no account number or ANM has been captured yet. Create a new mapping to bring it under full control — the details will be pre-filled.`
              : "This terminal has not been mapped yet."}
          </p>
        </Card>
      ) : (
        <ol className="space-y-4">
          {d.mappings.map((m) => (
            <li key={m.id} className={`card overflow-hidden ${m.isCurrent ? "border-brand-600/40" : ""}`}>
              <div className={`flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3 ${m.isCurrent ? "bg-brand-50/60" : "bg-surface-sunken"}`}>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">Mapping version {m.version}</span>
                  {m.isCurrent ? <span className="rounded-full bg-brand-700 px-2 py-0.5 text-2xs font-semibold uppercase text-white">Current</span> : <span className="text-xs text-ink-subtle">Superseded {fmtDateTime(m.effectiveTo)}</span>}
                  {m.requestType && <TypeTag type={m.requestType} />}
                </div>
                {m.requestId && m.requestReference && <Link href={`/requests/${m.requestId}`} className="ident text-xs text-brand-700 hover:underline">{m.requestReference}</Link>}
              </div>
              <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
                <KV label="Agent / merchant">{m.agentName}</KV>
                <KV label="Account" mono>{m.account}</KV>
                <KV label="Location">{m.state}{m.area ? ` — ${m.area}` : ""}</KV>
                <KV label="ANM">{m.anmName}</KV>
                <KV label="Requested by">{m.requestedBy ?? "—"} · {fmtDateTime(m.requestedAt)}</KV>
                <KV label="Sent to Elnexu">{fmtDateTime(m.submittedAt)}</KV>
                <KV label="Treated by">{m.treatedBy ?? "—"} · {fmtDateTime(m.treatedAt)}</KV>
                <KV label="Reason / comment">{m.reason ?? m.treatmentComment ?? "—"}</KV>
              </dl>
            </li>
          ))}
        </ol>
      )}

      <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-ink-muted">All requests for this terminal</h2>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[700px] border-separate border-spacing-0">
          <thead><tr>{["Request", "Type", "Status", "Agent / merchant", "Requested by", "Created", "Treated", "Exception"].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
          <tbody>
            {d.requests.map((r) => (
              <tr key={r.id}>
                <td className="table-td"><Link href={`/requests/${r.id}`} className="ident text-brand-700 hover:underline">{r.reference}</Link></td>
                <td className="table-td"><TypeTag type={r.type} /></td>
                <td className="table-td"><StatusBadge status={r.status} /></td>
                <td className="table-td">{r.agentName}</td>
                <td className="table-td">{r.requestedBy}</td>
                <td className="table-td num text-xs">{fmtDateTime(r.createdAt)}</td>
                <td className="table-td num text-xs">{fmtDateTime(r.treatedAt)}</td>
                <td className="table-td text-xs">{exceptionLabel(r.exceptionReason) || "—"}</td>
              </tr>
            ))}
            {d.requests.length === 0 && <tr><td colSpan={8} className="table-td py-8 text-center text-ink-muted">No requests yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
