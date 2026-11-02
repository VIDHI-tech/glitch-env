import { resolve, join } from "node:path";
import { mkdirSync, copyFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { openDatabase, transaction } from "../src/db.js";
import { Platform, string } from "../src/platform.js";
import { id, now, passwordHash } from "../src/auth.js";
const dataDir = resolve(process.env.DATA_DIR || "data");
mkdirSync(join(dataDir, "files"), { recursive: true });
const db = openDatabase(join(dataDir, "glitch.sqlite")),
  p = new Platform(db),
  command = process.argv[2];
try {
  if (command === "admin" || command === "instructor") {
    const email = process.env.GLITCH_ADMIN_EMAIL,
      name = process.env.GLITCH_ADMIN_NAME || "GLITCH Administrator",
      password = process.env.GLITCH_ADMIN_PASSWORD;
    if (!email || !password || password.length < 12)
      throw new Error(
        "Set GLITCH_ADMIN_EMAIL and GLITCH_ADMIN_PASSWORD (at least 12 characters). Passwords are never accepted as command-line arguments.",
      );
    if (p.one("SELECT 1 FROM users WHERE email=?", email))
      throw new Error(
        "Account already exists; this command does not change existing permissions.",
      );
    p.run(
      "INSERT INTO users VALUES(?,?,?,?,?,?)",
      id(),
      email,
      name,
      passwordHash(password),
      command,
      now(),
    );
    console.log(`${command} account created.`);
  } else if (command === "seed") {
    if (p.one("SELECT 1 FROM courses WHERE id=?", "glitch-core")) {
      console.log("Curriculum seed already exists; no changes made.");
    } else
      transaction(db, () => {
        p.run(
          "INSERT INTO courses VALUES(?,?,?,0)",
          "glitch-core",
          "GLITCH — Core Learning Programme",
          "Observe carefully. Question assumptions. Build evidence-backed decisions.",
        );
        p.run(
          "INSERT INTO weeks VALUES(?,?,?,?)",
          "glitch-week-1",
          "glitch-core",
          "Week 1 · Discovery & sense-making",
          0,
        );
        const plans = [
          [
            "glitch-day-1",
            "See First. Explain Later.",
            225,
            [
              "Observation versus interpretation",
              "Claims, assumptions and unknowns",
              "Evidence quality and provenance",
              "Competing hypotheses",
              "Falsifiability and VERIFY-3",
              "Auditing AI explanations",
              "Authentic investigation and transfer",
            ],
          ],
          [
            "glitch-day-2",
            "Stakeholders, Research & Sense-Making",
            255,
            [
              "Milkshake Mystery",
              "Hostel Laundry Request",
              "Four Stakeholder Realities",
              "Different Situations",
              "Hospital Scanner",
              "Two Interviewers",
              "Interview Arjun",
              "Rebuild His Experience",
              "Evidence Wall",
              "Evidence That Does Not Fit",
              "Five Students, 120 Residents",
              "Two Real Needs",
              "When Needs Conflict",
              "Before and After Research",
              "Food-Stall Transfer",
              "Defend Your Finding",
            ],
          ],
        ];
        for (const [
          dayIndex,
          [dayId, title, minutes, topics],
        ] of plans.entries()) {
          p.run(
            "INSERT INTO days VALUES(?,?,?,?)",
            dayId,
            "glitch-week-1",
            title,
            dayIndex,
          );
          for (const [chapterIndex, topic] of topics.entries()) {
            const chapterId = `${dayId}-chapter-${chapterIndex + 1}`,
              unitId = `${chapterId}-theory`,
              versionId = `${unitId}-v1`;
            p.run(
              "INSERT INTO chapters VALUES(?,?,?,?)",
              chapterId,
              dayId,
              topic,
              chapterIndex,
            );
            p.run(
              "INSERT INTO learning_units VALUES(?,?,?,?,?)",
              unitId,
              chapterId,
              0,
              "video",
              versionId,
            );
            p.run(
              "INSERT INTO unit_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
              versionId,
              unitId,
              1,
              topic,
              `DRAFT PLANNING METADATA — NOT REVIEWED TEACHING CONTENT.\nSource topic: ${topic}.\nDay active learning target: ${minutes} minutes.\nFinal theory units should be 3–5 minutes. Attach real media and reviewed lesson material before publication. This scaffold does not prescribe the final video or exercise count.`,
              1,
              0,
              1,
              null,
              0,
              null,
              now(),
            );
          }
        }
        console.log(
          "Draft Day 1 and Day 2 hierarchy created. No media or teaching content was fabricated or published.",
        );
      });
  } else if (command === "import-media") {
    const [unitId, source, adminEmail] = process.argv.slice(3);
    if (!unitId || !source || !adminEmail)
      throw new Error(
        "Usage: node scripts/manage.js import-media UNIT_ID /absolute/video.mp4 ADMIN_EMAIL",
      );
    const actor = p.one(
      "SELECT * FROM users WHERE email=? AND role='admin'",
      adminEmail,
    );
    if (!actor) throw new Error("An existing administrator is required");
    const v = p.one(
      "SELECT v.* FROM unit_versions v JOIN learning_units u ON u.current_version_id=v.id WHERE u.id=? AND u.kind='video'",
      unitId,
    );
    if (!v) throw new Error("Video learning unit not found");
    const path = resolve(source),
      size = statSync(path).size;
    if (size > 1024 * 1024 * 1024)
      throw new Error("Media must be no larger than 1 GB");
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_format", "-show_streams", "-of", "json", path],
        { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30000 },
      ),
    );
    const video = probe.streams.find((s) => s.codec_type === "video"),
      audio = probe.streams.filter((s) => s.codec_type === "audio"),
      duration = Number(probe.format.duration);
    if (
      !video ||
      video.codec_name !== "h264" ||
      video.pix_fmt !== "yuv420p" ||
      audio.some((s) => s.codec_name !== "aac") ||
      !probe.format.format_name.includes("mp4") ||
      !Number.isFinite(duration) ||
      duration <= 0
    )
      throw new Error(
        "Import a browser-compatible MP4 with H.264 yuv420p video and optional AAC audio. Transcode with FFmpeg before importing.",
      );
    const fileId = id(),
      key = id();
    copyFileSync(path, join(dataDir, "files", key));
    transaction(db, () => {
      let versionId = v.id;
      if (v.published) {
        versionId = id();
        p.run(
          "INSERT INTO unit_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          versionId,
          unitId,
          v.version + 1,
          v.title,
          v.content,
          v.required,
          0,
          v.requires_review,
          null,
          0,
          v.reveal_unit_id,
          now(),
        );
        p.run(
          "UPDATE learning_units SET current_version_id=? WHERE id=?",
          versionId,
          unitId,
        );
      }
      p.run(
        "INSERT INTO stored_files VALUES(?,?,?,?,?,?,?,?,?)",
        fileId,
        actor.id,
        unitId,
        `${string(v.title, "title", 200)}.mp4`,
        "video/mp4",
        size,
        key,
        "media",
        now(),
      );
      p.run(
        "UPDATE unit_versions SET media_id=?,duration=? WHERE id=?",
        fileId,
        duration,
        versionId,
      );
      p.audit(actor.id, "import_media", unitId, versionId);
    });
    console.log(
      `Validated media imported as a draft (${duration.toFixed(1)} seconds). Preview/review content before publishing. Existing enrollments retain their media version.`,
    );
  } else
    console.log(
      "Commands: seed, admin, instructor, import-media. See README.md for setup.",
    );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
