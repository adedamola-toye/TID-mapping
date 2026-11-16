import type { Metadata } from "next";
import Link from "next/link";
import { requirePage } from "@/server/http";
import { listActiveAnms } from "@/server/services/anms";
import { can } from "@/server/rbac";
import { PageHeader } from "@/components/ui";
import { getRegionMap } from "@/server/services/regions";
import { RequestsTable, type TabDef } from "@/components/requests/RequestsTable";

export const metadata: Metadata = { title: "Requests" };

const TABS: TabDef[] = [
  { value: "all", label: "All" },
  { value: "review", label: "Ready for review", status: ["DRAFT", "READY_FOR_REVIEW", "RETURNED"] },
  { value: "vendor", label: "With Elnexu", status: ["SUBMITTED", "IN_PROGRESS"] },
  { value: "exceptions", label: "Exceptions", status: ["EXCEPTION"] },
  { value: "treated", label: "Treated", status: ["TREATED"] },
  { value: "history", label: "Completed", status: ["TREATED", "CLOSED", "CANCELLED"] },
];
const QUEUE: TabDef[] = [
  { value: "queue", label: "Open", status: ["DRAFT", "READY_FOR_REVIEW", "RETURNED", "SUBMITTED", "IN_PROGRESS", "EXCEPTION"] },
  ...TABS.slice(1),
  { value: "all", label: "All" },
];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor } = await requirePage("request:view_all");
  const sp = await searchParams;
  const type = sp.type === "MAPPING" || sp.type === "REMAPPING" ? sp.type : undefined;
  const view = sp.view ?? "all";
  const tabs = type ? QUEUE : TABS;
  const initial = tabs.some((t) => t.value === view) ? view : tabs[0].value;
  const anms = await listActiveAnms();
  const title = type === "MAPPING" ? (view === "history" ? "Mapping History" : "Mapping Queue") : type === "REMAPPING" ? (view === "history" ? "Remapping History" : "Remapping Queue") : "All Requests";
  return (
    <>
      <PageHeader
        eyebrow={type ? (type === "MAPPING" ? "Terminal mapping" : "Terminal remapping") : "Operations"}
        title={title}
        subtitle="Review, release to Elnexu and track every request. Select rows to act in bulk."
        actions={
          can(actor.role, "request:create") && (
            <>
              {type !== "REMAPPING" && <Link href="/requests/new/mapping" className="btn-primary">New mapping</Link>}
              {type !== "MAPPING" && <Link href="/requests/new/remapping" className={type ? "btn-primary" : "btn-secondary"}>New remapping</Link>}
              <Link href="/imports" className="btn-secondary">Upload batch</Link>
            </>
          )
        }
      />
      <RequestsTable
        regions={await getRegionMap()}
        key={`${type}-${initial}`}
        mode="internal"
        tabs={tabs}
        initialTab={initial}
        fixedType={type}
        anms={anms}
        canExport={can(actor.role, "export:run")}
        canExportFull={can(actor.role, "export:run") && can(actor.role, "account:view_full")}
        bulkActions={["submit", "close"]}
        batchId={sp.batch && /^[0-9a-f-]{36}$/.test(sp.batch) ? sp.batch : undefined}
      />
    </>
  );
}
