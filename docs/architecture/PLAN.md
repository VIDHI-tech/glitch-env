# Dependency-ordered implementation plan

M0 (this branch): baseline, preservation map, target schema, API contract, migration mapping, ADRs and rollback gate. No application stack change.

M1: pnpm workspace, shared Zod schemas, Fastify/Vite/React shell, Drizzle migrations, Better Auth, role/ownership policy, health endpoints. Gate: reproduce registration, login, per-student privacy on disposable PostgreSQL; old app still runnable.

M2: immutable release model, enrollment snapshots, progression, watched intervals, drafts and review policies. Gate: port all baseline progression/isolation/versioning tests and verify migrated records.

M3: provider interfaces and local test adapters first; then Stream tus authorizations, webhook verification/dedupe, signed playback and R2 private files. Gate: simulated provider tests and separately documented live sandbox checks when credentials exist.

M4: admin curriculum builder, ordering, publication validation, preview, assignments and cohorts. Gate: publish a real ordered release without changing existing enrollments.

M5: React student dashboard, roadmap, player, progress, work and portfolio. Gate: Playwright desktop/mobile flows and accessibility checks.

M6: thirteen validated exercise types and authored simulation/reveal rules. Gate: task-specific interface and saved-answer/revision tests per type.

M7: instructor rubric review, student inspection, scoped analytics and audit UI. Gate: assigned staff only; review transitions tested.

M8: import verified Day 1/2 source files, pending availability. Seed metadata remains draft; media not invented.

M9: staging on Render/Neon/Stream/R2, backups and restore, security review, Playwright E2E and measured load test. Gate: full operational demonstration and rollback rehearsal. Do not call pilot-ready until all acceptance criteria pass.

Each milestone gets its own branch/PR, test report and commit. Existing `main` remains a rollback point until verified cutover. External credentials are tracked as dependencies rather than fabricated.
