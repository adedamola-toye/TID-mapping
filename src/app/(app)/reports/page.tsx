import type { Metadata } from "next";
import { requirePage } from "@/server/http";
import { can } from "@/server/rbac";
import { PageHeader } from "@/components/ui";
import { Reports } from "./Reports";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor } = await requirePage("report:view");
  const sp = await searchParams;
  return (
    <>
      <PageHeader eyebrow="Management information" title="Reports" subtitle="Operational and vendor performance reporting. Every report can be exported to Excel." />
      <Reports initialTab={sp.tab ?? "daily"} canExport={can(actor.role, "export:run")} />
    </>
  );
}
