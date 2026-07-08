// Shared markdown-parsing primitives for RYM page parsers. Kept intentionally
// small and linear (no nested-quantifier regexes) since these run over full
// scraped pages.

import type { AlbumRef } from "../../types.js";
import { canonicalRymUrl } from "../urls.js";

export interface MdLink {
  text: string;
  href: string;
  title: string | null;
  isImage: boolean;
  /** Character offset of the match start within the source string. */
  index: number;
}

// Text/title bodies allow any escaped character (`\x`) or any character that
// isn't an unescaped bracket/quote delimiter — this tolerates the RYM
// footnote quirk (`"[Artist275]"`) and escaped brackets in titles
// (`Depressive Silence \[II\]`) without backtracking.
const TEXT_BODY = String.raw`(?:\\.|[^\[\]])*`;
const TITLE_BODY = String.raw`(?:\\.|[^"])*`;
const HREF = String.raw`[^\s()]+`;

// 1: wrapped-image alt text, 2: image url (unused), 3: outer href, 4: outer title
const WRAPPED_IMAGE_LINK = String.raw`\[!\[(${TEXT_BODY})\]\((${HREF})\)\]\((${HREF})(?:\s+"(${TITLE_BODY})")?\)`;
// 5: standalone image alt text, 6: image href
const STANDALONE_IMAGE = String.raw`!\[(${TEXT_BODY})\]\((${HREF})\)`;
// 7: plain link text, 8: plain link href, 9: plain link title
const PLAIN_LINK = String.raw`\[(${TEXT_BODY})\]\((${HREF})(?:\s+"(${TITLE_BODY})")?\)`;

const LINK_RE = new RegExp(`${WRAPPED_IMAGE_LINK}|${STANDALONE_IMAGE}|${PLAIN_LINK}`, "g");

/** Extracts every markdown link (plain, image, and image-wrapped-in-link) in document order. */
export function extractLinks(md: string): MdLink[] {
  const out: MdLink[] = [];
  for (const m of md.matchAll(LINK_RE)) {
    if (m[3] !== undefined) {
      out.push({ text: m[1], href: m[3], title: m[4] ?? null, isImage: true, index: m.index });
    } else if (m[6] !== undefined) {
      out.push({ text: m[5], href: m[6], title: null, isImage: true, index: m.index });
    } else {
      out.push({
        text: m[7] ?? "",
        href: m[8] ?? "",
        title: m[9] ?? null,
        isImage: false,
        index: m.index,
      });
    }
  }
  return out;
}

/** Splits a single `| a | b | c |` markdown table row line into trimmed cells. */
export function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

const PAGE_LINE_RE = /^Page (\d+) (.+)$/m;

/**
 * Finds the RYM `Page 1 [2](...) [3](...) [>>](...)` pagination line and
 * returns the href whose link text equals currentPage + 1, verbatim (origin
 * stripped only — no case or trailing-slash normalization, since collection
 * tier pages don't have a trailing slash while list/genre pages do).
 */
export function extractNextPageUrl(md: string): string | null {
  const lineMatch = md.match(PAGE_LINE_RE);
  if (!lineMatch) return null;
  const currentPage = Number(lineMatch[1]);
  const target = String(currentPage + 1);
  const links = extractLinks(lineMatch[2]);
  const next = links.find((l) => l.text.trim() === target);
  if (!next) return null;
  return new URL(next.href, "https://rateyourmusic.com").pathname;
}

const RELEASE_HREF_RE = /^https:\/\/rateyourmusic\.com\/release\/[a-z0-9]+\/[^/]+\/[^/]+\/?$/i;
const ARTIST_HREF_RE = /^https:\/\/rateyourmusic\.com\/artist\//i;
const YEAR_AFTER_RE = /^\)_?\s*\((\d{4})\)/;

export type ReleaseItem = AlbumRef & { index: number };

/**
 * Extracts release/album links from a page (genre charts, new-music, list
 * pages), deduping the repeated cover-image + title link pair for the same
 * release (keeping the non-image text as the title), preserving first-seen
 * document order (order is a ranking signal on genre/chart pages).
 *
 * Artist is taken from the nearest `/artist/...` link (by character
 * distance) when one exists; otherwise it's derived from the release url's
 * artist slug (hyphens -> spaces).
 */
export function extractReleaseItems(md: string): ReleaseItem[] {
  const links = extractLinks(md);
  const artistLinks = links.filter((l) => ARTIST_HREF_RE.test(l.href));

  type Entry = { href: string; title: string; isImage: boolean; index: number };
  const order: string[] = [];
  const byKey = new Map<string, Entry>();

  for (const link of links) {
    if (!RELEASE_HREF_RE.test(link.href)) continue;
    const key = canonicalRymUrl(link.href);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        href: link.href,
        title: link.text,
        isImage: link.isImage,
        index: link.index,
      });
      order.push(key);
    } else if (existing.isImage && !link.isImage) {
      existing.title = link.text;
      existing.isImage = false;
      existing.index = link.index;
    }
  }

  return order.map((key) => {
    const entry = byKey.get(key) as Entry;
    const tail = md.slice(entry.index, entry.index + 200);
    const closeParenIdx = tail.indexOf(")");
    const afterHref = closeParenIdx >= 0 ? tail.slice(closeParenIdx) : "";
    const yearMatch = afterHref.match(YEAR_AFTER_RE);

    let artist: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const a of artistLinks) {
      const distance = Math.abs(a.index - entry.index);
      if (distance < bestDistance) {
        bestDistance = distance;
        artist = a.text;
      }
    }
    if (artist === null) {
      const slugMatch = key.match(/^\/release\/[a-z0-9]+\/([^/]+)\//);
      artist = slugMatch ? slugMatch[1].replace(/-/g, " ") : "";
    }

    return {
      rymUrl: key,
      artist,
      title: entry.title,
      year: yearMatch ? Number(yearMatch[1]) : null,
      index: entry.index,
    };
  });
}
