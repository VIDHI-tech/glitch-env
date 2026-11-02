# M1 test and migration checklist

Use Node 24.14.0 and pnpm 10.20.0. Keep production credentials and databases out of this process.

1. Start a disposable PostgreSQL 17 instance with a dedicated test role that can create databases. Set `TEST_DATABASE_URL` to a database on that instance. The integration runner creates a uniquely named database, applies all committed migrations, then drops it after the tests.
2. Install and check the workspace:

   ```sh
   pnpm install --frozen-lockfile
   pnpm m1:typecheck
   pnpm m1:build
   pnpm --filter @glitch/api test
   TEST_DATABASE_URL=postgresql://glitch_test:password@127.0.0.1:5432/glitch_m1_test pnpm test:m1:integration
   npm run check
   npm test
   ```

3. Install Playwright Chromium (`pnpm exec playwright install chromium`) and run `pnpm test:e2e`. Inspect the four screenshots and three traces in `tests/e2e/artifacts/`.
4. Confirm GitHub Actions passes on the pushed M1 branch. Do not point a production app at these migrations until the complete target schema, data inventory, backup, import, rollback rehearsal, and release gate are ready.

The integration command exits nonzero without `TEST_DATABASE_URL`. Its PostgreSQL tests contain no conditional skip. The legacy suite may skip its separate FFmpeg test if FFmpeg is unavailable; the CI runner must install FFmpeg if a zero-skip legacy run is required.

To bootstrap the first M1 super administrator after a verified account exists, run `DATABASE_URL=... ADMIN_BOOTSTRAP_EMAIL=... pnpm --filter @glitch/api bootstrap:super-admin`. This operator-only command is one time; it is not an HTTP endpoint. Further grants use the audited admin API.
