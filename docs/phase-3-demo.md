# Phase 3 demo: attendance and offline sync

Use a synthetic database only. Do not enter real student details during this walkthrough.

## Laptop walkthrough

1. Sign in with a synthetic Class Teacher account and switch to the **Class Teacher** role.
2. Open **Attendance**. Confirm only the assigned section is listed and the section says **Not marked yet**.
3. Select one synthetic student as absent. Use **Review & submit** and check the student list and notification preview.
4. Confirm the submission. The section changes to **Submitted**; a repeated sync request with the same key is safe and does not create another submission.
5. Sign in as Principal or Director. Open the same date, mark the absent student **Late**, and enter the arrival time and reason. Verify the audit event and bilingual correction notification are saved.
6. Sign in as Finance and open Attendance. The server must deny access.
7. For a synthetic attendance record dated today, select **Sudden closure today** in Holidays. Read the guardian/staff and correction counts in the confirmation, then confirm. The submission is retained as voided, the absent record is soft-voided, queued attendance reminders/absence events are cancelled, and bilingual closure/correction events are queued. Sudden closures cannot be removed after confirmation.
8. If the synthetic database is configured, the worker can be started separately with `npm run worker`. It checks attendance at the configured IST cutoff and queues teacher reminders and later Principal escalations. Scheduled closures are excluded.

## Phone walkthrough

1. Open the school's HTTPS URL at a 360-pixel phone width and sign in as the synthetic Class Teacher.
2. Open **Attendance**, choose the assigned section, and tap only the absent students.
3. Switch the phone to airplane mode while keeping the attendance screen open. Review and submit; the draft stays in that teacher's browser storage and the screen says it has not been sent to parents.
4. Turn connectivity back on. The saved draft syncs with its idempotency key. Confirm the section shows **Submitted**.
5. Sign out. Local attendance drafts are cleared from that browser.

## What this phase saves

- The database stores section submissions, absent/late records, bilingual notification templates and guardian notification outbox rows.
- Parent notifications are queued only after a server-side submission exists. Late corrections are also audited and queued.
- The parent inbox and parent OTP sign-in are part of the parent-app phase. DLT-gated SMS is still off until the school registers sender/template details. No real phone is contacted by this demo.

## Acceptance checks

- A missing submission is returned as `NOT_SUBMITTED`; it is never inferred as present.
- Teachers can mark only sections assigned to them; dated substitute access expires after its date.
- Duplicate syncs cannot create a second section submission or duplicate notifications.
- A School A user cannot read or mutate School B attendance.
- Changes from Absent to Late require a reason and IST arrival time, retain before/after audit values and queue bilingual correction copy.
- No PII is cached by the service worker. Offline drafts are scoped to the teacher's browser account and cleared on sign-out.
