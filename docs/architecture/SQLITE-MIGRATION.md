# SQLite to PostgreSQL migration map (M0 design)

No production migration ran in M0. The local ignored `data/glitch.sqlite` has zero users/enrollments/progress/submissions/files; external deployments still need inventory. Keep an immutable SQLite backup, copy the private files directory, record checksums, and test both restoration and conversion before cutover.

| SQLite source | Target | Mapping and preservation rule |
| --- | --- | --- |
| `users` | Better Auth user/account + `user_role_assignments` | Preserve UUID/name/email and role. Verify scrypt transitional login or force a secure reset; never insert old hashes into an incompatible Better Auth field. |
| `sessions` | Better Auth sessions | Do not import opaque legacy cookies without verified adapter. Invalidate at cutover and require login if safe transition unavailable. |
| `courses`, `weeks`, `days`, `chapters`, `learning_units` | Same hierarchy | Parse stable UUIDs; **legacy seeded IDs are text slugs**, so map deterministically to UUIDv5 and persist mapping table. Preserve positions. |
| `unit_versions` | `learning_unit_versions`, `exercise_definitions`, media links | Preserve version number, title/content, required/review policy, media, reveal ID. Published versions are immutable. |
| `student_enrollments`, `enrollment_units` | `enrollments`, `curriculum_releases`, `curriculum_release_units`, `enrollment_release_units` | Group each distinct ordered `(unit_id,version_id)` snapshot into a release; record source-to-target IDs. Existing students retain their exact order/content; do not merge by latest course state. |
| `staff_assignments` | `staff_student_assignments` | Preserve each student/course grant exactly. A general course assignment cannot substitute for this restriction. Never widen instructor access silently. |
| `student_unit_progress` | `student_unit_progress` | Resolve student+unit through enrollment release unit; preserve completion timestamp and status. Reject ambiguous mapping. |
| `student_video_progress`, `playback_sessions` | `video_watch_sessions`, `video_watch_intervals` | Parse and validate JSON intervals, preserve union and last position; expired playback sessions need not be active after cutover. Preserve version association. |
| `student_exercise_drafts` | `exercise_drafts` | Preserve answer text as validated JSON payload, revision and timestamp. |
| `student_submissions` | `exercise_attempts` | Preserve immutable ID, attempt order, answer, status and timestamp. Map submitted to awaiting review where policy requires. |
| `submission_feedback` | `exercise_feedback`, `exercise_reviews` | Preserve reviewer, message, decision and order. Create review record only for an actual recorded decision. |
| `student_notes` | `student_notes` | Preserve body, revision and timestamp. |
| `stored_files` | `private_file_assets`, `media_asset_versions` | Inventory object bytes, size and hash. Copy student attachments to private R2 and videos to Stream with verified provider IDs; keep stable metadata mapping. Do not mark unavailable bytes ready. |
| `student_portfolio_artifacts` | `portfolio_artifacts`, `portfolio_artifact_versions` | Preserve artifact ID, owner, file association and body as version 1. |
| `student_learning_activity`, `audit_log` | `student_learning_activity`, `audit_events` | Preserve event time and actor; link to enrollment where unambiguous. Quarantine otherwise rather than dropping records. |
| `rate_limits` | New runtime rate limiter | No migration; ephemeral operational counters. |

## Idempotent import procedure

1. Stop writes to the old app or capture a consistent SQLite backup and later delta. Record source file checksum and counts per table.
2. Create a migration run ID and durable `legacy_id_map(source_table,source_id,target_uuid,source_hash)` in a staging database. UUIDv5 uses a fixed GLITCH namespace for non-UUID legacy IDs; existing UUIDs remain UUIDs.
3. Import in FK order: users → hierarchy → media metadata → versions → releases → enrollments → progress/work/files/activity/audit. Use upsert on stable source identity with source hash; changed source rows fail review rather than overwrite completed work.
4. Verify counts, ownership, FK integrity, release order, progress percentages and sampled original/revised answers. Re-run the import to prove idempotency (zero changed target rows).
5. Test login transition, private file access, two-student isolation and release pins in staging. Restore from backup and repeat before scheduling cutover.
6. Keep old app and backup available for rollback. Do not point production at the new database until acceptance checks and a rollback rehearsal pass.

M1 must implement and test the importer against populated representative SQLite fixtures. This document is a mapping specification, not a claim that the importer or a live data migration exists.
