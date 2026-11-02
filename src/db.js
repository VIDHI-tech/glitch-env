import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
export function openDatabase(path) {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)");
  if (
    !db
      .prepare("SELECT name FROM migrations WHERE name=?")
      .get("001_student_environment")
  ) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(
        readFileSync(
          fileURLToPath(
            new URL(
              "../migrations/001_student_environment.sql",
              import.meta.url,
            ),
          ),
          "utf8",
        ),
      );
      db.prepare("INSERT INTO migrations(name) VALUES(?)").run(
        "001_student_environment",
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return db;
}
export function transaction(db, action) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
