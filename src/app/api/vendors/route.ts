import { api, readJson } from "@/server/http";
import { listVendors, saveVendor } from "@/server/services/users";
import { can } from "@/server/rbac";
import { AppError } from "@/server/errors";

export const GET = api(async ({ actor }) => {
  if (!can(actor.role, "vendor:manage") && !can(actor.role, "user:manage") && !can(actor.role, "request:view_all"))
    throw new AppError("FORBIDDEN", "Not allowed.");
  return { items: await listVendors() };
});
export const POST = api(async ({ req, actor }) => saveVendor(actor, null, await readJson(req)), { permission: "vendor:manage" });
