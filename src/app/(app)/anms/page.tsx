import type { Metadata } from "next";
import { requirePage } from "@/server/http";
import { listAnms } from "@/server/services/anms";
import { can } from "@/server/rbac";
import { PageHeader } from "@/components/ui";
import { AnmManager } from "./AnmManager";
import { getRegionMap } from "@/server/services/regions";

export const metadata: Metadata = { title: "ANMs" };

export default async function AnmsPage() {
  const { actor } = await requirePage("anm:view");
  const items = await listAnms({ includeInactive: true });
  return (
    <>
      <PageHeader
        eyebrow="Master data"
        title="Agent Network Managers"
        subtitle="The controlled ANM list used in every mapping. Inactive ANMs are hidden from new assignments but kept on historical records."
      />
      <AnmManager regions={await getRegionMap()} items={JSON.parse(JSON.stringify(items))} canManage={can(actor.role, "anm:manage")} />
    </>
  );
}
