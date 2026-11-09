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

The local synthetic seed creates 1,000 students (including a twin pair and one inactive record), 900 guardian records, 1,000 student-guardian links (100 sibling pairs), and 60 staff role assignments. Synthetic contact identifiers start with `SYNTHETIC-` and are not real phone numbers. Seeded staff have no passwords and are data fixtures, not sign-in accounts.

For a local-only phone/laptop sign-in demo, set `ALLOW_SYNTHETIC_SEED=true` and a private `SYNTHETIC_TEACHER_PASSWORD` in `.env`, run `npm run db:seed`, then start `npm run dev`. Sign in with phone/login ID `SYNTHETIC-STAFF-053` and the password you set; that synthetic ID is accepted only when synthetic mode is enabled outside production. Never set `ALLOW_SYNTHETIC_SEED=true` or the demo password in Vercel/production.

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

## Current build: Phase 1 academic setup and imports

Phase 1 adds editable academic years, class levels, senior streams and elective groups, subjects and class-subject links, sections, student roster imports, staff account imports and teacher assignment during staff import. Imports are preview-first, with persistent batch history and guarded rollback. Student imports link guardians by unique phone and record prior dues as append-only ledger entries. Staff CSV passwords are Argon2id hashes and imported accounts must change their initial password.

Set `IMPORT_PREVIEW_SECRET` to a private random value of at least 32 characters in local and deployment environments before using import preview. Do not set it with a `NEXT_PUBLIC_` prefix. A preview token expires after 30 minutes and is bound to its school, user, CSV content and import type.

The exact laptop and phone walkthrough is in [`docs/phase-1-demo.md`](docs/phase-1-demo.md). The PWA caches only its manifest, icons and generic offline page. It does not cache private school records; offline attendance is implemented in a later phase.

### Apply the Phase 1 database migration

On a fresh database, run the normal Prisma flow: `npm run db:deploy`. On a database already initialized from the Phase 0.5 SQL files in Supabase SQL Editor, open `supabase/phase-1-academics-import.sql` and run the complete file once. The SQL file is a copy of the versioned Prisma migration at `prisma/migrations/20261109120000_phase_1_academics_import/migration.sql`. Do not run both paths against the same database. For SQL Editor upgrades, keep Prisma migration history aligned before using `npm run db:deploy` against that database.

After applying the migration, run `npm run db:generate`, then initialize each school with `npm run provision:director` for a new production database or `npm run db:seed` only on an explicitly disposable synthetic test database. The academic screen is available at `/academic`; student and staff CSV tools are at `/imports` for roles with the relevant capabilities. Download templates from those pages, review all preview errors and warnings, then explicitly confirm. Import rollback is allowed only while imported records are unchanged and unused; opening-balance entries are reversed rather than deleted.

## Remaining product phases

- **Phase 0.5 — Hardening:** real PostgreSQL tenant-isolation tests for all Prisma operations, raw SQL guardrails, common route wrapper enforcement, migrations and synthetic seed on a disposable database.
- **Phase 1 — Academic setup and imports:** academic years/classes/streams/groups/subjects/sections, preview-confirm student and staff imports, rollback safeguards.
- **Phase 3 — Attendance, offline sync and parent notifications.**
- **Phase 4 — Fees, ledger, receipts, day close and reports.**
- **Phase 5 — Tests, exams, marks and report cards.**
- **Phase 6 — Notices, parent app and role dashboards.**
- **Phase 7 — Inactive students, year rollover and pilot hardening.**

Each feature phase will be gated by tests, lint, typecheck, Prisma validation and production build, with demo steps and a changelog. Current implementation is still in progress and is not a customer release until all required workflows and release checks are complete.

## Current build: Phase 2 staff assignments, timetable and holidays

Phase 2 adds class-teacher assignments (one section per teacher/year), subject-teacher assignments scoped to section and academic year, an eight-period weekly timetable, configurable working days/period times/breaks, planned and same-day holiday controls, national holiday and second-Saturday helpers, and intentional combined lessons across sections. Timetable subject entries derive their teacher from the assignment matrix. Reassignments retain prior assignment rows and create timetable history plus audit events for dependent lessons.

Timetable saves are versioned and the database enforces a unique section/day/period. A PostgreSQL trigger serializes teacher-slot checks so simultaneous edits cannot assign a teacher to two classes in the same period; explicitly shared lessons are allowed only through a matching combined-lesson group. Holiday, assignment, schedule and timetable mutations record actor, active role, time and before/after values. Every protected API remains behind the common session/capability/school-scope route wrapper.

### Apply the Phase 2 database migration

On a database already tracked by Prisma, run `npm run db:deploy`. For an existing Supabase SQL Editor database initialized manually, run the complete [`supabase/phase-2-staff-timetable-holidays.sql`](supabase/phase-2-staff-timetable-holidays.sql) once. Do not use both paths on the same database. The migration backfills existing timetable rows' academic year from their section, adds school-composite foreign keys and history, and installs PostgreSQL constraints/triggers for slot and teacher conflicts. After migration run `npm run db:generate`.

Open `/assignments`, `/timetable` and `/holidays` from the dashboard for roles that have those capabilities. The laptop/phone walkthrough and expected access checks are in [`docs/phase-2-demo.md`](docs/phase-2-demo.md). The real-database CI suite covers two-school isolation, concurrent saves, teacher conflicts, shared lessons, audit history, denied roles and working-day configuration. SMS messages and attendance voiding for closures are deferred to the attendance/notification phase; SMS delivery also requires DLT registration and approved templates.
