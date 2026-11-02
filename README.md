# GLITCH — Personal Student Environment

A working local application implements the mandatory personal student workspace with Node.js 24, SQLite and native browser JavaScript. A separate TypeScript and PostgreSQL backend now implements the M2 curriculum release, enrollment and personal progression engine. The React app remains an engineering shell. The SQLite application remains the working student UI.

## Repository status

Source is tracked in [VIDHI-tech/glitch-env](https://github.com/VIDHI-tech/glitch-env). M0 and M1 are merged into `main`. M2 development is on `feat/m2-learning-engine`; it preserves the legacy application directories.

## Run locally

```sh
npm run seed
npm start
```

Open http://127.0.0.1:3000. Register a student to create a private persistent workspace immediately. There are no default administrator credentials. Students initially have no assigned courses; enrollment is an explicit administrative action.

Create the first platform administrator in a terminal without putting its password into shell history:

```sh
export GLITCH_ADMIN_EMAIL='your-admin@example.com'
export GLITCH_ADMIN_NAME='GLITCH Administrator'
read -rs 'GLITCH_ADMIN_PASSWORD?Administrator password (12+ characters): '
export GLITCH_ADMIN_PASSWORD
npm run admin
unset GLITCH_ADMIN_PASSWORD
```

The prompt syntax above is for macOS zsh. On another shell, set the password using its secure input mechanism. To create an instructor instead, use the same environment variables and run `node scripts/manage.js instructor`. Existing accounts are never silently promoted. `admin` represents the platform operator/super-admin capability; instructors only see explicitly assigned students and courses. Fine-grained content-admin/publisher roles from the broader brief are not included.

Sign in as the administrator, create course → week → day → chapter → learning units, publish reviewed content, then assign the course to a student. The admin who enrolls a student receives a course-scoped management assignment. The admin may grant the same scoped access to an instructor. “Assign / append” also restores a suspended enrollment and adds newly published units to its existing sequence.

## Implemented student environment

- Personal dashboard: enrolled courses, current week/day/unit, personal course/day percentages, completed/remaining required blocks, exercises, pending review, recent feedback, last visited unit, continue action, and paginated learning history.
- Roadmap: per-student server-calculated locks; unfinished required units prevent progression; completed units stay accessible; an active-node scroll target; mobile and desktop layouts.
- Video progress: distinct merged intervals, last playback position, explicit resume, end detection, server-validated 90% completion, authenticated/rate-limited heartbeats, private HTTP range playback. Coverage is bounded by server elapsed time and the player’s maximum 2× speed. Seeking never counts as watched coverage. Only one active playback session per student/unit is authoritative.
- My Work: persistent exercise drafts, lesson notes, immutable original/revised submission answers, feedback, supporting files, portfolio deliverables, editable projects, saved code. Code is data only; it is never executed.
- Review: submitted → needs revision → new attempt → completed. Submission alone does not complete an approval-required exercise. Feedback and original attempts remain separate records.
- Account sync: SQLite is authoritative across sessions/devices/server restarts; personal work is not stored in localStorage. Drafts/notes use explicit save buttons and revision numbers to reject stale writes. Project edits use an update token. Video heartbeats occur every five seconds and on pause, seek, end and page exit; abrupt process/network loss can lose the interval since the last acknowledged heartbeat.
- Privacy: session-derived student IDs, per-course staff assignments, backend ownership checks, private attachment downloads, guarded content/media, same-origin writes, CSRF tokens, HttpOnly/SameSite cookies, password hashing, request limits and audit records.
- Stable content: enrollments pin their unit versions and sequence. Publishing replacements leaves existing progress/media/work intact. Append only adds new unit IDs to the end of an existing path. It does not silently reorder or replace existing assigned units.

## Storage and schema

Migrations run on startup. `migrations/001_student_environment.sql` contains curriculum hierarchy, immutable version references, `student_enrollments`, `student_unit_progress`, `student_video_progress`, `student_exercise_drafts`, `student_submissions`, `student_notes`, `student_portfolio_artifacts`, `student_learning_activity`, private file metadata, review feedback, sessions, staff assignments and audit records.

Default storage:

```text
data/glitch.sqlite       SQL records, sessions, progress and work
data/files/<random-id>   private student attachments and media
```

Files are never served from a public static directory. Portfolio files are limited to 20 MB and always delivered as attachments with an octet-stream content type and `nosniff`, including HTML/code. Only the owning student or explicitly assigned staff can download them. Course suspension blocks learning content and mutations while preserving saved personal history/work for restoration. Students may still read their own saved work after suspension.

## Media configuration

This student-environment implementation provides a validated operator import, not the complete administrator upload/transcoding service described in the broader Phase 1 brief.

Install FFmpeg/ffprobe on the application host for imports. Supply an actual browser-compatible MP4: H.264, yuv420p, optional AAC audio. Then:

```sh
node scripts/manage.js import-media UNIT_ID /absolute/path/lesson.mp4 your-admin@example.com
```

The import probes the real file, verifies its codecs and duration, copies it into private storage, and attaches it to a draft version. Importing a replacement for a published video creates a new draft version; previously assigned media remains intact. Publication requires a duration of 180–300 seconds and nonempty reviewed lesson material. There is no duration-exception bypass. Run the CLI with the same `DATA_DIR` as the server.

Seeded Day 1/2 titles are draft planning metadata only: seven Day 1 topics and sixteen Day 2 experiences with 225/255-minute source day targets. They do not assert a finalized lesson count, supply reviewed exercise content, or fabricate video recordings. The final reviewed curriculum, exact exercise material, evidence-release rules, and real recordings still need to be supplied before student publication. Draft metadata must be replaced with reviewed teaching material, not merely supplemented with media.

## Tests

```sh
npm run check
npm test
```

The acceptance suite starts a temporary HTTP server and a separate database, creates distinct student/staff accounts, exercises authenticated HTTP endpoints, and removes its own test storage. It covers every mandatory student-environment acceptance criterion, plus seek abuse, concurrency conflicts, revision preservation, CSRF, role spoofing, unpublished/locked/suspended content, evidence reveals, playback-session conflicts, file ownership, history pagination and a full admin → student → instructor workflow.

The real MP4 import/range-playback test runs when FFmpeg and ffprobe are installed; otherwise that single integration test explicitly skips. All other tests require only Node 24. Network sandbox environments must permit a loopback listener.

For repeatable manual UI checks, run:

```sh
node test/browser-fixture.js
```

This creates a **separate disposable database** and serves at http://127.0.0.1:3001. Test-only accounts are `student@glitch.test`, `instructor@glitch.test`, and `admin@glitch.test`, with password `local-browser-test-only`. These accounts are never seeded into the actual app database. Stop this fixture when done. Browser QA results are recorded in `docs/VERIFICATION.md`.

## Environment and deployment

`npm start` and `npm run dev` optionally load `.env`; see `.env.example`.

| Variable | Default / purpose |
| --- | --- |
| `PORT` | `3000` |
| `HOST` | `127.0.0.1`; bind appropriately behind your reverse proxy |
| `DATA_DIR` | `./data`; persistent absolute path recommended |
| `APP_ORIGIN` | Exact public origin, e.g. `https://learn.example.com`; mandatory in production |
| `NODE_ENV` | Set `production` behind HTTPS to enable Secure session cookies |

Deploy as one Node process on a persistent host/container behind an HTTPS reverse proxy. Use the same origin for UI and API. Do not serve the data directory through the proxy. Proxy streaming/range responses and allow only the intended upload limits. Restrict filesystem permissions to the service account. Back up the SQLite database with SQLite’s backup mechanism and the private file directory together; copying a live database file alone can omit WAL changes. Test restore before relying on backups. Keep database/file storage on a persistent volume across app releases.

This implementation is not a stateless serverless or multi-region deployment. Before scaling to multiple application hosts, migrate records to a shared transactional database and files to private object storage while preserving stable IDs and ownership policies. The app has not been deployed to external hosting.

## Remaining work from the broader Phase 1 specification

The personal environment works; the entire attached Phase 1 platform is **not** complete. Explicitly outstanding:

- Full admin media uploader with resumable object-storage uploads, asynchronous processing/retries, thumbnails, captions, adaptive streaming and media-library version/rollback UI. The operator MP4 importer is the available media path today.
- Visual drag-and-drop course reordering, granular publishing validation/permissions, student preview, arbitrary prerequisites, and a managed reassignment/migration UI. Existing student paths are deliberately pinned and append-only.
- All thirteen specialized professional exercise editors, objective graders, and admin evidence-release configuration. Current exercises use a written response with configurable manual approval; the backend has an enforced first-attempt reveal rule.
- Cohorts, invitations, broad operational analytics, audited progress-correction UI, and the finalized reviewed curriculum.
- Existing GLITCH identity-provider integration and deployment monitoring. M1 adds Better Auth email verification and account recovery to the separate PostgreSQL API; the working SQLite app still uses its own local accounts.
- Isolated code execution, intentionally excluded by the personal-workspace requirement. Saved code and private files are supported.
- Automated cross-browser UI tests and a browser-run full-duration video watch. M1 adds a Chromium Playwright regression flow; video completion and real MP4 delivery are integration-tested through the legacy backend.

## TypeScript and PostgreSQL backend (M1–M2)

The original `npm start` application remains the working student experience. The pnpm workspace provides Better Auth registration, verification, sessions, reset, audited administrator grants, enrollment-scoped portfolio work, immutable curriculum releases and per-student progression. The React screen is an engineering foundation, not a migrated student dashboard. To verify the backend locally:

```sh
pnpm install --frozen-lockfile
pnpm m1:typecheck
pnpm m1:build
pnpm --filter @glitch/api test
TEST_DATABASE_URL=postgresql://glitch_test:password@127.0.0.1:5432/glitch_m1_test pnpm test:m1:integration
TEST_DATABASE_URL=postgresql://glitch_test:password@127.0.0.1:5432/glitch_m1_test pnpm test:m2:integration
npm test
pnpm test:e2e
```

The integration suites create and drop separate test databases; the supplied account must have `CREATEDB`. They fail if `TEST_DATABASE_URL` is missing. Playwright requires Chromium and starts disposable servers. See [M2 architecture](docs/architecture/M2-ENGINE.md), [API routes](docs/api/m2-api.md), and [testing instructions](docs/architecture/M2-TESTING.md). The API requires `DATABASE_URL`, `APP_ORIGIN`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, and `EMAIL_FROM` for live email. Local-only mail capture is available with `MAIL_CAPTURE=1` on a loopback origin. No production database migration, email delivery, Cloudflare playback or React student UI is claimed.
