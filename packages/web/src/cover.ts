/**
 * We don't store cover art URLs (see brief). When there's no Spotify embed to show, a
 * candidate card falls back to a typographic placeholder: initials plus a hue hashed from
 * the album id, so the same album always renders the same placeholder color.
 */

const GOLDEN_ANGLE = 137.508;

/** Deterministic hue in [0, 360) for an album id, spread via the golden angle. */
export function hueFromAlbumId(albumId: number): number {
  const raw = (((albumId * GOLDEN_ANGLE) % 360) + 360) % 360;
  return Math.round(raw);
}

/** First letter of artist + first letter of title, uppercased; "?" for missing fields. */
export function initialsFromCandidate(artist: string, title: string): string {
  const a = artist.trim().charAt(0).toUpperCase() || "?";
  const t = title.trim().charAt(0).toUpperCase() || "?";
  if (a === "?" && t === "?") return "??";
  return `${a}${t}`;
}
