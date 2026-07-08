import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("core smoke test", () => {
  it("has the r5.0 collection fixture available", () => {
    const fixturePath = fileURLToPath(new URL("./fixtures/collection-r5.0.md", import.meta.url));
    expect(existsSync(fixturePath)).toBe(true);
    const contents = readFileSync(fixturePath, "utf-8");
    expect(contents).toContain("bon-iver");
  });
});
