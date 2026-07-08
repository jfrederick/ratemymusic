// Identity: albums keyed by canonical RYM release URL (path only, trailing slash, lowercase)
export type AlbumRef = { rymUrl: string; artist: string; title: string; year: number | null };
export type Album = AlbumRef & {
  id: number;
  artistRymUrl: string | null;
  rymAvgRating: number | null;
  rymNumRatings: number | null;
  genres: string[];
  descriptors: string[];
  spotifyAlbumId: string | null;
  scrapedAt: string | null;
};
export type MyRating = { albumId: number; rating: number; ratedAt: string | null };
export type MethodKey = "list" | "twin" | "genre" | "descriptor" | "new";
export type Evidence =
  | { method: "list"; lists: { rymUrl: string; title: string; affinity: number }[] }
  | { method: "twin"; twins: { username: string; affinity: number; rating: number }[] }
  | { method: "genre"; charts: { rymUrl: string; genre: string; position: number }[] }
  | { method: "descriptor"; charts: { rymUrl: string; descriptor: string; position: number }[] }
  | { method: "new"; charts: { rymUrl: string; position: number }[] };
export type Candidate = {
  albumId: number;
  score: number;
  components: Partial<Record<MethodKey, { score: number; evidence: Evidence }>>;
  status: "new" | "playlisted" | "dismissed" | "known";
};
export type TasteProfile = {
  genres: Record<string, number>;
  descriptors: Record<string, number>;
  eras: Record<string, number>;
  computedAt: string; // eras keyed '1960s'.. ; values normalized 0..1
};
export type ScrapeResult = {
  url: string;
  markdown: string;
  links: string[];
  cachePath: string;
  fromCache: boolean;
};
export interface Scraper {
  scrape(url: string, opts?: { maxAgeDays?: number }): Promise<ScrapeResult>;
}
export type TrackPickMode = "sampler" | "top" | "deep";
export type PickedTrack = {
  spotifyTrackId: string;
  name: string;
  albumId: number;
  popularity: number;
};
