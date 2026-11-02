import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
export const id = () => randomUUID();
export const now = () => Date.now();
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password, value) {
  const [salt, stored] = value.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(stored, "hex"),
  );
}
export function issueSession(db, userId) {
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
    hash(token),
    userId,
    csrf,
    now() + 1000 * 60 * 60 * 24 * 14,
  );
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now());
  return { token, csrf };
}
