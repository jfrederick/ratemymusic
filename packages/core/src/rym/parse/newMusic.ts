import type { AlbumRef } from "../../types.js";
import { ParseError } from "./errors.js";
import { extractReleaseItems } from "./markdown.js";

export type NewMusicPage = {
  items: AlbumRef[];
};

/** Parses the RYM new-music page (`/new-music/`). */
export function parseNewMusicPage(md: string): NewMusicPage {
  if (!/new-music/i.test(md)) {
    throw new ParseError(
      "not the RYM new-music page",
      "expected 'new-music' navigation markers on the page",
    );
  }

  return { items: extractReleaseItems(md) };
}
