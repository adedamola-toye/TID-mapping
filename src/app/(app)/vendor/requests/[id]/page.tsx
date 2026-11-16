import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/http";
import { getRequestDetail, recordVendorOpened } from "@/server/services/requests";
import { AppError } from "@/server/errors";
import { VendorTask } from "./VendorTask";

export const metadata: Metadata = { title: "Treat request" };

export default async function VendorRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePage("vendor:queue");
  const { id } = await params;
  try {
    await recordVendorOpened(actor, id);
    const detail = await getRequestDetail(actor, id);
    return <VendorTask detail={JSON.parse(JSON.stringify(detail))} />;
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
}
