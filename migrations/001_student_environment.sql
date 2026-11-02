CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','instructor','admin')),
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS weeks (id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), title TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS days (id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id), title TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chapters (id TEXT PRIMARY KEY, day_id TEXT NOT NULL REFERENCES days(id), title TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS learning_units (
 id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id), position INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('video','exercise','reflection','feedback')), current_version_id TEXT,
 UNIQUE(chapter_id,position)
);
CREATE TABLE IF NOT EXISTS unit_versions (
 id TEXT PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES learning_units(id), version INTEGER NOT NULL, title TEXT NOT NULL,
 content TEXT NOT NULL DEFAULT '', required INTEGER NOT NULL DEFAULT 1, published INTEGER NOT NULL DEFAULT 0,
 requires_review INTEGER NOT NULL DEFAULT 1, media_id TEXT, duration REAL NOT NULL DEFAULT 0,
 reveal_unit_id TEXT REFERENCES learning_units(id), created_at INTEGER NOT NULL, UNIQUE(unit_id,version)
);
-- Enrollments pin a sequence and immutable content versions. Publishing replacements does not reset learners.
CREATE TABLE IF NOT EXISTS student_enrollments (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), course_id TEXT NOT NULL REFERENCES courses(id),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')), last_unit_id TEXT REFERENCES learning_units(id),
 created_at INTEGER NOT NULL, UNIQUE(student_id,course_id)
);
CREATE TABLE IF NOT EXISTS enrollment_units (
 enrollment_id TEXT NOT NULL REFERENCES student_enrollments(id), unit_id TEXT NOT NULL REFERENCES learning_units(id),
 version_id TEXT NOT NULL REFERENCES unit_versions(id), position INTEGER NOT NULL, PRIMARY KEY(enrollment_id,unit_id)
);
CREATE TABLE IF NOT EXISTS staff_assignments (
 staff_id TEXT NOT NULL REFERENCES users(id), student_id TEXT NOT NULL REFERENCES users(id), course_id TEXT NOT NULL REFERENCES courses(id),
 PRIMARY KEY(staff_id,student_id,course_id)
);
CREATE TABLE IF NOT EXISTS student_unit_progress (
 student_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT NOT NULL REFERENCES learning_units(id), version_id TEXT NOT NULL REFERENCES unit_versions(id),
 status TEXT NOT NULL CHECK(status IN ('in_progress','completed')), completed_at INTEGER, updated_at INTEGER NOT NULL,
 PRIMARY KEY(student_id,unit_id)
);
CREATE TABLE IF NOT EXISTS student_video_progress (
 student_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT NOT NULL REFERENCES learning_units(id), version_id TEXT NOT NULL REFERENCES unit_versions(id),
 last_position REAL NOT NULL DEFAULT 0, intervals TEXT NOT NULL DEFAULT '[]', reached_end INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(student_id,unit_id)
);
CREATE TABLE IF NOT EXISTS playback_sessions (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT NOT NULL REFERENCES learning_units(id),
 last_position REAL NOT NULL, last_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS student_exercise_drafts (
 student_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT NOT NULL REFERENCES learning_units(id), answer TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, PRIMARY KEY(student_id,unit_id)
);
CREATE TABLE IF NOT EXISTS student_submissions (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT NOT NULL REFERENCES learning_units(id),
 version_id TEXT NOT NULL REFERENCES unit_versions(id), attempt INTEGER NOT NULL, answer TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('submitted','needs_revision','completed')), created_at INTEGER NOT NULL,
 UNIQUE(student_id,unit_id,attempt)
);
CREATE TABLE IF NOT EXISTS submission_feedback (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES student_submissions(id), reviewer_id TEXT NOT NULL REFERENCES users(id),
 message TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('needs_revision','completed')), created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS student_notes (
 student_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT NOT NULL REFERENCES learning_units(id), body TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, PRIMARY KEY(student_id,unit_id)
);
CREATE TABLE IF NOT EXISTS stored_files (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT REFERENCES learning_units(id),
 name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, storage_key TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('portfolio','media')),
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS student_portfolio_artifacts (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT NOT NULL REFERENCES learning_units(id), title TEXT NOT NULL,
 body TEXT NOT NULL DEFAULT '', file_id TEXT REFERENCES stored_files(id), kind TEXT NOT NULL DEFAULT 'deliverable' CHECK(kind IN ('deliverable','code','project')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS student_learning_activity (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT REFERENCES learning_units(id),
 course_id TEXT REFERENCES courses(id), event TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS activity_student_time ON student_learning_activity(student_id,created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_student ON student_submissions(student_id,unit_id,attempt DESC);
CREATE INDEX IF NOT EXISTS enrollment_student ON student_enrollments(student_id,status);
