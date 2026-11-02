# M1 foundation status — in progress

Base: M0 commit `78b1f14` on `feat/m0-baseline-architecture`. Branch: `feat/m1-foundation`; this is a stacked branch until M0 merges. No pull request or deployment yet.

## Implemented and tested

- pnpm workspace with `apps/api`, `apps/web`, `packages/shared`, `packages/db`, `packages/ui`.
- Fastify/TypeScript API shell with liveness, readiness, `/api/v1/health`, Better Auth routing boundary and `/api/v1/me`. Without database, origin and secret, auth fails closed with 503. Readiness queries both auth and course tables.
- Drizzle PostgreSQL client and first six curriculum tables, generated SQL migration in `packages/db/migrations`. No production migration applied.
- React/TypeScript/Vite shell that retains the existing dark/purple visual identity; Vite proxies `/api` and `/health` to Fastify in local development.
- Shared Zod health/error/UUID schemas. Direct dependencies pinned in `pnpm-lock.yaml`.
- `pnpm -r --filter '@glitch/*' typecheck` and API/web builds passed. API injection test passed 1/1. Existing application tests passed 22/22 in the M0 baseline; legacy application files were not altered in M1.

## Partially implemented / unverified

- Better Auth configuration is present but its generated auth schema, real PostgreSQL registration/login, email delivery and session tests are not yet complete. No user journey should be moved to the M1 shell yet.
- Drizzle migration contains curriculum foundation tables only. M0's full target schema still needs implementing in reviewed migrations.
- New React shell is an engineering marker, not a replacement student/admin product. Existing app remains the working local product and rollback path.

## Dependencies and limitations

- `DATABASE_URL`, `APP_ORIGIN`, `BETTER_AUTH_SECRET`, and a disposable PostgreSQL database are needed for M1 integration tests. Email verification also needs an actual delivery adapter; no live provider is claimed.
- The latest pnpm 12 rejected several dependencies under its minimum release age supply-chain policy. The workspace is pinned to pnpm 10.20.0, which installed the exact versions in the lockfile. The policy was not disabled.
- No credentials were committed, no external database was altered, and no deployment occurred.

Next: generate Better Auth schema from its pinned config, add role tables and ownership policy, complete registration/login and privacy tests against disposable PostgreSQL, then build the real React student interface and run browser tests. M1 cannot be called complete until those gates pass.
