# M3 secure media infrastructure

M3 adds Cloudflare Stream for video and Cloudflare R2 for course and student files to the PostgreSQL API. It does not migrate the legacy SQLite application or change curriculum content, methods, exercise policies, or existing M2 records. Migration `0012_m3-media.sql` adds `media_assets`, `release_unit_media`, `stream_webhook_events`, and `video_watch_sessions.playback_authorized_until`. It is additive and safe for existing pinned releases; those releases have no media links until an explicit future release is published.

## Trust boundaries

- The API holds Cloudflare credentials. The browser receives only a 15 minute Stream direct upload URL for an administrator, a 2 minute signed Stream playback URL for the owning student, or a 2 minute R2 presigned operation URL. Upload URLs and playback tokens are bearer credentials: do not log, cache, or share them.
- Only a super administrator or content administrator can register course media. A verified student can request a private resource upload for their own active enrollment. A student can download a course resource only when M2's existing ownership, pinned release, and unlock checks pass; a private student resource requires its owning active enrollment. Instructors receive no media management privilege by default.
- The private R2 bucket has no public binding or public ACL. R2 URLs are signed for one object and operation. Course and student keys use server generated UUIDs in separate scopes. The client never chooses a key.
- Resource upload authorization allows PDF, PNG, JPEG, WebP, UTF-8 text, and ZIP, up to 25 MiB. Confirmation HEAD checks size and MIME and reads the first 512 bytes to check file signatures. The server copies the validated staging object into a new unguessable key, verifies the copy, then marks it ready. The direct upload URL cannot overwrite that final key. R2 server credentials need GetObject, PutObject, HeadObject, CopyObject, and DeleteObject permissions.
- A release publication may pin only ready assets from that exact learning unit version. The published link and asset identity, including Stream UID, R2 key and duration, are protected by PostgreSQL triggers. A later version or media replacement requires a new release. Revocation changes availability without deleting student progress.
- A Stream webhook is accepted only when `Webhook-Signature` contains a valid HMAC SHA-256 over the timestamp and raw body within five minutes. The body digest is stored once; duplicate callbacks do not repeat effects. An old UID from a retried upload cannot update the replacement upload. Admin sync can reconcile missing callbacks. Failed, unpinned video processing may be retried; the original duration limit is preserved.
- New Stream video sessions require a ready linked asset. Playback is authorized per active enrolled student and pinned unit, then a signed token expires after two minutes. M2 watch events for Stream sessions also require an unexpired playback grant and preserve the existing session ownership, elapsed time, unique interval, and 90% plus end rules. The test-video adapter remains for M2 automated tests when no media provider is configured; production mode rejects video sessions without linked media.

## What playback evidence means

A signed playback token proves that the server authorized a request; it is not proof of viewing. M2's elapsed time and interval checks limit arbitrary completion claims, but events still originate from the client and can be fabricated by a determined authorized student. Cloudflare Stream does not provide an authenticated, per-student watch attestation in this implementation. Do not represent the completion percentage as cryptographically verified viewing. A suspended enrollment or revoked video prevents new tokens and API events immediately; a token already issued may work at Cloudflare until its two minute expiry. R2 course downloads have the same residual presigned URL window; revocation also deletes the R2 object, blocking it when deletion succeeds.

## Configuration and deployment

Set these environment variables on the **PostgreSQL API server** (plus existing `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `APP_ORIGIN`). Never put them in React or commit values to Git.

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Enables the Cloudflare provider |
| `CLOUDFLARE_STREAM_API_TOKEN` | Stream direct upload and status API token |
| `CLOUDFLARE_STREAM_CUSTOMER_CODE` | Host for signed Stream playback URLs |
| `CLOUDFLARE_STREAM_SIGNING_KEY_ID` | Stream signing key ID |
| `CLOUDFLARE_STREAM_SIGNING_KEY_PEM_BASE64` | Base64 encoded private PEM for that key |
| `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | Secret returned when configuring the Stream webhook |
| `CLOUDFLARE_R2_BUCKET` | Private R2 bucket name |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | R2 S3 token key ID |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 S3 token secret |

1. Create a private R2 bucket with no public `r2.dev` or custom domain. Create a scoped R2 API token for that bucket. Configure browser CORS for the exact app origin and PUT headers `Content-Type` and `Content-Length`; keep the signing parameters and request headers identical. Avoid broad wildcard origins.
2. Enable Cloudflare Stream signed URLs, create a Stream signing key pair, and supply its key ID and private key. Create an API token limited to the required Stream operations. Configure direct creator uploads and set the Stream webhook endpoint to `https://<api-host>/webhooks/cloudflare/stream`; save its signing secret. Confirm Cloudflare can reach the HTTPS endpoint.
3. Back up PostgreSQL, inspect the migration journal, and apply migration `0012` before deploying the new API. Use `pnpm m1:typecheck`, `pnpm m1:build`, and `pnpm test:m3:integration` against a disposable PostgreSQL database. CI mocks Cloudflare and does not need live credentials.
4. Configure all variables in the API secret manager, deploy over HTTPS, and verify a real direct upload, processing callback, private playback, R2 upload/download, and suspension in a staging Cloudflare account. No live Cloudflare verification was performed by the automated suite.
5. Monitor provider 5xx responses, webhook 401/422 responses, processing failures, staging objects, and R2 deletion failures. Set an R2 lifecycle rule to remove stale `staging/` objects after an operationally suitable period. Retry failed Stream processing via the admin endpoint; reconcile missing callbacks with the sync endpoint.

Rollback the API deployment without reversing migration `0012`: existing M2 endpoints and data remain intact. New Stream backed releases will require the M3 API to play media, so avoid publishing them until the deployment is verified. Keep Stream videos, R2 objects, and the new tables during rollback. Do not drop `0012` while releases reference assets. No production PostgreSQL or SQLite migration was performed here.

## Known limits

The 512 byte signature check is not antivirus scanning or a full parser for PDF/ZIP. Add malware scanning and deeper format validation before accepting untrusted files in high risk environments. A short lived presigned R2 PUT could still mutate its staging key before confirmation; promotion isolates the served object. Cleanup of orphaned Stream uploads and failed R2 copy destinations is operational. Live Cloudflare API, webhook, CORS, and R2 compatibility require staging verification with actual credentials. A managed migration for existing students from legacy SQLite remains out of scope.
