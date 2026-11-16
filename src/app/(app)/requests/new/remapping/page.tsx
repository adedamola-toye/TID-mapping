import type { Metadata } from "next";
import { requirePage } from "@/server/http";
import { listActiveAnms } from "@/server/services/anms";
import { can } from "@/server/rbac";
import { RemapWizard } from "./RemapWizard";

export const metadata: Metadata = { title: "New Remapping" };

export default async function NewRemappingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor } = await requirePage("request:create");
  const sp = await searchParams;
  return <RemapWizard anms={await listActiveAnms()} canSubmitToVendor={can(actor.role, "request:submit_vendor")} initialIdentifier={sp.terminal?.slice(0, 40) ?? ""} />;
}
