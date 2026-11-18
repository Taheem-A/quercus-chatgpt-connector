# Quercus Local

A local-only Quercus/Canvas dashboard, snapshotter, and exporter.

It is designed for one job: **run it when you need it, click Sync Quercus, collect as much student-readable Canvas data as possible, browse it in one place, and export it.**

There is no cloud database, no Vercel requirement, no Docker, and no npm dependency install. The server uses Node.js built-ins and runs on `127.0.0.1` only.

## Quercus Pocket v2 — cross-platform workspace and private cloud accounts

Quercus Pocket remains at **https://quercus-pocket.vercel.app/**. It now supports iPhone portrait, iPhone landscape, tablet and desktop browsers. Desktop has a persistent sidebar; landscape and tablet readers have side-by-side course/assignment outlines and reading panes. The separate Quercus Local localhost-only desktop server at the repository root is unchanged.

**Cloud accounts are optional.** The original device-only snapshot and direct Quercus sync continue to function without registration. With consent, users can store a private course snapshot in managed Neon Auth + authenticated PostgreSQL Data API. It is not end-to-end encrypted against the database operator.

### Sign up and synchronize your devices

1. Open the production Quercus Pocket URL in Safari or desktop Chrome/Edge. Tap **Sign in → Create account**. Enter your email, a display name, and a unique password. Confirm the emailed **one-time verification code**.
2. On your original device, open **Account → Upload this device's saved snapshot**. This is separate, explicit consent because your snapshot may include grades, academic records and Quercus page contents. If the original saved anonymous export disappeared after signing in, choose **Use existing device-only backup** to review it inside your account first.
3. Sign into the **same account** on your other device. It will download and cache the newest private cloud snapshot. Your Quercus API token is not shared between devices; enter your token separately on a second device only if you want it to initiate Quercus syncing too.
4. While signed in, the app checks for newer cloud data when focused or reopened and approximately every **two minutes** in the foreground. The cached workspace is readable offline. On offline launch, the previously used account can view its own local cached data until the online session is reverified.
5. Optionally enable **Automatically upload after Quercus sync** to publish future fresh Canvas/Quercus syncs. This is a separate toggle, off by default. Uploading once does not enable recurring uploads.

The account database stores the **latest snapshot**, not continuously live Canvas data; a device must actively perform a Quercus sync when fresh university information is needed. The application cannot guarantee unattended background polling from a closed browser.

### Privacy, database and conflict protection

- Managed Neon Auth (Better Auth), email OTP verification, account passwords and a first-party HTTPS auth proxy for Safari/iOS. Quercus access tokens remain device-only and are not copied to the account database.
- A separate Neon project named **Quercus Pocket Cloud** has database **quercus_pocket**. The University Planner projects were not modified.
- Each snapshot has an owner ID and a revision. **FORCE ROW LEVEL SECURITY** on the Postgres table protects all SELECT/INSERT/UPDATE/DELETE operations. Anonymous access grants were revoked; each authenticated query is restricted to the user identity verified by Neon. The schema is in `mobile/migrations/001_cloud_snapshots.sql`.
- Cloud writes recheck the latest revision and use a conditional update, rejecting stale uploads if another device has already committed a newer copy. Newer cloud snapshots are downloaded only when the local copy has no unuploaded changes.
- Before cloud upload, secret-like JSON fields are removed and the snapshot is size-limited. Your actual coursework and page HTML are still stored in Neon if you choose to upload; do not assume end-to-end encryption.
- Each device caches data and Quercus tokens under separate per-account IndexedDB keys. Explicit signout hides the previous account's offline copy without deleting it. Browser-storage deletion, private browsing, and device security affect offline retention.
- An existing guest/device-only backup is not silently uploaded when signing in; transferring it into an account and uploading it are explicit separate actions.

### Build and deploy

The cross-platform web app lives in the `mobile/` directory, using Vite with the official `@neondatabase/neon-js` client. Run `npm install`, then `npm run build` from that directory. Vercel's configured root is still `mobile`; the build output is `dist`, with the existing read-only API relay preserved under `mobile/api/canvas.js`. New offline caching is implemented in `mobile/public/sw.js` and caches hashed static assets without caching API responses or tokens.

**Current limitations:** No background service worker Canvas synchronization, automatic downloads of linked PDFs, multi-user sharing, Google Drive/AI integrations, or Windows EXE yet. Google OAuth sign-in is deferred until its first-party callback flow is validated. Neon shared email delivery is intended for initial testing; a dedicated SMTP provider is recommended for sustained production use. Cloud preview domains are not authorized to perform real Neon sign-in; production email OTP and account syncing still require a live end-user verification. Retain a JSON export as a personal backup before changing devices.

---
## iPhone and Android companion — Quercus Pocket

Quercus Pocket is a separately deployed mobile Progressive Web App: https://quercus-pocket.vercel.app/.

**It can now sync Quercus directly from the phone with the Windows laptop powered off.** It runs the same read-only Quercus synchronization engine as the desktop connector, including module-linked page bodies, and saves the result for offline reading.

### Set up direct phone sync

1. On iPhone, open https://quercus-pocket.vercel.app/ in Safari, tap Share → Add to Home Screen, then launch that home-screen icon.
2. Tap **Connect and sync Quercus** (or ⟳ in the header).
3. In your own Quercus account, find or generate a personal Canvas API token under Account → Settings → Approved Integrations. Never send tokens in chat or files. Availability and permitted use can vary by institution.
4. Paste the token in Quercus Pocket. Optionally select **Remember token on this device** for later one-tap refresh. Tap Connect and sync now.
5. Keep the phone screen on and the app in the foreground until the sync finishes; mobile browsers may suspend inactive tabs. Hundreds of requests may be required.
6. Synced courses, deadlines, grades, announcements, Module page text and course file listings are then available offline. Tap ⟳ to refresh on demand.

### API architecture and privacy

Direct browser-to-Quercus API calls may be blocked by cross-origin browser policy. A restricted, read-only Vercel Node Function at mobile/api/canvas.js forwards phone requests:

- The browser sends an HTTPS POST request with its token to the same-origin relay. The relay allows only an explicit set of Canvas GET paths on q.utoronto.ca. It rejects arbitrary domains, mutation requests, cross-origin browser calls and redirects.
- The token is forwarded to Quercus and processed transiently by Vercel; **it is not stored in a Vercel database, file or environment variable**, and the relay disables response caching and intentionally does not log secrets. Vercel remains a service provider handling the token in transit.
- The static site has no student token or course data bundled into it. Your latest snapshot stays in the phone's IndexedDB. The token is kept only in session memory unless you opt into **Remember token on this device** (IndexedDB, without extra app-level encryption). Use **More → Forget saved token** or **Delete saved data** to clear it.
- Protect your Canvas token like a password. Revoke it through Quercus if it becomes compromised. This is for personal use; it is not an OAuth integration intended to collect tokens from other users.
- Vercel Hobby usage quotas apply; a complete phone sync invokes the relay many times. The desktop localhost server is not exposed to the internet.

### Offline access and export import

The phone service worker caches the mobile app and its sync code. Successful snapshots stay on the phone for offline browsing. Manually importing Complete JSON or ChatGPT Markdown exports remains optional; **a desktop export is no longer required for phone sync**.

### Course-style Pages reader and inline attachment previews

The Pages tab now provides a **course → Modules → Pages** hierarchy instead of showing hundreds of expanded page cards. Each selected page opens in a dedicated, readable layout with breadcrumbs, module contents, inline images and Previous/Next buttons.

- Clicking a Quercus page link **already present in the saved snapshot** navigates to that page inside Pocket (no new tab). Links to unsynced, inaccessible or external resources still open the original destination. Module-item links are resolved to their Page when possible.
- Course and Page navigation uses a URL hash so browser Back and deep links work without a server reload. The course catalog retains text search, including saved Page content.
- Canvas images render **inline** and resize to the reading column. Image file links can request fresh authorized signed image URLs when an old source fails. The app does not automatically download/cache all images for offline use.
- Tapping a Canvas file opens a **Pocket attachment viewer**. It requests `GET /api/v1/files/:id` and, if available, Canvas's official `GET /api/v1/files/:id/public_url` for an inline preview URL. Images and PDFs render within a dialog where supported, with **Open in Quercus** and **Download** as separate choices. If Canvas supplies a document-preview URL, other files may be previewable too.
- **iOS limitation:** Apple's WebKit engine sometimes blocks or poorly renders inline PDFs, or Canvas may send a forced-download header. The viewer includes a Quercus fallback. A successful automated test of the URL logic is not proof that every PDF will display on every iPhone.
- The signed file URL is handled directly in the phone's browser and not persisted in our backend. The Vercel relay only returns authorized read-only JSON metadata; file bytes do not pass through Vercel. PDFs and images still need internet to load unless separately cached by the browser.
- Canvas page HTML is reconstructed using allowlisted safe DOM elements. Scripts, event handlers, and arbitrary embeds are never executed; only HTTPS resources are eligible for remote image or frame loading.

### Assignment library and rich assignment details

The old mobile **Tasks** card list has been replaced with an **Assignments** tab designed like the new Pages reader:

- **Assignments → Course → Assignment group → Assignment**. It displays the actual Canvas assignment groups and names; ungrouped assignments remain findable in Other assignments.
- Browse or search by course, assignment title and full instructions. Filter assignments by **All, Not submitted, Submitted, and Graded**.
- A dedicated assignment reading view contains the full **Canvas description HTML**, safely rendered with the same images, links, internal navigation, and file previews as Pages.
- The detail view also shows **due date, points, submission status, grade/score**, and when provided **available-from / lock dates, submission types, attempt count, grading/submission timestamps, late status**, and the Module(s) referencing the assignment. Status comes from the student's captured Canvas submission record; Pocket is not a replacement for Quercus grading.
- Assignment links in saved Pages and Module-item redirects now navigate into the Pocket assignment reader when that assignment is available in the offline snapshot. The Home screen's upcoming assignment cards also link directly to the detail reader. Course cards offer **View assignments** next to **View pages**.
- Browser back and deep links work for assignment courses and assignment details. Assignment data remains stored in the existing on-device snapshot and is included in the existing JSON/Markdown/ZIP exports.
- **Read-only boundary:** The reader has an **Open in Quercus to submit** action; uploading files or submitting an assignment is still done in Quercus. Missing or inaccessible assignment details may require opening the original Canvas page.

### Mobile exports and clickable page content

The mobile app now supports **Export** (↧ in the header or More → Export my data):

- **Complete JSON** — directly importable into Quercus Pocket or desktop tools, with original HTML page bodies retained.
- **ChatGPT Markdown** — the comprehensive course context, including complete accessible Page contents and document links.
- **Readable Markdown** — the shorter coursework summary.
- **Calendar ICS** — assignment and Canvas calendar dates.
- **Complete ZIP** — JSON, Markdown, CSV tables, and ICS, generated fully on the device. ZIP uses the portable STORE format (not compressed). The ZIP does not automatically contain external binary attachments.

On iPhone, use the native Share sheet to **Save to Files**, AirDrop, or send an export to another device. If native sharing is unavailable, the export screen also provides a Save link. No private export file is sent to Vercel.

Pages now show **sanitized, clickable rich content** rather than only flattened plain text. Hyperlinks to other Quercus pages, external resources, and course files remain usable. The page reader also lists its discovered attachments and external links below the page body. Original page HTML is stored in the snapshot and rendered only through an allowlisted DOM builder: active HTML elements and event-handler attributes are discarded. Do not render arbitrary Canvas HTML directly with innerHTML.

**File access:** When you tap a Canvas file link while online with a token configured, the mobile app fetches its File object using the authorized read-only GET /api/v1/files/:id via the relay. That metadata may provide a time-limited signed download URL. The browser opens that URL directly; file bytes do **not** pass through Vercel. If Quercus cannot provide a usable URL, the app falls back to the original Quercus link and your existing university session can still handle the download. Certain files may be locked, require Quercus login, or not be accessible via the student token; the app cannot bypass those restrictions.

Canvas-linked binary course files are not downloaded in bulk or cached offline automatically. The app is read-only and does not submit assignments or modify course data. iOS can evict browser storage; keep backups when important.

---

## What it syncs

The app performs a broad best-effort sync. A failure on one endpoint or one course does **not** stop the rest of the sync.

It currently attempts to collect:

- your Canvas profile and account settings
- active, completed, and invited/pending courses
- enrollments and available course-level grade summaries
- assignments, assignment groups, due dates, descriptions, overrides, and your submission state
- submission history, scores, grades, missing/late/excused state, and rubric assessment data when Canvas exposes it
- modules, module items, content details, and completion requirements
- course pages plus full page bodies, including Pages linked in Modules when the course-wide Pages list is disabled (subject to the student's API permissions)
- announcements
- discussion topics
- calendar events and assignment calendar entries
- planner items and planner notes
- Canvas to-do and upcoming-event feeds
- files and folders metadata (course + user-level)
- quizzes exposed by the Classic Quizzes API
- course tabs/navigation metadata
- sections when your student account can read them
- rubrics when visible
- course progress, activity streams, feature flags, root outcome-group metadata, grading-period metadata, and external-tool metadata when permitted
- favorites, groups, activity stream, and Canvas Inbox conversations when permitted
- peer-review metadata for assignments that use peer review

Some Canvas APIs are intentionally permission-sensitive. If U of T/Canvas returns `401`, `403`, or `404` for a particular endpoint, Quercus Local records the failure under **Diagnostics** and continues.

## Requirements

- Windows 10/11 (the launchers are Windows-friendly; the Node server itself is cross-platform)
- Node.js **20 or newer**
- a Quercus personal access token

Your existing Node 26 installation is fine if the app starts normally.

## Install / replace the old MCP project

This package is meant to live at:

```text
C:\Projects\quercus-chatgpt-connector
```

If you already have the earlier MCP project there, you can extract this package **over the same folder and replace files when asked**. Old Next/Vercel files that are left behind are ignored by this local app.

Important: this ZIP does **not** contain `.env.local`, so an existing local Canvas token in that file is not overwritten. Quercus Local automatically detects these existing variables:

```text
CANVAS_BASE_URL=https://q.utoronto.ca
CANVAS_TOKEN=...
```

Alternatively, configure the token in the app's Settings screen.

## Normal use

Double-click:

```text
start-quercus.bat
```

or run:

```powershell
cd C:\Projects\quercus-chatgpt-connector
.\start-quercus.ps1
```

The launcher checks Node, starts the local server, and the server opens your default browser automatically.

Default address:

```text
http://127.0.0.1:3210
```

If port 3210 is already in use, the app automatically finds the next free port.

To stop the app, close the terminal window or press `Ctrl+C` in it.

## First run

1. Start the app.
2. If the top-left status says the token is not configured, open **Settings**.
3. Keep the base URL as:

   ```text
   https://q.utoronto.ca
   ```

4. Paste your Quercus personal access token.
5. Click **Save & verify**.
6. Click **Sync Quercus**.

The token is saved locally in:

```text
.quercus-local.json
```

That file is ignored by Git. The browser never receives the token back after it has been saved.

## What the dashboard gives you

### Overview

- course count
- due in the next 7 days
- overdue/missing work
- file count
- immediate attention list
- recent announcements

### Courses

Each course gets a compact card with assignment/module counts and grade summary when Canvas exposes it.

### Assignments

One table across every course with:

- due date
- submitted / not submitted / missing / late / excused state
- score/grade
- points possible
- Quercus link
- assignment description preview

### Calendar & Planner

Combines Canvas calendar events, assignment calendar items, planner items, and Canvas to-do records.

### Modules / Pages / Discussions / Quizzes / Messages

Dedicated searchable views for each category.

**Module-linked Pages:** Sync first completes module item lists (including partially embedded lists), then fetches each unique Page using its module `page_url`. This still runs if Canvas returns `404` for the course-wide `/pages` collection. The Pages view labels successful and unavailable bodies; no authentication bypass is attempted. Full text is included in ChatGPT Markdown and ZIP CSV exports when available. Unmodified source HTML is retained in the JSON snapshot and `csv/pages.csv`.

A page may remain unavailable if the individual Page API endpoint denies the configured token. The course's Pages tab being hidden does not itself establish that individual module-linked pages are inaccessible.

### Grades & Submissions

Course-level grade summaries plus the submission records Canvas returned for your user.

### Files

Course file metadata plus an authenticated **Download** action for each accessible Canvas file.

The normal sync does **not** automatically download every binary course file. That avoids unexpectedly pulling gigabytes of lecture recordings/PDFs. File metadata is fully exported, and you can download files on demand from the Files view.

### Diagnostics

Shows every endpoint probe with:

- success/failure
- HTTP status
- result count
- pages fetched
- request time
- error detail when unavailable

This is especially useful because Canvas permissions vary by course and instructor configuration.

### Raw API

A read-only Canvas GET explorer. Example:

```text
/api/v1/courses
```

or:

```text
/api/v1/courses/123/assignments?per_page=100
```

You can run one GET response or automatically follow Canvas pagination.

## Local snapshots

The latest successful sync is saved to:

```text
data\snapshot.json
```

The app also keeps up to 10 historical snapshots in:

```text
data\history\
```

When the app restarts, it immediately loads the latest snapshot. You do not have to sync again just to view previously collected data.

These local data files are ignored by Git.

## Exports

Open **Export** in the sidebar.

### Export for ChatGPT

Downloads:

```text
quercus-chatgpt-<timestamp>.md
```

This is intentionally optimized to upload into a ChatGPT conversation. It contains the useful course context rather than every noisy API field:

- courses
- workload
- assignments and submission state
- assignment descriptions
- modules and module items
- announcements
- pages
- discussions
- grades
- planner/calendar/todo context
- useful Quercus links
- failed endpoint diagnostics
- snapshot timestamp

### Complete JSON

The full snapshot, including the Canvas API objects the sync retrieved and all diagnostics.

### Complete ZIP bundle

Contains:

```text
snapshot.json
summary.md
chatgpt-context.md
calendar.ics
csv/courses.csv
csv/assignments.csv
csv/submissions.csv
csv/announcements.csv
csv/modules.csv
csv/module_items.csv
csv/pages.csv
csv/discussions.csv
csv/files.csv
csv/quizzes.csv
csv/calendar.csv
csv/planner.csv
csv/diagnostics.csv
```

### ICS calendar

Exports dated assignments plus Canvas calendar events as an importable `.ics` file.

### Save into the project

The **Save local copy** action writes the same export bundle under:

```text
exports\<timestamp>\
```

and also creates a ZIP in `exports\`.

Browser download exports normally go to your browser's usual Downloads directory.

## Token rotation

To replace your Quercus token:

1. Create a new personal access token in Quercus.
2. Open Quercus Local → **Settings**.
3. Paste the new token.
4. Click **Save & verify**.

The old local token is replaced.

If you prefer `.env.local`, delete `.quercus-local.json` first, then update `CANVAS_TOKEN` in `.env.local`.

## Troubleshooting

### “Token not configured”

Open Settings and paste a token, or make sure `.env.local` contains `CANVAS_TOKEN`.

### Token verification fails

Check that:

- the token was copied completely
- it has not expired
- the Quercus base URL is `https://q.utoronto.ca`

### Some Diagnostics rows say 403 / 404

That is expected for APIs your student account or a particular course does not expose. Quercus Local deliberately continues syncing everything else.

### Sync takes a while

A comprehensive sync can make hundreds of API requests because it follows pagination and retrieves full page bodies, module items, submissions, files metadata, etc. The progress bar shows the current course and stage.

### Canvas rate limiting

The API client follows Canvas `Link` pagination, detects `429` responses, honors `Retry-After` when present, and retries transient server errors with backoff. It also slows slightly when the Canvas rate-limit-remaining header gets low.

### App opens on a different port

Port 3210 was occupied. Look at the terminal; it prints the exact local URL being used.

### Browser does not open automatically

Copy the URL printed by the launcher into your browser.

## Manual commands

Start without automatically opening a browser:

```powershell
node server.mjs --no-open
```

Syntax-check the application:

```powershell
npm run check
```

No `npm install` is required by this version.

## Privacy / local behavior

- The web server binds to `127.0.0.1`, not your LAN interface.
- The Canvas token remains on your computer.
- Export files never include the token.
- Quercus data is written under this project directory only when you sync or explicitly save an export.
- The only external network requests made by the backend are to your configured Canvas/Quercus server and Canvas-provided file download URLs.


## Experimental University Hub file import (opt-in)

The new `files:sync` command imports accessible course files into a directory **you choose**. It works with an existing saved Quercus snapshot, and never deletes or replaces user files. This is the first step toward University Hub integration; it is **not** yet a scheduled background service or a Planner integration.

1. Start Quercus Local, configure your token, and click **Sync Quercus** so `data/snapshot.json` exists.
2. Open PowerShell in this repository.
3. Preview the next 100 eligible file imports (no token or filesystem writes required):

   ```powershell
   npm run files:sync -- --out "C:\\path\\to\\Google Drive\\UofT\\Quercus Imports" --dry-run
   ```

4. Import the files after reviewing the preview:

   ```powershell
   npm run files:sync -- --out "C:\\path\\to\\Google Drive\\UofT\\Quercus Imports"
   ```

Replace the example path with your actual UofT folder. The command does not assume a Google Drive drive letter or local path.

Options:

- `--course MAT188` to limit matching course codes or IDs;
- `--max-files 250` to attempt more than the default 100 new files per run;
- `--max-mb 250` to adjust the default 100 MiB per-file limit;
- `--dry-run` to see proposed downloads without writes or network calls.

Downloads are placed in course-named subfolders of the selected output directory. Imported filenames include the Canvas file ID and a metadata-version fingerprint. Re-running with the same snapshot skips unchanged files; a changed version gets a different filename, preserving prior copies. Local sync state is kept in `.quercus-file-manifest.json` in the output directory; keep that file when moving the imported directory.

**Safety limits:** audio/video files are skipped, Canvas file metadata must contain a numeric ID, and each downloaded response is size-bounded. Failed downloads are reported without stopping the whole run. Existing files are never overwritten; missing/replaced manifests can cause safe filename conflicts rather than silent changes. The importer does not remove files when Quercus removes them, does not detect separately downloaded copies outside its output directory, and cannot retrieve files that Canvas does not expose to the authenticated student.

Run the small synthetic regression suite with `npm test`; no real Quercus token is used by the tests.
