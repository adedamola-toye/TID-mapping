import type { Metadata } from "next";
import { requirePage } from "@/server/http";
import { config } from "@/server/config";
import { Card, KV, PageHeader } from "@/components/ui";
import { NIGERIAN_STATES, REQUEST_STATUSES, STATUS_LABELS, EXCEPTION_REASONS, EXCEPTION_REASON_LABELS } from "@/lib/constants";

export const metadata: Metadata = { title: "System Configuration" };

export default async function SettingsPage() {
  await requirePage("config:view");
  const c = config();
  return (
    <>
      <PageHeader eyebrow="Administration" title="System configuration" subtitle="Effective runtime settings. Values are set through environment configuration by the platform team; secrets are never displayed." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Security & sessions">
          <dl className="grid gap-4 sm:grid-cols-2">
            <KV label="Idle session timeout">{c.SESSION_IDLE_TIMEOUT_MINUTES} minutes</KV>
            <KV label="Absolute session lifetime">{c.SESSION_ABSOLUTE_TIMEOUT_MINUTES} minutes</KV>
            <KV label="Lockout after">{c.MAX_FAILED_LOGINS} failed sign-ins</KV>
            <KV label="Lockout duration">{c.LOCKOUT_MINUTES} minutes</KV>
            <KV label="Secure cookies (HTTPS)">{c.SECURE_COOKIES ? "Enabled" : "Disabled (development)"}</KV>
            <KV label="Account-number encryption">AES-256-GCM (key configured)</KV>
            <KV label="Environment">{c.NODE_ENV}</KV>
            <KV label="Email channel">{c.EMAIL_TRANSPORT}</KV>
          </dl>
        </Card>
        <Card title="Validation & imports">
          <dl className="grid gap-4 sm:grid-cols-2">
            <KV label="TID pattern" mono>{c.TID_PATTERN}</KV>
            <KV label="NUBAN check-digit bank code" mono>{c.NUBAN_BANK_CODE ?? "Not set (10-digit format check only)"}</KV>
            <KV label="Max upload size">{(c.IMPORT_MAX_BYTES / 1048576).toFixed(1)} MB</KV>
            <KV label="Max rows per batch">{c.IMPORT_MAX_ROWS.toLocaleString()}</KV>
            <KV label="Default vendor code" mono>{process.env.DEFAULT_VENDOR_CODE ?? "ELNEXU"}</KV>
            <KV label="Controlled locations">{NIGERIAN_STATES.length} states + FCT</KV>
          </dl>
        </Card>
        <Card title="Workflow statuses (application-controlled)">
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">{REQUEST_STATUSES.map((s) => <li key={s}><span className="ident text-xs text-ink-subtle">{s}</span> — {STATUS_LABELS[s]}</li>)}</ul>
        </Card>
        <Card title="Vendor exception reasons">
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">{EXCEPTION_REASONS.map((s) => <li key={s}>{EXCEPTION_REASON_LABELS[s]}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
