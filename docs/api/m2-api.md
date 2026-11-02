# M2 HTTP API

All routes are under `/api/v1`, use the Better Auth session, and require the exact configured `Origin` header for mutations. Errors use `{code,message}`. Invalid input returns 422, unauthenticated access 401, forbidden admin operations 403, hidden or unowned resources 404, and duplicate/stale state 409.

| Method | Route | Access and effect |
| --- | --- | --- |
| POST | `/admin/courses/:id/releases` | Super administrator publishes ordered ready unit versions and conditions atomically; returns release and unit IDs |
| POST | `/admin/enrollments` | Super administrator enrolls a verified student in the latest release |
| POST | `/admin/enrollments/:id/suspend` | Super administrator suspends learning access, preserving work |
| POST | `/admin/enrollments/:id/resume` | Super administrator restores a suspended enrollment and its pinned release |
| GET | `/enrollments` | Own courses and pinned releases |
| GET | `/enrollments/:id/roadmap` | Own unit states, current required unit, course/day percentages |
| GET | `/enrollments/:id/activity?cursor=` | Own paginated learning history |
| GET | `/release-units/:id` | Own unlocked/completed content, saved note and draft |
| POST | `/release-units/:id/complete` | Acknowledge eligible feedback/reflection/handover |
| POST | `/release-units/:id/video-sessions` | Start current test-video session and return resume position |
| POST | `/video-sessions/:id/events` | Submit `{positionSeconds,type}` where type is `heartbeat`, `seek`, or `end` |
| PUT | `/release-units/:id/exercise-draft` | Save `{answer,revision}` using optimistic concurrency |
| POST | `/release-units/:id/attempts` | Submit immutable `{answer}` attempt |
| GET | `/release-units/:id/attempts` | Own attempts with feedback |
| PUT | `/release-units/:id/note` | Save `{body,revision}` using optimistic concurrency |
| POST | `/instructor/attempts/:id/review` | Assigned instructor decides `completed` or `needs_revision` with a message |

The M1 portfolio create route now requires an active enrollment in the course. Portfolio updates also require an active matching enrollment. `GET` retains owner access to historical work. The new API is exercised through actual HTTP requests in `apps/api/test/integration/m2.test.ts`; a sanitized request/response transcript is in `docs/qa/m2-http-demo.json`.
