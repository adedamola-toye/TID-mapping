# Wakeel POS Terminal Mapping & Remapping Platform

**The Alternative Bank — Wakeel internal operations platform**

A controlled, auditable workflow that replaces the spreadsheet hand-off between the Wakeel team and the vendor (Elnexu) for allocating, mapping and remapping POS terminals/TIDs.

```
Request → Internal completion → Review & release → Vendor queue → TMS treatment → Treated → Closed
                                                        └── Exception → Returned → corrected → resubmitted
```

The application is the **system of record**. Spreadsheets are an import/export format, not the source of truth.

---

## Contents

- [What it does](#what-it-does)
- [Quick start (development)](#quick-start-development)
- [Development test credentials](#development-test-credentials)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Further documentation](#further-documentation)
- [Assumptions](#assumptions)
- [Known limitations](#known-limitations)

## What it does

| Area | Highlights |
|---|---|
| **New mapping** | Capture terminal (serial, TID, ISW TID) + agent/merchant (name, NUBAN account, state/area, ANM from controlled list, priority). Validation → review screen with explicit confirmation → release to Elnexu. Duplicate/conflict detection for serials, TIDs, pending requests and active mappings. |
| **Remapping** | Look up a terminal by serial or TID, see the current mapping, enter the new agent/account/location/ANM + reason. Serial and TID are locked. On treatment a new mapping **version** is created; earlier versions are preserved with who/when/why. |
| **Vendor workspace** | Elnexu users see only requests released to their vendor. One-click copy per field and **Copy all** (structured payload for the TMS) with "Copied" feedback, Start treatment, **Mark as treated** (with TMS confirmation), **Unable to treat** (reason + comment), bulk start/treat. |
| **Workflow engine** | Application-controlled statuses (Draft, Ready for Review, Submitted to Vendor, In Progress, Treated, Exception, Returned, Cancelled, Closed). Controlled amendments after release (reason required, vendor notified, fully audited). One open request per terminal enforced in the database. |
| **Vendor sheet import** | The existing Elnexu sheet imports as-is: the merchant name on the sheet, status and remarks are kept on each terminal, every value in unmapped/unlabelled columns is preserved as an "other identifier" (with a warning — e.g. a replacement serial), messy locations are normalised to states, and a serial typed in the wrong column is called out. Typing a serial in *New Mapping* pre-fills TID, ISW TID, merchant and state from the sheet, so only the account number and ANM need adding. |
| **North Bank / South Bank** | Every state belongs to North Bank or South Bank. Capture forms drill down *Bank → State* (choosing a state fills in its bank); request queues, the vendor queue, terminals, the dashboard, the location report and Excel exports can all be filtered or broken down by bank. Super Admins reassign states under *Administration → Regions* — changes apply immediately to existing records and are audited. ANM coverage can be set per bank in one click. |
| **Batch processing** | Upload `.xlsx`/`.csv` (vendor TID batch, mapping batch, remapping batch) → header detection → column mapping → per-row validation (errors, duplicates, warnings) → correct rows in the browser or download failed rows → import valid rows (transactional) → bulk review & release. Works with the legacy *Location / Terminal Serial Number / Current TID / ISW TID / Status/Comment* sheet. |
| **Terminal master** | Current state of every terminal plus full lifecycle: every mapping version and every request. |
| **Dashboard & reports** | Totals, pending, with vendor, exceptions, outstanding, today's activity, vendor performance (avg/P90 treatment time, exception rate), by ANM/state, daily report, outstanding ageing, ANM, location, activity and single-terminal history. All exportable to Excel. |
| **Audit** | Every significant action (logins, creates, edits, submissions, vendor opens/copies/treatments, exceptions, remaps, admin changes, exports, account reveals) with user, role, record, old/new values, timestamp, IP and device. Append-only (DB triggers) and SHA-256 hash-chained with an in-app integrity check. |
| **Security** | scrypt passwords, opaque server-side sessions (idle + absolute timeout), lockout and throttling, CSRF tokens + origin checks, strict nonce-based CSP, RBAC enforced server-side on every call, vendor scoping (no IDOR), AES-256-GCM encryption of account numbers at rest, masked display, audited reveal, optional TOTP 2-step verification. |
| **Notifications** | In-app notifications (vendor: new requests/amendments; internal: treated, exceptions, returns) behind a channel interface ready for email/SMS/WhatsApp. |

## Quick start (development)

Requirements: **Node.js 22+**, **PostgreSQL 14+** (16 recommended).

```bash
npm ci
cp .env.example .env
#   set DATABASE_URL, and generate keys:
#   DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)
#   DATA_HASH_KEY=$(openssl rand -base64 32)
#   EMAIL_TRANSPORT=console   (dev only: prints reset links to the server log)

createdb wakeel                 # or use docker compose (see docs/DEPLOYMENT.md)
npm run db:reset                # drop + migrate + seed FICTIONAL data (dev only)
npm run dev                     # http://localhost:3000
```

Other scripts:

| Script | Purpose |
|---|---|
| `npm run db:migrate` | Apply migrations (safe, idempotent — use in every environment) |
| `npm run db:seed` | Seed development data into an empty database (refuses in production) |
| `npm run create-admin` | Production bootstrap of the first Super Admin (`ADMIN_EMAIL`, `ADMIN_NAME`) |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit + integration tests (needs a test database) |
| `npm run build && npm run test:e2e` | Browser end-to-end + HTTP security tests against a production build |

## Development test credentials

Created by `npm run db:seed` / `npm run db:reset` only. **All seed data is fictional.** Password for every account: `Wakeel#Dev2026!`

| Role | Email | Lands on |
|---|---|---|
| Super Admin | `superadmin@wakeel.test` | Dashboard (+ Administration) |
| Wakeel Operations | `ops@wakeel.test`, `ops2@wakeel.test` | Dashboard |
| Field / Internal Submitter | `field@wakeel.test` | My Submissions |
| Elnexu Vendor | `vendor@elnexu.test`, `vendor2@elnexu.test` | Treatment Queue |

Fictional sample spreadsheets are in [`samples/`](samples/) (legacy Elnexu TID sheet layout, and a mapping batch containing deliberate errors), and each import type has a downloadable template in the app.

## Project structure

```
src/
  app/                    Next.js App Router
    (auth)/               sign-in, 2-step, forgot/reset password
    (app)/                authenticated pages (dashboard, requests, vendor, terminals, imports, reports, admin, account)
    api/                  JSON API route handlers (thin: auth/CSRF/RBAC wrapper → services)
  server/                 server-only code (never bundled to the browser)
    db/                   Drizzle schema + client
    auth/                 passwords, sessions, rate limiting, TOTP
    workflow/             pure state machine
    services/             business logic: requests, terminals, anms, users, imports, reports
    audit.ts              append-only hash-chained audit writer/verifier
    crypto.ts             AES-256-GCM, HMAC
    rbac.ts               roles → permissions
    http.ts               API wrapper, CSRF/origin checks, error mapping, page guards
    notifications.ts      in-app notifications + channel adapters
  components/             reusable UI (shell, tables, forms, charts)
  lib/                    shared constants, validation (zod), formatting, client API helper
  proxy.ts                CSP nonce + unauthenticated redirect
drizzle/                  SQL migrations (generated + hand-written hardening)
scripts/                  migrate, seed, reset, create-admin, sample generator
tests/                    unit, integration (real PostgreSQL), e2e (Playwright)
docs/                     architecture, security, deployment, testing
```

## Testing

- **Unit + integration (Vitest, 91 tests)** against a real PostgreSQL test database (`TEST_DATABASE_URL`, default `wakeel_test`; schema is recreated each run): validation, state machine, crypto/TOTP/password primitives, auth (lockout, idle/absolute expiry, logout, reset, MFA, privilege changes), the full mapping & remapping workflows, concurrency (simultaneous conflicting requests), vendor isolation/IDOR, amendments & exceptions, bulk operations, Excel import (legacy layout, errors, duplicates, correction, manual column mapping, spoofed files, 2,000-row batch), audit append-only enforcement and tamper detection.
- **End-to-end (Playwright, 23 tests)** against a production build with a freshly seeded database (`E2E_DATABASE_URL`, default `wakeel_e2e`): the two critical acceptance flows through the UI with separate internal and vendor sessions (including clipboard content), batch upload → correct → import → bulk release, vendor exception → return, mobile field submission, and HTTP security tests (unauthenticated access, session replay after logout, rate limiting, account enumeration, CSRF, cross-origin, RBAC, IDOR, privilege escalation, data minimisation for the vendor, SQL injection, malformed input, spoofed uploads, security headers).

See [docs/TESTING.md](docs/TESTING.md) for the manual UAT checklist.

## Further documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, data model, workflow state machine, API surface
- [docs/SECURITY.md](docs/SECURITY.md) — security model and controls
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — environment variables, deployment, migrations, backups, operations
- [docs/TESTING.md](docs/TESTING.md) — automated suites and manual UAT script

## Assumptions

1. **Starting point.** The repository was empty, so the stack was chosen from scratch (Next.js 16 / React 19 / TypeScript, PostgreSQL, Drizzle ORM, Tailwind CSS). The importer has been validated against the bank's sample Elnexu sheet (real data will be loaded after go-live). It handles that sheet's layout: merchant names in an **unlabelled first column**, a blank row under the header, **Status/Comment spanning two columns** (status + unlabelled remarks), an extra `@dropdown` column, 8/13/14-digit numeric serials, inconsistent locations (`FCT-Abuja`, `abuja`, `kadunna`, `TARABA`, street addresses, blanks), replacement serial/TID values in the extra columns, and stray values far below the data. `samples/legacy-elnexu-tid-batch.xlsx` is a fictional replica of that structure.
2. **Brand.** The Alternative Bank's official colour values were not available, so the palette (deep green + restrained gold) is defined as CSS variables in `src/app/globals.css`, and the mark in `src/components/brand.tsx` is a placeholder. Swap in the official values/logo there — no component changes needed.
3. **Single vendor routing.** All requests route to the vendor with code `ELNEXU` (configurable via `DEFAULT_VENDOR_CODE`). The data model supports multiple vendors.
4. **Location.** Location is a controlled Nigerian state (36 + FCT) plus an optional free-text area/LGA, grouped into North Bank / South Bank. The initial split puts the 19 northern states + FCT in North Bank and the 17 southern states in South Bank; a Super Admin can move any state (or leave it unassigned). The bank is looked up live from the state, so reassigning a state re-groups past records too. Legacy spreadsheet locations are kept verbatim on the terminal as the "vendor location".
5. **Account numbers** are 10-digit NUBAN. The CBN check digit is enforced when `NUBAN_BANK_CODE` is set (e.g. when all agents bank with one institution); otherwise format + obvious-invalid checks apply.
6. **TID format** defaults to 8 alphanumerics (e.g. `2WKL1136`) and is configurable via `TID_PATTERN`.
7. **"New" status.** The brief's "New" and "Draft" are represented by *Draft* (being completed) and *Ready for Review* (complete, awaiting release). Field submitters submit for review; Wakeel operations release to the vendor.
8. **Mapping & remapping** share one `requests` table with a type discriminator (cleaner queries/reporting than two near-identical tables); terminal state lives in `terminals` + versioned `terminal_mappings`.
9. **Roles & permissions** are fixed in code (reviewed and version-controlled) and assigned to users by administrators; the Roles page displays the matrix. This is a deliberate control so a runtime misconfiguration can never grant the vendor internal access.
10. **Vendor visibility of accounts.** The vendor sees the full account number only while a request is actionable (needed for TMS entry); afterwards it is masked. Internal staff see masked values and can reveal (audited).

## Known limitations

- **Email/SMS/WhatsApp delivery** is not wired to a provider. In-app notifications are complete; the channel interface (`registerChannel`) and the password-reset email hook are ready. Until email is connected, administrators issue one-time password links from the Users page.
- **Rate limiting** is in-memory per instance. For multi-instance deployments, add a shared limiter (gateway/WAF or Redis). Account lockout is database-backed and works across instances.
- **Large imports** run in the request (validated up to 10,000 rows / 5 MB; 2,000 rows import in a few seconds in tests). Very large files should be split; a background job queue would be the next step if volumes grow.
- **MFA** is TOTP (authenticator app) and optional; making it mandatory for privileged roles is a one-line policy change once the bank decides.
- **Exact brand assets** (logo, fonts, hex values) need to be supplied by the bank.
