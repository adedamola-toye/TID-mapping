import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/http";
import { Alert, Card, PageHeader } from "@/components/ui";
import { PasswordForm } from "../AccountForms";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await currentSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Change password" />
      {(sp.required || s.user.mustChangePassword) && <div className="mb-4"><Alert tone="warn">You must set a new password before continuing.</Alert></div>}
      <Card><PasswordForm /></Card>
    </div>
  );
}
