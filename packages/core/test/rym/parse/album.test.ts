import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAlbumPage } from "../../../src/rym/parse/album.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), "utf-8");
}

describe("parseAlbumPage", () => {
  it("parses the For Emma, Forever Ago album page", () => {
    const result = parseAlbumPage(fixture("album-for-emma.md"));

    expect(result.genres).toEqual(["Indie Folk", "Singer-Songwriter", "Psychedelic Folk"]);
    expect(result.descriptors).toContain("winter");
    expect(result.descriptors).toContain("melancholic");
    expect(result.descriptors.length).toBeGreaterThanOrEqual(30);
    expect(result.avgRating).toBe(3.82);
    expect(result.numRatings).toBe(27931);

    expect(result.listAppearances.length).toBeGreaterThanOrEqual(10);
    expect(result.listAppearances.map((l) => l.rymUrl)).toContain(
      "/list/GentlemanCritic/dark-winter/",
    );
  });

  it("parses the Souvlaki album page", () => {
    const result = parseAlbumPage(fixture("album-souvlaki.md"));
    expect(result.genres.length).toBeGreaterThan(0);
    expect(result.avgRating).not.toBeNull();
    expect(result.avgRating as number).toBeGreaterThan(3);
    expect(result.avgRating as number).toBeLessThan(5);
  });
});
