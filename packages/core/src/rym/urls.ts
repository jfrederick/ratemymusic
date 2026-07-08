// URL helpers for RateYourMusic pages. All "canonical" paths are lowercase,
// origin/query/fragment-free, and slash-bounded, except for the username /
// author segments called out below (RYM usernames are case-sensitive).

const ORIGIN = "https://rateyourmusic.com";

/**
 * Normalizes an absolute or relative RYM url/path down to a canonical path:
 * strips origin, query string, and fragment; ensures a leading and trailing
 * slash; lowercases the path EXCEPT it preserves case in the username segment
 * of `/collection/<user>/...`, `/~<user>`, and `/list/<user>/...`.
 */
export function canonicalRymUrl(input: string): string {
  const url = new URL(input, ORIGIN);
  let path = url.pathname;
  if (!path.startsWith("/")) path = `/${path}`;
  if (!path.endsWith("/")) path = `${path}/`;

  const parts = path.split("/");
  // parts[0] is always "" (leading slash) and parts[last] is always "" (trailing slash).
  const preserveIndex = parts[1] === "collection" || parts[1] === "list" ? 2 : null;

  for (let i = 1; i < parts.length - 1; i++) {
    if (i === preserveIndex) continue;
    if (preserveIndex === null && i === 1 && parts[1].startsWith("~")) continue;
    parts[i] = parts[i].toLowerCase();
  }

  return parts.join("/");
}

export type CollectionTier = "5.0" | "4.5" | "4.0" | "3.5" | "3.0";

/** Builds a collection tier page path, e.g. '/collection/jimbof36/r5.0' or '.../r5.0/2'. */
export function collectionUrl(user: string, tier: CollectionTier, page?: number): string {
  const base = `/collection/${user}/r${tier}`;
  return page === undefined ? base : `${base}/${page}`;
}

/** Builds a genre listing page path, e.g. '/genre/slowcore/'. */
export function genrePageUrl(genreSlug: string): string {
  return `/genre/${genreSlug}/`;
}

/** The new-music page path. */
export function newMusicUrl(): string {
  return "/new-music/";
}

/** Builds an absolute RYM url from a path (canonicalizing it first). */
export function absoluteRymUrl(path: string): string {
  return `${ORIGIN}${canonicalRymUrl(path)}`;
}

/** Extracts the genre slug from a '/genre/<slug>/' url, or null if it doesn't match. */
export function genreSlugFromUrl(url: string): string | null {
  const path = canonicalRymUrl(url);
  const match = path.match(/^\/genre\/([^/]+)\/$/);
  return match ? match[1] : null;
}
