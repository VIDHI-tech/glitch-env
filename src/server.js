import http from "node:http";
import {
  mkdirSync,
  createReadStream,
  createWriteStream,
  statSync,
  unlinkSync,
} from "node:fs";
import { resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { openDatabase } from "./db.js";
import { Platform, ApiError, fail, string } from "./platform.js";
import {
  id,
  now,
  hash,
  passwordHash,
  verifyPassword,
  issueSession,
} from "./auth.js";
const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const dummyPassword = passwordHash("timing-equalization-only");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
export function createApplication({
  dataDir = resolve(process.env.DATA_DIR || "data"),
  db: providedDb,
  clock = now,
  origin = process.env.APP_ORIGIN,
  secure = process.env.NODE_ENV === "production",
} = {}) {
  mkdirSync(join(dataDir, "files"), { recursive: true });
  const db = providedDb || openDatabase(join(dataDir, "glitch.sqlite")),
    p = new Platform(db, clock);
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  async function body(req) {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      fail(415, "Expected JSON");
    let total = 0;
    const parts = [];
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 200000) fail(413, "Request too large");
      parts.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(parts).toString());
      if (!value || Array.isArray(value) || typeof value !== "object")
        fail(400, "Expected an object");
      return value;
    } catch {
      fail(400, "Invalid JSON");
    }
  }
  function rate(key, max, windowMs) {
    const old = p.one("SELECT * FROM rate_limits WHERE key=?", key);
    if (old && old.reset_at > clock() && old.count >= max)
      fail(429, "Too many requests; try again shortly");
    if (!old || old.reset_at <= clock())
      p.run(
        "INSERT INTO rate_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=1,reset_at=excluded.reset_at",
        key,
        1,
        clock() + windowMs,
      );
    else p.run("UPDATE rate_limits SET count=count+1 WHERE key=?", key);
  }
  function session(req) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("glitch_session="))
      ?.slice(15);
    if (!token) fail(401, "Sign in to continue");
    const row = p.one(
      "SELECT u.id,u.name,u.email,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
      hash(token),
      now(),
    );
    if (!row) fail(401, "Session expired; sign in again");
    return { ...row, token };
  }
  function originCheck(req) {
    const expected = origin || `http://${req.headers.host}`;
    if (req.headers.origin && req.headers.origin !== expected)
      fail(403, "Request origin is not allowed");
    if (req.headers["sec-fetch-site"] === "cross-site")
      fail(403, "Cross-site request rejected");
  }
  function setCookie(res, token) {
    res.setHeader(
      "Set-Cookie",
      `glitch_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600${secure ? "; Secure" : ""}`,
    );
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self'; script-src 'self'; media-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    res.setHeader("Cache-Control", "no-store");
    try {
      const url = new URL(req.url, "http://localhost"),
        path = url.pathname,
        method = req.method;
      if (!path.startsWith("/api/")) {
        if (method !== "GET") fail(405, "Method not allowed");
        const target = ["/app.js", "/style.css"].includes(path)
          ? join(publicDir, path)
          : join(publicDir, "index.html");
        res.writeHead(200, { "Content-Type": types[extname(target)] });
        createReadStream(target).pipe(res);
        return;
      }
      if (method !== "GET") originCheck(req);
      if (path === "/api/auth/register" && method === "POST") {
        rate(`register:${req.socket.remoteAddress}`, 10, 3600000);
        const b = await body(req),
          email = string(b.email, "email", 254).toLowerCase(),
          name = string(b.name, "name", 100),
          password = string(b.password, "password", 200);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12)
          fail(
            400,
            "Use a valid email and a password of at least 12 characters",
          );
        if (p.one("SELECT 1 FROM users WHERE email=?", email))
          fail(409, "Unable to create this account; try signing in");
        const userId = id();
        p.run(
          "INSERT INTO users VALUES(?,?,?,?,?,?)",
          userId,
          email,
          name,
          passwordHash(password),
          "student",
          now(),
        );
        p.activity(userId, null, null, "workspace_created");
        const auth = issueSession(db, userId);
        setCookie(res, auth.token);
        json(res, 201, {
          id: userId,
          name,
          email,
          role: "student",
          csrf: auth.csrf,
        });
        return;
      }
      if (path === "/api/auth/login" && method === "POST") {
        rate(`login:${req.socket.remoteAddress}`, 30, 900000);
        const b = await body(req),
          email = string(b.email, "email", 254),
          password = string(b.password, "password", 200);
        const user = p.one("SELECT * FROM users WHERE email=?", email);
        const valid = verifyPassword(
          password,
          user?.password_hash || dummyPassword,
        );
        if (!user || !valid) fail(401, "Email or password is incorrect");
        const auth = issueSession(db, user.id);
        setCookie(res, auth.token);
        json(res, 200, {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          csrf: auth.csrf,
        });
        return;
      }
      const user = session(req);
      if (method !== "GET" && req.headers["x-csrf-token"] !== user.csrf)
        fail(403, "Invalid request token; reload this page");
      rate(`api:${user.id}`, 600, 60000);
      if (path === "/api/me" && method === "GET") {
        const { token, ...safe } = user;
        json(res, 200, safe);
        return;
      }
      if (path === "/api/auth/logout" && method === "POST") {
        p.run("DELETE FROM sessions WHERE token_hash=?", hash(user.token));
        res.setHeader(
          "Set-Cookie",
          `glitch_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
        );
        json(res, 200, { ok: true });
        return;
      }
      if (path === "/api/dashboard" && method === "GET") {
        p.student(user);
        json(res, 200, p.dashboard(user.id));
        return;
      }
      if (path === "/api/work" && method === "GET") {
        p.student(user);
        json(res, 200, p.work(user.id));
        return;
      }
      if (path === "/api/history" && method === "GET") {
        p.student(user);
        json(res, 200, p.history(user.id, url.searchParams.get("cursor")));
        return;
      }
      if (path === "/api/artifacts" && method === "POST") {
        p.student(user);
        json(res, 200, p.artifact(user.id, await body(req)));
        return;
      }
      let match = path.match(
        /^\/api\/units\/([^/]+)(?:\/(draft|note|submit|acknowledge|playback|heartbeat))?$/,
      );
      if (match) {
        p.student(user);
        const [, unitId, action] = match;
        if (method === "GET" && !action) {
          json(res, 200, p.lesson(user.id, unitId));
          return;
        }
        if (method === "POST") {
          const b = await body(req);
          let result;
          if (["draft", "note"].includes(action))
            result = p.saveText(user.id, unitId, b, action);
          else if (action === "submit") result = p.submit(user.id, unitId, b);
          else if (action === "acknowledge")
            result = p.acknowledge(user.id, unitId);
          else if (action === "playback")
            result = p.startPlayback(user.id, unitId, b.position);
          else if (action === "heartbeat") {
            rate(`video:${user.id}`, 90, 60000);
            result = p.heartbeat(user.id, unitId, b);
          } else fail(404, "Endpoint not found");
          json(res, 200, result);
          return;
        }
      }
      if (path === "/api/files" && method === "POST") {
        p.student(user);
        const unitId = url.searchParams.get("unit");
        p.context(user.id, unitId);
        const filename = string(req.headers["x-file-name"], "file name", 200),
          mime = req.headers["content-type"] || "application/octet-stream";
        if (
          !/\.(pdf|txt|md|csv|json|png|jpe?g|webp|zip|py|js|ts|html|css)$/i.test(
            filename,
          )
        )
          fail(400, "Unsupported file extension");
        const fileId = id(),
          key = id(),
          destination = join(dataDir, "files", key);
        let total = 0;
        const limit = new Transform({
          transform(chunk, encoding, callback) {
            total += chunk.length;
            if (total > 20 * 1024 * 1024)
              callback(new ApiError(413, "Files must be 20 MB or smaller"));
            else callback(null, chunk);
          },
        });
        try {
          await pipeline(
            req,
            limit,
            createWriteStream(destination, { flags: "wx", mode: 0o600 }),
          );
          if (!total) fail(400, "Empty file");
        } catch (e) {
          try {
            unlinkSync(destination);
          } catch {}
          throw e;
        }
        p.run(
          "INSERT INTO stored_files VALUES(?,?,?,?,?,?,?,?,?)",
          fileId,
          user.id,
          unitId,
          filename,
          mime,
          total,
          key,
          "portfolio",
          clock(),
        );
        json(res, 201, { id: fileId, name: filename, size: total });
        return;
      }
      match = path.match(/^\/api\/files\/([^/]+)$/);
      if (match && method === "GET") {
        const f = p.fileAccess(user, match[1]),
          file = join(dataDir, "files", f.storage_key),
          size = statSync(file).size;
        const headers = {
          "Content-Type":
            f.purpose === "media" ? "video/mp4" : "application/octet-stream",
          "Content-Disposition": `${f.purpose === "media" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name).replace(/'/g, "%27")}`,
          "Accept-Ranges": "bytes",
        };
        const range = req.headers.range;
        if (range) {
          const m = range.match(/^bytes=(\d+)-(\d*)$/);
          if (!m) fail(416, "Invalid range");
          const start = Number(m[1]),
            end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
          if (start > end || start >= size) fail(416, "Invalid range");
          res.writeHead(206, {
            ...headers,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": end - start + 1,
          });
          createReadStream(file, { start, end }).pipe(res);
        } else {
          res.writeHead(200, { ...headers, "Content-Length": size });
          createReadStream(file).pipe(res);
        }
        return;
      }
      if (path === "/api/staff" && method === "GET") {
        if (!["admin", "instructor"].includes(user.role))
          fail(403, "Staff permission required");
        const students = p.all(
          `SELECT u.id,u.name,u.email,a.course_id,c.title course_title,e.status FROM staff_assignments a JOIN users u ON u.id=a.student_id JOIN courses c ON c.id=a.course_id LEFT JOIN student_enrollments e ON e.student_id=u.id AND e.course_id=c.id WHERE a.staff_id=?`,
          user.id,
        );
        const submissions = p.all(
          `SELECT s.*,v.title,u.name student_name FROM student_submissions s JOIN unit_versions v ON v.id=s.version_id JOIN learning_units lu ON lu.id=s.unit_id JOIN chapters ch ON ch.id=lu.chapter_id JOIN days d ON d.id=ch.day_id JOIN weeks w ON w.id=d.week_id JOIN staff_assignments a ON a.student_id=s.student_id AND a.course_id=w.course_id JOIN users u ON u.id=s.student_id WHERE a.staff_id=? AND s.status='submitted' ORDER BY s.created_at`,
          user.id,
        );
        json(res, 200, { students, submissions });
        return;
      }
      match = path.match(/^\/api\/staff\/students\/([^/]+)\/courses\/([^/]+)$/);
      if (match && method === "GET") {
        p.staff(user, match[1], match[2]);
        json(res, 200, p.dashboard(match[1], match[2]));
        return;
      }
      match = path.match(/^\/api\/staff\/submissions\/([^/]+)\/review$/);
      if (match && method === "POST") {
        json(res, 200, p.review(user, match[1], await body(req)));
        return;
      }
      if (path.startsWith("/api/admin/")) {
        p.admin(user);
        if (path === "/api/admin/catalog" && method === "GET") {
          json(res, 200, {
            courses: p.all("SELECT * FROM courses"),
            weeks: p.all("SELECT * FROM weeks"),
            days: p.all("SELECT * FROM days"),
            chapters: p.all("SELECT * FROM chapters"),
            units: p.all(
              "SELECT u.*,v.title,v.published,v.content,v.requires_review,v.required,v.media_id,v.duration FROM learning_units u JOIN unit_versions v ON v.id=u.current_version_id",
            ),
            students: p.all(
              "SELECT id,name,email FROM users WHERE role='student'",
            ),
            staff: p.all(
              "SELECT id,name,role FROM users WHERE role!='student'",
            ),
          });
          return;
        }
        if (path === "/api/admin/enrollments" && method === "POST") {
          const b = await body(req);
          json(res, 200, p.enroll(user, b.student_id, b.course_id));
          return;
        }
        if (path === "/api/admin/suspend" && method === "POST") {
          const b = await body(req);
          p.staff(user, b.student_id, b.course_id);
          p.run(
            "UPDATE student_enrollments SET status='suspended' WHERE student_id=? AND course_id=?",
            b.student_id,
            b.course_id,
          );
          p.audit(user.id, "suspend", b.student_id, b.course_id);
          json(res, 200, { ok: true });
          return;
        }
        if (path === "/api/admin/assignments" && method === "POST") {
          const b = await body(req);
          if (
            !p.one(
              "SELECT 1 FROM users WHERE id=? AND role IN ('admin','instructor')",
              b.staff_id,
            ) ||
            !p.one(
              "SELECT 1 FROM student_enrollments WHERE student_id=? AND course_id=?",
              b.student_id,
              b.course_id,
            )
          )
            fail(400, "Valid staff member and enrollment required");
          p.run(
            "INSERT OR IGNORE INTO staff_assignments VALUES(?,?,?)",
            b.staff_id,
            b.student_id,
            b.course_id,
          );
          p.audit(
            user.id,
            "assign_staff",
            b.staff_id,
            `${b.student_id}:${b.course_id}`,
          );
          json(res, 200, { ok: true });
          return;
        }
        if (path === "/api/admin/hierarchy" && method === "POST") {
          const b = await body(req),
            title = string(b.title, "title", 200),
            newId = id();
          const parents = {
            weeks: ["courses", "course_id"],
            days: ["weeks", "week_id"],
            chapters: ["days", "day_id"],
          };
          if (b.type === "courses")
            p.run(
              "INSERT INTO courses VALUES(?,?,?,0)",
              newId,
              title,
              string(b.description || "", "description", 2000, true),
            );
          else if (parents[b.type]) {
            const [parent, key] = parents[b.type];
            if (!p.one(`SELECT 1 FROM ${parent} WHERE id=?`, b.parent_id))
              fail(400, "Invalid parent");
            const pos = p.one(
              `SELECT COALESCE(MAX(position),-1)+1 n FROM ${b.type} WHERE ${key}=?`,
              b.parent_id,
            ).n;
            p.run(
              `INSERT INTO ${b.type} VALUES(?,?,?,?)`,
              newId,
              b.parent_id,
              title,
              pos,
            );
          } else fail(400, "Invalid hierarchy type");
          p.audit(user.id, "create_content", newId, b.type);
          json(res, 201, { id: newId });
          return;
        }
        if (path === "/api/admin/units" && method === "POST") {
          const b = await body(req),
            title = string(b.title, "title", 200),
            content = string(b.content || "", "content", 50000, true);
          if (!["video", "exercise", "reflection", "feedback"].includes(b.kind))
            fail(400, "Invalid unit type");
          if (!p.one("SELECT 1 FROM chapters WHERE id=?", b.chapter_id))
            fail(400, "Invalid chapter");
          const unitId = b.id || id(),
            existing = b.id
              ? p.one("SELECT * FROM learning_units WHERE id=?", b.id)
              : null;
          if (b.id && !existing) fail(404, "Unit not found");
          const previousVersion = existing
            ? p.one(
                "SELECT * FROM unit_versions WHERE id=?",
                existing.current_version_id,
              )
            : null;
          if (
            existing &&
            (existing.kind !== b.kind || existing.chapter_id !== b.chapter_id)
          )
            fail(400, "Stable units retain their type and chapter");
          const versionId = id(),
            version = p.one(
              "SELECT COALESCE(MAX(version),0)+1 n FROM unit_versions WHERE unit_id=?",
              unitId,
            ).n;
          db.exec("BEGIN IMMEDIATE");
          try {
            if (!existing) {
              const pos = p.one(
                "SELECT COALESCE(MAX(position),-1)+1 n FROM learning_units WHERE chapter_id=?",
                b.chapter_id,
              ).n;
              p.run(
                "INSERT INTO learning_units VALUES(?,?,?,?,NULL)",
                unitId,
                b.chapter_id,
                pos,
                b.kind,
              );
            }
            p.run(
              "INSERT INTO unit_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
              versionId,
              unitId,
              version,
              title,
              content,
              b.required === undefined
                ? (previousVersion?.required ?? 1)
                : b.required === false
                  ? 0
                  : 1,
              0,
              b.requires_review === false ? 0 : 1,
              previousVersion?.media_id ?? null,
              previousVersion?.duration ?? 0,
              previousVersion?.reveal_unit_id ?? null,
              clock(),
            );
            p.run(
              "UPDATE learning_units SET current_version_id=? WHERE id=?",
              versionId,
              unitId,
            );
            p.audit(user.id, "save_draft_version", unitId, String(version));
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
          json(res, 201, { id: unitId, version_id: versionId });
          return;
        }
        if (path === "/api/admin/publish" && method === "POST") {
          const b = await body(req),
            v = p.one(
              "SELECT v.*,u.kind FROM unit_versions v JOIN learning_units u ON u.current_version_id=v.id WHERE u.id=?",
              b.unit_id,
            );
          if (!v) fail(404, "Unit not found");
          if (
            !v.content.trim() ||
            v.content.startsWith("DRAFT PLANNING METADATA")
          )
            fail(
              400,
              "Replace planning metadata with reviewed teaching instructions before publication",
            );
          if (
            v.kind === "video" &&
            (!v.media_id || v.duration < 180 || v.duration > 300)
          )
            fail(
              400,
              "A validated 3–5 minute playable MP4 is required; import it using the operator media command",
            );
          p.run("UPDATE unit_versions SET published=1 WHERE id=?", v.id);
          p.run(
            `UPDATE courses SET published=1 WHERE id=(SELECT w.course_id FROM learning_units u JOIN chapters c ON c.id=u.chapter_id JOIN days d ON d.id=c.day_id JOIN weeks w ON w.id=d.week_id WHERE u.id=?)`,
            b.unit_id,
          );
          p.audit(user.id, "publish", b.unit_id, v.id);
          json(res, 200, { ok: true });
          return;
        }
      }
      fail(404, "Endpoint not found");
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error(error);
      if (!res.headersSent && !res.destroyed)
        json(res, status, {
          error:
            status === 500
              ? "An unexpected server error occurred"
              : error.message,
        });
      else if (!res.destroyed) res.end();
    }
  });
  server.requestTimeout = 120000;
  return { server, db, platform: p };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.env.NODE_ENV === "production" && !process.env.APP_ORIGIN)
    throw new Error("APP_ORIGIN is required in production");
  const { server } = createApplication();
  const port = Number(process.env.PORT || 3000),
    host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () =>
    console.log(`GLITCH is ready at http://${host}:${port}`),
  );
}
