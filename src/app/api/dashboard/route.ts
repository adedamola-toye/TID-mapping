import { api } from "@/server/http";
import { dashboard, vendorSummary } from "@/server/services/reports";

export const GET = api(async ({ actor }) => (actor.role === "VENDOR_USER" ? vendorSummary(actor) : dashboard(actor)));
