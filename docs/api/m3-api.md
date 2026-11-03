# M3 media HTTP API

These routes extend the M2 PostgreSQL API. `/api/v1` mutations require the configured `Origin`, a Better Auth session, and JSON bodies unless stated otherwise. Errors are `{code,message}`. Course media management is limited to super administrators and content administrators; student routes derive identity from the session. M2 publishing accepts optional `mediaAssetIds: UUID[]` per unit. A published video unit must have one ready asset from the selected video provider; its pinned duration comes from provider metadata.

| Method | Route | Access and effect |
| --- | --- | --- |
| POST | `/api/v1/admin/media/videos/uploads` | Admin: `{unitVersionId,idempotencyKey,maxDurationSeconds,sizeBytes?}`; returns asset ID and 15 minute direct upload URL. R2/HLS requires `sizeBytes` of 1–100 MiB and a duration limit of 1–800 seconds; unsupported inputs return 422. Send MP4 with signed `Content-Type`, `Content-Length` and `If-None-Match: *` headers. |
| GET | `/api/v1/admin/media/:id` | Admin: status and metadata for course media, no provider credential or raw object key |
| POST | `/api/v1/admin/media/:id/sync` | Admin: retrieve provider processing status; HLS pending/processing transitions remain worker owned |
| POST | `/api/v1/admin/media/:id/retry` | Admin: new upload URL for failed, expired pending, or abandoned processing unpinned video |
| POST | `/api/v1/admin/media/:id/revoke` | Admin: prevent new access; delete R2 object when applicable |
| POST | `/api/v1/media/resources/uploads` | Admin course resource: `{unitVersionId,idempotencyKey,mimeType,sizeBytes}`; student private resource: use `enrollmentId` instead of `unitVersionId`; returns 2 minute scoped PUT URL |
| POST | `/api/v1/media/resources/:id/confirm` | Uploader: validate uploaded object, copy to immutable key, mark ready |
| GET | `/api/v1/media/my-resources/:id/download` | Owning active student: 2 minute R2 GET URL |
| POST | `/api/v1/video-sessions/:id/playback` | Owning active student on unlocked pinned unit: 2 minute Stream URL or 10 minute same-origin HLS manifest URL |
| GET | `/api/v1/video-sessions/:id/hls/:file` | HLS manifest or allowlisted segment, fetched from private R2 after checking session, enrollment, release, asset and grant on every request |
| GET | `/api/v1/release-units/:id/resources` | Owning active student on unlocked pinned unit: ready course resources |
| GET | `/api/v1/release-units/:id/resources/:assetId/download` | Same check plus exact pinned asset: 2 minute R2 GET URL |
| POST | `/webhooks/cloudflare/stream` | Cloudflare raw JSON and `Webhook-Signature`; no browser origin or session, HMAC required |

A Stream upload is complete only after webhook or admin sync marks it ready. An R2/HLS upload becomes ready after the background worker transcodes it and writes its private HLS manifest and segments; sync can reconcile a finished worker result. Each video asset stores its provider independently of the default for new uploads. If that provider is not configured, playback, retry and sync return 503; other configured providers continue working. A resource upload is complete only after confirm. Repeated upload requests with the same creator and idempotency key resolve to the same asset; a key reused with different parameters returns 409. An expired pending video upload is renewed with a new provider ID on the same idempotent request. Published media references are immutable. A suspended enrollment receives 404 for playback and resources. Existing Stream signed URLs can remain usable until their short expiry; HLS bytes are checked on every request. See [M3 media architecture](../architecture/M3-MEDIA.md).
