import type { Metadata } from "next";
import { requirePage } from "@/server/http";
import { getRegionMap } from "@/server/services/regions";
import { PageHeader } from "@/components/ui";
import { RegionManager } from "./RegionManager";

export const metadata: Metadata = { title: "Regions (North / South Bank)" };

export default async function RegionsPage() {
  await requirePage("region:manage");
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Regions — North Bank & South Bank"
        subtitle="Choose which states fall in each bank. Location pickers, filters, the dashboard and reports use this assignment immediately, including for existing records. Every change is audited."
      />
      <RegionManager initial={await getRegionMap()} />
    </>
  );
}
