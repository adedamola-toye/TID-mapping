import type { Metadata } from "next";
import { requirePage } from "@/server/http";
import { listBatches } from "@/server/services/imports";
import { PageHeader } from "@/components/ui";
import { ImportsHome } from "./ImportsHome";

export const metadata: Metadata = { title: "Batch Uploads" };

export default async function ImportsPage() {
  const { actor } = await requirePage("import:run");
  const batches = await listBatches(actor);
  return (
    <>
      <PageHeader
        eyebrow="Bulk processing"
        title="Batch uploads"
        subtitle="Upload an Excel or CSV file of vendor TIDs, new mappings or remappings. Every row is validated before anything is imported — nothing invalid is imported silently."
      />
      <ImportsHome batches={JSON.parse(JSON.stringify(batches))} />
    </>
  );
}
