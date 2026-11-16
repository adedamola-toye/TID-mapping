import { api, readJson } from "@/server/http";
import { createAnm, listActiveAnms, listAnms } from "@/server/services/anms";
import { can } from "@/server/rbac";
import { AppError } from "@/server/errors";

/** ?scope=active (default; dropdowns) or ?scope=all (admin list, with terminal counts). */
export const GET = api(async ({ req, actor }) => {
  const scope = req.nextUrl.searchParams.get("scope");
  if (scope === "all") {
    if (!can(actor.role, "anm:view")) throw new AppError("FORBIDDEN", "Not allowed.");
    return { items: await listAnms({ includeInactive: true, q: req.nextUrl.searchParams.get("q") ?? undefined }) };
  }
  if (!can(actor.role, "request:create") && !can(actor.role, "anm:view")) throw new AppError("FORBIDDEN", "Not allowed.");
  return { items: await listActiveAnms() };
});

export const POST = api(async ({ req, actor }) => createAnm(actor, await readJson(req)), { permission: "anm:manage" });
