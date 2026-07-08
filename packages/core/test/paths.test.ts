import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRepoPath } from "../src/paths.js";

describe("resolveRepoPath", () => {
  const repoRoot = "/repo/root";

  it("anchors a relative path to the given repo root regardless of process.cwd()", () => {
    expect(resolveRepoPath(repoRoot, "data/rmm.sqlite")).toBe(join(repoRoot, "data/rmm.sqlite"));
  });

  it("returns an absolute path unchanged", () => {
    const absolute = resolve("/tmp/custom.sqlite");
    expect(resolveRepoPath(repoRoot, absolute)).toBe(absolute);
  });

  it("returns the sqlite in-memory sentinel unchanged", () => {
    expect(resolveRepoPath(repoRoot, ":memory:")).toBe(":memory:");
  });

  it("resolves nested relative paths correctly", () => {
    expect(resolveRepoPath(repoRoot, "data/cache")).toBe(join(repoRoot, "data/cache"));
  });

  it("is unaffected by the process's current working directory", () => {
    // Regression guard for the bug this helper fixes: entry points invoked with
    // cwd=packages/core (e.g. `npm run discover -w @rmm/core`) must still resolve
    // relative RMM_DB_PATH against the repo root, not against process.cwd().
    const originalCwd = process.cwd();
    try {
      process.chdir("/tmp");
      expect(resolveRepoPath(repoRoot, "data/rmm.sqlite")).toBe(join(repoRoot, "data/rmm.sqlite"));
    } finally {
      process.chdir(originalCwd);
    }
  });
});
