"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Field, Spinner } from "@/components/ui";

export function LoginForm({ expired, reset }: { expired?: boolean; reset?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ redirectTo: string }>("/api/auth/login", { body: { email, password } });
      window.location.assign(r.redirectTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to sign in.");
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold">Sign in</h2>
      <p className="mt-1 text-sm text-ink-muted">Use your Wakeel or vendor account.</p>
      <div className="mt-6 space-y-3">
        {expired && <Alert tone="warn">Your session expired. Please sign in again.</Alert>}
        {reset && <Alert tone="ok">Password updated. Sign in with your new password.</Alert>}
        {error && <Alert tone="bad">{error}</Alert>}
      </div>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <Field label="Email address" required>
          {(p) => <input {...p} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}
        </Field>
        <Field label="Password" required>
          {(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <button type="submit" className="btn-primary w-full py-2.5" disabled={busy || !email || !password}>
          {busy && <Spinner />} Sign in
        </button>
      </form>
      <div className="mt-6 text-center text-sm">
        <Link href="/forgot-password" className="text-brand-700 hover:underline">Forgot your password?</Link>
      </div>
    </div>
  );
}
