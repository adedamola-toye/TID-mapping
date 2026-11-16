import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Clock, Send, CheckCircle2 } from "lucide-react";
import { requirePage } from "@/server/http";
import { dashboard } from "@/server/services/reports";
import { Card, PageHeader, TypeTag } from "@/components/ui";
import { DailyColumns, HBars } from "@/components/charts";
import { fmtDateTime, fmtDuration, fmtNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

function Stat({ label, value, sub, href, tone }: { label: string; value: number | string; sub?: string; href?: string; tone?: "bad" | "warn" }) {
  const body = (
    <div className="h-full rounded-md border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong">
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className={`num mt-1.5 text-2xl font-semibold ${tone === "bad" ? "text-bad-700" : tone === "warn" ? "text-warn-700" : "text-ink"}`}>{typeof value === "number" ? fmtNumber(value) : value}</div>
      {sub && <div className="mt-1 text-xs text-ink-subtle">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export default async function DashboardPage() {
  const { actor, session } = await requirePage("dashboard:view");
  const d = await dashboard(actor);
  const r = d.requests;
  return (
    <>
      <PageHeader
        eyebrow="Wakeel operations"
        title={`Good ${new Date().getUTCHours() + 1 < 12 ? "morning" : new Date().getUTCHours() + 1 < 17 ? "afternoon" : "evening"}, ${session.user.fullName.split(" ")[0]}`}
        subtitle="Live view of terminal mapping work across Wakeel and Elnexu."
        actions={
          <>
            <Link href="/requests/new/mapping" className="btn-primary">New mapping</Link>
            <Link href="/requests/new/remapping" className="btn-secondary">New remapping</Link>
          </>
        }
      />

      {/* Action strip: what needs attention now */}
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <Link href="/requests?view=review" className="flex items-center gap-3 rounded-md border border-info-700/20 bg-info-50 px-4 py-3 text-sm text-info-700 hover:border-info-700/40">
          <Clock className="h-5 w-5 shrink-0" aria-hidden />
          <span className="flex-1"><strong className="num">{r.readyForReview}</strong> ready for review &amp; release</span>
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link href="/requests?view=exceptions" className="flex items-center gap-3 rounded-md border border-bad-600/25 bg-bad-50 px-4 py-3 text-sm text-bad-700 hover:border-bad-600/50">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <span className="flex-1"><strong className="num">{r.exceptions}</strong> vendor exception{r.exceptions === 1 ? "" : "s"} to resolve</span>
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link href="/requests?view=treated" className="flex items-center gap-3 rounded-md border border-ok-700/25 bg-ok-50 px-4 py-3 text-sm text-ok-700 hover:border-ok-700/50">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          <span className="flex-1"><strong className="num">{r.awaitingClose}</strong> treated, awaiting close-out</span>
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Overall</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Total terminals" value={d.terminals.total} sub={`${fmtNumber(d.terminals.mapped)} mapped · ${fmtNumber(d.terminals.available)} available`} href="/terminals" />
        <Stat label="Total mappings" value={r.totalMappings} href="/requests?type=MAPPING&view=history" />
        <Stat label="Total remappings" value={r.totalRemappings} href="/requests?type=REMAPPING&view=history" />
        <Stat label="Pending mappings" value={r.pendingMappings} sub="Not yet released" href="/requests?type=MAPPING&view=queue" />
        <Stat label="Pending remappings" value={r.pendingRemappings} sub="Not yet released" href="/requests?type=REMAPPING&view=queue" />
        <Stat label="Submitted to Elnexu" value={r.withVendor} sub={`${r.inProgress} in progress`} href="/requests?view=vendor" tone={r.withVendor ? "warn" : undefined} />
        <Stat label="Outstanding" value={r.outstanding} sub={`${fmtNumber(r.treated)} treated to date`} href="/reports?tab=outstanding" />
      </div>

      <div className="mb-8 grid gap-6 xl:grid-cols-3">
        <Card title="Submitted vs treated — last 14 days" className="xl:col-span-2">
          <DailyColumns rows={d.daily} />
        </Card>
        <Card title="Vendor performance (Elnexu)">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><dt className="text-xs text-ink-muted">Assigned (open)</dt><dd className="num mt-1 text-xl font-semibold">{fmtNumber(r.withVendor)}</dd></div>
            <div><dt className="text-xs text-ink-muted">Treated to date</dt><dd className="num mt-1 text-xl font-semibold">{fmtNumber(r.treated)}</dd></div>
            <div><dt className="text-xs text-ink-muted">Avg. treatment time</dt><dd className="num mt-1 text-xl font-semibold">{fmtDuration(r.avgTreatMs)}</dd></div>
            <div><dt className="text-xs text-ink-muted">Exception rate</dt><dd className="num mt-1 text-xl font-semibold">{(r.exceptionRate * 100).toFixed(1)}%</dd></div>
          </dl>
          <div className="mt-5 border-t border-line pt-4 text-xs text-ink-muted">
            Oldest pending with vendor: <span className="font-medium text-ink">{r.oldestPendingAt ? fmtDateTime(r.oldestPendingAt) : "none"}</span>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 rounded bg-surface-sunken p-3 text-center">
            {[
              ["Created", d.today.created],
              ["Released", d.today.submitted],
              ["Treated", d.today.treated],
              ["Exceptions", d.today.exceptions],
            ].map(([l, v]) => (
              <div key={l as string}>
                <div className="num text-lg font-semibold">{v}</div>
                <div className="text-2xs uppercase tracking-wide text-ink-subtle">{l} today</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Mapped terminals by ANM"><HBars rows={d.byAnm.map((x) => ({ label: x.label, n: x.n }))} /></Card>
        <Card title="Mapped terminals by state"><HBars rows={d.byState.map((x) => ({ label: x.label, n: x.n }))} /></Card>
        <Card title="Recent treatments" bodyClass="p-0" actions={<Link href="/requests?view=treated" className="text-xs text-brand-700 hover:underline">View all</Link>}>
          {d.recentTreatments.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">No treatments yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.recentTreatments.map((t) => (
                <li key={t.id}>
                  <Link href={`/requests/${t.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-sunken">
                    <Send className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><TypeTag type={t.type} /><span className="truncate text-sm font-medium">{t.agentName}</span></div>
                      <div className="ident mt-0.5 text-xs text-ink-muted">{t.serialNumber} · {t.tid}</div>
                    </div>
                    <div className="text-right text-2xs text-ink-subtle">{fmtDateTime(t.treatedAt)}<br />{t.treatedByName}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
