import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/http";
import { ROLE_LABELS } from "@/lib/constants";
import { Card, KV, PageHeader } from "@/components/ui";
import { PasswordForm, MfaSetup } from "./AccountForms";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.user.mustChangePassword) redirect("/account/password?required=1");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Account" title="My account & security" />
      <div className="space-y-6">
        <Card title="Profile">
          <dl className="grid gap-4 sm:grid-cols-3">
            <KV label="Name">{s.user.fullName}</KV>
            <KV label="Email">{s.user.email}</KV>
            <KV label="Role">{ROLE_LABELS[s.user.role]}{s.user.vendorName ? ` — ${s.user.vendorName}` : ""}</KV>
          </dl>
        </Card>
        <Card title="Change password"><PasswordForm /></Card>
        <Card title="Two-step verification"><MfaSetup enabled={s.user.mfaEnabled} /></Card>
      </div>
    </div>
  );
}
