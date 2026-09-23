# Quercus Local

A local-only Quercus/Canvas dashboard, snapshotter, and exporter.

It is designed for one job: **run it when you need it, click Sync Quercus, collect as much student-readable Canvas data as possible, browse it in one place, and export it.**

There is no cloud database, no Vercel requirement, no Docker, and no npm dependency install. The server uses Node.js built-ins and runs on `127.0.0.1` only.

## What it syncs

The app performs a broad best-effort sync. A failure on one endpoint or one course does **not** stop the rest of the sync.

It currently attempts to collect:

- your Canvas profile and account settings
- active, completed, and invited/pending courses
- enrollments and available course-level grade summaries
- assignments, assignment groups, due dates, descriptions, overrides, and your submission state
- submission history, scores, grades, missing/late/excused state, and rubric assessment data when Canvas exposes it
- modules, module items, content details, and completion requirements
- course pages plus full page bodies
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
