import type { AlbumRef } from "../../types.js";
import { genreSlugFromUrl } from "../urls.js";
import { ParseError } from "./errors.js";
import { extractReleaseItems } from "./markdown.js";

export type GenrePage = {
  genre: string;
  items: AlbumRef[];
};

const HEADING_RE = /^#\s+(.+)$/m;

/** Parses a RYM genre page (`/genre/<slug>/`). `url` is used as a fallback genre name source. */
export function parseGenrePage(md: string, url?: string): GenrePage {
  const headingMatch = md.match(HEADING_RE);
  const slugFromUrl = url ? genreSlugFromUrl(url) : null;

  if (!headingMatch && !slugFromUrl) {
    throw new ParseError(
      "not a RYM genre page",
      "expected a '# Genre Name' heading or a /genre/<slug>/ url",
    );
  }

  const genre = headingMatch ? headingMatch[1].trim() : (slugFromUrl as string);

  return {
    genre,
    items: extractReleaseItems(md),
  };
}
