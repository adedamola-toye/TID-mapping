import { z } from "zod";
import { api, readJson } from "@/server/http";
import { listNotifications, markNotificationsRead } from "@/server/notifications";
import { AppError } from "@/server/errors";

export const GET = api(async ({ actor }) => listNotifications(actor.id), { allowPasswordChange: true });

const body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().uuid()).max(200) })]);

export const POST = api(async ({ req, actor }) => {
  const p = body.safeParse(await readJson(req));
  if (!p.success) throw new AppError("BAD_REQUEST", "Invalid request.");
  await markNotificationsRead(actor.id, "all" in p.data ? "all" : p.data.ids);
  return { ok: true };
});
