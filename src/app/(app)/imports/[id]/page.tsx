import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/http";
import { getBatch } from "@/server/services/imports";
import { AppError } from "@/server/errors";
import { can } from "@/server/rbac";
import { BatchWizard } from "./BatchWizard";

export const metadata: Metadata = { title: "Batch" };

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePage("import:run");
  const { id } = await params;
  try {
    const b = await getBatch(actor, id, { pageSize: 50 });
    return <BatchWizard initial={JSON.parse(JSON.stringify(b))} canSubmit={can(actor.role, "request:submit_vendor")} />;
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}
