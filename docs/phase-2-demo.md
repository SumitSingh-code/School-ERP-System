# Phase 2 demo: assignments, timetable and holidays

Use only a disposable local database or dedicated staging school. Every person and record in this walkthrough must be synthetic. The phase migration is `20261109130000_phase_2_staff_timetable_holidays`.

## Setup

1. Apply `npm run db:deploy` to a database already tracked by Prisma migrations. For an existing database initialized manually in Supabase SQL Editor, open `supabase/phase-2-staff-timetable-holidays.sql` and run it once. Do not apply both paths to the same schema.
2. Regenerate the client with `npm run db:generate` and start Next.js with `npm run dev`. Keep the separate worker running with `npm run worker` for queued jobs from earlier phases.
3. Sign in as a synthetic Director on local/staging. Add a synthetic teacher using the staff import from Phase 1, or use a synthetic staff account created for this demo.

## Laptop and phone walkthrough

1. On the academic setup page, create a current synthetic school year, a class, a subject and two sections. Link the subject to the class.
2. Open **Teacher assignments**. Assign a class teacher to the first section. Assign the same synthetic subject teacher to both sections.
3. Change one subject teacher and confirm the timetable lessons follow the new assignment, while the old assignment remains visible as previous history. Restore the original teacher for the shared lesson example.
4. Open **Timetable** on laptop and phone. Select a section and weekday. Add a subject to a period; its teacher is filled from the assignment. Add a named Assembly, Games or Library period without a teacher.
5. Configure Sunday as off, keep Saturday on, adjust period times, and add a break. Save. Check that the day picker disables off days and that overlapping times are rejected.
6. Add a combined lesson for the two sections, same subject and same teacher, at a free period. The shared teacher may teach both sections in that slot. Try giving the teacher a different simultaneous lesson; the save should be refused.
7. Open **Holidays**. Add a synthetic planned closure, add the standard national dates for the selected year, then mark the second Saturday. Only Director/Principal can set a sudden closure for the current India date.
8. Sign in with a read-only Teacher or Finance role and confirm that assignment, timetable or holiday writes are denied according to that role's capabilities.

## Automated verification

CI applies the migration on PostgreSQL 16 and runs the integration route tests with two synthetic schools. The tests cover successful assignments and schedule writes, teacher and slot conflicts under concurrent requests, combined lessons, denied roles, school isolation, holiday audit records, and schedule configuration. Local environments without PostgreSQL skip only the real-database integration suite; unit, lint, typecheck, Prisma validation and production build checks still run.

This phase does not send holiday messages or change attendance records; those depend on the later attendance/notification phase. SMS fallback remains blocked on provider registration and DLT-approved sender/templates.
