import { isAbsolute, join } from "node:path";

/**
 * Resolves a possibly-relative data path (db path, scrape cache dir, web dist dir, ...) against
 * a repo root, independent of `process.cwd()`.
 *
 * Contract: a relative `RMM_DB_PATH` (or any other relative data path from Config) is ALWAYS
 * anchored to the repository root, never to the current working directory. This matters
 * because different entry points run with different cwds: `npm run discover -w @rmm/core` sets
 * cwd to `packages/core`, `npm run start -w @rmm/server` sets cwd to `packages/server`, while a
 * plain `node dist/cli/sync.js` from the repo root sets cwd to the repo root. Passing a relative
 * path straight to a filesystem API without anchoring it here would silently create/open the
 * file under whatever the cwd happens to be, rather than under `<repoRoot>/data/`.
 *
 * Each caller computes its own `repoRoot` from `import.meta.url`/`__dirname` (walking up from
 * its own file's location -- the walk depth differs per entry point, so that part can't be
 * shared) and passes it in here alongside the path to resolve.
 *
 * An already-absolute `p` is returned unchanged. The SQLite in-memory sentinel `:memory:` is
 * also returned unchanged -- it isn't a filesystem path, so it must never be joined onto a root.
 */
export function resolveRepoPath(repoRoot: string, p: string): string {
  if (p === ":memory:") return p;
  return isAbsolute(p) ? p : join(repoRoot, p);
}
