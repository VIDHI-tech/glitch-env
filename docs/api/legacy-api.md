# Existing API contract at M0

All existing endpoints are same-origin `/api/*` JSON unless noted. Auth: HttpOnly `glitch_session`; mutations also require `X-CSRF-Token`. Errors: `{ "error": "message" }`. Student identity is derived from the session. This contract is a regression reference, not the new `/api/v1` design.

| Method | Path | Behaviour |
| --- | --- | --- |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Local accounts and sessions |
| GET | `/api/me`, `/api/dashboard`, `/api/work`, `/api/history?cursor=` | Session, personal dashboard, work, history |
| POST | `/api/artifacts` | Create/update owned portfolio artifact |
| GET | `/api/units/:unitId` | Accessible assigned unit; records visit |
| POST | `/api/units/:unitId/draft`, `/note`, `/submit`, `/acknowledge`, `/playback`, `/heartbeat` | Personal progress and work |
| POST/GET | `/api/files?unit=:unitId`, `/api/files/:fileId` | Private attachment and media bytes; media supports Range |
| GET | `/api/staff` | Assigned students and pending submissions |
| GET | `/api/staff/students/:studentId/courses/:courseId` | Scoped individual progress |
| POST | `/api/staff/submissions/:id/review` | Scoped approval/revision |
| GET | `/api/admin/catalog` | Content and student list |
| POST | `/api/admin/enrollments`, `/suspend`, `/assignments`, `/hierarchy`, `/units`, `/publish` | Current administration |

## Target `/api/v1` REST contract

Each endpoint uses Zod request/response schemas in `packages/shared` and generated OpenAPI in M1/M2. All private IDs are UUIDs; 401 means no valid session, 403 means authenticated but ineligible, 404 hides records outside scope, 409 means version/concurrency conflict, 422 means validation failure. Mutations use CSRF/origin protection. Pagination uses opaque cursors. Idempotency keys apply to uploads, reviews, release migrations and webhooks.

| Method | Path | Request / response and ownership |
| --- | --- | --- |
| GET | `/api/v1/me` | User profile and granted roles; session |
| GET | `/api/v1/enrollments` | Own assigned releases only |
| GET | `/api/v1/enrollments/:id/roadmap` | Own release snapshot, state, percentages and current unit |
| GET | `/api/v1/enrollments/:id/activity?cursor=` | Own paginated history |
| GET | `/api/v1/release-units/:id` | Own unlocked/completed content version; reveal gates enforced |
| POST | `/api/v1/release-units/:id/video-sessions` | Own eligible video; playback session and signed Stream token |
| POST | `/api/v1/video-sessions/:id/events` | Position, event, elapsed server validation; watched intervals and completion |
| PUT | `/api/v1/release-units/:id/exercise-draft` | Schema-validated answer and revision token; own unit |
| POST | `/api/v1/release-units/:id/attempts` | Immutable new attempt, policy transition; own unit |
| GET | `/api/v1/release-units/:id/attempts` | Own attempts and feedback |
| PUT | `/api/v1/release-units/:id/note` | Own note and revision token |
| GET/POST | `/api/v1/portfolio` | Own artifacts, version history |
| POST | `/api/v1/portfolio/uploads` | Scoped short-lived R2 authorization; own unit |
| GET | `/api/v1/portfolio/files/:id/download` | Own or assigned staff; short-lived signed access |
| GET/POST | `/api/v1/admin/courses`, `/curriculum`, `/learning-units` | Content admin/super admin; Zod payloads |
| POST | `/api/v1/admin/media/uploads` | Authorized content admin; short-lived Stream tus authorization |
| GET | `/api/v1/admin/media/:id` | Status, versions, preview authorization |
| POST | `/api/v1/admin/releases/validate`, `/api/v1/admin/releases` | Preview validation then immutable publish; authorized publisher |
| POST | `/api/v1/admin/enrollments`, `/api/v1/admin/enrollments/:id/migrate` | Scoped assignment/migration with audit |
| GET | `/api/v1/admin/students/:id/progress` | Authorized staff assignment only |
| GET | `/api/v1/instructor/reviews` | Assigned pending attempts only |
| POST | `/api/v1/instructor/reviews/:id` | Rubric decision, message, idempotency key and audit |
| POST | `/webhooks/cloudflare/stream` | Raw body signature verification and deduped event ID |
| GET | `/health/live`, `/health/ready` | Liveness and database/provider readiness; no secrets |

The exact Zod schemas and generated OpenAPI are M1/M2 implementation work. No new endpoint listed here is claimed live in M0.
