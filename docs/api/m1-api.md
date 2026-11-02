# M1 API currently implemented

The M1 Fastify API is separate from the working SQLite app. Set `DATABASE_URL`, `APP_ORIGIN`, and `BETTER_AUTH_SECRET`; set `RESEND_API_KEY` and `EMAIL_FROM` to deliver live verification and reset messages. Run committed PostgreSQL migrations before starting the API. All `/api/v1` mutations require the exact `APP_ORIGIN` in the `Origin` header. Authentication uses Better Auth's HttpOnly session cookie.

| Method | Route | Access |
| --- | --- | --- |
| POST | `/api/auth/sign-up/email` | Public; verified email required to sign in; student role assigned by DB trigger |
| GET | `/api/auth/verify-email` | Verification link recipient |
| POST | `/api/auth/sign-in/email`, `/api/auth/sign-out` | Sign in / sign out |
| POST | `/api/auth/request-password-reset`, `/api/auth/reset-password`, `/api/auth/revoke-session` | Better Auth lifecycle |
| GET | `/api/v1/me` | Current authenticated user |
| POST | `/api/v1/admin/courses` | Super administrator |
| POST | `/api/v1/admin/roles` | Super administrator; verified target; grants `super_admin`, `content_admin`, or `instructor` |
| POST | `/api/v1/admin/staff-assignments` | Super administrator; staff role and student/course scope required |
| POST | `/api/v1/portfolio/artifacts` | Student; published course; creates owned artifact |
| GET, PATCH | `/api/v1/portfolio/artifacts/:id` | Owner only; PATCH requires current `revision` |
| GET | `/api/v1/staff/students/:studentId/courses/:courseId/artifacts/:artifactId` | Staff member with current privileged role and exact student/course assignment |

Private records outside the caller's scope return 404. Missing sessions return 401. Unauthorized admin operations return 403. Invalid fields return 422 and stale revisions return 409. The portfolio resource is the M1 ownership proof, not the complete future My Work API. Planned endpoints in `legacy-api.md` remain design contracts.
