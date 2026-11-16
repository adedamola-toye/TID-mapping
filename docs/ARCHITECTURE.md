# Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Web/UI | Next.js 16 (App Router), React 19, TypeScript | Server-rendered pages with server-side authorisation; one deployable unit |
| Styling | Tailwind CSS 3 with CSS-variable design tokens | Consistent enterprise look; brand values swappable in one file |
| API | Next.js route handlers wrapped by `api()` (`src/server/http.ts`) | Session, CSRF, origin, permission and error mapping in one place |
| Business logic | Plain TypeScript services (`src/server/services`) | Framework-independent; unit/integration tested directly |
| Database | PostgreSQL 16 via Drizzle ORM + `pg` | Relational integrity, partial unique indexes, triggers, transactions |
| Validation | zod schemas shared by client and server (`src/lib/validation.ts`) | Same rules for fast feedback and authoritative server checks |
| Excel | exceljs (read & write) | Maintained, no known vulnerable versions |

Separation of concerns: **UI** (`src/app`, `src/components`) → **API** (`src/app/api`) → **services / workflow** (`src/server/services`, `src/server/workflow`) → **database** (`src/server/db`). Authentication (`src/server/auth`), validation (`src/lib/validation.ts`) and the workflow engine (`src/server/workflow/stateMachine.ts`) are independent modules. Files under `src/server` import `server-only` and can never be bundled to the browser.

## Data model

```
vendors 1─* users (vendor users only)          anms (controlled master list)
                                                   │
terminals 1─* terminal_mappings (version 1..n) ─*──┘   agents (account HMAC + name)
    │  current_mapping_id ─────────┘                       │
    1                                                      │
    *                                                      │
requests (MAPPING | REMAPPING) ── previous_mapping_id / result_mapping_id
    1─* workflow_events (timeline, append-only)
import_batches 1─* import_rows      notifications      sessions / password_reset_tokens
audit_logs (append-only, hash-chained)
```

Key tables (see `src/server/db/schema.ts` and `drizzle/*.sql`):

- **terminals** — master record: serial (unique), TID (unique when set), ISW TID, status (`AVAILABLE`, `MAPPING_PENDING`, `MAPPED`, `REMAPPING_PENDING`, `INACTIVE`), pointer to the current mapping, first-mapped and last-remapped dates, and preserved vendor-sheet fields (location, legacy status/comment, extra identifiers).
- **terminal_mappings** — every mapping version. Agent name, encrypted account + last 4, state/area, ANM id **and ANM name snapshot** (history survives ANM renames/deactivation), the request that produced it, effective from/to. A partial unique index allows only one `is_current` row per terminal.
- **requests** — mapping/remapping workflow records: immutable terminal identifiers, proposed mapping, status, priority, all actor/timestamp fields (created, reviewed, submitted, vendor opened, started, treated, exception, returned, cancelled, closed), internal comment, reason, row version (optimistic locking). **Partial unique index `requests_one_open_per_terminal_uq`** guarantees one open request per terminal — the database-level guard against duplicate or conflicting work and concurrent remappings.
- **workflow_events** — per-request timeline, with a flag controlling vendor visibility; immutable.
- **audit_logs** — see SECURITY.md.
- **import_batches / import_rows** — staged uploads: raw row encrypted, normalised values, row status (`VALID`, `ERROR`, `DUPLICATE`, `IMPORTED`, `SKIPPED`), errors, warnings, created entity id.

Indexes cover every list filter (status, type, vendor+status, ANM, state, created/submitted/treated dates, serial, TID, account HMAC, batch) plus trigram GIN indexes for partial-text search on agent names and serials.

## Workflow state machine

Defined once in `src/server/workflow/stateMachine.ts` (pure, unit-tested). Every action declares its allowed source statuses, target status and required permission; vendor actions are additionally scoped to the request's vendor.

| Action | From | To | Who |
|---|---|---|---|
| UPDATE | Draft, Ready for Review, Returned | (same) | creator / Wakeel ops |
| MARK_READY | Draft, Returned | Ready for Review | creator / Wakeel ops |
| SUBMIT_TO_VENDOR (review confirmation required) | Draft, Ready for Review, Returned | Submitted | Wakeel ops |
| AMEND (reason required, vendor notified) | Submitted, Exception | (same) | Wakeel ops (blocked while In Progress) |
| START / RELEASE | Submitted ↔ In Progress | | vendor |
| TREAT (TMS confirmation required) | Submitted, In Progress | Treated | vendor |
| RAISE_EXCEPTION (reason required) | Submitted, In Progress | Exception | vendor |
| RETURN (comment required) | Exception, Submitted (recall) | Returned | Wakeel ops |
| RESUBMIT | Exception | Submitted | Wakeel ops |
| CANCEL (reason required) | any open status | Cancelled | Wakeel ops; submitter for own pre-release |
| CLOSE | Treated | Closed | Wakeel ops |

Treating a request, inside one transaction: locks the terminal, verifies the mapping hasn't changed since the remap was requested, closes the previous version (`effective_to`), inserts the next version, updates the terminal, and writes workflow + audit events.

## API surface

All JSON; mutating calls require the `X-CSRF-Token` header and same-origin. Search endpoints use POST so search terms (e.g. account numbers) never appear in URLs or access logs.

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login`, `/logout`, `/mfa`, `/forgot`, `/reset`, `/password`; `GET/POST /api/auth/mfa/setup`; `GET /api/me` | Authentication |
| `POST /api/requests` · `POST /api/requests/search` · `GET/PATCH /api/requests/:id` · `POST /api/requests/:id/action` · `POST /api/requests/bulk` · `POST /api/requests/export` | Mapping/remapping workflow, vendor treatment, exceptions |
| `POST /api/terminals/search` · `POST /api/terminals/lookup` · `GET/PATCH /api/terminals/:id` · `POST /api/terminals/export` | Terminal master |
| `GET/POST /api/anms` · `GET/PATCH /api/anms/:id` | ANM master data |
| `GET/POST /api/imports` · `GET/POST /api/imports/:id` · `PATCH/DELETE /api/imports/:id/rows/:rowId` · `GET /api/imports/template` | Batch import |
| `GET/POST /api/users` · `PATCH/POST /api/users/:id` · `GET/POST /api/vendors` · `PATCH /api/vendors/:id` | Administration |
| `GET/POST /api/audit` | Audit search/export/verify |
| `POST /api/reports/:name` (`daily`, `vendor`, `outstanding`, `anm`, `location`, `activity`; `format: "xlsx"` to export) · `GET /api/dashboard` | Reporting |
| `GET/POST /api/notifications` · `GET /api/health` | Notifications, health probe |

Errors are returned as `{ error: { code, message, fields? } }` with business-language messages; database constraint violations are translated (e.g. "This terminal already has an open mapping/remapping request"). Unexpected errors return a generic message with a reference id; details go to the server log only.
