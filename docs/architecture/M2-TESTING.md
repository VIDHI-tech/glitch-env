# Run M2 locally

Use Node 24.14.0, pnpm 10.20.0, and a disposable PostgreSQL instance. `TEST_DATABASE_URL` must point to a test role with `CREATEDB`. The suite creates and drops a uniquely named database, applies migrations from empty, and performs real Fastify HTTP requests.

```sh
pnpm install --frozen-lockfile
pnpm m1:typecheck
pnpm m1:build
pnpm --filter @glitch/api test
TEST_DATABASE_URL=postgresql://glitch_test:password@127.0.0.1:5432/glitch_m1_test pnpm test:m1:integration
TEST_DATABASE_URL=postgresql://glitch_test:password@127.0.0.1:5432/glitch_m1_test pnpm test:m2:integration
npm run check
npm test
pnpm exec playwright install chromium
pnpm test:e2e
```

Set `M2_DEMO_OUTPUT=/absolute/path/demo.json` during the M2 integration run to capture sanitized HTTP requests and responses. The committed example is `docs/qa/m2-http-demo.json`. Tests fail rather than skip if `TEST_DATABASE_URL` is absent. GitHub CI repeats both PostgreSQL suites, legacy tests, and Playwright with disposable fixtures.

For local manual email verification, set `MAIL_CAPTURE=1`, `APP_ORIGIN` to a loopback origin, `HOST=127.0.0.1`, and a non-production `NODE_ENV`. `GET /__dev/mail` displays captured links from loopback only. The adapter rejects production or non-loopback configuration. Production still requires `RESEND_API_KEY` and `EMAIL_FROM`.
