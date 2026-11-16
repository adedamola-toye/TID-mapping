import { api, readJson } from "@/server/http";
import { adminResetPassword, resetUserMfa, unlockUser, updateUser } from "@/server/services/users";
import { AppError } from "@/server/errors";

export const PATCH = api<{ id: string }>(
  async ({ req, actor, params }) => {
    const u = await updateUser(actor, params.id, await readJson(req));
    return { id: u.id };
  },
  { permission: "user:manage" },
);

export const POST = api<{ id: string }>(
  async ({ req, actor, params }) => {
    const { op } = await readJson<{ op?: string }>(req, 1024);
    if (op === "reset-password") return adminResetPassword(actor, params.id);
    if (op === "unlock") {
      await unlockUser(actor, params.id);
      return { ok: true };
    }
    if (op === "reset-mfa") {
      await resetUserMfa(actor, params.id);
      return { ok: true };
    }
    throw new AppError("BAD_REQUEST", "Unknown operation.");
  },
  { permission: "user:manage" },
);
