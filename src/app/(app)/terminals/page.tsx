import type { Metadata } from "next";
import { requirePage } from "@/server/http";
import { listActiveAnms } from "@/server/services/anms";
import { can } from "@/server/rbac";
import { PageHeader } from "@/components/ui";
import { TerminalsTable } from "./TerminalsTable";

export const metadata: Metadata = { title: "Terminals" };

export default async function TerminalsPage() {
  const { actor } = await requirePage("terminal:view");
  return (
    <>
      <PageHeader eyebrow="Terminal master" title="Terminals" subtitle="The single source of truth for every POS terminal's identity and current mapping. Open a terminal to see its full lifecycle." />
      <TerminalsTable anms={await listActiveAnms()} canExport={can(actor.role, "export:run")} canRemap={can(actor.role, "request:create")} />
    </>
  );
}
