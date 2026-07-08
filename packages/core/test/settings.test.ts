import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { getSetting, setSetting } from "../src/settings.js";

describe("settings", () => {
  it("returns null for a missing key", () => {
    const db = openDb(":memory:");
    expect(getSetting(db, "does-not-exist")).toBeNull();
    db.close();
  });

  it("roundtrips an object value", () => {
    const db = openDb(":memory:");
    const value = { foo: "bar", nested: [1, 2, 3] };
    setSetting(db, "my-key", value);
    expect(getSetting(db, "my-key")).toEqual(value);
    db.close();
  });

  it("overwrites an existing value", () => {
    const db = openDb(":memory:");
    setSetting(db, "counter", 1);
    expect(getSetting(db, "counter")).toBe(1);
    setSetting(db, "counter", 2);
    expect(getSetting(db, "counter")).toBe(2);
    db.close();
  });
});
