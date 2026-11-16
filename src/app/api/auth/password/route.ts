import { api, readJson, homeFor } from "@/server/http";
import { changePassword } from "@/server/auth/service";

export const POST = api(
  async ({ req, actor, session }) => {
    const body = await readJson<{ currentPassword?: string; newPassword?: string }>(req, 4096);
    await changePassword(actor, String(body.currentPassword ?? ""), String(body.newPassword ?? ""), session.sessionId);
    return { ok: true, redirectTo: homeFor(actor.role) };
  },
  { allowPasswordChange: true },
);
