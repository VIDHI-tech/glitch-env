# M1 browser evidence — 3 November 2026

Playwright 1.64.1 with Chromium headless shell, disposable old-app QA fixture, and the Vite development server. Result: **3 passed, 0 failed, 0 skipped**.

- `existing-student-dashboard.png` — old working application's student dashboard.
- `existing-student-roadmap.png` — old working application's roadmap.
- `existing-admin.png` — old working application's course management screen.
- `m1-react-foundation.png` — new React engineering screen, not a migrated dashboard.
- `traces/student-flow.zip` — old-app login → dashboard → roadmap → unit → save draft → refresh → logout → login → verify work.
- `traces/admin.zip` — old-app admin login and course management.
- `traces/react-foundation.zip` — new React render check.

Reproduce with `pnpm test:e2e`. The ignored HTML report and raw per-run results remain locally under `tests/e2e/artifacts/report` and `tests/e2e/artifacts/results`; curated evidence above is committed.
