# Testing

## Automated

```bash
# Unit + integration (real PostgreSQL; schema recreated each run)
TEST_DATABASE_URL=postgres://wakeel:***@localhost:5432/wakeel_test npm test

# End-to-end + HTTP security (Playwright) against a production build
npm run build
E2E_DATABASE_URL=postgres://wakeel:***@localhost:5432/wakeel_e2e npm run test:e2e
```

| Suite | File | Covers |
|---|---|---|
| Validation | `tests/unit/validation.test.ts` | TID/serial/account rules, NUBAN check digit, required fields, controlled ANM/state, XSS-shaped names, password policy, state aliases |
| Workflow | `tests/unit/workflow.test.ts` | State machine paths, terminal states, role/permission boundaries |
| Security primitives | `tests/unit/security-primitives.test.ts` | scrypt, AES-GCM tamper detection, HMAC, TOTP RFC vectors, audit sanitisation, formula-injection neutralisation, rate limiter |
| Mapping | `tests/integration/mapping.test.ts` | **Critical acceptance flow** (create → submit → vendor sees/opens/copies/treats → internal sees TREATED → audit answers who/what/when), validation, duplicate serial/TID/pending/active mapping, concurrent creation, field submitter limits & IDOR, edits, optimistic locking, amendments, exception → return → resubmit, vendor isolation, SQL metacharacters, bulk ops |
| Remapping | `tests/integration/remapping.test.ts` | **Critical acceptance flow** (lookup → new agent/account/location/ANM → vendor treats → v1 preserved + v2 current + history), serial/TID immutability, identical-mapping rejection, concurrent conflicting remaps, cancel restores state, v1→v2→v3 |
| Auth | `tests/integration/auth.test.ts` | Login, generic errors, lockout, logout, idle & absolute expiry, garbage tokens, deactivation, role change revocation, reset tokens (single-use, expiry), no enumeration, set-password links, vendor binding, privilege escalation, MFA |
| Imports | `tests/integration/imports.test.ts` | Legacy sheet with title row, numeric serials, Status/Comment split, re-upload duplicates, errors & duplicates per row, in-browser correction, failed-row export, commit, bulk release, missing columns, manual column mapping, spoofed/unsupported/empty files, role checks, 2,000-row batch, remapping batch |
| Audit | `tests/integration/audit.test.ts` | Hash chain verification, DB-enforced append-only, tamper detection, access restriction |
| E2E acceptance | `tests/e2e/acceptance.spec.ts` | Both critical flows through the UI with separate internal/vendor sessions and clipboard verification; batch upload → correct → import → bulk submit; vendor exception → return (stored markup rendered as text); mobile field submission; forbidden pages |
| E2E security | `tests/e2e/security.spec.ts` | Unauthenticated access, cookie flags, session replay after logout, login throttling, enumeration, CSRF, cross-origin, vendor API restrictions, IDOR, vendor data minimisation, privilege escalation, submitter scoping, SQL injection, malformed input, spoofed uploads, masked accounts, security headers |

## Manual UAT script

Use the seeded development accounts (password `Wakeel#Dev2026!`).

1. **Field officer (`field@wakeel.test`, on a phone):** New Mapping → enter serial/TID, agent, account, state, ANM → review → *Submit for review*. Confirm it appears under *My Submissions → In progress*. Confirm *Administration* and *Treatment Queue* are not reachable.
2. **Operations (`ops@wakeel.test`):** Dashboard → *ready for review* → open the request → *Review & submit to Elnexu*; confirm the submit button stays disabled until the review confirmation is ticked.
3. **Vendor (`vendor@elnexu.test`):** Treatment Queue → *Treat* → use *Copy* on each field and *Copy all*; paste into a text editor and check the payload. *Mark as treated* → tick the TMS confirmation → confirm.
4. **Operations:** the request shows *Treated*, treated-by and time; notification bell shows the treatment.
5. **Remapping:** Terminals → *Mapped* → *Remap* → enter new details and reason → submit. As vendor, treat it. On the terminal page check version 1 (superseded) and version 2 (current) with requester, treater, dates and reason.
6. **Exception:** as vendor choose *Unable to treat* → *Account information invalid* + comment. As operations open *Exceptions*, *Return for correction*, edit the account, resubmit; as vendor treat. Check the timeline shows every step.
7. **Amendment:** release a request, then *Amend* (reason required); as vendor see the *Amended after release* entry and the updated values.
8. **Batch:** Batch Uploads → *Vendor terminal / TID batch* → upload `samples/legacy-elnexu-tid-batch.xlsx` (same layout as the bank's real Elnexu sheet) → check the suggested column mapping (unlabelled merchant column, two-column Status/Comment), validate (1 error: stray serial in the Location column; warnings for re-read locations and the replacement serial), import. Open a terminal to see the sheet merchant, status/remarks and extra identifiers. Then upload `samples/mapping-batch-example.xlsx` as *New mapping requests*: see 1 error row, correct it in the browser or skip it, import, *Review this batch's requests*, select all, *Submit to Elnexu*.
9. **Concurrency:** in two browsers, start a remapping for the same terminal; the second submission is refused with "already has a pending remapping request".
10. **Audit (superadmin):** Audit Logs → search by request ID; expand entries to see old/new values; *Verify integrity*.
11. **Reports:** each tab loads; *Export to Excel* downloads a workbook; *Terminal history* finds a terminal.
12. **Security spot-checks:** sign out and press Back (no data shown); wait past idle timeout (warning then sign-out); 6 wrong passwords lock the account; vendor URL-guessing an internal request ID shows "not found".

## Product review against §53 of the brief

| Question | Answer / where |
|---|---|
| Create 100 mapping requests without email/Excel juggling? | Yes — batch upload with validation/correction, then select-all → Submit to Elnexu. |
| Can Elnexu clearly see what to treat? | Yes — vendor queue (pending first, oldest first), per-type tabs, priority. |
| Copy quickly into TMS? | Per-field copy + Copy all structured payload, with feedback. |
| Mark each record treated? | Yes — individually (with TMS confirmation) or in bulk. |
| Wakeel sees treated immediately? | Yes — status, timeline, dashboard, notifications. |
| Remap without changing serial/TID? | Enforced in UI, API and service; tested. |
| Historical mappings preserved? | `terminal_mappings` versions; terminal lifecycle page. |
| Outstanding visible to management? | Dashboard + Outstanding report with ageing. |
| Who did what and when? | Audit trail + workflow timeline + terminal history. |
| Conflicting mappings by two users? | Blocked by service checks and a DB partial unique index; tested concurrently. |
| Vendor seeing data it shouldn't? | Server-side scoping + data minimisation; tested via API. |
| Bypassing role permissions? | Server-side RBAC on every endpoint; tested. |
| Large batches? | 10,000-row limit; 2,000-row batch tested. |
| Graceful errors? | Business-language errors, field-level messages, reference ids for unexpected errors, empty states. |
