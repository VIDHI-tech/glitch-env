# M0 architecture decisions

## ADR-001 — TypeScript modular monolith

Decision: pnpm workspace with `apps/web` (React/TypeScript/Vite) and `apps/api` (Fastify/TypeScript); `packages/shared` contains browser-safe Zod schemas and REST types; `packages/db` owns Drizzle/PostgreSQL; `packages/ui` owns shared presentational components. Fastify serves the built Vite output and `/api/v1` on one origin in production. Vite proxies `/api` in development. The web package may depend on shared/UI only, never DB or provider secrets. This keeps the existing single-service operational shape while providing the required typed boundaries.

## ADR-002 — PostgreSQL releases and enrollment ownership

Decision: Neon PostgreSQL, Drizzle ORM/Kit and committed, reviewed SQL migrations. A release is immutable; each enrollment pins one release. Student progress is keyed to enrollment plus release-unit identity. Stable unit IDs and versions preserve original content through replacements. Migration is an explicit audited operation. No automatic production schema push or destructive cascade.

## ADR-003 — Authentication and authorization

Decision: Better Auth with PostgreSQL stores verified accounts and sessions. GLITCH roles/permissions and staff-course grants are separate relational tables. Public registration grants only student. Every private endpoint checks session, role, enrollment and resource ownership. Existing scrypt hashes need a verified transitional login adapter or reset flow if live legacy users exist; do not assume Better Auth accepts them.

## ADR-004 — Media and files

Decision: Cloudflare Stream for private theory media with direct tus uploads, verified idempotent webhooks and short-lived signed playback. Cloudflare R2 for private student attachments, scoped expiring authorizations and non-executable downloads. Server adapters have local test implementations for integration tests; they must be marked simulated and must never be used as production providers.

## ADR-005 — Staged cutover

Decision: implement on milestone branches with isolated test databases, migration dry runs and rollback records. Keep `main` baseline available. Provisioning Neon, Stream, R2, Render and email delivery requires valid accounts and credentials; no live integration is claimed in M0. Production cutover requires inventory of external SQLite data, backup, restore rehearsal and acceptance evidence.

## Dependency plan

Use the exact stack in the master specification. At M1, verify current stable mutually compatible versions from primary package documentation and lock all direct/transitive dependencies in `pnpm-lock.yaml`. Avoid speculative version numbers in this architecture document. Install foundational packages before implementing features. Security and deployment credentials remain environment variables, never committed.
