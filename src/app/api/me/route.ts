import { api } from "@/server/http";
import { ROLE_PERMISSIONS } from "@/server/rbac";

export const GET = api(
  async ({ session }) => ({
    user: session.user,
    permissions: ROLE_PERMISSIONS[session.user.role],
  }),
  { allowPasswordChange: true },
);
