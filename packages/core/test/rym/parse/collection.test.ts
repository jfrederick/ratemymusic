import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCollectionPage } from "../../../src/rym/parse/collection.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), "utf-8");
}

describe("parseCollectionPage", () => {
  it("parses the r5.0 collection fixture", () => {
    const { items, nextPageUrl } = parseCollectionPage(fixture("collection-r5.0.md"));

    // Note: the fixtures README/brief describe this fixture as "8 albums";
    // the actual scraped table has 9 distinct rows (verified by direct
    // count against the raw fixture) -- the fixture is ground truth here.
    expect(items).toHaveLength(9);

    expect(items[0]).toMatchObject({
      rymUrl: "/release/album/bon-iver/for-emma-forever-ago/",
      artist: "Bon Iver",
      title: "For Emma, Forever Ago",
      year: 2007,
      rating: 5.0,
      ratedAt: "2010-08-07",
    });

    const mingus = items.find((i) => i.title === "The Black Saint and the Sinner Lady");
    expect(mingus).toMatchObject({ artist: "Mingus" });

    expect(nextPageUrl).toBeNull();
  });

  it("parses the paginated r4.0 collection fixture", () => {
    const { items, nextPageUrl } = parseCollectionPage(fixture("collection-r4.0.md"));
    expect(items.length).toBeGreaterThan(0);
    expect(nextPageUrl).toBe("/collection/jimbof36/r4.0/2");
  });

  it("parses an empty collection table without throwing (degenerate fixture)", () => {
    const { items, nextPageUrl } = parseCollectionPage(fixture("user-collection-r5.md"));
    expect(items).toEqual([]);
    expect(nextPageUrl).toBeNull();
  });

  it("parses the r4.5 collection fixture", () => {
    // Note: the fixtures README describes this as a "single page"; the
    // actual scraped table has 25 rows and a real pagination line -- ground
    // truth wins.
    const { items, nextPageUrl } = parseCollectionPage(fixture("collection-r4.5.md"));
    expect(items).toHaveLength(25);
    expect(items[0]).toMatchObject({
      rymUrl: "/release/album/adele/21/",
      artist: "Adele",
      title: "21",
      year: 2011,
      rating: 4.5,
    });
    expect(nextPageUrl).toBe("/collection/jimbof36/r4.5/2");
  });

  it("parses the JesseAaron twin collection fixture", () => {
    // Note: the fixtures README describes this as "~11 albums"; the actual
    // scraped table has 25 rows and a real pagination line -- ground truth
    // wins.
    const { items, nextPageUrl } = parseCollectionPage(fixture("user-collection-jesseaaron-r5.md"));
    expect(items).toHaveLength(25);
    expect(items[0]).toMatchObject({
      rymUrl: "/release/album/bark-psychosis/hex/",
      artist: "Bark Psychosis",
      title: "Hex",
      year: 1994,
      rating: 5,
    });
    expect(nextPageUrl).toBe("/collection/JesseAaron/r5.0/2");
  });
});
