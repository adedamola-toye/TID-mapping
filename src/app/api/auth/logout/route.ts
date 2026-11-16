import { NextResponse } from "next/server";
import { api, clearSessionCookies, SESSION_COOKIE } from "@/server/http";
import { logout } from "@/server/auth/service";

export const POST = api(
  async ({ req, actor }) => {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (token) await logout(token, actor);
    const res = NextResponse.json({ ok: true });
    clearSessionCookies(res);
    return res;
  },
  { allowPasswordChange: true },
);
