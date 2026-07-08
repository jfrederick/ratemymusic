import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db.js";
import { PRIORITY, enqueue, markDone, markFailed, nextPending } from "../../src/ingest/frontier.js";

describe("frontier", () => {
  it("defines the documented per-kind priorities", () => {
    expect(PRIORITY).toEqual({
      collection: 100,
      album: 80,
      list: 60,
      "twin-collection": 40,
      "genre-page": 30,
      "new-music": 20,
    });
  });

  it("returns the highest-priority pending item first, then lowest id", () => {
    const db = openDb(":memory:");
    enqueue(db, "/genre/slowcore/", "genre-page");
    enqueue(db, "/list/someone/a-list/", "list");
    enqueue(db, "/collection/jimbof36/r5.0", "collection");
    enqueue(db, "/release/album/bon-iver/for-emma-forever-ago/", "album");

    expect(nextPending(db)).toMatchObject({
      url: "/collection/jimbof36/r5.0/",
      kind: "collection",
    });
  });

  it("orders same-priority items by lowest id (insertion order)", () => {
    const db = openDb(":memory:");
    enqueue(db, "/release/album/a/a/", "album");
    enqueue(db, "/release/album/b/b/", "album");

    expect(nextPending(db)?.url).toBe("/release/album/a/a/");
  });

  it("canonicalizes the url before enqueueing", () => {
    const db = openDb(":memory:");
    enqueue(db, "https://rateyourmusic.com/GENRE/Slowcore", "genre-page");
    expect(nextPending(db)?.url).toBe("/genre/slowcore/");
  });

  it("dedupes on enqueue (INSERT OR IGNORE), keeping the existing row's status", () => {
    const db = openDb(":memory:");
    enqueue(db, "/genre/slowcore/", "genre-page");
    const first = nextPending(db);
    expect(first).not.toBeNull();
    if (first) markDone(db, first.id);

    // Re-enqueueing the same (now done) url must not resurrect it as pending.
    enqueue(db, "/genre/slowcore/", "genre-page");
    expect(nextPending(db)).toBeNull();
  });

  it("markDone transitions a pending item out of the pending set", () => {
    const db = openDb(":memory:");
    enqueue(db, "/genre/slowcore/", "genre-page");
    const item = nextPending(db);
    expect(item).not.toBeNull();
    if (item) markDone(db, item.id);
    expect(nextPending(db)).toBeNull();
  });

  it("markFailed keeps status pending for the first two failures, then fails on the third", () => {
    const db = openDb(":memory:");
    enqueue(db, "/genre/slowcore/", "genre-page");
    const item = nextPending(db);
    expect(item).not.toBeNull();
    if (!item) throw new Error("unreachable");

    markFailed(db, item.id);
    expect(nextPending(db)).toMatchObject({ id: item.id });

    markFailed(db, item.id);
    expect(nextPending(db)).toMatchObject({ id: item.id });

    markFailed(db, item.id);
    expect(nextPending(db)).toBeNull();

    const row = db.prepare("SELECT status, attempts FROM scrape_queue WHERE id = ?").get(item.id);
    expect(row).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("priorityBoost raises an item above its kind's default priority", () => {
    const db = openDb(":memory:");
    enqueue(db, "/genre/slowcore/", "genre-page");
    enqueue(db, "/list/someone/a-list/", "list", 100);

    expect(nextPending(db)?.kind).toBe("list");
  });
});
