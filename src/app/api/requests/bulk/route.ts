import { z } from "zod";
import { api, readJson } from "@/server/http";
import * as svc from "@/server/services/requests";
import { AppError } from "@/server/errors";

const schema = z.object({
  action: z.enum(["submit", "start", "treat", "close"]),
  ids: z.array(z.string().uuid()).min(1, "Select at least one request.").max(500, "Select at most 500 requests at a time."),
  confirm: z.boolean().optional(),
  comment: z.string().max(1000).optional().nullable(),
});

export const POST = api(async ({ req, actor }) => {
  const parsed = schema.safeParse(await readJson(req, 64_000));
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0].message);
  const { action, ids, confirm, comment } = parsed.data;
  switch (action) {
    case "submit":
      return svc.bulkSubmitToVendor(actor, ids, confirm === true);
    case "start":
      return svc.bulkStart(actor, ids);
    case "treat":
      return svc.bulkMarkTreated(actor, ids, confirm === true, comment ?? null);
    case "close":
      return svc.bulkClose(actor, ids);
  }
});
