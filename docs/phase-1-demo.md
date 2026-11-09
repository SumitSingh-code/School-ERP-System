# Phase 1 demo script

Use a disposable local database or a dedicated staging school. Do not import a real student roster until the school has reviewed access and backups. The sample rows below are synthetic.

## Prepare once

1. Apply the Phase 1 migration using `npm run db:deploy` or, for the SQL Editor path, run `supabase/phase-1-academics-import.sql` once.
2. Set private `DATABASE_URL`, `DIRECT_URL`, and `IMPORT_PREVIEW_SECRET` values. `IMPORT_PREVIEW_SECRET` must be at least 32 random characters.
3. Create the first Director with `npm run provision:director`. Privileged sign-in requires the school’s DLT-approved SMS sender/template and private 2Factor credentials.
4. Start the web app with `npm run dev`.

## Laptop walkthrough

1. Sign in as Director and open **Manage academic setup**.
2. Review the current academic year, CBSE classes, subjects, and sections. Rename a synthetic class/subject, then restore its original name.
3. Open **Import students** and download the student template. Fill two entirely synthetic rows, one with a new section and two different synthetic guardian phones.
4. Upload the file and select **Preview CSV**. Confirm the academic year, row counts, new section, and guardian/name warnings. Fix any errors and re-preview.
5. Select **Confirm and import**. Verify the count and the new batch under **Recent student imports**.
6. Refresh the page, open the same batch history, and roll back the untouched import. Verify the history status changes to **ROLLED BACK** and that the ledger was reversed rather than erased.
7. If testing staff setup, use a disposable staff phone/password row, assign a configured section, and confirm the account is required to change its password on first sign-in. Do not share the initial password in the CSV after the import.

## Phone walkthrough

1. Open the same HTTPS staging or local-network URL in Chrome on Android or Safari on iPhone.
2. Install from Chrome’s app prompt, or in Safari use **Share → Add to Home Screen**.
3. Open the installed app and confirm the mobile layout, sign-in, academic setup, CSV preview and import history fit the phone screen.
4. Turn off connectivity and open a page. The app displays a small offline notice; it does not cache school records or accept offline edits yet. Offline attendance is a later phase.
5. Reconnect, then use the update banner when a new service worker version is available.

Never demo with production family details. The synthetic seed/demo account is for local development only and must never be enabled on a production deployment.
