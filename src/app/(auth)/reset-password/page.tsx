"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Field, Spinner } from "@/components/ui";
import { passwordPolicy } from "@/lib/validation";

/** The token is carried in the URL fragment (#token=…) so it never reaches server logs or Referer headers. */
export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const m = /token=([\w-]+)/.exec(window.location.hash);
    if (m) {
      setToken(m[1]);
      history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const policy = pw ? passwordPolicy.safeParse(pw) : null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setError("Passwords do not match.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/reset", { body: { token, password: pw } });
      window.location.assign("/login?reset=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed.");
      setBusy(false);
    }
  }
  return (
    <div>
      <h2 className="text-2xl font-semibold">Set a new password</h2>
      <p className="mt-1 text-sm text-ink-muted">At least 12 characters, using three of: lowercase, uppercase, digits, symbols.</p>
      <div className="mt-6 space-y-3">
        {!token && <Alert tone="warn">Open this page from the reset link you received.</Alert>}
        {error && <Alert tone="bad">{error}</Alert>}
      </div>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="New password" required error={policy && !policy.success ? policy.error.issues[0].message : undefined}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
        </Field>
        <Field label="Confirm password" required error={pw2 && pw !== pw2 ? "Passwords do not match." : undefined}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />}
        </Field>
        <button className="btn-primary w-full py-2.5" disabled={busy || !token || !policy?.success || pw !== pw2}>{busy && <Spinner />} Update password</button>
      </form>
    </div>
  );
}
