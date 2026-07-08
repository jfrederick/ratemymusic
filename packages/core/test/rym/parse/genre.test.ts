import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ParseError } from "../../../src/rym/parse/errors.js";
import { parseGenrePage } from "../../../src/rym/parse/genre.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), "utf-8");
}

describe("parseGenrePage", () => {
  it("parses the slowcore genre page", () => {
    const result = parseGenrePage(fixture("genre-slowcore.md"));
    expect(result.genre).toBe("Slowcore");
    expect(result.items.length).toBeGreaterThanOrEqual(10);
    expect(result.items[0].rymUrl).toBe("/release/album/duster/stratosphere/");
  });

  // DECOY: chart-genre-slowcore.md is a /charts/... page, not a /genre/...
  // page. Its title mentions slowcore but its item list is a generic
  // all-time albums chart, not slowcore-specific -- it's deliberately kept
  // out of the ingestion pipeline at a higher layer. This test only
  // documents that parsing it doesn't crash the process; there is no
  // behavioral requirement on the exact result (throw or a items array are
  // both acceptable here).
  it("does not crash on the DECOY chart page (excluded from ingestion by design)", () => {
    const md = fixture("chart-genre-slowcore.md");
    expect(() => {
      try {
        parseGenrePage(md);
      } catch (err) {
        if (!(err instanceof ParseError)) throw err;
      }
    }).not.toThrow();
  });
});
