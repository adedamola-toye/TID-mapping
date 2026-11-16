import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/http";
import { getRequestForEdit } from "@/server/services/requests";
import { listActiveAnms } from "@/server/services/anms";
import { AppError } from "@/server/errors";
import { EditForm } from "./EditForm";
import { getRegionMap } from "@/server/services/regions";

export const metadata: Metadata = { title: "Edit request" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePage("request:edit");
  const { id } = await params;
  try {
    const r = await getRequestForEdit(actor, id);
    return <EditForm r={JSON.parse(JSON.stringify(r))} anms={await listActiveAnms()} regions={await getRegionMap()} />;
  } catch (e) {
    if (e instanceof AppError && ["NOT_FOUND", "FORBIDDEN"].includes(e.code)) notFound();
    throw e;
  }
}
