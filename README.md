# School ERP

## Locked architecture

- **Frontend:** Next.js App Router, React, TypeScript and Tailwind; mobile-first installable PWA.
- **Backend:** Next.js route handlers in TypeScript. No separate API service unless a mobile app or external client makes one useful.
- **Database:** Supabase-hosted PostgreSQL with Prisma. Runtime uses Supabase's transaction-mode pooled URL in `DATABASE_URL` (`?pgbouncer=true`); Prisma `directUrl` uses a direct/session URL for migrations.
- **Tenant isolation:** Prisma connects as a direct database user, so Supabase RLS is not the isolation boundary. App queries must go through a school-scoped Prisma wrapper/extension that requires `schoolId`; unscoped access fails closed. Server-side role/capability checks are also required.
- **Worker:** Separate TypeScript Node process using pg-boss backed by PostgreSQL. Imports, PDF generation and reminders run as jobs, never in web requests.
- **Auth/secrets:** App-managed auth skeleton and capabilities. Supabase service key is server-only and must never be sent to the browser or committed.
- **Notifications blocker:** SMS fallback waits for TRAI DLT sender ID and template registration. Phase 0 focuses on in-app notifications; push/WhatsApp can be added before SMS.

## Phase 0 plan and acceptance

1. Create the Next.js + TypeScript + Prisma scaffold and Supabase connection settings, including pooled runtime `DATABASE_URL` and direct migration `directUrl`.
2. Add a fail-closed tenant-scoped database access layer. Every school-owned query requires an explicit `schoolId`. Add an automated test proving School A cannot read School B's records.
3. Add the basic auth, active-role, role/capability and server authorization skeleton.
4. Add an independently runnable pg-boss worker skeleton for imports, PDFs and reminders.
5. Provide synthetic-only seed data, responsive PWA shell, GitHub Actions CI, test checklist and phone/laptop demo steps. No secrets or real student data in Git.

## Local setup

Copy `.env.example` to `.env` and provide Supabase pooled/direct database URLs plus the server-only Supabase key. Run `npm install`, `npx prisma generate`, `npx prisma migrate dev`, `npm run db:seed`, then `npm run dev`. Run the separate worker with `npm run worker`; it uses the direct/session database connection so PostgreSQL job coordination is reliable.

## Demo checklist

1. Open `http://localhost:3000` on a phone-sized viewport and a laptop.
2. Check the responsive dashboard and PWA shell.
3. Demonstrate the authorization skeleton and capability denial for an unauthorized action.
4. Run the tenant-scope test and verify a request scoped to School A cannot return School B's synthetic records.
5. Start the worker separately and enqueue a demo job.

Other approved rules: guardian phone is unique per guardian; siblings link to one guardian. Parents see “Not marked yet” until a section submission exists; offline drafts are teacher-only. Import rollback is allowed only while imported records have not been edited or used.

## Phase 0.5 database verification

Docker is unavailable in the current development environment. To exercise the real database suite against a dedicated, empty Supabase test project:

1. In Supabase SQL Editor, run `supabase/phase-0.5-schema.sql` once on an empty project, then run `supabase/audit-append-only.sql` and `supabase/phase-0.5-seed.sql`. Both school and student rows are synthetic.
2. Copy the project's pooled transaction URL to `DATABASE_URL` (include `?pgbouncer=true`) and its direct/session URL to `DIRECT_URL` in a local `.env` file. Keep that file private.
3. Run `npm run db:generate`, `npm run test:db` with `TENANT_DB_TEST=1`, then `npm test`, `npm run lint`, `npm run typecheck`, `npx prisma validate`, and `npm run build`.

The integration suite creates and removes uniquely named synthetic fixtures and checks all requested Prisma operations. It does not run unless `TENANT_DB_TEST=1` is explicitly set. Never point it at production data.
