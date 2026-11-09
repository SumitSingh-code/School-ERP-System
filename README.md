# School ERP

## Locked architecture

- **Frontend:** Next.js App Router, React, TypeScript and Tailwind; mobile-first installable PWA.
- **Backend:** Next.js route handlers in TypeScript. No separate API service unless a mobile app or external client makes one useful.
- **Database:** Supabase-hosted PostgreSQL with Prisma. Runtime uses Supabase's transaction-mode pooled URL in `DATABASE_URL` (`?pgbouncer=true`); Prisma `directUrl` uses a direct/session URL for migrations.
- **Tenant isolation:** Prisma connects as a direct database user, so Supabase RLS is not the isolation boundary. App queries must go through a school-scoped Prisma wrapper/extension that requires `schoolId`; unscoped access fails closed. Server-side role/capability checks are also required.
- **Worker:** Separate TypeScript Node process using pg-boss backed by PostgreSQL. Imports, PDF generation and reminders run as jobs, never in web requests.
- **Auth/secrets:** App-managed auth skeleton and capabilities. Supabase service key is server-only and must never be sent to the browser or committed.
- **OTP/SMS provider:** 2Factor is the selected Indian SMS adapter. Their current listed Starter price is ₹0.15/SMS; delivery is paid, not free. Production use is blocked until the school has its provider account, DLT sender/header and approved login template. The API key stays server-side. Provider setup is documented below.

## Phase 0 plan and acceptance

1. Create the Next.js + TypeScript + Prisma scaffold and Supabase connection settings, including pooled runtime `DATABASE_URL` and direct migration `directUrl`.
2. Add a fail-closed tenant-scoped database access layer. Every school-owned query requires an explicit `schoolId`. Add an automated test proving School A cannot read School B's records.
3. Add the basic auth, active-role, role/capability and server authorization skeleton.
4. Add an independently runnable pg-boss worker skeleton for imports, PDFs and reminders.
5. Provide synthetic-only seed data, responsive PWA shell, GitHub Actions CI, test checklist and phone/laptop demo steps. No secrets or real student data in Git.

## Local setup

Copy `.env.example` to `.env` and provide Supabase pooled/direct database URLs plus the server-only Supabase key. Run `npm install`, `npm run db:generate`, and `npm run db:migrate`. Only on a disposable local/test database, explicitly set `ALLOW_SYNTHETIC_SEED=true` before `npm run db:seed`, then start with `npm run dev`. Run the separate worker with `npm run worker`; it uses the direct/session database connection so PostgreSQL job coordination is reliable. Production uses `npm run db:deploy` with the direct URL. The seed command refuses to run in production or without the explicit opt-in.

## Demo checklist

1. Open `http://localhost:3000` on a phone-sized viewport and a laptop.
2. Check the responsive dashboard and PWA shell.
3. Demonstrate the authorization skeleton and capability denial for an unauthorized action.
4. Run the tenant-scope test and verify a request scoped to School A cannot return School B's synthetic records.
5. Start the worker separately and enqueue a demo job.

Other approved rules: guardian phone is unique per guardian; siblings link to one guardian. Parents see “Not marked yet” until a section submission exists; offline drafts are teacher-only. Import rollback is allowed only while imported records have not been edited or used.

## Phase 0.5 database verification

Docker is unavailable in the current development environment. To exercise the real database suite against a dedicated, empty Supabase test project:

1. CI provisions a disposable PostgreSQL service, applies the versioned Prisma migrations, runs the synthetic seed, then runs both two-school isolation suites. For an empty Supabase test project, use `npm run db:deploy` with its direct connection URL; for SQL Editor setup, run `supabase/phase-0.5-schema.sql`, `supabase/audit-append-only.sql`, and `supabase/phase-0.5-seed.sql` once.
2. Copy the project's pooled transaction URL to `DATABASE_URL` (include `?pgbouncer=true`) and its direct/session URL to `DIRECT_URL` in a local `.env` file. Keep that file private.
3. Run `npm run db:generate`, `npm run test:db` with `TENANT_DB_TEST=1`, then `npm test`, `npm run lint`, `npm run typecheck`, `npx prisma validate`, and `npm run build`.

The integration suite creates and removes uniquely named synthetic fixtures and checks all requested Prisma operations. It does not run unless `TENANT_DB_TEST=1` is explicitly set. Never point it at production data.

## Authentication foundation status

- The root page now requires a staff phone/password session; account creation is closed.
- Password checks use Argon2id, successful and failed sign-ins are audited, and five failed attempts start a 15-minute lock window.
- Director, Principal and Finance roles require a 6-digit SMS code on a new device. Codes are stored as keyed hashes, expire after five minutes, allow three attempts, and are single-use. OTP requests are capped at five per hour per account and IP. Trusted staff devices expire after 90 days.
- Staff sessions use 15-minute access tokens and rotating 30-day refresh tokens. Desk roles expire after 30 minutes of inactivity.
- A user can switch only among roles assigned to that user's session. The active role change is audited server-side.
- Protected route handlers use the shared session/capability/school-scope wrapper. Login and OTP verification are public auth routes with common error handling.
- `supabase/phase-0.5-auth-lockout.sql` upgrades an existing database with the login lockout field. The full schema SQL already includes it for a fresh database.
- To upgrade a database that already has the Phase 0.5 auth schema, run `supabase/phase-0.5-otp-auth.sql` once to add trusted devices and OTP challenges. A fresh database gets those tables from `phase-0.5-schema.sql`.
- Initial production setup uses `npm run provision:director` from a private terminal after applying the schema. It asks for the school and Director details, hides the password while typing, seeds reference roles/capabilities, and refuses to run if any school already exists.
- 2Factor integration is isolated behind `src/lib/sms/provider.ts`. Add `TWOFACTOR_API_KEY`, `TWOFACTOR_LOGIN_TEMPLATE`, and a private random `OTP_HASH_SECRET` (at least 32 characters) only to deployment environment settings after registering the sender and template with DLT. Neither variable belongs in `NEXT_PUBLIC_*` or Git. OTP delivery is unavailable until those values are set; no test code is sent to real numbers.

Provider cost notes (checked 9 November 2026): 2Factor lists a ₹0.15/SMS Starter rate and DLT assistance. Firebase Phone Auth bills for each SMS and does not include phone SMS in its no-cost Spark plan, so it is not the cheaper production option for this India-first product. Provider prices and terms can change; verify them before procurement.

This remains foundation work, not a customer release. Parent OTP, active-device management/revocation screens, domain workflows, and real-Postgres permission/IDOR tests still remain. Production staff OTP needs the school’s DLT-approved sender/template and private 2Factor credentials; no OTP is sent by a fake or hardcoded production path.
