import type { DatabaseType } from "./db.js";

export function getSetting<T>(db: DatabaseType, key: string): T | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (row === undefined) return null;
  return JSON.parse(row.value) as T;
}

export function setSetting<T>(db: DatabaseType, key: string, value: T): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}
