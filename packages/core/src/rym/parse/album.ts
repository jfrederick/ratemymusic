import { canonicalRymUrl } from "../urls.js";
import { ParseError } from "./errors.js";
import { extractLinks } from "./markdown.js";

export type AlbumPage = {
  genres: string[];
  descriptors: string[];
  avgRating: number | null;
  numRatings: number | null;
  listAppearances: { rymUrl: string; title: string }[];
};

const LIST_APPEARANCE_HREF_RE = /^https:\/\/rateyourmusic\.com\/list\/[^/]+\/[^/]+\/?$/i;

function fieldValue(md: string, label: string): string | null {
  const re = new RegExp(`^\\|\\s*${label}\\s*\\|(.*)$`, "m");
  const match = md.match(re);
  if (!match) return null;
  let value = match[1].trim();
  if (value.endsWith("|")) value = value.slice(0, -1).trim();
  return value;
}

function parseRating(cell: string | null): { avgRating: number | null; numRatings: number | null } {
  if (!cell) return { avgRating: null, numRatings: null };
  const avgMatch = cell.match(/(\d+(?:\.\d+)?)/);
  const numMatch = cell.match(/\*\*([\d,]+)\*\*/);
  return {
    avgRating: avgMatch ? Number(avgMatch[1]) : null,
    numRatings: numMatch ? Number(numMatch[1].replace(/,/g, "")) : null,
  };
}

/** Parses a RYM release/album page (`/release/album/<artist>/<title>/`). */
export function parseAlbumPage(md: string): AlbumPage {
  const ratingCell = fieldValue(md, "RYM Rating");
  const genresCell = fieldValue(md, "Genres");
  const descriptorsCell = fieldValue(md, "Descriptors");

  if (ratingCell === null && genresCell === null && !/^By \[/m.test(md)) {
    throw new ParseError(
      "not a RYM album page",
      "expected a 'RYM Rating' / 'Genres' field row or a 'By [Artist]' byline",
    );
  }

  const genres = genresCell ? extractLinks(genresCell).map((l) => l.text) : [];
  const descriptors = descriptorsCell
    ? descriptorsCell
        .split(",")
        .map((d) => d.trim())
        .filter((d) => d.length > 0)
    : [];
  const { avgRating, numRatings } = parseRating(ratingCell);

  const seen = new Set<string>();
  const listAppearances: { rymUrl: string; title: string }[] = [];
  for (const link of extractLinks(md)) {
    if (!LIST_APPEARANCE_HREF_RE.test(link.href)) continue;
    const rymUrl = canonicalRymUrl(link.href);
    if (seen.has(rymUrl)) continue;
    seen.add(rymUrl);
    listAppearances.push({ rymUrl, title: link.text });
  }

  return { genres, descriptors, avgRating, numRatings, listAppearances };
}
