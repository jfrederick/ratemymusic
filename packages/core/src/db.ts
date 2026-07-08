import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export type DatabaseType = Database.Database;

export function openDb(path = ":memory:"): DatabaseType {
  if (path !== ":memory:") {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(path);
  if (path !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}
