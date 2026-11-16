import { api, readJson } from "@/server/http";
import { getRegionMap, updateRegionMap } from "@/server/services/regions";
import { isInternal } from "@/server/rbac";
import { AppError } from "@/server/errors";

export const GET = api(async ({ actor }) => {
  if (!isInternal(actor.role)) throw new AppError("FORBIDDEN", "Not allowed.");
  return { regions: await getRegionMap() };
});

export const PUT = api(async ({ req, actor }) => ({ regions: await updateRegionMap(actor, await readJson(req)) }), { permission: "region:manage" });
