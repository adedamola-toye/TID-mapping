"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Field, Spinner } from "@/components/ui";
import { passwordPolicy } from "@/lib/validation";

export function PasswordForm() {
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const policy = pw ? passwordPolicy.safeParse(pw) : null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ redirectTo: string }>("/api/auth/password", { body: { currentPassword: cur, newPassword: pw } });
      setOk(true);
      setTimeout(() => window.location.assign(r.redirectTo), 1200);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not change password.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      {ok && <Alert tone="ok">Password changed. Other sessions have been signed out.</Alert>}
      {err && <Alert tone="bad">{err}</Alert>}
      <Field label="Current password" required>{(p) => <input {...p} type="password" className="input" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />}</Field>
      <Field label="New password" required error={policy && !policy.success ? policy.error.issues[0].message : undefined} hint="At least 12 characters; three of lowercase, uppercase, digits, symbols.">
        {(p) => <input {...p} type="password" className="input" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
      </Field>
      <Field label="Confirm new password" required error={pw2 && pw !== pw2 ? "Passwords do not match." : undefined}>
        {(p) => <input {...p} type="password" className="input" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />}
      </Field>
      <button className="btn-primary" disabled={busy || !cur || !policy?.success || pw !== pw2}>{busy && <Spinner />}Update password</button>
    </form>
  );
}

export function MfaSetup({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(enabled);
  const [busy, setBusy] = useState(false);
  if (done) return <p className="text-sm text-ok-700">Two-step verification is on. A code from your authenticator app is required at every sign-in. Ask an administrator to reset it if you lose your device.</p>;
  return (
    <div className="max-w-lg space-y-4 text-sm">
      <p className="text-ink-muted">Add a second step to sign-in using an authenticator app (Microsoft Authenticator, Google Authenticator, etc.). Strongly recommended for administrators.</p>
      {err && <Alert tone="bad">{err}</Alert>}
      {!setup ? (
        <button className="btn-secondary" onClick={() => api<{ secret: string; uri: string }>("/api/auth/mfa/setup").then(setSetup).catch((e) => setErr(e.message))}>Set up two-step verification</button>
      ) : (
        <>
          <ol className="list-decimal space-y-2 pl-5">
            <li>In your authenticator app, choose <em>Add account → Enter a setup key</em>.</li>
            <li>Account: your email · Key: <span className="ident select-all rounded bg-surface-sunken px-1.5 py-0.5">{setup.secret.match(/.{1,4}/g)?.join(" ")}</span> · Type: time-based.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div className="flex gap-2">
            <input className="input ident w-40 tracking-[0.3em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="Verification code" />
            <button
              className="btn-primary"
              disabled={code.length !== 6 || busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await api("/api/auth/mfa/setup", { body: { secret: setup.secret, code } });
                  setDone(true);
                } catch (e) {
                  setErr(e instanceof ApiError ? e.message : "Verification failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Spinner />}Verify &amp; enable
            </button>
          </div>
        </>
      )}
    </div>
  );
}
