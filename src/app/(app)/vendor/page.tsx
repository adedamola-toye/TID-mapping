import type { Metadata } from "next";
import { requirePage } from "@/server/http";
import { vendorSummary } from "@/server/services/reports";
import { PageHeader } from "@/components/ui";
import { RequestsTable, type TabDef } from "@/components/requests/RequestsTable";

export const metadata: Metadata = { title: "Treatment Queue" };

const TABS: TabDef[] = [
  { value: "pending", label: "Pending treatment", status: ["SUBMITTED", "IN_PROGRESS"] },
  { value: "mapping", label: "New mappings", status: ["SUBMITTED", "IN_PROGRESS"], type: "MAPPING" },
  { value: "remapping", label: "Remappings", status: ["SUBMITTED", "IN_PROGRESS"], type: "REMAPPING" },
  { value: "treated", label: "Treated", status: ["TREATED", "CLOSED"] },
  { value: "exceptions", label: "Exceptions", status: ["EXCEPTION"] },
];

export default async function VendorQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, session } = await requirePage("vendor:queue");
  const sp = await searchParams;
  const s = await vendorSummary(actor);
  const initial = TABS.some((t) => t.value === sp.tab) ? (sp.tab as string) : "pending";
  return (
    <>
      <PageHeader
        eyebrow={`${session.user.vendorName ?? "Vendor"} workspace`}
        title="Treatment Queue"
        subtitle="Open a request, copy the details into the TMS, then mark it as treated. Oldest requests are shown first."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Pending", s.pending, ""],
          ["In progress", s.inProgress, `${s.mine} assigned to you`],
          ["High / urgent", s.urgent, ""],
          ["Treated today", s.treatedToday, ""],
          ["Open exceptions", s.exceptions, "Awaiting Wakeel"],
        ].map(([l, v, sub]) => (
          <div key={l as string} className="rounded-md border border-line bg-surface p-4 shadow-card">
            <div className="text-xs font-medium text-ink-muted">{l}</div>
            <div className="num mt-1 text-2xl font-semibold">{v}</div>
            {sub && <div className="text-xs text-ink-subtle">{sub}</div>}
          </div>
        ))}
      </div>
      <RequestsTable key={initial} mode="vendor" tabs={TABS} initialTab={initial} bulkActions={["start", "treat"]} />
    </>
  );
}
