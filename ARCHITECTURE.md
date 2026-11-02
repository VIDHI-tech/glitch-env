# GLITCH student environment implementation plan

The supplied workspace was empty on inspection. The subsequently supplied `https://github.com/VIDHI-tech/glitch-env.git` repository was also verified empty through the GitHub API on 2 November 2026. The local implementation is connected to that remote; there is no pre-existing code or authentication to integrate. This implementation focuses on the mandatory individual student environment in the latest request. The broader Phase 1 specification supplies the domain model and future integration requirements; unimplemented full-platform capabilities are explicitly listed in README.md.

1. Persistent SQLite schema, immutable published unit versions, enrollment sequence snapshots, authentication, ownership and staff assignment rules.
2. Server-calculated sequential unlocks, independent progress and watched intervals, resumable playback, optimistic concurrency for drafts/notes.
3. Student dashboard, curriculum roadmap, lesson workspace and My Work portfolio, including private files and saved code as data only.
4. Assigned student inspection and instructor review; supporting curriculum and enrollment administration.
5. Draft Day 1/2 curriculum seed, backend acceptance tests, browser verification and setup/deployment documentation.

Node 24 provides HTTP, crypto and SQLite without third-party runtime dependencies. SQLite and private files live in DATA_DIR on a persistent volume. This is a single-node application; multiple devices use the same authenticated server. No student data is stored in browser localStorage. Enrollment snapshots preserve existing content and ordering when new versions are published. Explicit audited append imports newly published curriculum without resetting completion. Course suspension removes access to lesson content and mutations while preserving historical work for restoration.

All student API paths derive student identity from the session. Staff inspection requires a per-student, per-course assignment (even for ordinary admins); only admin enrollment/assignment management creates these grants. The administrator CLI is an operator-only bootstrap path. Public registration always creates a student.
