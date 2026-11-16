import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSession, homeFor } from "@/server/http";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await currentSession();
  if (s) redirect(homeFor(s.user.role));
  const sp = await searchParams;
  return <LoginForm expired={sp.expired === "1"} reset={sp.reset === "1"} />;
}
