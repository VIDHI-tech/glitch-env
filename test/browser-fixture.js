// Disposable browser QA environment. Never seeds the real application database.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/server.js";
import { passwordHash, id, now } from "../src/auth.js";
const dataDir = mkdtempSync(join(tmpdir(), "glitch-browser-"));
const { server, platform: p } = createApplication({ dataDir });
for (const [key, name, role] of [
  ["student", "QA Learner", "student"],
  ["instructor", "QA Instructor", "instructor"],
  ["admin", "QA Admin", "admin"],
])
  p.run(
    "INSERT INTO users VALUES(?,?,?,?,?,?)",
    key,
    `${key}@glitch.test`,
    name,
    passwordHash("local-browser-test-only"),
    role,
    now(),
  );
p.run(
  "INSERT INTO courses VALUES(?,?,?,1)",
  "qa-course",
  "Learning workspace · QA fixture",
  "Disposable test curriculum for verifying your personal learning environment.",
);
p.run(
  "INSERT INTO weeks VALUES(?,?,?,0)",
  "qa-week",
  "qa-course",
  "Week 1 · Observation & reasoning",
);
p.run(
  "INSERT INTO days VALUES(?,?,?,0)",
  "qa-day-1",
  "qa-week",
  "See First. Explain Later.",
);
p.run(
  "INSERT INTO days VALUES(?,?,?,1)",
  "qa-day-2",
  "qa-week",
  "Stakeholders & sense-making",
);
p.run(
  "INSERT INTO chapters VALUES(?,?,?,0)",
  "qa-chapter-1",
  "qa-day-1",
  "Observation and interpretation",
);
p.run(
  "INSERT INTO chapters VALUES(?,?,?,0)",
  "qa-chapter-2",
  "qa-day-2",
  "Evidence and decisions",
);
for (const [i, kind, title, content] of [
  [
    0,
    "reflection",
    "Observe before you explain",
    "QA material: describe what you can directly observe before offering an explanation.",
  ],
  [
    1,
    "exercise",
    "Separate observations from interpretations",
    "QA exercise: write one observation and one interpretation. Explain what evidence could distinguish between interpretations. Success criteria: label each clearly and identify a testable source of evidence.",
  ],
  [
    2,
    "reflection",
    "Bring your evidence forward",
    "QA material: revisit your observation after feedback.",
  ],
]) {
  const unit = `qa-unit-${i}`,
    version = `qa-version-${i}`;
  p.run(
    "INSERT INTO learning_units VALUES(?,?,?,?,?)",
    unit,
    i === 2 ? "qa-chapter-2" : "qa-chapter-1",
    i,
    kind,
    version,
  );
  p.run(
    "INSERT INTO unit_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    version,
    unit,
    1,
    title,
    content,
    1,
    1,
    1,
    null,
    0,
    null,
    now(),
  );
}
p.enroll({ id: "admin", role: "admin" }, "student", "qa-course");
p.run(
  "INSERT INTO staff_assignments VALUES(?,?,?)",
  "instructor",
  "student",
  "qa-course",
);
server.listen(3001, "127.0.0.1", () =>
  console.log(
    "Disposable browser QA: http://127.0.0.1:3001 · student@glitch.test / instructor@glitch.test · password: local-browser-test-only",
  ),
);
