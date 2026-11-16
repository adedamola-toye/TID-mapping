import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/http";
import { getAnm } from "@/server/services/anms";
import { AppError } from "@/server/errors";
import { Card, KV, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "ANM" };

export default async function AnmPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("anm:view");
  const { id } = await params;
  let d;
  try {
    d = await getAnm(id);
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "BAD_REQUEST")) notFound();
    throw e;
  }
  return (
    <>
      <PageHeader eyebrow={`ANM · ${d.anm.code}`} title={d.anm.fullName} subtitle={d.anm.isActive ? "Active" : "Inactive — not available for new assignments"} />
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card title="Details" className="self-start">
          <dl className="space-y-3">
            <KV label="Code" mono>{d.anm.code}</KV>
            <KV label="Email">{d.anm.email ?? "—"}</KV>
            <KV label="Phone">{d.anm.phone ?? "—"}</KV>
            <KV label="States covered">{d.anm.regions.join(", ") || "—"}</KV>
          </dl>
        </Card>
        <Card title={`Current terminal portfolio (${d.portfolio.length})`} bodyClass="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[600px] border-separate border-spacing-0">
              <thead><tr>{["Serial", "TID", "Agent / merchant", "State", "Since"].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
              <tbody>
                {d.portfolio.map((p) => (
                  <tr key={p.terminalId}>
                    <td className="table-td"><Link href={`/terminals/${p.terminalId}`} className="ident text-brand-700 hover:underline">{p.serialNumber}</Link></td>
                    <td className="table-td ident">{p.tid}</td>
                    <td className="table-td">{p.agentName}</td>
                    <td className="table-td">{p.state}</td>
                    <td className="table-td num text-xs">{fmtDate(p.since)}</td>
                  </tr>
                ))}
                {d.portfolio.length === 0 && <tr><td colSpan={5} className="table-td py-8 text-center text-ink-muted">No terminals currently mapped to this ANM.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
