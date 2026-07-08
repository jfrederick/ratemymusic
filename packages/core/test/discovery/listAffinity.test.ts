import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db.js";
import { computeListAffinities } from "../../src/discovery/listAffinity.js";
import {
  replaceListItems,
  upsertAlbum,
  upsertList,
  upsertMyRating,
} from "../../src/ingest/upserts.js";

function album(db: ReturnType<typeof openDb>, n: string) {
  return upsertAlbum(db, {
    rymUrl: `/release/album/${n}/${n}/`,
    artist: n,
    title: n,
    year: 2000,
  });
}

describe("computeListAffinities", () => {
  it("hand-computed: a 4-item list with 2 rated items (5.0, 4.0) -> (6.25+2.25)/sqrt(4) = 4.25", () => {
    const db = openDb(":memory:");
    const a1 = album(db, "a1");
    const a2 = album(db, "a2");
    const a3 = album(db, "a3");
    const a4 = album(db, "a4");
    const listId = upsertList(db, { rymUrl: "/list/x/y/", title: "Y", author: "x" });
    replaceListItems(db, listId, [a1, a2, a3, a4]);
    upsertMyRating(db, a1, 5.0, "2020-01-01");
    upsertMyRating(db, a2, 4.0, "2020-01-01");

    const affinities = computeListAffinities(db);
    expect(affinities.get(listId)).toBeCloseTo((6.25 + 2.25) / Math.sqrt(4));

    const row = db.prepare("SELECT affinity FROM lists WHERE id = ?").get(listId) as {
      affinity: number;
    };
    expect(row.affinity).toBeCloseTo((6.25 + 2.25) / Math.sqrt(4));
  });

  it("a list with only 1 rated-overlap item gets affinity 0 (noise floor)", () => {
    const db = openDb(":memory:");
    const a1 = album(db, "a1");
    const a2 = album(db, "a2");
    const listId = upsertList(db, { rymUrl: "/list/x/y/", title: "Y", author: "x" });
    replaceListItems(db, listId, [a1, a2]);
    upsertMyRating(db, a1, 5.0, "2020-01-01");

    const affinities = computeListAffinities(db);
    expect(affinities.get(listId)).toBe(0);

    const row = db.prepare("SELECT affinity FROM lists WHERE id = ?").get(listId) as {
      affinity: number;
    };
    expect(row.affinity).toBe(0);
  });

  it("a list with 0 rated-overlap items gets affinity 0", () => {
    const db = openDb(":memory:");
    const a1 = album(db, "a1");
    const listId = upsertList(db, { rymUrl: "/list/x/y/", title: "Y", author: "x" });
    replaceListItems(db, listId, [a1]);

    const affinities = computeListAffinities(db);
    expect(affinities.get(listId)).toBe(0);
  });
});
