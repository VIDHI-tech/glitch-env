# GLITCH launch readiness

This document separates a working local product from a live pilot and a public launch. Automated tests do not establish production readiness.

## 1. Functional local product readiness

M1–M5 provide a local React admin, student and instructor experience backed by PostgreSQL, Better Auth, immutable curriculum releases, and the M2 learning engine. Docker QA uses MinIO and FFmpeg for real HLS processing without paid Cloudflare credentials. The legacy SQLite application remains separate.

Local QA is ready when typecheck, build, M1–M5 PostgreSQL suites, legacy suites, M4 browser suite, M5 classroom browser suite and the M3 container media suite pass on the intended commit. The M5 browser suite creates a test-only course, uploads a generated MP4, publishes it, verifies real playback, and exercises student submission, instructor revision and approval. The fixture is disposable and does not represent finalized teaching material.

Use `sh scripts/m4-local-up.sh` to start local PostgreSQL, MinIO, API, FFmpeg worker and React; visit `http://127.0.0.1:5173`. On environments where background processes end with the shell, start API, worker and web in separate terminals after `source scripts/m4-local-env.sh`:

```sh
docker compose -p glitch-m4-local -f compose.m4-local.yml up -d --wait
source scripts/m4-local-env.sh
pnpm --filter @glitch/api exec tsx src/migrate.ts
pnpm --filter @glitch/api exec tsx scripts/seed-m4-qa.ts
pnpm --filter @glitch/api exec tsx src/server.ts
# Separate terminal, with the same environment:
pnpm --filter @glitch/api exec tsx src/hls-worker.ts
# Separate terminal:
pnpm --filter @glitch/web dev
```

Run `pnpm test:m5:e2e` to create and exercise a real MP4/HLS classroom fixture. QA accounts are `admin@glitch.local`, `content@glitch.local`, `instructor@glitch.local`, `student.a@glitch.local`, and `student.b@glitch.local`; local-only password: `GlitchQaOnly2026!`. Stop services with `sh scripts/m4-local-down.sh`. Never use these credentials or QA data outside the disposable environment.

## 2. Live pilot readiness

- Provision isolated production-grade PostgreSQL and private R2 storage, backups, restore drills, HTTPS, secret management, monitoring and incident response.
- Decide whether the pilot uses Stream or R2/HLS; configure and verify the chosen provider with live credentials, domain and signed playback behavior. The local MinIO test is not live Cloudflare verification.
- Validate concurrent learners, segment-serving latency, worker throughput, failed-job recovery and storage cost with the intended pilot cohort. Plan scaling beyond the single-node FFmpeg and API pilot architecture.
- Confirm enrollment, suspension, staff assignment, feedback, file access, retention and deletion policies with real operational roles.
- Review accessibility, mobile device playback, browser support and upload limits using pilot hardware and networks.
- Prepare approved course content, real video, exercises and instructor guidance before enrolling actual learners.

## 3. Public production launch readiness

- Complete security review, penetration testing and privacy/data protection review for student work, media and account flows.
- Establish migration and rollback procedures for existing production data. This branch does not migrate legacy SQLite data.
- Run load and failure tests across multiple API instances and workers; set SLAs, error budgets, alerting and disaster recovery targets.
- Perform compliance, legal and safeguarding review appropriate to the learners and jurisdictions.
- Implement operational support processes for account recovery, media failure, instructor response times, moderation and audit requests.
- Validate provider contracts, cost ceilings and CDN/caching design before broad distribution of HLS segments.

## 4. Remaining curriculum/content preparation

- Review and approve all teaching text, media, exercise prompts, completion policies and prerequisites against the GLITCH methodology.
- Replace QA fixtures with approved curriculum releases. Published releases stay immutable; new content uses new versions and releases.
- Prepare captions/transcripts, alternate formats, resource accessibility and instructor review rubrics.
- Pilot the week/day pacing and learner feedback with real students before expanding the catalogue.

### Playback verification limit

The server bounds watch progress by elapsed session time and watched intervals. A signed playback grant only authorizes access; it does not prove attention or comprehension. Browser events can still be manipulated by a determined client. Subjective exercise completion remains subject to its configured instructor review policy.
