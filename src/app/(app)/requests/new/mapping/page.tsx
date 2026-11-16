import type { Metadata } from "next";
import { requirePage } from "@/server/http";
import { listActiveAnms } from "@/server/services/anms";
import { can } from "@/server/rbac";
import { MappingWizard } from "./MappingWizard";

export const metadata: Metadata = { title: "New Mapping" };

export default async function NewMappingPage() {
  const { actor } = await requirePage("request:create");
  const anms = await listActiveAnms();
  return <MappingWizard anms={anms} canSubmitToVendor={can(actor.role, "request:submit_vendor")} />;
}
