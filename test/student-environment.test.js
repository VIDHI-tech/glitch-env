import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createApplication } from "../src/server.js";
import { id, passwordHash } from "../src/auth.js";
let server,
  db,
  p,
  base,
  dir,
  clock = Date.now(),
  counter = 0;
const password = "strong-test-password-123";
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "glitch-tests-"));
  ({
    server,
    db,
    platform: p,
  } = createApplication({ dataDir: dir, clock: () => clock }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
async function request(path, actor, method = "GET", body, headers = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(actor ? { Cookie: actor.cookie, "X-CSRF-Token": actor.csrf } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  return {
    status: response.status,
    data: result,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function register(role = "student") {
  const n = ++counter,
    email = `person${n}@test.example`,
    r = await request("/api/auth/register", null, "POST", {
      name: `Learner ${n}`,
      email,
      password,
      role: "admin",
    });
  // Register rate limits are reset by the fixture; endpoint rate limiting has its own test.
  p.run("DELETE FROM rate_limits WHERE key LIKE 'register:%'");
  assert.equal(r.status, 201);
  assert.equal(r.data.role, "student");
  if (role !== "student")
    p.run("UPDATE users SET role=? WHERE id=?", role, r.data.id);
  return { ...r.data, cookie: r.cookie, email, role };
}
async function fixture(kinds = ["video", "exercise", "reflection"]) {
  const admin = await register("admin"),
    a = await register(),
    b = await register(),
    course = id(),
    week = id(),
    day1 = id(),
    day2 = id(),
    ch1 = id(),
    ch2 = id();
  p.run(
    "INSERT INTO courses VALUES(?,?,?,1)",
    course,
    "Test course",
    "A real test fixture",
  );
  p.run("INSERT INTO weeks VALUES(?,?,?,0)", week, course, "Week 1");
  p.run("INSERT INTO days VALUES(?,?,?,0)", day1, week, "Day 1");
  p.run("INSERT INTO days VALUES(?,?,?,1)", day2, week, "Day 2");
  p.run("INSERT INTO chapters VALUES(?,?,?,0)", ch1, day1, "Chapter 1");
  p.run("INSERT INTO chapters VALUES(?,?,?,0)", ch2, day2, "Chapter 2");
  const units = [];
  for (const [i, kind] of kinds.entries()) {
    const unit = id(),
      version = id(),
      media = kind === "video" ? id() : null;
    p.run(
      "INSERT INTO learning_units VALUES(?,?,?,?,?)",
      unit,
      i === kinds.length - 1 ? ch2 : ch1,
      i,
      kind,
      version,
    );
    if (media) {
      writeFileSync(join(dir, "files", media), "test-video-content");
      p.run(
        "INSERT INTO stored_files VALUES(?,?,?,?,?,?,?,?,?)",
        media,
        admin.id,
        unit,
        "lesson.mp4",
        "video/mp4",
        18,
        media,
        "media",
        clock,
      );
    }
    p.run(
      "INSERT INTO unit_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      version,
      unit,
      1,
      `Unit ${i + 1}`,
      "Reviewed content for testing",
      1,
      1,
      1,
      media,
      kind === "video" ? 180 : 0,
      null,
      clock,
    );
    units.push({ id: unit, version, media });
  }
  p.enroll(admin, a.id, course);
  p.enroll(admin, b.id, course);
  return { admin, a, b, course, units, day1, day2, ch1 };
}
async function watch(actor, unit) {
  const start = await request(`/api/units/${unit.id}/playback`, actor, "POST", {
    position: 0,
  });
  assert.equal(start.status, 200);
  let result;
  for (let position = 10; position <= 180; position += 10) {
    clock += 10000;
    result = await request(`/api/units/${unit.id}/heartbeat`, actor, "POST", {
      playbackId: start.data.playbackId,
      position,
      event: position === 180 ? "ended" : "playing",
    });
    assert.equal(result.status, 200);
  }
  return result;
}
async function dashboard(actor) {
  const r = await request("/api/dashboard", actor);
  assert.equal(r.status, 200);
  return r.data;
}

test("Registration automatically creates a private workspace and cannot create an admin", async () => {
  const student = await register();
  const d = await dashboard(student);
  assert.equal(d.courses.length, 0);
  assert.equal(d.history[0].event, "workspace_created");
  assert.equal((await request("/api/admin/catalog", student)).status, 403);
  assert.equal((await request("/api/dashboard")).status, 401);
});
test("1, 2, 6: Same course has independent unlocks, video progress, and percentages", async () => {
  const { a, b, units } = await fixture();
  assert.equal((await watch(a, units[0])).data.completed, true);
  const ad = (await dashboard(a)).courses[0],
    bd = (await dashboard(b)).courses[0];
  assert.equal(ad.units[1].state, "available");
  assert.equal(bd.units[1].state, "locked");
  assert.equal(ad.percentage, 33);
  assert.equal(bd.percentage, 0);
  assert.equal(ad.days[0].percentage, 50);
  assert.equal(bd.units[0].watched_percentage, 0);
});
test("3: Drafts survive logout and a new login session", async () => {
  const { a, units } = await fixture(["exercise", "reflection"]);
  const saved = await request(`/api/units/${units[0].id}/draft`, a, "POST", {
    answer: "My original draft",
    revision: 0,
  });
  assert.equal(saved.status, 200);
  assert.equal((await request("/api/auth/logout", a, "POST", {})).status, 200);
  assert.equal((await request("/api/work", a)).status, 401);
  const login = await request("/api/auth/login", null, "POST", {
    email: a.email,
    password,
  });
  assert.equal(login.status, 200);
  const second = { ...login.data, cookie: login.cookie };
  const lesson = await request(`/api/units/${units[0].id}`, second);
  assert.equal(lesson.data.draft.answer, "My original draft");
});
test("4: Last position and watched intervals resume at 2:15 across devices", async () => {
  const { a, units } = await fixture();
  const start = await request(`/api/units/${units[0].id}/playback`, a, "POST", {
    position: 0,
  });
  for (let pos = 15; pos <= 135; pos += 15) {
    clock += 15000;
    assert.equal(
      (
        await request(`/api/units/${units[0].id}/heartbeat`, a, "POST", {
          playbackId: start.data.playbackId,
          position: pos,
          event: "playing",
        })
      ).status,
      200,
    );
  }
  const login = await request("/api/auth/login", null, "POST", {
    email: a.email,
    password,
  });
  const other = { ...login.data, cookie: login.cookie };
  const r = await request(`/api/units/${units[0].id}`, other);
  assert.equal(r.data.last_position, 135);
  assert.deepEqual(r.data.intervals, [[0, 135]]);
  assert.equal(r.data.watched_percentage, 75);
});
test("Seek-to-end and client percentages cannot falsely complete video", async () => {
  const { a, units } = await fixture();
  const s = await request(`/api/units/${units[0].id}/playback`, a, "POST", {
    position: 0,
  });
  clock += 1000;
  const h = await request(`/api/units/${units[0].id}/heartbeat`, a, "POST", {
    playbackId: s.data.playbackId,
    position: 180,
    event: "ended",
    percentage: 100,
    student_id: a.id,
  });
  assert.equal(h.data.completed, false);
  assert.deepEqual(h.data.intervals, []);
  assert.equal((await dashboard(a)).courses[0].units[1].state, "locked");
  assert.equal(
    (await request(`/api/units/${units[0].id}/acknowledge`, a, "POST", {}))
      .status,
    400,
  );
});
test("5, 11: Notes, drafts, submissions, projects, files, and feedback remain private despite tampered identities", async () => {
  const { a, b, admin, units, course } = await fixture([
    "exercise",
    "reflection",
  ]);
  await request(`/api/units/${units[0].id}/note`, a, "POST", {
    body: "A secret note",
    revision: 0,
    student_id: b.id,
  });
  await request(`/api/units/${units[0].id}/draft`, a, "POST", {
    answer: "A secret draft",
    revision: 0,
  });
  const s = await request(`/api/units/${units[0].id}/submit`, a, "POST", {
    answer: "A secret submission",
  });
  await request(`/api/staff/submissions/${s.data.id}/review`, admin, "POST", {
    decision: "needs_revision",
    message: "Private feedback",
  });
  const file = id();
  writeFileSync(join(dir, "files", file), "private content");
  p.run(
    "INSERT INTO stored_files VALUES(?,?,?,?,?,?,?,?,?)",
    file,
    a.id,
    units[0].id,
    "work.txt",
    "text/plain",
    15,
    file,
    "portfolio",
    clock,
  );
  const artifact = await request("/api/artifacts", a, "POST", {
    title: "Private project",
    body: "Private code",
    kind: "code",
    unit_id: units[0].id,
    file_id: file,
  });
  assert.equal(artifact.status, 200);
  const work = await request(`/api/work?student_id=${a.id}`, b);
  assert.deepEqual(work.data, {
    drafts: [],
    notes: [],
    submissions: [],
    artifacts: [],
  });
  assert.equal((await request(`/api/files/${file}`, b)).status, 404);
  assert.equal(
    (
      await request("/api/artifacts", b, "POST", {
        id: artifact.data.id,
        title: "Stolen",
        body: "x",
        unit_id: units[0].id,
        updated_at: artifact.data.updated_at,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request("/api/artifacts", b, "POST", {
        title: "Stolen file",
        unit_id: units[0].id,
        file_id: file,
      })
    ).status,
    404,
  );
  assert.equal(
    (await request(`/api/staff/students/${a.id}/courses/${course}`, b)).status,
    404,
  );
  assert.equal(
    (
      await request(`/api/staff/submissions/${s.data.id}/review`, b, "POST", {
        decision: "completed",
        message: "Bypass",
      })
    ).status,
    404,
  );
  const own = await request("/api/work", a);
  assert.equal(own.data.notes[0].body, "A secret note");
  assert.equal(own.data.submissions[0].feedback[0].message, "Private feedback");
});
test("7, 8: Completed student revisits earlier lessons; unfinished student resumes correct required unit", async () => {
  const { a, b, units } = await fixture([
    "reflection",
    "reflection",
    "reflection",
  ]);
  for (const u of units)
    assert.equal(
      (await request(`/api/units/${u.id}/acknowledge`, a, "POST", {})).status,
      200,
    );
  const done = (await dashboard(a)).courses[0];
  assert.equal(done.current, null);
  assert.equal(done.percentage, 100);
  assert.equal(done.completed_days, 2);
  assert.equal((await request(`/api/units/${units[0].id}`, a)).status, 200);
  await request(`/api/units/${units[0].id}/acknowledge`, b, "POST", {});
  await request(`/api/units/${units[0].id}`, b);
  const unfinished = (await dashboard(b)).courses[0];
  assert.equal(unfinished.last_visited.id, units[0].id);
  assert.equal(unfinished.current.id, units[1].id);
  assert.equal((await request(`/api/units/${units[2].id}`, b)).status, 403);
});
test("9, 11: Staff may inspect and review only explicitly assigned students and courses", async () => {
  const { a, admin, course, units } = await fixture(["exercise", "reflection"]);
  const stranger = await register("admin"),
    instructor = await register("instructor");
  assert.equal(
    (await request(`/api/staff/students/${a.id}/courses/${course}`, stranger))
      .status,
    404,
  );
  assert.equal(
    (await request(`/api/staff/students/${a.id}/courses/${course}`, admin))
      .status,
    200,
  );
  const submitted = await request(
    `/api/units/${units[0].id}/submit`,
    a,
    "POST",
    { answer: "Evidence-based memo" },
  );
  assert.equal(
    (
      await request(
        `/api/staff/submissions/${submitted.data.id}/review`,
        instructor,
        "POST",
        { decision: "completed", message: "Good reasoning" },
      )
    ).status,
    404,
  );
  await request("/api/admin/assignments", admin, "POST", {
    staff_id: instructor.id,
    student_id: a.id,
    course_id: course,
  });
  assert.equal(
    (
      await request(
        `/api/staff/submissions/${submitted.data.id}/review`,
        instructor,
        "POST",
        { decision: "completed", message: "Good reasoning" },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/admin/enrollments", instructor, "POST", {
        student_id: a.id,
        course_id: course,
      })
    ).status,
    403,
  );
});
test("Subjective work stays locked until approval; originals and revisions survive feedback", async () => {
  const { a, admin, units } = await fixture(["exercise", "reflection"]);
  const first = await request(`/api/units/${units[0].id}/submit`, a, "POST", {
    answer: "Original evidence",
  });
  assert.equal(first.data.status, "submitted");
  assert.equal((await dashboard(a)).courses[0].units[1].state, "locked");
  await request(
    `/api/staff/submissions/${first.data.id}/review`,
    admin,
    "POST",
    { decision: "needs_revision", message: "Include source provenance" },
  );
  const second = await request(`/api/units/${units[0].id}/submit`, a, "POST", {
    answer: "Revised evidence with sources",
  });
  assert.equal(second.status, 200);
  await request(
    `/api/staff/submissions/${second.data.id}/review`,
    admin,
    "POST",
    { decision: "completed", message: "Meets the rubric" },
  );
  const lesson = await request(`/api/units/${units[0].id}`, a);
  assert.equal(lesson.data.submissions.length, 2);
  assert.equal(lesson.data.submissions[1].answer, "Original evidence");
  assert.equal(
    lesson.data.submissions[0].answer,
    "Revised evidence with sources",
  );
  assert.equal((await dashboard(a)).courses[0].units[1].state, "available");
  assert.equal(
    (
      await request(
        `/api/staff/submissions/${first.data.id}/review`,
        admin,
        "POST",
        { decision: "completed", message: "Stale approval" },
      )
    ).status,
    409,
  );
});
test("10: Publishing replacements preserves stable unit progress, pinned media, drafts and history", async () => {
  const { a, b, admin, units, course } = await fixture();
  await watch(a, units[0]);
  await request(`/api/units/${units[1].id}/draft`, a, "POST", {
    answer: "Retain my draft",
    revision: 0,
  });
  const replacement = id();
  p.run(
    "INSERT INTO unit_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    replacement,
    units[0].id,
    2,
    "Updated title",
    "Updated material",
    1,
    1,
    1,
    null,
    240,
    null,
    clock,
  );
  p.run(
    "UPDATE learning_units SET current_version_id=? WHERE id=?",
    replacement,
    units[0].id,
  );
  p.enroll(admin, a.id, course);
  const d = (await dashboard(a)).courses[0];
  assert.equal(d.units[0].state, "completed");
  assert.equal(d.units[0].version_id, units[0].version);
  assert.equal(d.units[0].watched_percentage, 100);
  assert.equal(
    (await request(`/api/units/${units[1].id}`, a)).data.draft.answer,
    "Retain my draft",
  );
  assert.equal((await dashboard(b)).courses[0].units[0].state, "available");
  const lesson = await request(`/api/units/${units[0].id}`, a);
  assert.equal(lesson.data.media_url, `/api/files/${units[0].media}`);
  assert.ok((await dashboard(a)).history.some((h) => h.event === "completed"));
});
test("Draft and note optimistic concurrency prevents stale devices overwriting saved work", async () => {
  const { a, units } = await fixture(["exercise"]);
  for (const action of ["draft", "note"]) {
    const field = action === "draft" ? "answer" : "body";
    assert.equal(
      (
        await request(`/api/units/${units[0].id}/${action}`, a, "POST", {
          [field]: "First device",
          revision: 0,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/api/units/${units[0].id}/${action}`, a, "POST", {
          [field]: "Stale device",
          revision: 0,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(`/api/units/${units[0].id}/${action}`, a, "POST", {
          [field]: "Second revision",
          revision: 1,
        })
      ).status,
      200,
    );
  }
});
test("Locked, draft, unenrolled and suspended content and media are protected server-side", async () => {
  const { a, b, admin, units, course } = await fixture(["reflection", "video"]);
  assert.equal((await request(`/api/units/${units[1].id}`, a)).status, 403);
  assert.equal((await request(`/api/files/${units[1].media}`, a)).status, 403);
  assert.equal(
    (
      await request(`/api/units/${units[1].id}/note`, a, "POST", {
        body: "Bypass",
        revision: 0,
      })
    ).status,
    403,
  );
  const outsider = await register();
  assert.equal(
    (await request(`/api/units/${units[0].id}`, outsider)).status,
    404,
  );
  await request("/api/admin/suspend", admin, "POST", {
    student_id: a.id,
    course_id: course,
  });
  assert.equal((await request(`/api/units/${units[0].id}`, a)).status, 404);
  assert.equal(
    (await request(`/api/units/${units[0].id}/acknowledge`, a, "POST", {}))
      .status,
    404,
  );
  assert.equal((await request(`/api/units/${units[0].id}`, b)).status, 200);
  const draft = id(),
    version = id();
  p.run(
    "INSERT INTO learning_units VALUES(?,?,?,?,?)",
    draft,
    p.one("SELECT chapter_id FROM learning_units WHERE id=?", units[0].id)
      .chapter_id,
    42,
    "reflection",
    version,
  );
  p.run(
    "INSERT INTO unit_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    version,
    draft,
    1,
    "Secret draft",
    "Unpublished content",
    1,
    0,
    1,
    null,
    0,
    null,
    clock,
  );
  p.enroll(admin, b.id, course);
  assert.equal((await request(`/api/units/${draft}`, b)).status, 404);
  assert.ok(!(await dashboard(b)).courses[0].units.some((u) => u.id === draft));
});
test("Hidden evidence requires first attempt even if the prerequisite is optional", async () => {
  const { a, units } = await fixture(["exercise", "feedback"]);
  p.run("UPDATE unit_versions SET required=0 WHERE id=?", units[0].version);
  p.run(
    "UPDATE unit_versions SET reveal_unit_id=? WHERE id=?",
    units[0].id,
    units[1].version,
  );
  assert.equal((await request(`/api/units/${units[1].id}`, a)).status, 403);
  assert.equal(
    (await request(`/api/units/${units[1].id}/acknowledge`, a, "POST", {}))
      .status,
    403,
  );
  await request(`/api/units/${units[0].id}/submit`, a, "POST", {
    answer: "First attempt",
  });
  assert.equal((await request(`/api/units/${units[1].id}`, a)).status, 200);
});
test("CSRF, hostile origins, role spoofing and malformed input cannot bypass ownership", async () => {
  const { a, units } = await fixture(["exercise"]);
  assert.equal(
    (
      await request(
        `/api/units/${units[0].id}/draft`,
        a,
        "POST",
        { answer: "attack", revision: 0 },
        { "X-CSRF-Token": "wrong" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/units/${units[0].id}/draft`,
        a,
        "POST",
        { answer: "attack", revision: 0 },
        { Origin: "https://attacker.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/api/units/${units[0].id}/submit`, a, "POST", {
        answer: { role: "admin" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/admin/catalog", a, "GET", undefined, {
        "X-Role": "admin",
        "X-Student-Id": a.id,
      })
    ).status,
    403,
  );
});
test("Concurrent playback sessions cannot inflate watched coverage and replayed intervals are distinct", async () => {
  const { a, b, units } = await fixture();
  const old = await request(`/api/units/${units[0].id}/playback`, a, "POST", {
    position: 0,
  });
  const fresh = await request(`/api/units/${units[0].id}/playback`, a, "POST", {
    position: 0,
  });
  clock += 10000;
  assert.equal(
    (
      await request(`/api/units/${units[0].id}/heartbeat`, a, "POST", {
        playbackId: old.data.playbackId,
        position: 10,
        event: "playing",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/api/units/${units[0].id}/heartbeat`, b, "POST", {
        playbackId: fresh.data.playbackId,
        position: 10,
        event: "playing",
      })
    ).status,
    409,
  );
  await request(`/api/units/${units[0].id}/heartbeat`, a, "POST", {
    playbackId: fresh.data.playbackId,
    position: 10,
    event: "playing",
  });
  await request(`/api/units/${units[0].id}/heartbeat`, a, "POST", {
    playbackId: fresh.data.playbackId,
    position: 0,
    event: "seek",
  });
  clock += 10000;
  const repeat = await request(
    `/api/units/${units[0].id}/heartbeat`,
    a,
    "POST",
    { playbackId: fresh.data.playbackId, position: 10, event: "playing" },
  );
  assert.deepEqual(repeat.data.intervals, [[0, 10]]);
});
test("Server restart preserves the database and sessions", async () => {
  const { a, units } = await fixture(["exercise"]);
  await request(`/api/units/${units[0].id}/draft`, a, "POST", {
    answer: "Durable on disk",
    revision: 0,
  });
  const other = createApplication({ dataDir: dir, clock: () => clock });
  await new Promise((r) => other.server.listen(0, "127.0.0.1", r));
  try {
    const response = await fetch(
      `http://127.0.0.1:${other.server.address().port}/api/work`,
      { headers: { Cookie: a.cookie } },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).drafts[0].answer, "Durable on disk");
  } finally {
    other.server.closeAllConnections();
    await new Promise((r) => other.server.close(r));
    other.db.close();
  }
});
test("Private file uploads persist, download with ownership checks and cannot be served as executable HTML", async () => {
  const { a, b, units } = await fixture(["exercise"]);
  const upload = await fetch(`${base}/api/files?unit=${units[0].id}`, {
    method: "POST",
    headers: {
      Cookie: a.cookie,
      "X-CSRF-Token": a.csrf,
      "X-File-Name": "project.html",
      "Content-Type": "text/html",
    },
    body: "<script>alert(1)</script>",
  });
  assert.equal(upload.status, 201);
  const file = await upload.json();
  const download = await fetch(`${base}/api/files/${file.id}`, {
    headers: { Cookie: a.cookie },
  });
  assert.equal(download.status, 200);
  assert.equal(
    download.headers.get("content-type"),
    "application/octet-stream",
  );
  assert.match(download.headers.get("content-disposition"), /^attachment/);
  assert.equal(await download.text(), "<script>alert(1)</script>");
  assert.equal((await request(`/api/files/${file.id}`, b)).status, 404);
});
test("Published curriculum append preserves completed sequence; pending required day controls next day", async () => {
  const { a, admin, units, course, ch1 } = await fixture([
    "reflection",
    "reflection",
  ]);
  await request(`/api/units/${units[0].id}/acknowledge`, a, "POST", {});
  const newUnit = id(),
    version = id();
  p.run(
    "INSERT INTO learning_units VALUES(?,?,?,?,?)",
    newUnit,
    ch1,
    4,
    "reflection",
    version,
  );
  p.run(
    "INSERT INTO unit_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    version,
    newUnit,
    1,
    "Newly assigned lesson",
    "Reviewed new material",
    1,
    1,
    1,
    null,
    0,
    null,
    clock,
  );
  p.enroll(admin, a.id, course);
  const d = (await dashboard(a)).courses[0];
  assert.deepEqual(
    d.units.map((u) => u.id),
    [units[0].id, units[1].id, newUnit],
  );
  assert.equal(d.units[0].state, "completed");
  assert.equal(d.current.id, units[1].id);
  assert.equal(d.units[2].state, "locked");
});
test("Admin content, hierarchy and enrollment endpoints support a complete text-learning workflow", async () => {
  const admin = await register("admin"),
    student = await register();
  let parent;
  for (const type of ["courses", "weeks", "days", "chapters"]) {
    const r = await request("/api/admin/hierarchy", admin, "POST", {
      type,
      title: `New ${type}`,
      parent_id: parent,
    });
    assert.equal(r.status, 201);
    parent = r.data.id;
    if (type === "courses") admin.course = parent;
  }
  const unit = await request("/api/admin/units", admin, "POST", {
    chapter_id: parent,
    kind: "exercise",
    title: "Decision memo",
    content: "Cite two observations and justify your recommendation.",
    requires_review: true,
  });
  assert.equal(unit.status, 201);
  assert.equal(
    (
      await request("/api/admin/publish", admin, "POST", {
        unit_id: unit.data.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/admin/enrollments", admin, "POST", {
        student_id: student.id,
        course_id: admin.course,
      })
    ).status,
    200,
  );
  const submission = await request(
    `/api/units/${unit.data.id}/submit`,
    student,
    "POST",
    {
      answer:
        "Observed queues and repeated questions. Recommend clearer signage.",
    },
  );
  assert.equal(submission.status, 200);
  assert.equal(
    (
      await request(
        `/api/staff/submissions/${submission.data.id}/review`,
        admin,
        "POST",
        {
          message: "Clear evidence and a defensible decision.",
          decision: "completed",
        },
      )
    ).status,
    200,
  );
  assert.equal((await dashboard(student)).courses[0].percentage, 100);
});
test("Progress endpoint rate limits return 429 without recording progress", async () => {
  const { a, units } = await fixture();
  p.run(
    "INSERT INTO rate_limits VALUES(?,?,?)",
    `video:${a.id}`,
    90,
    clock + 60000,
  );
  assert.equal(
    (
      await request(`/api/units/${units[0].id}/heartbeat`, a, "POST", {
        playbackId: id(),
        position: 10,
        event: "playing",
      })
    ).status,
    429,
  );
  assert.equal((await dashboard(a)).courses[0].percentage, 0);
});
test("Complete learning history is paginated and another student cannot use its cursor", async () => {
  const { a, b, units, course } = await fixture(["reflection"]);
  for (let i = 0; i < 55; i++)
    p.activity(a.id, units[0].id, course, "visited", `Activity ${i}`);
  const first = await request("/api/history", a);
  assert.equal(first.data.items.length, 50);
  assert.ok(first.data.next);
  const second = await request(`/api/history?cursor=${first.data.next}`, a);
  assert.ok(second.data.items.length >= 5);
  assert.equal(
    new Set([...first.data.items, ...second.data.items].map((a) => a.id)).size,
    first.data.items.length + second.data.items.length,
  );
  assert.equal(
    (await request(`/api/history?cursor=${first.data.next}`, b)).status,
    404,
  );
});

test(
  "Real MP4 import validates codecs, publishes a new version, and serves authenticated range requests",
  {
    skip:
      spawnSync("ffmpeg", ["-version"]).error !== undefined ||
      spawnSync("ffprobe", ["-version"]).error !== undefined,
  },
  async () => {
    const { admin, a, units, course } = await fixture(["video", "reflection"]);
    const file = join(dir, "actual-video.mp4");
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=128x72:r=1",
        "-t",
        "180",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-y",
        file,
      ],
      { timeout: 30000 },
    );
    execFileSync(
      process.execPath,
      ["scripts/manage.js", "import-media", units[0].id, file, admin.email],
      {
        cwd: resolve("."),
        env: { ...process.env, DATA_DIR: dir },
        timeout: 30000,
      },
    );
    const version = p.one(
      "SELECT * FROM unit_versions WHERE id=(SELECT current_version_id FROM learning_units WHERE id=?)",
      units[0].id,
    );
    assert.equal(version.duration, 180);
    assert.equal(version.published, 0);
    assert.notEqual(version.id, units[0].version);
    assert.equal(
      (
        await request("/api/admin/publish", admin, "POST", {
          unit_id: units[0].id,
        })
      ).status,
      200,
    );
    const newStudent = await register();
    p.enroll(admin, newStudent.id, course);
    const lesson = await request(`/api/units/${units[0].id}`, newStudent);
    assert.equal(lesson.data.media_url, `/api/files/${version.media_id}`);
    const range = await fetch(base + lesson.data.media_url, {
      headers: { Cookie: newStudent.cookie, Range: "bytes=0-31" },
    });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 32);
    assert.equal(range.headers.get("content-type"), "video/mp4");
    assert.equal(
      (await request(`/api/files/${version.media_id}`, a)).status,
      404,
    );
    assert.equal((await watch(newStudent, units[0])).data.completed, true);
  },
);
