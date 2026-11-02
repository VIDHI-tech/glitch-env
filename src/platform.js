import { id, now } from "./auth.js";
import { transaction } from "./db.js";
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new ApiError(status, message);
};
export function string(value, name, max = 20000, allowEmpty = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  )
    fail(400, `Invalid ${name}`);
  return value.trim();
}
export function mergeIntervals(intervals) {
  const result = [];
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1] + 0.05) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
export class Platform {
  constructor(db, clock = now) {
    this.db = db;
    this.clock = clock;
  }
  one(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  activity(student, unit, course, event, detail = "") {
    this.run(
      "INSERT INTO student_learning_activity VALUES(?,?,?,?,?,?,?)",
      id(),
      student,
      unit,
      course,
      event,
      detail,
      this.clock(),
    );
  }
  audit(actor, action, target, detail = "") {
    this.run(
      "INSERT INTO audit_log VALUES(?,?,?,?,?,?)",
      id(),
      actor,
      action,
      target,
      detail,
      this.clock(),
    );
  }
  admin(user) {
    if (user.role !== "admin") fail(403, "Administrator permission required");
  }
  student(user) {
    if (user.role !== "student") fail(403, "Student account required");
  }
  staff(user, studentId, courseId) {
    if (
      !["admin", "instructor"].includes(user.role) ||
      !this.one(
        "SELECT 1 FROM staff_assignments WHERE staff_id=? AND student_id=? AND course_id=?",
        user.id,
        studentId,
        courseId,
      )
    )
      fail(404, "Student record not found");
  }
  enrollment(student, course) {
    const e = this.one(
      "SELECT * FROM student_enrollments WHERE student_id=? AND course_id=? AND status=?",
      student,
      course,
      "active",
    );
    if (!e) fail(404, "Enrollment not found");
    return e;
  }
  units(enrollment) {
    return this.all(
      `SELECT u.id,u.kind,eu.position, v.id version_id,v.title,v.required,v.requires_review,v.duration,
      c.id chapter_id,c.title chapter_title,d.id day_id,d.title day_title,d.position day_position,w.title week_title,w.position week_position,
      COALESCE(p.status,'not_started') progress_status,
      (SELECT status FROM student_submissions s WHERE s.student_id=? AND s.unit_id=u.id ORDER BY attempt DESC LIMIT 1) submission_status,
      EXISTS(SELECT 1 FROM student_exercise_drafts dr WHERE dr.student_id=? AND dr.unit_id=u.id) has_draft,
      vp.last_position, vp.intervals,vp.reached_end,p.completed_at
      FROM enrollment_units eu JOIN learning_units u ON u.id=eu.unit_id JOIN unit_versions v ON v.id=eu.version_id
      JOIN chapters c ON c.id=u.chapter_id JOIN days d ON d.id=c.day_id JOIN weeks w ON w.id=d.week_id
      LEFT JOIN student_unit_progress p ON p.unit_id=u.id AND p.student_id=?
      LEFT JOIN student_video_progress vp ON vp.unit_id=u.id AND vp.student_id=?
      WHERE eu.enrollment_id=? ORDER BY eu.position`,
      enrollment.student_id,
      enrollment.student_id,
      enrollment.student_id,
      enrollment.student_id,
      enrollment.id,
    ).map((u, i, list) => {
      const completed = u.progress_status === "completed";
      const blocked = list
        .slice(0, i)
        .some((x) => x.required && x.progress_status !== "completed");
      const intervals = JSON.parse(u.intervals || "[]");
      return {
        ...u,
        intervals,
        last_position: u.last_position || 0,
        watched_percentage: u.duration
          ? Math.min(
              100,
              Math.round(
                (intervals.reduce((n, [a, b]) => n + b - a, 0) / u.duration) *
                  100,
              ),
            )
          : 0,
        state: completed ? "completed" : blocked ? "locked" : "available",
        exercise_status:
          u.submission_status || (u.has_draft ? "draft" : "not_started"),
      };
    });
  }
  context(student, unit, requireUnlocked = true) {
    const row = this.one(
      `SELECT e.* FROM student_enrollments e JOIN enrollment_units eu ON eu.enrollment_id=e.id WHERE e.student_id=? AND eu.unit_id=? AND e.status='active'`,
      student,
      unit,
    );
    if (!row) fail(404, "Learning unit not found");
    const item = this.units(row).find((u) => u.id === unit);
    if (requireUnlocked && item.state === "locked")
      fail(403, "Complete the earlier required learning unit first");
    const version = this.one(
      "SELECT * FROM unit_versions WHERE id=?",
      item.version_id,
    );
    if (
      requireUnlocked &&
      version.reveal_unit_id &&
      !this.one(
        "SELECT 1 FROM student_submissions WHERE student_id=? AND unit_id=?",
        student,
        version.reveal_unit_id,
      )
    )
      fail(
        403,
        "Submit the required first attempt before viewing this evidence",
      );
    return { enrollment: row, unit: item, version };
  }
  complete(student, ctx) {
    const old = this.one(
      "SELECT status FROM student_unit_progress WHERE student_id=? AND unit_id=?",
      student,
      ctx.unit.id,
    );
    if (old?.status === "completed") return;
    this.run(
      `INSERT INTO student_unit_progress VALUES(?,?,?,'completed',?,?) ON CONFLICT(student_id,unit_id) DO UPDATE SET status='completed',completed_at=excluded.completed_at,updated_at=excluded.updated_at`,
      student,
      ctx.unit.id,
      ctx.version.id,
      this.clock(),
      this.clock(),
    );
    this.activity(
      student,
      ctx.unit.id,
      ctx.enrollment.course_id,
      "completed",
      ctx.unit.title,
    );
  }
  courseProgress(enrollment) {
    const units = this.units(enrollment),
      required = units.filter((u) => u.required),
      done = required.filter((u) => u.state === "completed");
    const days = [...new Set(units.map((u) => u.day_id))].map((dayId) => {
      const list = units.filter((u) => u.day_id === dayId),
        req = list.filter((u) => u.required),
        count = req.filter((u) => u.state === "completed").length;
      return {
        id: dayId,
        title: list[0].day_title,
        week: list[0].week_title,
        completed: count,
        total: req.length,
        percentage: req.length ? Math.round((count / req.length) * 100) : 0,
      };
    });
    const current =
      units.find((u) => u.required && u.state === "available") ||
      units.find((u) => u.state === "available");
    return {
      ...enrollment,
      course: this.one(
        "SELECT * FROM courses WHERE id=?",
        enrollment.course_id,
      ),
      units,
      days,
      completed: done.length,
      total: required.length,
      remaining: required.length - done.length,
      percentage: required.length
        ? Math.round((done.length / required.length) * 100)
        : 0,
      completed_days: days.filter((d) => d.total > 0 && d.completed === d.total)
        .length,
      current: current || null,
      last_visited: units.find((u) => u.id === enrollment.last_unit_id) || null,
    };
  }
  dashboard(student, courseFilter) {
    const enrollments = this.all(
      "SELECT * FROM student_enrollments WHERE student_id=? AND status='active' ORDER BY created_at",
      student,
    ).filter((e) => !courseFilter || e.course_id === courseFilter);
    const courses = enrollments.map((e) => this.courseProgress(e));
    const history = this.all(
      "SELECT a.*,u.title unit_title FROM student_learning_activity a LEFT JOIN unit_versions u ON u.id=(SELECT version_id FROM enrollment_units eu JOIN student_enrollments e ON e.id=eu.enrollment_id WHERE e.student_id=a.student_id AND eu.unit_id=a.unit_id LIMIT 1) WHERE a.student_id=? ORDER BY a.created_at DESC LIMIT 100",
      student,
    ).filter((a) => !courseFilter || a.course_id === courseFilter);
    const feedback = this.all(
      `SELECT f.*,s.unit_id,s.attempt,v.title,st.name reviewer,c.course_id FROM submission_feedback f JOIN student_submissions s ON s.id=f.submission_id JOIN unit_versions v ON v.id=s.version_id JOIN users st ON st.id=f.reviewer_id JOIN learning_units u ON u.id=s.unit_id JOIN chapters ch ON ch.id=u.chapter_id JOIN days d ON d.id=ch.day_id JOIN weeks c ON c.id=d.week_id WHERE s.student_id=? ORDER BY f.created_at DESC LIMIT 30`,
      student,
    ).filter((f) => !courseFilter || f.course_id === courseFilter);
    return { courses, history, feedback };
  }
  lesson(student, unitId) {
    return transaction(this.db, () => {
      const ctx = this.context(student, unitId);
      if (
        ctx.version.reveal_unit_id &&
        !this.one(
          "SELECT 1 FROM student_submissions WHERE student_id=? AND unit_id=?",
          student,
          ctx.version.reveal_unit_id,
        )
      )
        fail(
          403,
          "Submit the required first attempt before viewing this evidence",
        );
      this.run(
        "UPDATE student_enrollments SET last_unit_id=? WHERE id=?",
        unitId,
        ctx.enrollment.id,
      );
      this.activity(
        student,
        unitId,
        ctx.enrollment.course_id,
        "visited",
        ctx.unit.title,
      );
      const draft = this.one(
        "SELECT * FROM student_exercise_drafts WHERE student_id=? AND unit_id=?",
        student,
        unitId,
      );
      const note = this.one(
        "SELECT * FROM student_notes WHERE student_id=? AND unit_id=?",
        student,
        unitId,
      );
      const submissions = this.submissions(student, unitId);
      return {
        ...ctx.unit,
        content: ctx.version.content,
        media_url: ctx.version.media_id
          ? `/api/files/${ctx.version.media_id}`
          : null,
        draft,
        note,
        submissions,
      };
    });
  }
  submissions(student, unitId) {
    return this.all(
      "SELECT * FROM student_submissions WHERE student_id=? AND unit_id=? ORDER BY attempt DESC",
      student,
      unitId,
    ).map((s) => ({
      ...s,
      feedback: this.all(
        "SELECT f.*,u.name reviewer FROM submission_feedback f JOIN users u ON u.id=f.reviewer_id WHERE submission_id=? ORDER BY created_at",
        s.id,
      ),
    }));
  }
  saveText(student, unitId, body, type) {
    return transaction(this.db, () => {
      const ctx = this.context(student, unitId);
      if (type === "draft" && ctx.unit.kind !== "exercise")
        fail(400, "This unit is not an exercise");
      const table =
          type === "draft" ? "student_exercise_drafts" : "student_notes",
        field = type === "draft" ? "answer" : "body";
      const content = string(body[field], field, 50000, true),
        old = this.one(
          `SELECT * FROM ${table} WHERE student_id=? AND unit_id=?`,
          student,
          unitId,
        );
      if (body.revision !== (old?.revision || 0))
        fail(
          409,
          "This work changed on another device. Reload before saving to avoid overwriting it.",
        );
      this.run(
        `INSERT INTO ${table} VALUES(?,?,?,?,?) ON CONFLICT(student_id,unit_id) DO UPDATE SET ${field}=excluded.${field},revision=excluded.revision,updated_at=excluded.updated_at`,
        student,
        unitId,
        content,
        (old?.revision || 0) + 1,
        this.clock(),
      );
      this.activity(student, unitId, ctx.enrollment.course_id, `${type}_saved`);
      return this.one(
        `SELECT * FROM ${table} WHERE student_id=? AND unit_id=?`,
        student,
        unitId,
      );
    });
  }
  submit(student, unitId, body) {
    return transaction(this.db, () => {
      const ctx = this.context(student, unitId);
      if (ctx.unit.kind !== "exercise")
        fail(400, "This unit is not an exercise");
      const old = this.one(
        "SELECT * FROM student_submissions WHERE student_id=? AND unit_id=? ORDER BY attempt DESC LIMIT 1",
        student,
        unitId,
      );
      if (old && old.status !== "needs_revision")
        fail(409, "This exercise is already submitted");
      const answer = string(body.answer, "answer", 50000),
        submissionId = id(),
        status = ctx.version.requires_review ? "submitted" : "completed";
      this.run(
        "INSERT INTO student_submissions VALUES(?,?,?,?,?,?,?,?)",
        submissionId,
        student,
        unitId,
        ctx.version.id,
        (old?.attempt || 0) + 1,
        answer,
        status,
        this.clock(),
      );
      this.run(
        "DELETE FROM student_exercise_drafts WHERE student_id=? AND unit_id=?",
        student,
        unitId,
      );
      this.activity(
        student,
        unitId,
        ctx.enrollment.course_id,
        "submitted",
        ctx.unit.title,
      );
      if (status === "completed") this.complete(student, ctx);
      return { id: submissionId, status };
    });
  }
  acknowledge(student, unitId) {
    return transaction(this.db, () => {
      const ctx = this.context(student, unitId);
      if (!["reflection", "feedback"].includes(ctx.unit.kind))
        fail(400, "This unit requires playback or exercise completion");
      if (
        ctx.version.reveal_unit_id &&
        !this.one(
          "SELECT 1 FROM student_submissions WHERE student_id=? AND unit_id=?",
          student,
          ctx.version.reveal_unit_id,
        )
      )
        fail(403, "Evidence is not yet available");
      this.complete(student, ctx);
      return { completed: true };
    });
  }
  startPlayback(student, unitId, position) {
    const ctx = this.context(student, unitId);
    if (ctx.unit.kind !== "video" || !ctx.version.media_id)
      fail(400, "Playable video required");
    if (
      !Number.isFinite(position) ||
      position < 0 ||
      position > ctx.version.duration
    )
      fail(400, "Invalid position");
    // One authoritative playback session per learner/unit prevents concurrent tabs inflating coverage.
    return transaction(this.db, () => {
      this.run(
        "DELETE FROM playback_sessions WHERE student_id=? AND unit_id=?",
        student,
        unitId,
      );
      const playbackId = id();
      this.run(
        "INSERT INTO playback_sessions VALUES(?,?,?,?,?,?)",
        playbackId,
        student,
        unitId,
        position,
        this.clock(),
        this.clock() + 3600000,
      );
      return { playbackId };
    });
  }
  heartbeat(student, unitId, body) {
    return transaction(this.db, () => {
      const ctx = this.context(student, unitId),
        duration = ctx.version.duration;
      const session = this.one(
        "SELECT * FROM playback_sessions WHERE id=? AND student_id=? AND unit_id=?",
        body.playbackId,
        student,
        unitId,
      );
      if (!session || session.expires_at < this.clock())
        fail(409, "Playback session expired or started on another device");
      const position = body.position;
      if (
        !Number.isFinite(position) ||
        position < 0 ||
        position > duration + 0.25
      )
        fail(400, "Invalid playback position");
      if (!["playing", "pause", "seek", "ended"].includes(body.event))
        fail(400, "Invalid playback event");
      const old = this.one(
        "SELECT * FROM student_video_progress WHERE student_id=? AND unit_id=?",
        student,
        unitId,
      );
      let intervals = JSON.parse(old?.intervals || "[]");
      const elapsed = (this.clock() - session.last_at) / 1000,
        delta = position - session.last_position;
      // Max supported rate 2x, bounded heartbeat gap. A seek is never counted as watched time.
      if (
        body.event !== "seek" &&
        delta > 0 &&
        elapsed > 0 &&
        elapsed <= 20 &&
        delta <= elapsed * 2 + 0.5
      )
        intervals = mergeIntervals([
          ...intervals,
          [session.last_position, Math.min(position, duration)],
        ]);
      const reachedEnd =
        !!old?.reached_end ||
        (body.event === "ended" &&
          position >= duration - 0.5 &&
          intervals.some(
            ([a, b]) => a <= duration - 0.5 && b >= duration - 0.25,
          ));
      const watched = intervals.reduce((n, [a, b]) => n + b - a, 0),
        completed = watched >= duration * 0.9 && reachedEnd;
      this.run(
        `INSERT INTO student_video_progress VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(student_id,unit_id) DO UPDATE SET last_position=excluded.last_position, intervals=excluded.intervals,reached_end=excluded.reached_end,revision=excluded.revision,updated_at=excluded.updated_at`,
        student,
        unitId,
        ctx.version.id,
        Math.min(position, duration),
        JSON.stringify(intervals),
        Number(reachedEnd),
        (old?.revision || 0) + 1,
        this.clock(),
      );
      this.run(
        "UPDATE playback_sessions SET last_position=?,last_at=? WHERE id=?",
        Math.min(position, duration),
        this.clock(),
        session.id,
      );
      this.run(
        `INSERT INTO student_unit_progress VALUES(?,?,?,'in_progress',NULL,?) ON CONFLICT(student_id,unit_id) DO UPDATE SET updated_at=excluded.updated_at`,
        student,
        unitId,
        ctx.version.id,
        this.clock(),
      );
      if (completed) this.complete(student, ctx);
      return {
        completed: completed || ctx.unit.state === "completed",
        last_position: position,
        watched_percentage: Math.min(
          100,
          Math.round((watched / duration) * 100),
        ),
        intervals,
      };
    });
  }
  work(student) {
    const enrich = (rows) =>
      rows.map((r) => ({
        ...r,
        ...this.one(
          `SELECT v.title unit_title,w.course_id,c.title course_title,d.title day_title FROM learning_units u JOIN enrollment_units eu ON eu.unit_id=u.id JOIN student_enrollments e ON e.id=eu.enrollment_id JOIN unit_versions v ON v.id=eu.version_id JOIN chapters ch ON ch.id=u.chapter_id JOIN days d ON d.id=ch.day_id JOIN weeks w ON w.id=d.week_id JOIN courses c ON c.id=w.course_id WHERE u.id=? AND e.student_id=?`,
          r.unit_id,
          student,
        ),
      }));
    return {
      drafts: enrich(
        this.all(
          "SELECT * FROM student_exercise_drafts WHERE student_id=? ORDER BY updated_at DESC",
          student,
        ),
      ),
      notes: enrich(
        this.all(
          "SELECT * FROM student_notes WHERE student_id=? ORDER BY updated_at DESC",
          student,
        ),
      ),
      submissions: enrich(
        this.all(
          "SELECT * FROM student_submissions WHERE student_id=? ORDER BY created_at DESC",
          student,
        ),
      ).map((s) => ({
        ...s,
        feedback: this.all(
          "SELECT * FROM submission_feedback WHERE submission_id=? ORDER BY created_at",
          s.id,
        ),
      })),
      artifacts: enrich(
        this.all(
          "SELECT a.*,f.name file_name FROM student_portfolio_artifacts a LEFT JOIN stored_files f ON f.id=a.file_id WHERE a.student_id=? ORDER BY a.updated_at DESC",
          student,
        ),
      ),
    };
  }
  history(student, cursor) {
    const previous = cursor
      ? this.one(
          "SELECT created_at,id FROM student_learning_activity WHERE student_id=? AND id=?",
          student,
          cursor,
        )
      : null;
    if (cursor && !previous) fail(404, "History page not found");
    const rows = previous
      ? this.all(
          "SELECT * FROM student_learning_activity WHERE student_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 51",
          student,
          previous.created_at,
          previous.created_at,
          previous.id,
        )
      : this.all(
          "SELECT * FROM student_learning_activity WHERE student_id=? ORDER BY created_at DESC,id DESC LIMIT 51",
          student,
        );
    return {
      items: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49].id : null,
    };
  }
  artifact(student, body) {
    const ctx = this.context(student, body.unit_id),
      title = string(body.title, "title", 200),
      content = string(body.body || "", "body", 100000, true),
      kind = body.kind || "deliverable";
    if (!["deliverable", "code", "project"].includes(kind))
      fail(400, "Invalid artifact kind");
    if (
      body.file_id &&
      !this.one(
        "SELECT 1 FROM stored_files WHERE id=? AND owner_id=? AND unit_id=? AND purpose='portfolio'",
        body.file_id,
        student,
        body.unit_id,
      )
    )
      fail(404, "File not found");
    return transaction(this.db, () => {
      const artifactId = body.id || id();
      if (body.id) {
        const old = this.one(
          "SELECT * FROM student_portfolio_artifacts WHERE id=? AND student_id=? AND unit_id=?",
          body.id,
          student,
          body.unit_id,
        );
        if (!old) fail(404, "Artifact not found");
        if (old.updated_at !== body.updated_at)
          fail(409, "Project changed on another device; reload before saving");
        this.run(
          "UPDATE student_portfolio_artifacts SET title=?,body=?,kind=?,updated_at=? WHERE id=?",
          title,
          content,
          kind,
          Math.max(this.clock(), old.updated_at + 1),
          artifactId,
        );
      } else
        this.run(
          "INSERT INTO student_portfolio_artifacts VALUES(?,?,?,?,?,?,?,?,?)",
          artifactId,
          student,
          body.unit_id,
          title,
          content,
          body.file_id || null,
          kind,
          this.clock(),
          this.clock(),
        );
      this.activity(
        student,
        body.unit_id,
        ctx.enrollment.course_id,
        "project_saved",
        title,
      );
      return this.one(
        "SELECT * FROM student_portfolio_artifacts WHERE id=?",
        artifactId,
      );
    });
  }
  enroll(actor, studentId, courseId) {
    this.admin(actor);
    if (
      !this.one("SELECT 1 FROM users WHERE id=? AND role='student'", studentId)
    )
      fail(404, "Student not found");
    if (!this.one("SELECT 1 FROM courses WHERE id=?", courseId))
      fail(404, "Course not found");
    return transaction(this.db, () => {
      let enrollment = this.one(
        "SELECT * FROM student_enrollments WHERE student_id=? AND course_id=?",
        studentId,
        courseId,
      );
      if (!enrollment) {
        const enrollmentId = id();
        this.run(
          "INSERT INTO student_enrollments VALUES(?,?,?,'active',NULL,?)",
          enrollmentId,
          studentId,
          courseId,
          this.clock(),
        );
        enrollment = this.one(
          "SELECT * FROM student_enrollments WHERE id=?",
          enrollmentId,
        );
      }
      this.run(
        "UPDATE student_enrollments SET status=? WHERE id=?",
        "active",
        enrollment.id,
      );
      this.run(
        "INSERT OR IGNORE INTO staff_assignments VALUES(?,?,?)",
        actor.id,
        studentId,
        courseId,
      );
      this.appendPublished(enrollment);
      this.audit(actor.id, "enroll_or_append", studentId, courseId);
      return enrollment;
    });
  }
  appendPublished(enrollment) {
    let position =
      this.one(
        "SELECT COALESCE(MAX(position),-1) n FROM enrollment_units WHERE enrollment_id=?",
        enrollment.id,
      ).n + 1;
    const units = this.all(
      `SELECT u.id,v.id version_id FROM learning_units u JOIN unit_versions v ON v.id=u.current_version_id JOIN chapters c ON c.id=u.chapter_id JOIN days d ON d.id=c.day_id JOIN weeks w ON w.id=d.week_id JOIN courses co ON co.id=w.course_id WHERE w.course_id=? AND v.published=1 AND co.published=1 ORDER BY w.position,d.position,c.position,u.position`,
      enrollment.course_id,
    );
    for (const u of units)
      if (
        !this.one(
          "SELECT 1 FROM enrollment_units WHERE enrollment_id=? AND unit_id=?",
          enrollment.id,
          u.id,
        )
      )
        this.run(
          "INSERT INTO enrollment_units VALUES(?,?,?,?)",
          enrollment.id,
          u.id,
          u.version_id,
          position++,
        );
  }
  review(actor, submissionId, body) {
    return transaction(this.db, () => {
      const submission = this.one(
        "SELECT * FROM student_submissions WHERE id=?",
        submissionId,
      );
      if (!submission) fail(404, "Submission not found");
      const ctx = this.context(
        submission.student_id,
        submission.unit_id,
        false,
      );
      this.staff(actor, submission.student_id, ctx.enrollment.course_id);
      if (submission.status !== "submitted")
        fail(409, "This submission has already been reviewed");
      if (!["completed", "needs_revision"].includes(body.decision))
        fail(400, "Invalid review decision");
      const message = string(body.message, "feedback", 20000);
      this.run(
        "INSERT INTO submission_feedback VALUES(?,?,?,?,?,?)",
        id(),
        submissionId,
        actor.id,
        message,
        body.decision,
        this.clock(),
      );
      this.run(
        "UPDATE student_submissions SET status=? WHERE id=?",
        body.decision,
        submissionId,
      );
      if (body.decision === "completed")
        this.complete(submission.student_id, ctx);
      this.activity(
        submission.student_id,
        submission.unit_id,
        ctx.enrollment.course_id,
        "feedback_received",
        body.decision,
      );
      this.audit(actor.id, "review", submissionId, body.decision);
      return { status: body.decision };
    });
  }
  fileAccess(actor, fileId) {
    const file = this.one("SELECT * FROM stored_files WHERE id=?", fileId);
    if (!file) fail(404, "File not found");
    if (file.purpose === "media") {
      if (actor.role === "admin" && file.owner_id === actor.id) return file;
      if (actor.role === "student") {
        const ctx = this.context(actor.id, file.unit_id);
        if (ctx.version.media_id !== fileId) fail(404, "File not found");
      } else {
        this.admin(actor);
      }
    } else if (file.owner_id !== actor.id) {
      const ctx = this.context(file.owner_id, file.unit_id, false);
      this.staff(actor, file.owner_id, ctx.enrollment.course_id);
    }
    return file;
  }
}
