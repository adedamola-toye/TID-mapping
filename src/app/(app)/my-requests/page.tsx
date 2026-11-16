import type { Metadata } from "next";
import Link from "next/link";
import { requirePage } from "@/server/http";
import { PageHeader } from "@/components/ui";
import { RequestsTable, type TabDef } from "@/components/requests/RequestsTable";

export const metadata: Metadata = { title: "My Submissions" };

const TABS: TabDef[] = [
  { value: "open", label: "In progress", status: ["DRAFT", "READY_FOR_REVIEW", "SUBMITTED", "IN_PROGRESS", "EXCEPTION"] },
  { value: "returned", label: "Needs correction", status: ["RETURNED"] },
  { value: "done", label: "Treated", status: ["TREATED", "CLOSED"] },
  { value: "all", label: "All" },
];

export default async function MyRequestsPage() {
  await requirePage("request:view_own");
  return (
    <>
      <PageHeader
        eyebrow="Field submissions"
        title="My Submissions"
        subtitle="Track the terminals you have submitted for mapping or remapping."
        actions={
          <>
            <Link href="/requests/new/mapping" className="btn-primary">New mapping</Link>
            <Link href="/requests/new/remapping" className="btn-secondary">New remapping</Link>
          </>
        }
      />
      <RequestsTable mode="mine" tabs={TABS} initialTab="open" />
    </>
  );
}
