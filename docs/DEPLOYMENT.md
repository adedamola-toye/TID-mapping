# Deployment & operations

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✔ | PostgreSQL connection string |
| `APP_URL` | ✔ | Public base URL (origin checks, reset links) |
| `DATA_ENCRYPTION_KEY` | ✔ | 32 bytes, base64 (`openssl rand -base64 32`) — AES-256-GCM key for account numbers |
| `DATA_HASH_KEY` | ✔ | 32 bytes, base64 — HMAC key for account-number lookups |
| `SECURE_COOKIES` | ✔ prod | `true` behind HTTPS (required in production) |
| `NODE_ENV` | | `production` for deployments |
| `SESSION_IDLE_TIMEOUT_MINUTES` / `SESSION_ABSOLUTE_TIMEOUT_MINUTES` | | default 30 / 720 |
| `MAX_FAILED_LOGINS` / `LOCKOUT_MINUTES` | | default 5 / 15 |
| `NUBAN_BANK_CODE` | | 3- or 6-digit CBN code to enforce the NUBAN check digit |
| `TID_PATTERN` | | regex for TIDs (default `^[A-Z0-9]{8}$`) |
| `DEFAULT_VENDOR_CODE` | | vendor that new requests route to (default `ELNEXU`) |
| `EMAIL_TRANSPORT` | | `none` (default), `console` (development only; blocked in production) or `resend` |
| `RESEND_API_KEY` | ✔ with resend | Resend API key (send-only keys are fine) |
| `MAIL_FROM` | ✔ with resend | Verified sender, e.g. `Wakeel <no-reply@wakeelfo.ng>` |
| `IMPORT_MAX_BYTES` / `IMPORT_MAX_ROWS` | | default 5 MB / 10,000 |
| `TRUST_PROXY` | | `true` only behind a trusted reverse proxy (client IP for audit/throttling) |
| `DB_POOL_MAX` | | connection pool size per instance (default 10) |

The app validates configuration at start-up and refuses to run with missing/invalid keys.

## First deployment

```bash
# 1. Database (managed PostgreSQL 14+ recommended), with a migration role and an app role
# 2. Build
npm ci && npm run build            # or: docker build -t wakeel-tid .
# 3. Migrate (every deployment, before starting the new version)
DATABASE_URL=... npm run db:migrate
# 4. Bootstrap the first Super Admin (prints a one-time password-set link, valid 30 min)
ADMIN_EMAIL=it.admin@bank.example ADMIN_NAME="Jane Doe" npm run create-admin
# 5. Start
npm start                           # or: node .next/standalone/server.js (Docker image does this)
```

Then, as Super Admin: confirm the Elnexu vendor record, create users (vendor users linked to Elnexu), load the ANM list, and upload Elnexu's current TID sheet as a *Vendor terminal / TID batch* to register existing terminals.

### Docker / docker-compose

`Dockerfile` produces a non-root image using Next.js standalone output with a health check on `/api/health`. `docker-compose.yml` runs PostgreSQL, a one-shot `migrate` service and the app:

```bash
cp .env.example .env   # fill in keys, APP_URL, SECURE_COOKIES, and POSTGRES_PASSWORD
docker compose up --build
```

Terminate TLS at the bank's load balancer / reverse proxy and forward to port 3000.

## Migrations

- SQL migrations live in `drizzle/` and are applied in order by `npm run db:migrate` (tracked in the `drizzle.__drizzle_migrations` table; safe to re-run).
- To change the schema: edit `src/server/db/schema.ts`, run `npm run db:generate`, review the SQL, commit it.
- `0001_hardening.sql` adds pg_trgm search indexes, reference sequences, extra foreign keys and the append-only triggers.

## Backups & recovery

- Use the managed database's automated backups with point-in-time recovery (recommended RPO ≤ 15 min), or `pg_dump -Fc` nightly with off-site retention.
- **Back up `DATA_ENCRYPTION_KEY` and `DATA_HASH_KEY` separately from the database** (secret manager). Without them, account numbers cannot be decrypted.
- Test restores quarterly; after a restore, run *Audit Logs → Verify integrity*.

## Logging & monitoring

- Application logs go to stdout/stderr (container-friendly). Unexpected errors are logged with a short reference id that is also shown to the user. Account numbers and secrets are never logged.
- Monitor `/api/health` (returns 200/503), 5xx rates, and the audit actions `AUTH_ACCOUNT_LOCKED`, `ACCOUNT_REVEALED`, `EXPORT_*`.
- Housekeeping: `purgeSessions()` (in `src/server/auth/service.ts`) removes sessions expired/revoked > 7 days; schedule it daily (e.g. a small cron job or DB job: `delete from sessions where expires_at < now() - interval '7 days'`).

## Key rotation

`DATA_HASH_KEY` and `DATA_ENCRYPTION_KEY` rotation requires a maintenance script that decrypts with the old key and re-encrypts/re-hashes with the new key (`requests`, `terminal_mappings`, `agents`, `import_rows`, `users.mfa_secret_enc`). The ciphertext format is versioned (`v1.`) to support this.

## Scaling

The app is stateless apart from the in-memory throttle; run multiple instances behind a load balancer with a shared rate limiter at the edge. All list views use server-side filtering and pagination; dashboards use aggregate queries.
