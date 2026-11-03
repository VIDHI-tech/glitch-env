# M3 media HTTP API

These routes extend the M2 PostgreSQL API. `/api/v1` mutations require the configured `Origin`, a Better Auth session, and JSON bodies unless stated otherwise. Errors are `{code,message}`. Course media management is limited to super administrators and content administrators; student routes derive identity from the session. M2 publishing accepts optional `mediaAssetIds: UUID[]` per unit. When a Cloudflare provider is configured, a video unit must have one ready Stream asset; the pinned duration comes from Stream metadata.

| Method | Route | Access and effect |
| --- | --- | --- |
| POST | `/api/v1/admin/media/videos/uploads` | Admin: `{unitVersionId,idempotencyKey,maxDurationSeconds}`; returns asset ID and 15 minute direct upload URL |
| GET | `/api/v1/admin/media/:id` | Admin: status and metadata for course media, no provider credential or raw object key |
| POST | `/api/v1/admin/media/:id/sync` | Admin: retrieve Stream processing status when webhook was missed |
| POST | `/api/v1/admin/media/:id/retry` | Admin: new upload URL for failed, unpinned Stream video |
| POST | `/api/v1/admin/media/:id/revoke` | Admin: prevent new access; delete R2 object when applicable |
| POST | `/api/v1/media/resources/uploads` | Admin course resource: `{unitVersionId,idempotencyKey,mimeType,sizeBytes}`; student private resource: use `enrollmentId` instead of `unitVersionId`; returns 2 minute scoped PUT URL |
| POST | `/api/v1/media/resources/:id/confirm` | Uploader: validate uploaded object, copy to immutable key, mark ready |
| GET | `/api/v1/media/my-resources/:id/download` | Owning active student: 2 minute R2 GET URL |
| POST | `/api/v1/video-sessions/:id/playback` | Owning active student on unlocked pinned unit: 2 minute Stream URL |
| GET | `/api/v1/release-units/:id/resources` | Owning active student on unlocked pinned unit: ready course resources |
| GET | `/api/v1/release-units/:id/resources/:assetId/download` | Same check plus exact pinned asset: 2 minute R2 GET URL |
| POST | `/webhooks/cloudflare/stream` | Cloudflare raw JSON and `Webhook-Signature`; no browser origin or session, HMAC required |

A Stream upload is complete only after webhook or admin sync marks it ready. A resource upload is complete only after confirm. Repeated upload requests with the same creator and idempotency key resolve to the same asset; a key reused with different parameters returns 409. Published media references are immutable. A suspended enrollment receives 404 for playback and resources. Existing signed URLs can remain usable until their short expiry; see [M3 media architecture](../architecture/M3-MEDIA.md).
