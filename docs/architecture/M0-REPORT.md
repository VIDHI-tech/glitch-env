# M0 milestone report

- **Base commit:** `ef1f8be2587a4843b9ff4028ac096cc496f7cf0f`
- **Branch:** `feat/m0-baseline-architecture`; no pull request opened at the time of this report.
- **Files:** `BASELINE.md`, `DECISIONS.md`, `PLAN.md`, `SQLITE-MIGRATION.md`, student/admin baseline screenshots, `docs/api/legacy-api.md`, `packages/db/target-schema.sql`.
- **Database migrations:** none applied. The SQL file is a target design, not a production migration.
- **Architecture:** modular TypeScript monolith; React/Vite frontend, Fastify backend, Drizzle/PostgreSQL, Better Auth, Stream/R2 adapters and same-origin hosting. Decisions are recorded in `DECISIONS.md`.
- **Implemented and tested:** audited source and local data, fetched matching main SHA, ran syntax checks and 22 existing tests (22 pass, 0 fail, 0 skip), loaded student and admin browser views in a disposable QA instance, captured screenshots.
- **Implemented but unverified:** target PostgreSQL DDL and API contract are design artifacts; not executed against PostgreSQL or generated into OpenAPI.
- **Partially implemented:** migration mapping is documented; an idempotent importer and rollback rehearsal belong to M1/M2.
- **Missing:** the M1 TypeScript workspace, real Postgres migrations, provider integrations, and full platform features.
- **Blocked by external credentials:** live Neon/Stream/R2/Render/email checks and external SQLite data inventory.
- **Browser evidence:** `student-baseline.png`, `admin-baseline.png`. These show the existing UI renders, not the future stack.
- **Deployment:** no service or database was deployed or changed. Existing `main` remains available for rollback.
- **Next milestone:** verify stable package versions, create the pnpm workspace and typed API/UI shell, generate reviewed Drizzle migrations and Better Auth adapter, port ownership regression tests against disposable PostgreSQL. Preserve the old app until parity is demonstrated.
