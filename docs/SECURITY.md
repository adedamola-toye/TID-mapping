# Security model

## Authentication & sessions

- Passwords hashed with **scrypt** (N=2¹⁵, r=8, p=1, 16-byte salt); policy ≥12 chars and 3 of 4 character classes. Timing is equalised for unknown users.
- Sessions are **opaque random tokens** (256-bit) in an `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie. Only the SHA-256 of the token is stored. Sessions have an **idle timeout** (default 30 min, with an in-app warning) and an **absolute lifetime** (default 12 h); logout, password change/reset, role/vendor/status changes and deactivation revoke sessions server-side.
- **Account lockout** after 5 failed attempts for 15 minutes (DB-backed), plus in-memory throttling of repeated failures per account and per client IP. Sign-in errors are generic (no user enumeration); forgot-password responds identically for unknown emails.
- **Password reset**: single-use 30-minute tokens (hash stored), delivered as a URL *fragment* so tokens never reach server logs or `Referer` headers. Admin-created users never receive an admin-chosen password; they get a one-time set-password link.
- **MFA**: optional RFC 6238 TOTP. The secret is stored encrypted; a password-verified session stays "MFA pending" (5-minute lifetime, unusable for any API) until the code is verified.

## Authorisation

- RBAC permissions (`src/server/rbac.ts`) checked server-side on every API call and page. The vendor role holds only `vendor:queue` and `vendor:treat`.
- **Object-level checks (IDOR)**: every request lookup goes through `canView()` — vendors only see requests of their own vendor that have been released (Submitted, In Progress, Treated, Exception, Closed); field submitters only their own; unauthorised lookups return 404. Search filters are scoped server-side regardless of the filters the client sends.
- **Data minimisation for the vendor**: no internal comments, remapping reasons, internal staff names or internal-only timeline events; full account number only while the request is actionable.
- Admins cannot change their own role or deactivate themselves; the last active Super Admin cannot be removed.

## Request security

- **CSRF**: per-session token (double-submit cookie `wk_csrf` → `X-CSRF-Token` header, compared in constant time to the session's token) on all state-changing API calls, plus an **Origin/Sec-Fetch-Site** check.
- **CSP** with a per-request nonce and `strict-dynamic` (no inline scripts), `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`; plus `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy`, COOP/CORP, HSTS when served over HTTPS, `X-Powered-By` removed, `Cache-Control: no-store` on APIs.
- **Input validation** with zod on the server for every payload (types, lengths, formats, enums), body size limits, UUID validation, whitelisted sort fields.
- **SQL injection**: all queries are parameterised through Drizzle; LIKE patterns are escaped.
- **XSS**: React escapes all output; no `dangerouslySetInnerHTML`; agent names are restricted to a safe character set.
- **File uploads**: `.xlsx` (ZIP magic bytes verified) and `.csv` only, simple file names, 5 MB / 10,000 rows, files parsed in memory and never stored or served, formulas never evaluated (cached values only), hidden sheets ignored.
- **Spreadsheet formula injection**: exported cells starting with `= + - @` are neutralised.

## Sensitive data

- **Account numbers** are encrypted at rest with **AES-256-GCM** (`DATA_ENCRYPTION_KEY`), with an **HMAC-SHA-256** (`DATA_HASH_KEY`) for exact-match search/duplicate checks and the last 4 digits for masked display. Plaintext is never stored, never logged, never placed in URLs, and is stripped/masked from audit values. Staged import rows are encrypted too.
- Internal users see masked numbers and can **reveal** on demand (audited, auto-hides after 30 s). Full-account exports require `account:view_full` and are audited.

## Audit trail

- Written in the same transaction as the change, so an action and its audit record commit or fail together.
- Fields: actor id, email, role, action, record type/id/label, old value, new value, timestamp, IP (when `TRUST_PROXY` is enabled behind a trusted proxy) and user agent.
- **Tamper resistance**: `UPDATE`, `DELETE` and `TRUNCATE` on `audit_logs` (and changes to `workflow_events`) are blocked by database triggers; each record carries `SHA-256(previous hash ‖ canonical record)`, so any out-of-band edit breaks the chain. *Administration → Audit Logs → Verify integrity* recomputes the chain. For defence in depth, run the application with a database role that does not own the tables (so it cannot disable triggers) and ship logs to the bank's SIEM.

## Production hardening checklist

- Serve only over HTTPS; set `SECURE_COOKIES=true` (enforced at start-up in production unless served on localhost).
- Generate unique `DATA_ENCRYPTION_KEY` / `DATA_HASH_KEY` per environment and keep them in the bank's secret manager. Back them up — encrypted data is unrecoverable without the key.
- Set `TRUST_PROXY=true` only behind a reverse proxy that overwrites `X-Forwarded-For`.
- Use a least-privilege DB role for the app (DML only), and a separate migration role.
- Put a WAF/gateway rate limit in front when running multiple instances.
- Enable MFA for Super Admin and Wakeel Operations accounts.
