# M1 foundation status — review candidate

M1 is on `feat/m1-foundation`, stacked on the M0 `feat/m0-baseline-architecture` branch. The original SQLite application on `main` remains the working student environment. The React page is an engineering foundation and is not a migrated dashboard.

## Implemented

- pnpm workspace with Fastify API, React/Vite frontend, shared schemas, and Drizzle PostgreSQL package.
- Better Auth registration, verified email sign-in, persistent sessions, logout, expiry, password reset, and session revocation. `CaptureMailer` supplies deterministic tests; the production adapter calls Resend with environment credentials.
- Every user insertion creates a `student` role through a database trigger in the same transaction. Public signup payloads cannot grant staff roles. A one-time operator CLI promotes the first verified super administrator. Only a super administrator can grant further privileged roles and staff assignments; those operations write audit events.
- Private `portfolio_artifacts` resource with create/read/update, session-derived ownership, optimistic revisions, exact-origin mutation checks, and course/student scoped instructor read access. Removed instructor role immediately removes staff access.
- Drizzle migrations `0000`–`0004` cover auth/curriculum foundation, portfolio resource, default-role trigger, and audit events. Disposable PostgreSQL tests apply them from empty, reapply them, check constraints, and verify transaction rollback.
- GitHub Actions checks typecheck, build, API unit tests, required PostgreSQL integration tests, and the legacy regression suite. Playwright captures the running old app's student/admin screens and new React foundation.

## Verification

Run the commands in [M1-TESTING.md](M1-TESTING.md). The local verification record is in [VERIFICATION.md](../VERIFICATION.md), and browser images/traces are in `tests/e2e/artifacts/`. Required PostgreSQL tests fail when `TEST_DATABASE_URL` is absent. No production database was changed.

## Remaining scope

- Live Resend delivery requires configured credentials and a verified sending domain; automated tests use captured mail.
- The complete M0 target schema, SQLite importer, student progression engine, media services, and full React student/admin UI belong to later work and are not claimed in M1.
- [GitHub CI run #1](https://github.com/VIDHI-tech/glitch-env/actions/runs/41508649589) passed typecheck, build, API unit, PostgreSQL integration, and legacy regression checks on commit `2aa4535`. Production deployment and browser cross-browser checks remain separate gates.
