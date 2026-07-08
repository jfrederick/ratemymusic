import type { DatabaseType } from "../db.js";
import type { Album, AlbumRef } from "../types.js";

type AlbumUpsert = AlbumRef &
  Partial<
    Pick<Album, "artistRymUrl" | "rymAvgRating" | "rymNumRatings" | "genres" | "descriptors">
  > & {
    scrapedAt?: string;
  };

/**
 * Inserts or enriches an album row, keyed by `rym_url`. On conflict, `artist`/`title` are
 * overwritten only when non-empty (guards against the list parser's empty-artist fallback),
 * and every other field is overwritten only when the incoming value is present -- existing
 * enrichment data is never nulled by a later, less-informed sighting of the same album.
 */
export function upsertAlbum(db: DatabaseType, ref: AlbumUpsert): number {
  const existing = db.prepare("SELECT id FROM albums WHERE rym_url = ?").get(ref.rymUrl) as
    | { id: number }
    | undefined;

  if (!existing) {
    const info = db
      .prepare(
        `INSERT INTO albums
          (rym_url, artist, artist_rym_url, title, year, rym_avg_rating, rym_num_ratings, genres, descriptors, scraped_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ref.rymUrl,
        ref.artist,
        ref.artistRymUrl ?? null,
        ref.title,
        ref.year,
        ref.rymAvgRating ?? null,
        ref.rymNumRatings ?? null,
        JSON.stringify(ref.genres ?? []),
        JSON.stringify(ref.descriptors ?? []),
        ref.scrapedAt ?? null,
      );
    return info.lastInsertRowid as number;
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (ref.artist !== "") {
    sets.push("artist = ?");
    params.push(ref.artist);
  }
  if (ref.title !== "") {
    sets.push("title = ?");
    params.push(ref.title);
  }
  if (ref.year !== null && ref.year !== undefined) {
    sets.push("year = ?");
    params.push(ref.year);
  }
  if (ref.artistRymUrl != null) {
    sets.push("artist_rym_url = ?");
    params.push(ref.artistRymUrl);
  }
  if (ref.rymAvgRating != null) {
    sets.push("rym_avg_rating = ?");
    params.push(ref.rymAvgRating);
  }
  if (ref.rymNumRatings != null) {
    sets.push("rym_num_ratings = ?");
    params.push(ref.rymNumRatings);
  }
  if (ref.genres !== undefined) {
    sets.push("genres = ?");
    params.push(JSON.stringify(ref.genres));
  }
  if (ref.descriptors !== undefined) {
    sets.push("descriptors = ?");
    params.push(JSON.stringify(ref.descriptors));
  }
  if (ref.scrapedAt !== undefined) {
    sets.push("scraped_at = ?");
    params.push(ref.scrapedAt);
  }

  if (sets.length > 0) {
    params.push(ref.rymUrl);
    db.prepare(`UPDATE albums SET ${sets.join(", ")} WHERE rym_url = ?`).run(...params);
  }

  return existing.id;
}

/** Upserts the caller's own rating for an album (one row per album). */
export function upsertMyRating(
  db: DatabaseType,
  albumId: number,
  rating: number,
  ratedAt: string | null,
): void {
  db.prepare(
    `INSERT INTO my_ratings (album_id, rating, rated_at) VALUES (?, ?, ?)
     ON CONFLICT(album_id) DO UPDATE SET rating = excluded.rating, rated_at = excluded.rated_at`,
  ).run(albumId, rating, ratedAt);
}

export type ListUpsert = {
  rymUrl: string;
  title: string;
  author: string | null;
  numItems?: number | null;
  scrapedAt?: string;
};

/** Inserts or updates a list row, keyed by `rym_url`. Returns the list id. */
export function upsertList(db: DatabaseType, o: ListUpsert): number {
  const existing = db.prepare("SELECT id FROM lists WHERE rym_url = ?").get(o.rymUrl) as
    | { id: number }
    | undefined;

  if (!existing) {
    const info = db
      .prepare(
        `INSERT INTO lists (rym_url, title, author_username, num_items, scraped_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(o.rymUrl, o.title, o.author, o.numItems ?? null, o.scrapedAt ?? null);
    return info.lastInsertRowid as number;
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (o.title !== "") {
    sets.push("title = ?");
    params.push(o.title);
  }
  if (o.author != null) {
    sets.push("author_username = ?");
    params.push(o.author);
  }
  if (o.numItems != null) {
    sets.push("num_items = ?");
    params.push(o.numItems);
  }
  if (o.scrapedAt !== undefined) {
    sets.push("scraped_at = ?");
    params.push(o.scrapedAt);
  }
  if (sets.length > 0) {
    params.push(o.rymUrl);
    db.prepare(`UPDATE lists SET ${sets.join(", ")} WHERE rym_url = ?`).run(...params);
  }
  return existing.id;
}

/** Replaces a list's items wholesale: delete then insert, position = array index. Idempotent. */
export function replaceListItems(db: DatabaseType, listId: number, albumIds: number[]): void {
  const tx = db.transaction((ids: number[]) => {
    db.prepare("DELETE FROM list_items WHERE list_id = ?").run(listId);
    const ins = db.prepare("INSERT INTO list_items (list_id, album_id, position) VALUES (?, ?, ?)");
    ids.forEach((albumId, position) => ins.run(listId, albumId, position));
  });
  tx(albumIds);
}

/** Upserts a twin (RYM "taste twin") username. */
export function upsertTwin(db: DatabaseType, username: string): void {
  db.prepare("INSERT INTO twins (username) VALUES (?) ON CONFLICT(username) DO NOTHING").run(
    username,
  );
}

/** Upserts a twin's rating for an album. */
export function upsertTwinRating(
  db: DatabaseType,
  username: string,
  albumId: number,
  rating: number,
): void {
  db.prepare(
    `INSERT INTO twin_ratings (username, album_id, rating) VALUES (?, ?, ?)
     ON CONFLICT(username, album_id) DO UPDATE SET rating = excluded.rating`,
  ).run(username, albumId, rating);
}

export type ChartUpsert = {
  rymUrl: string;
  kind: "genre-page" | "new";
  params?: object;
  scrapedAt?: string;
};

/** Inserts or updates a chart row, keyed by `rym_url`. Returns the chart id. */
export function upsertChart(db: DatabaseType, o: ChartUpsert): number {
  const existing = db.prepare("SELECT id FROM charts WHERE rym_url = ?").get(o.rymUrl) as
    | { id: number }
    | undefined;
  const paramsJson = JSON.stringify(o.params ?? {});

  if (!existing) {
    const info = db
      .prepare("INSERT INTO charts (rym_url, kind, params, scraped_at) VALUES (?, ?, ?, ?)")
      .run(o.rymUrl, o.kind, paramsJson, o.scrapedAt ?? null);
    return info.lastInsertRowid as number;
  }

  const sets: string[] = ["kind = ?", "params = ?"];
  const params: unknown[] = [o.kind, paramsJson];
  if (o.scrapedAt !== undefined) {
    sets.push("scraped_at = ?");
    params.push(o.scrapedAt);
  }
  params.push(o.rymUrl);
  db.prepare(`UPDATE charts SET ${sets.join(", ")} WHERE rym_url = ?`).run(...params);
  return existing.id;
}

/** Replaces a chart's items wholesale: delete then insert, position = array index. Idempotent. */
export function replaceChartItems(db: DatabaseType, chartId: number, albumIds: number[]): void {
  const tx = db.transaction((ids: number[]) => {
    db.prepare("DELETE FROM chart_items WHERE chart_id = ?").run(chartId);
    const ins = db.prepare(
      "INSERT INTO chart_items (chart_id, album_id, position) VALUES (?, ?, ?)",
    );
    ids.forEach((albumId, position) => ins.run(chartId, albumId, position));
  });
  tx(albumIds);
}
