// Minimal Node ESM loader hook (zero new dependencies).
//
// Our source uses NodeNext-style `./foo.js` specifiers (so a future `tsc` build's emitted
// output resolves correctly), but nothing in this repo compiles to .js before running the
// CLI directly. This hook remaps a relative `.js` specifier to its sibling `.ts` file when
// the `.js` file doesn't actually exist on disk. Combined with node's built-in
// `--experimental-strip-types` flag (which erases the TS type syntax at parse time), this
// lets `node --experimental-strip-types --loader <this file> cli/sync.ts` run the TypeScript
// sources directly.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    const parentUrl = context.parentURL;
    if (parentUrl) {
      const candidate = new URL(specifier.replace(/\.js$/, ".ts"), parentUrl);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: pathToFileURL(fileURLToPath(candidate)).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
