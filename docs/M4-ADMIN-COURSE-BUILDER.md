# M4 admin course builder (disposable local QA)

## Run and inspect

Requires Docker Desktop, Node 24.14+, pnpm 10.20, and FFmpeg. From the repository root:

```sh
pnpm install --frozen-lockfile
./scripts/m4-local-up.sh
```

Open **http://127.0.0.1:5173**. API: `http://127.0.0.1:3002`; MinIO console: `http://127.0.0.1:9001`. Startup creates only the `glitch_m4_qa` PostgreSQL database and local `glitch-private` bucket. The seed refuses any other database name or nonlocal database host. The local Vite proxy keeps authentication and signed MinIO uploads on the same browser origin. Do not deploy this QA configuration or its credentials.

| QA account | Email | Password |
|---|---|---|
| Super administrator | `admin@glitch.local` | `GlitchQaOnly2026!` |
| Assigned content administrator | `content@glitch.local` | `GlitchQaOnly2026!` |
| Instructor | `instructor@glitch.local` | `GlitchQaOnly2026!` |
| Student A | `student.a@glitch.local` | `GlitchQaOnly2026!` |
| Student B | `student.b@glitch.local` | `GlitchQaOnly2026!` |

The sample course and teaching text are **QA fixtures**, based on topic labels already present in the legacy draft. They are not finalized curriculum. Student A has a submitted exercise; Student B begins independently. The release is published; a separate video unit remains editable. To stop the app:

```sh
./scripts/m4-local-down.sh
```

To discard all local QA data, stop it and run `docker compose -p glitch-m4-local -f compose.m4-local.yml down -v`. Startup logs: `/private/tmp/glitch-m4-{api,worker,web}.log`. The scripts leave the legacy SQLite application untouched.

## Course workflow

A super administrator creates a course, assigns content administrators through the course author API, and publishes releases. An assigned content administrator can edit only that course's draft hierarchy, unit versions and media, and can preview publication and view its enrolled students. An instructor can view assigned student progress through the existing M2 staff permissions. Students cannot enter the builder. Every route checks roles and course ownership on the server; hiding a UI action is not the authorization boundary.

The hierarchy is Week → Day → Chapter → Unit. Arrow buttons reorder siblings. The editor saves a draft unit version, exercise prompt and completion policy. `Mark ready` selects the version for preview. Ready media is attached by asset ID. The preview can exclude units and set a prerequisite condition on an earlier selected unit; the checklist validates the selection. Publishing creates the existing immutable M2 release snapshot. Pinned student releases, media references and progress continue to refer to their original versions. The prerequisite selection is part of the publication payload; it is not saved as a separate draft configuration before publication. Publication itself remains restricted to super administrators.

Videos use the existing M3 provider choice (`r2-hls` for local QA, or Cloudflare Stream when configured). The local interface requests a scoped upload URL from the API, uploads a real MP4 through the Vite same-origin proxy, and polls worker state. The R2/HLS worker uses FFmpeg. Supporting resources use the existing R2 staging and confirmation flow. Provider credentials remain server-side. No live Cloudflare verification was performed.

## Verification

```sh
TEST_DATABASE_URL=postgresql://glitch:local_dev_only@127.0.0.1:55433/glitch_m4_qa pnpm test:m4:integration
pnpm test:m4:e2e
pnpm m1:typecheck
pnpm m1:build
```

The browser test uses a fresh QA course, uploads a generated two-second MP4, waits for real HLS processing, configures an exercise prerequisite, publishes, checks immutability, enrolls a student, inspects progress, logs out, restores a session and verifies cross-course denial. Its screenshots are in `docs/qa/`. CI runs the PostgreSQL test and a separate Compose browser job with PostgreSQL, MinIO, API and worker; no live Cloudflare credentials are needed.

## Deployment and rollback

Migration `0015_m4-course-authors.sql` adds course author assignments and editable version content. It also extends the published-definition trigger to protect the content field. Apply it before deploying the new API; the React app requires the new routes. Existing published releases and student data are not rewritten. To roll back code, deploy the prior API/web build while retaining this additive migration. Do not drop the table or column while M4 records may exist. Production SQLite migration is outside this milestone.
