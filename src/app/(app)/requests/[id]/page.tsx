import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePage } from "@/server/http";
import { getRequestDetail } from "@/server/services/requests";
import { AppError } from "@/server/errors";
import { RequestView } from "./RequestView";

export const metadata: Metadata = { title: "Request" };

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePage();
  const { id } = await params;
  if (actor.role === "VENDOR_USER") redirect(`/vendor/requests/${id}`);
  try {
    const d = await getRequestDetail(actor, id);
    return <RequestView detail={JSON.parse(JSON.stringify(d))} />;
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
}
