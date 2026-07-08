import type { AlbumRef } from "../../types.js";
import { ParseError } from "./errors.js";
import { extractNextPageUrl, extractReleaseItems, unescapeMarkdown } from "./markdown.js";

export type ListPage = {
  title: string;
  author: string;
  items: AlbumRef[];
  nextPageUrl: string | null;
};

const HEADING_RE = /^#\s+(.+)$/m;
const LIST_BY_RE = /A list by \[([^\]]+)\]/;
const LIST_PATH_USER_RE = /^\/list\/([^/]+)\//;

/** Parses a RYM list page (`/list/<user>/<slug>/`). */
export function parseListPage(md: string): ListPage {
  const headingMatch = md.match(HEADING_RE);
  const listByMatch = md.match(LIST_BY_RE);

  if (!headingMatch && !listByMatch) {
    throw new ParseError(
      "not a RYM list page",
      "expected a '# Title' heading and an 'A list by [author]' byline",
    );
  }

  const nextPageUrl = extractNextPageUrl(md);

  // The "A list by [name]" byline can be stale (observed in fixtures where it
  // shows an unrelated username while the pagination links correctly point
  // at the real list owner) -- prefer the pagination link's user segment
  // when available, falling back to the byline text for single-page lists.
  let author = listByMatch ? unescapeMarkdown(listByMatch[1]) : "";
  const fromPagination = nextPageUrl?.match(LIST_PATH_USER_RE);
  if (fromPagination) {
    author = fromPagination[1];
  }

  return {
    title: headingMatch ? headingMatch[1].trim() : "",
    author,
    items: extractReleaseItems(md),
    nextPageUrl,
  };
}
