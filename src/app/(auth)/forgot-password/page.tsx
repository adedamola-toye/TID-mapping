"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Field, Spinner } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>("/api/auth/forgot", { body: { email } });
      setDone(r.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <h2 className="text-2xl font-semibold">Reset password</h2>
      <p className="mt-1 text-sm text-ink-muted">We&apos;ll send a one-time reset link (valid for 30 minutes) to your registered email.</p>
      <div className="mt-6 space-y-3">
        {done && <Alert tone="ok">{done}</Alert>}
        {error && <Alert tone="bad">{error}</Alert>}
      </div>
      {!done && (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Email address" required>
            {(p) => <input {...p} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}
          </Field>
          <button className="btn-primary w-full py-2.5" disabled={busy || !email}>{busy && <Spinner />} Send reset link</button>
        </form>
      )}
      <p className="mt-6 text-xs text-ink-subtle">If you no longer have access to your email, ask a Wakeel administrator to issue a reset link.</p>
      <Link href="/login" className="mt-4 block text-center text-sm text-brand-700 hover:underline">Back to sign in</Link>
    </div>
  );
}
