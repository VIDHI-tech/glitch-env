# M0 baseline — 2 November 2026

Base: `ef1f8be2587a4843b9ff4028ac096cc496f7cf0f` on `main`; `origin/main` matched after fetch. M0 branch: `feat/m0-baseline-architecture`.

## Current source

- `src/server.js`: Node HTTP server, JSON and file endpoints, session/CSRF/origin checks, administrative routes.
- `src/platform.js`: course progression, watched interval merging, drafts, submissions, notes, work, staff checks.
- `src/auth.js`: local password/session implementation using scrypt and opaque cookie.
- `src/db.js`, `migrations/001_student_environment.sql`: Node SQLite and startup migration.
- `public/index.html`, `public/app.js`, `public/style.css`: single-page student, admin, and instructor UI in browser JavaScript.
- `scripts/manage.js`: administrator bootstrap, Day 1/2 draft seed, local MP4 import.
- `test/student-environment.test.js`: 22 API/integration checks. `test/browser-fixture.js`: disposable QA app.

There is no React, TypeScript, PostgreSQL, Better Auth, Cloudflare integration, Render configuration or existing CI in the baseline. See `docs/api/legacy-api.md` for existing routes.

## Baseline verification

`npm run check`: passed. `npm test`: **22 passed, 0 failed, 0 skipped**. Tests use an isolated temporary SQLite file and loopback server. Browser QA used a disposable fixture: student login/dashboard and admin course-management view rendered. Screenshots: `student-baseline.png`, `admin-baseline.png`. These prove rendering only; the older `docs/VERIFICATION.md` records the earlier manual end-to-end interaction checks.

The ignored local `data/glitch.sqlite` was inspected read-only: users 0, enrollments 0, progress 0, submissions 0, files 0. No evidence of real student data in this workspace. This does **not** establish that no live SQLite database exists on another host. Before production migration, the operator must inventory external data volumes and back them up. No production data was modified.

## Preservation map

| Baseline behaviour | Regression specification | Target module |
| --- | --- | --- |
| Student-only public registration, secure session | Registration, role spoofing, logout and expiry tests | Better Auth adapter, auth module |
| Private student data and scoped staff access | Two-student isolation, file, submission and admin checks | Authz policy and enrollment-scoped queries |
| Sequential required-unit progression | Independent locks, revisit, next required unit | `progression` |
| 90% unique video coverage and end event | Seek abuse, distinct interval and 2:15 resume tests | `videos`, `progression` |
| Drafts, original attempts, revisions, reviews | Logout persistence, optimistic conflict, review gate tests | `exercises`, `submissions` |
| Version-pinned student paths | Replacement preserves completion and media tests | Immutable curriculum releases |
| Day/course percentage and activity | Independent percentage and history tests | `progression`, `analytics` |
| Private attached files and saved code | Ownership, download disposition and portfolio tests | R2 adapter, `portfolios` |

Port behaviours as black-box API regression cases before retiring the Node/SQLite server. Keep the current app runnable on `main` for rollback until replacement acceptance and backup restore pass.
