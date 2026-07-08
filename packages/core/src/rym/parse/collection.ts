import type { AlbumRef } from "../../types.js";
import { canonicalRymUrl } from "../urls.js";
import { ParseError } from "./errors.js";
import { extractLinks, extractNextPageUrl } from "./markdown.js";

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

const DATE_CELL_RE = /\b([A-Za-z]{3})<br>(\d{2})<br>(\d{4})\b/;
const RATING_ALT_RE = /(\d+(?:\.\d+)?)\s*stars/;
const YEAR_SUFFIX_RE = /\)_\s*\((\d{4})\)/;

export type CollectionItem = AlbumRef & { rating: number; ratedAt: string | null };

export type CollectionPage = {
  items: CollectionItem[];
  nextPageUrl: string | null;
};

function parseRow(row: string): CollectionItem | null {
  const links = extractLinks(row);
  const releaseLink = links.find((l) => /\/release\//.test(l.href) && !l.isImage) ?? links[0];
  const ratingImage = links.find((l) => l.isImage && RATING_ALT_RE.test(l.text));
  const artistLink = links.find((l) => /\/artist\//.test(l.href));
  const titleLink = [...links].reverse().find((l) => /\/release\//.test(l.href) && !l.isImage);

  if (!releaseLink || !titleLink) return null;

  const ratingMatch = ratingImage ? ratingImage.text.match(RATING_ALT_RE) : null;
  const dateMatch = row.match(DATE_CELL_RE);
  const yearMatch = row.match(YEAR_SUFFIX_RE);

  const ratedAt = dateMatch
    ? `${dateMatch[3]}-${MONTHS[dateMatch[1]] ?? "01"}-${dateMatch[2]}`
    : null;

  return {
    rymUrl: canonicalRymUrl(titleLink.href),
    artist: artistLink ? artistLink.text : "",
    title: titleLink.text,
    year: yearMatch ? Number(yearMatch[1]) : null,
    rating: ratingMatch ? Number(ratingMatch[1]) : 0,
    ratedAt,
  };
}

/** Parses a RYM collection tier page (`/collection/<user>/r5.0` etc.). */
export function parseCollectionPage(md: string): CollectionPage {
  const rows = md.split("\n").filter((line) => line.trim().startsWith("| [!["));

  if (rows.length === 0) {
    const looksLikeCollectionPage = /\/collection\/[^/\s]+\/r\d/.test(md);
    if (!looksLikeCollectionPage) {
      throw new ParseError(
        "not a RYM collection page",
        "expected a /collection/<user>/r<tier> table with an 'Art'/'Date'/'Rating' header",
      );
    }
    return { items: [], nextPageUrl: extractNextPageUrl(md) };
  }

  const items = rows.map(parseRow).filter((item): item is CollectionItem => item !== null);
  return { items, nextPageUrl: extractNextPageUrl(md) };
}
