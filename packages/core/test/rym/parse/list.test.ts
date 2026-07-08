import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseListPage } from "../../../src/rym/parse/list.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), "utf-8");
}

describe("parseListPage", () => {
  it("parses the Dark Winter list", () => {
    const result = parseListPage(fixture("list-dark-winter.md"));
    expect(result.author).toBe("GentlemanCritic");
    expect(result.title).toContain("Dark Winter");
    // Brief/README describe "45 items/page"; the actual scraped fixture
    // rendered 100 rows in a single lazy-loaded page -- ground truth wins.
    expect(result.items.length).toBeGreaterThanOrEqual(90);
    expect(result.nextPageUrl).toBe("/list/GentlemanCritic/dark-winter/2/");
  });

  it("parses the degenerate top-releases list to exactly one item without throwing", () => {
    const result = parseListPage(fixture("list-top-releases.md"));
    expect(result.items).toHaveLength(1);
  });
});
