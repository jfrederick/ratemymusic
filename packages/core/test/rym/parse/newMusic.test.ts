import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseNewMusicPage } from "../../../src/rym/parse/newMusic.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), "utf-8");
}

describe("parseNewMusicPage", () => {
  it("parses the new-music fixture", () => {
    const result = parseNewMusicPage(fixture("new-music.md"));
    expect(result.items.length).toBeGreaterThanOrEqual(30);
    const inferno = result.items.find(
      (i) => i.rymUrl === "/release/album/boards-of-canada/inferno/",
    );
    expect(inferno).toMatchObject({ artist: "Boards of Canada" });
  });
});
