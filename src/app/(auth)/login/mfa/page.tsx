"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Field, Spinner } from "@/components/ui";

export default function MfaPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ redirectTo: string }>("/api/auth/mfa", { body: { code } });
      window.location.assign(r.redirectTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
      setBusy(false);
    }
  }
  return (
    <div>
      <h2 className="text-2xl font-semibold">Two-step verification</h2>
      <p className="mt-1 text-sm text-ink-muted">Enter the 6-digit code from your authenticator app.</p>
      {error && <div className="mt-4"><Alert tone="bad">{error}</Alert></div>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Verification code" required>
          {(p) => (
            <input {...p} className="input ident text-center text-lg tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
          )}
        </Field>
        <button className="btn-primary w-full py-2.5" disabled={busy || code.length !== 6}>{busy && <Spinner />} Verify</button>
      </form>
      <a href="/login" className="mt-6 block text-center text-sm text-brand-700 hover:underline">Back to sign in</a>
    </div>
  );
}
