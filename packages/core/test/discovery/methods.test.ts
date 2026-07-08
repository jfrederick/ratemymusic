import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db.js";
import type { DatabaseType } from "../../src/db.js";
import {
  descriptorMethod,
  genreMethod,
  listMethod,
  newMethod,
  twinMethod,
} from "../../src/discovery/methods.js";
import { ratingWeight } from "../../src/discovery/weights.js";
import {
  replaceChartItems,
  replaceListItems,
  upsertAlbum,
  upsertChart,
  upsertList,
  upsertMyRating,
  upsertTwin,
  upsertTwinRating,
} from "../../src/ingest/upserts.js";
import type { TasteProfile } from "../../src/types.js";

function album(
  db: DatabaseType,
  n: string,
  opts?: { genres?: string[]; descriptors?: string[]; year?: number | null },
) {
  return upsertAlbum(db, {
    rymUrl: `/release/album/${n}/${n}/`,
    artist: n,
    title: n,
    year: opts?.year ?? 2000,
    genres: opts?.genres,
    descriptors: opts?.descriptors,
  });
}

function emptyProfile(): TasteProfile {
  return { genres: {}, descriptors: {}, eras: {}, computedAt: new Date().toISOString() };
}

describe("listMethod", () => {
  it("sums affinity across containing lists, excludes known albums, and normalizes to the max", () => {
    const db = openDb(":memory:");
    const list1 = upsertList(db, { rymUrl: "/list/1/1/", title: "L1", author: "x" });
    const list2 = upsertList(db, { rymUrl: "/list/2/2/", title: "L2", author: "x" });
    db.prepare("UPDATE lists SET affinity = 2 WHERE id = ?").run(list1);
    db.prepare("UPDATE lists SET affinity = 3 WHERE id = ?").run(list2);

    const x = album(db, "x"); // on both lists: sum = 5 (max)
    const y = album(db, "y"); // on list1 only: sum = 2
    const known = album(db, "known"); // on list1 too, but already rated -> excluded
    replaceListItems(db, list1, [x, y, known]);
    replaceListItems(db, list2, [x]);
    upsertMyRating(db, known, 5.0, "2020-01-01");

    const result = listMethod(db);

    expect(result.has(known)).toBe(false);
    expect(result.get(x)?.score).toBeCloseTo(1);
    expect(result.get(y)?.score).toBeCloseTo(2 / 5);

    const evidence = result.get(x)?.evidence;
    expect(evidence?.method).toBe("list");
    if (evidence?.method === "list") {
      expect(evidence.lists.map((l) => l.affinity)).toEqual([3, 2]); // sorted desc
    }
  });

  it("returns an empty map when no lists have positive affinity", () => {
    const db = openDb(":memory:");
    upsertList(db, { rymUrl: "/list/1/1/", title: "L1", author: "x" });
    expect(listMethod(db).size).toBe(0);
  });
});

describe("twinMethod", () => {
  it("computes+persists twin affinity, applies the >=4.0 rating threshold, and excludes known albums", () => {
    const db = openDb(":memory:");
    const co1 = album(db, "co1");
    const co2 = album(db, "co2");
    const high = album(db, "high"); // bob rates 5.0 -> counts
    const low = album(db, "low"); // bob rates 3.5 -> excluded despite positive affinity
    const knownAlbum = album(db, "knownAlbum");

    upsertMyRating(db, co1, 5.0, "2020-01-01");
    upsertMyRating(db, co2, 4.0, "2020-01-01");
    upsertMyRating(db, knownAlbum, 4.0, "2020-01-01");

    upsertTwin(db, "bob");
    upsertTwinRating(db, "bob", co1, 4.5);
    upsertTwinRating(db, "bob", co2, 3.0);
    upsertTwinRating(db, "bob", high, 5.0);
    upsertTwinRating(db, "bob", low, 3.5);
    upsertTwinRating(db, "bob", knownAlbum, 5.0);

    // bob's affinity: sum(min(ratingWeight(mine), ratingWeight(theirs))) over co-rated / sqrt(count(all twin_ratings rows))
    // co-rated albums are co1, co2, AND knownAlbum (bob also rated the album I've already rated).
    const sum =
      Math.min(ratingWeight(5.0), ratingWeight(4.5)) + // co1: mine 5.0, bob 4.5
      Math.min(ratingWeight(4.0), ratingWeight(3.0)) + // co2: mine 4.0, bob 3.0
      Math.min(ratingWeight(4.0), ratingWeight(5.0)); // knownAlbum: mine 4.0, bob 5.0
    const expectedAffinity = sum / Math.sqrt(5); // co1, co2, high, low, knownAlbum

    const result = twinMethod(db);

    const row = db.prepare("SELECT affinity FROM twins WHERE username = 'bob'").get() as {
      affinity: number;
    };
    expect(row.affinity).toBeCloseTo(expectedAffinity);

    expect(result.has(low)).toBe(false); // rating < 4.0 contributes nothing
    expect(result.has(knownAlbum)).toBe(false); // known album never a candidate

    expect(result.get(high)?.score).toBeCloseTo(1); // sole nonzero score -> normalized to 1
    const evidence = result.get(high)?.evidence;
    expect(evidence?.method).toBe("twin");
    if (evidence?.method === "twin") {
      expect(evidence.twins).toEqual([
        { username: "bob", affinity: expectedAffinity, rating: 5.0 },
      ]);
    }
  });
});

describe("genreMethod", () => {
  it("hand-computed: decay(1) vs decay(11) ratio survives normalization, matching case-insensitively", () => {
    const db = openDb(":memory:");
    const profile = { ...emptyProfile(), genres: { X: 0.8 } };
    const chartId = upsertChart(db, {
      rymUrl: "/genre/x/",
      kind: "genre-page",
      params: { genre: "x" },
    });
    const item1 = album(db, "item1");
    const item2 = album(db, "item2");
    // Explicit positions (1 and 11) -- replaceChartItems would assign array-index positions instead.
    db.prepare("INSERT INTO chart_items (chart_id, album_id, position) VALUES (?, ?, 1)").run(
      chartId,
      item1,
    );
    db.prepare("INSERT INTO chart_items (chart_id, album_id, position) VALUES (?, ?, 11)").run(
      chartId,
      item2,
    );

    const result = genreMethod(db, profile);

    const decay1 = 1 / (1 + 1 / 10);
    const decay11 = 1 / (1 + 11 / 10);
    const expectedRatio = decay11 / decay1;

    expect(result.get(item1)?.score).toBeCloseTo(1);
    expect(result.get(item2)?.score).toBeCloseTo(expectedRatio);
  });

  it("matches multi-word profile genres against slug-form chart genres (Indie Folk vs indie-folk)", () => {
    const db = openDb(":memory:");
    const profile = { ...emptyProfile(), genres: { "Indie Folk": 0.9 } };
    const chartId = upsertChart(db, {
      rymUrl: "/genre/indie-folk/",
      kind: "genre-page",
      params: { genre: "indie-folk" },
    });
    const a = album(db, "slugmatch");
    db.prepare("INSERT INTO chart_items (chart_id, album_id, position) VALUES (?, ?, 1)").run(
      chartId,
      a,
    );

    const result = genreMethod(db, profile);
    expect(result.get(a)?.score).toBeCloseTo(1);
  });

  it("excludes known albums and charts for genres absent from the profile", () => {
    const db = openDb(":memory:");
    const profile = { ...emptyProfile(), genres: { X: 0.8 } };
    const chartId = upsertChart(db, {
      rymUrl: "/genre/unknown/",
      kind: "genre-page",
      params: { genre: "unknown" },
    });
    const item = album(db, "item");
    replaceChartItems(db, chartId, [item]);

    expect(genreMethod(db, profile).size).toBe(0);
  });
});

describe("descriptorMethod", () => {
  it("scores overlapping descriptors higher than disjoint ones and carries descriptor names as evidence", () => {
    const db = openDb(":memory:");
    const profile = { ...emptyProfile(), descriptors: { moody: 0.9, energetic: 0.1 } };
    const overlapping = album(db, "overlapping", { descriptors: ["moody"] });
    const disjoint = album(db, "disjoint", { descriptors: ["obscure"] });
    const noDescriptors = album(db, "none", { descriptors: [] });

    const result = descriptorMethod(db, profile);

    expect(result.get(overlapping)?.score).toBeCloseTo(1);
    expect(result.get(disjoint)?.score).toBeCloseTo(0); // scored, but no match -> 0
    expect(result.has(noDescriptors)).toBe(false); // no descriptors at all -> never scored

    const evidence = result.get(overlapping)?.evidence;
    expect(evidence?.method).toBe("descriptor");
    if (evidence?.method === "descriptor") {
      expect(evidence.charts).toEqual([{ rymUrl: "", descriptor: "moody", position: 0 }]);
    }
  });
});

describe("newMethod", () => {
  it("applies the 0.15 genre-unknown floor and ranks a genre-matched album higher", () => {
    const db = openDb(":memory:");
    const profile = { ...emptyProfile(), genres: { Y: 0.9 } };
    const chartId = upsertChart(db, { rymUrl: "/new-music/", kind: "new", params: {} });
    const unknownGenre = album(db, "unknownGenre", { genres: [] });
    const matchedGenre = album(db, "matchedGenre", { genres: ["Y"] });
    // replaceChartItems assigns position = array index: unknownGenre=0, matchedGenre=1.
    replaceChartItems(db, chartId, [unknownGenre, matchedGenre]);

    const rawUnknown = (1 / (1 + 0 / 10)) * 0.15;
    const rawMatched = (1 / (1 + 1 / 10)) * 0.9;

    const result = newMethod(db, profile);
    expect(result.get(unknownGenre)?.score).toBeCloseTo(rawUnknown / rawMatched);
    expect(result.get(matchedGenre)?.score).toBeCloseTo(1);
  });
});
