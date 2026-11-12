# Changelog

## Phase 3 — Attendance, offline sync and notifications

- Added school-scoped attendance submissions and absent/late records with one submission per section/date and retry-safe idempotency keys.
- Added mobile attendance screen with teacher-owned sections, review-before-submit flow, offline browser drafts, automatic sync when online and draft clearing on sign-out.
- Added reasoned late-arrival correction for authorized office roles, audit entries and bilingual guardian correction outbox events.
- Added date-scoped substitute assignments, default bilingual attendance notification templates, and teacher/Principal reminder scheduling in the separate pg-boss worker using each school's attendance cutoff, working days and holiday calendar.
- Added preview-first sudden holiday broadcasts, notification cancellation, and audited soft-voiding of same-day attendance.
- Added a PostgreSQL migration, Supabase SQL Editor copy, synthetic integration coverage and owner phone/laptop walkthrough.
- Parent inbox display and parent sign-in are in Phase 6; SMS remains blocked until DLT registration and approved templates.

## Phase 2 — Staff assignments, timetable and holidays

- Added class-teacher and subject-teacher assignment workflows with retained reassignment history.
- Added the eight-period weekly timetable with teacher auto-assignment, versioned edits, combined lessons and immutable timetable change history.
- Added configurable working days, period times and breaks, plus planned/sudden holiday management and calendar helpers.
- Added PostgreSQL constraints and a serialized teacher-conflict trigger, route integration coverage, a Supabase SQL migration and a phone/laptop demo script.
- SMS delivery and attendance changes on closure remain in later phases as specified.
