import type { Metadata } from "next";
import { requirePage } from "@/server/http";
import { listVendors } from "@/server/services/users";
import { PageHeader } from "@/components/ui";
import { VendorManager } from "./VendorManager";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage() {
  await requirePage("vendor:manage");
  return (
    <>
      <PageHeader eyebrow="Administration" title="Vendors" subtitle="Organisations that treat requests in the TMS. New requests are routed to the default vendor (Elnexu)." />
      <VendorManager items={await listVendors()} />
    </>
  );
}
