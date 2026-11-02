# Verification — 2 November 2026

## Backend acceptance suite

Run `npm test`. The automated HTTP tests use independent student accounts and a persistent SQLite fixture, with a controlled server clock for deterministic playback integrity checks. Tests cover the eleven mandatory student-environment criteria:

| Requirement | Evidence |
| --- | --- |
| 1. Different unlocked nodes in one course | A completes a video; B remains on the first unit |
| 2. A cannot affect B | Different locks, intervals and completion percentages |
| 3. Draft survives logout/login | Save draft, invalidate session, log in and reload |
| 4. Video resumes across devices | New login reads position 135 seconds and interval [0,135] |
| 5. Notes/submissions private | Tampered identity, file, project and staff URLs rejected |
| 6. Individual percentages | A = 33%, B = 0%; A day = 50% |
| 7. Completed units revisitable | Finished student reopens earlier unit |
| 8. Correct next required unit | Revisit old unit; Continue still selects first unfinished requirement |
| 9. Authorized admin access | Assigned staff succeeds; unassigned staff and students fail |
| 10. Updates preserve progress | New content/media version preserves enrolled version, drafts, completion and history |
| 11. Backend restrictions | Auth, ownership, roles, CSRF, origin, locks, reviews, private downloads and rate limits |

A generated black MP4 is used **only in an isolated integration test** to validate codec probing, actual media import, publication, private byte-range access and completion progression. It is never added to the real curriculum.

## Browser checks completed

Tested through the running app in the in-app browser using the disposable QA fixture:

- Student sign-in and personal dashboard.
- Private lesson-note save.
- Reflection completion unlocks exercise; next day stays locked.
- Exercise draft survives refresh and submits to instructor review.
- Instructor sees assigned student and pending response; approval changes course progress to 67%, Day 1 to 100%, and unlocks Day 2.
- Student sees feedback and resumed next step.
- Private saved code appears in My Work and persists an edited revision.
- Responsive dashboard at 390 × 844 and 1280 × 900; measured page width equals viewport width, with no horizontal overflow on the inspected dashboard.

Screenshot: `dashboard-qa.png` is the test fixture, not fabricated production activity.

Limitations: manual browser checks are not an automated UI regression suite. Browser playback through an entire video and a second physical device were not exercised; server-side interval/resume and new-session behavior are tested automatically.

Final run: **22 tests passed, 0 failed, 0 skipped**. `npm run check` passed. This is a standalone implementation in the initially empty workspace. The subsequently supplied `VIDHI-tech/glitch-env` repository was verified empty through the GitHub API. Local Git is initialized on `main`, with that repository configured as `origin`. No pre-existing framework or authentication was available to merge. No push was performed: the connected GitHub account reports `pull: true`, `push: false`. Source files remain local and uncommitted.
