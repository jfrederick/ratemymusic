import { useEffect, useState } from "react";
import {
  type CandidateView,
  type PlaylistMode,
  type PlaylistSummary,
  type PlaylistTrackView,
  api,
  describeError,
  isDisconnectedError,
} from "../api";
import { IconX } from "../components/Icon";
import { Skeleton } from "../components/Skeleton";
import { useToast } from "../toast";

const MODE_INFO: { value: PlaylistMode; label: string; description: string }[] = [
  {
    value: "sampler",
    label: "sampler",
    description: "The most popular track from each recommended album",
  },
  {
    value: "top",
    label: "top",
    description:
      "Spotify removed the artist-top-tracks endpoint in Feb 2026, so this mode currently behaves like sampler (2 tracks per album)",
  },
  {
    value: "deep",
    label: "deep",
    description: "A deeper cut from each album — skips the hit",
  },
];

function defaultPlaylistName(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `RYM Discoveries - ${date}`;
}

function albumLabel(albumId: number, lookup: Map<number, CandidateView>): string {
  const candidate = lookup.get(albumId);
  return candidate ? `${candidate.artist} - ${candidate.title}` : `Album #${albumId}`;
}

export function Playlists() {
  const { push } = useToast();
  const [queue, setQueue] = useState<number[]>([]);
  const [lookup, setLookup] = useState<Map<number, CandidateView>>(new Map());
  const [mode, setMode] = useState<PlaylistMode>("sampler");
  const [name, setName] = useState(defaultPlaylistName());
  const [creating, setCreating] = useState(false);
  const [pushingDaily, setPushingDaily] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [history, setHistory] = useState<PlaylistSummary[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [lastCreated, setLastCreated] = useState<string | null>(null);
  const [tracksByPlaylist, setTracksByPlaylist] = useState<Map<number, PlaylistTrackView[]>>(
    new Map(),
  );
  const [keepingTrackId, setKeepingTrackId] = useState<string | null>(null);

  useEffect(() => {
    api
      .getQueue()
      .then(setQueue)
      .catch(() => setQueue([]));
    api
      .getCandidates({ limit: 200 })
      .then((page) => setLookup(new Map(page.items.map((c) => [c.albumId, c]))))
      .catch(() => {
        // Lookup is best-effort; falls back to "Album #id" labels.
      });
    api
      .getPlaylists()
      .then(setHistory)
      .catch((err) => push(describeError(err), "error"));
    // `push` is a stable context callback; this still only runs once on mount.
  }, [push]);

  const removeFromQueue = async (albumId: number) => {
    setQueue((current) => current.filter((id) => id !== albumId));
    try {
      await api.removeFromQueue(albumId);
    } catch (err) {
      setQueue((current) => [...current, albumId]);
      push(describeError(err), "error");
    }
  };

  const refreshHistory = () => {
    api
      .getPlaylists()
      .then(setHistory)
      .catch((err) => push(describeError(err), "error"));
  };

  const createPlaylist = async () => {
    setCreating(true);
    setDisconnected(false);
    try {
      // Deliberately omit albumIds: sending it explicitly (even as a copy of the queue) would
      // stop the server from recognizing this as "build from the queue" and clearing it
      // server-side afterwards, leaving the queue stuck forever (I3).
      const result = await api.createPlaylist({ name, mode });
      setLastCreated(result.spotifyPlaylistId);
      push(`Created "${name}" with ${result.trackCount} tracks.`, "success");
      if (result.unresolved.length > 0) {
        const n = result.unresolved.length;
        push(`${n} album${n === 1 ? "" : "s"} had no Spotify match.`, "error");
      }
      refreshHistory();
      // The server clears its queue as part of a successful build-from-queue; refresh our local
      // copy so the UI reflects that instead of re-showing already-playlisted albums.
      const freshQueue = await api.getQueue().catch(() => []);
      setQueue(freshQueue);
    } catch (err) {
      if (isDisconnectedError(err)) {
        setDisconnected(true);
      } else {
        push(describeError(err), "error");
      }
    } finally {
      setCreating(false);
    }
  };

  const pushDaily = async () => {
    setPushingDaily(true);
    setDisconnected(false);
    try {
      const result = await api.createDailyPlaylist();
      push(`Daily playlist pushed (${result.trackCount} tracks).`, "success");
      refreshHistory();
    } catch (err) {
      if (isDisconnectedError(err)) {
        setDisconnected(true);
      } else {
        push(describeError(err), "error");
      }
    } finally {
      setPushingDaily(false);
    }
  };

  const toggleExpanded = (id: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!tracksByPlaylist.has(id)) {
      api
        .getPlaylistTracks(id)
        .then((tracks) => setTracksByPlaylist((current) => new Map(current).set(id, tracks)))
        .catch((err) => push(describeError(err), "error"));
    }
  };

  const keepTrack = async (playlistId: number, track: PlaylistTrackView) => {
    setKeepingTrackId(track.spotifyTrackId);
    try {
      await api.keepTrack({
        spotifyTrackId: track.spotifyTrackId,
        albumId: track.albumId ?? undefined,
      });
      setTracksByPlaylist((current) => {
        const next = new Map(current);
        const tracks = next.get(playlistId);
        if (tracks) {
          next.set(
            playlistId,
            tracks.map((t) =>
              t.spotifyTrackId === track.spotifyTrackId ? { ...t, kept: true } : t,
            ),
          );
        }
        return next;
      });
      push("Kept.", "success");
    } catch (err) {
      if (isDisconnectedError(err)) {
        setDisconnected(true);
      } else {
        push(describeError(err), "error");
      }
    } finally {
      setKeepingTrackId(null);
    }
  };

  return (
    <div>
      <header className="page-header">
        <h1>Playlists</h1>
        <div className="page-header__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={pushDaily}
            disabled={pushingDaily}
          >
            {pushingDaily ? "Pushing…" : "Push daily playlist"}
          </button>
        </div>
      </header>

      {disconnected && (
        <div className="error-banner">
          Spotify isn't connected yet.{" "}
          <a className="btn btn--primary btn--small" href="/auth/spotify">
            Connect Spotify
          </a>
        </div>
      )}

      {lastCreated && (
        <p className="card">
          Playlist ready:{" "}
          <a
            href={`https://open.spotify.com/playlist/${lastCreated}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Spotify
          </a>
        </p>
      )}

      <div className="two-col">
        <section className="card">
          <p className="section-title">Queue ({queue.length})</p>
          {queue.length === 0 ? (
            <p className="empty-state">
              Nothing queued. Add candidates from Discover to build a playlist.
            </p>
          ) : (
            <ul>
              {queue.map((albumId) => (
                <li className="queue-row" key={albumId}>
                  <span>{albumLabel(albumId, lookup)}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${albumLabel(albumId, lookup)} from queue`}
                    onClick={() => removeFromQueue(albumId)}
                  >
                    <IconX size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <p className="section-title">Build a playlist</p>
          <div className="stack">
            <div className="mode-options">
              {MODE_INFO.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  className={`mode-option${mode === m.value ? " is-active" : ""}`}
                  onClick={() => setMode(m.value)}
                >
                  <div className="mode-option__name">{m.label}</div>
                  <div className="mode-option__desc">{m.description}</div>
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="playlist-name">Name</label>
              <input
                id="playlist-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn--primary"
              onClick={createPlaylist}
              disabled={creating || queue.length === 0}
            >
              {creating ? "Creating…" : "Create playlist"}
            </button>
          </div>
        </section>
      </div>

      <section className="card">
        <p className="section-title">History</p>
        {history === null ? (
          <Skeleton height="100px" />
        ) : history.length === 0 ? (
          <p className="empty-state">No playlists created yet.</p>
        ) : (
          <ul>
            {history.map((playlist) => (
              <li key={playlist.id}>
                <div className="playlist-row">
                  <div>
                    <div>{playlist.name}</div>
                    <div className="playlist-row__meta">
                      {new Date(playlist.createdAt).toLocaleDateString()} · {playlist.mode} ·{" "}
                      {playlist.trackCount} tracks
                    </div>
                  </div>
                  <div className="page-header__actions">
                    <a
                      className="btn btn--ghost btn--small"
                      href={`https://open.spotify.com/playlist/${playlist.spotifyId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => toggleExpanded(playlist.id)}
                    >
                      {expanded.has(playlist.id) ? "Hide" : "Preview"}
                    </button>
                  </div>
                </div>
                {expanded.has(playlist.id) && (
                  <>
                    <iframe
                      title={`Preview of ${playlist.name}`}
                      src={`https://open.spotify.com/embed/playlist/${playlist.spotifyId}?theme=0`}
                      height={152}
                      style={{
                        width: "100%",
                        border: "none",
                        borderRadius: "var(--radius-control)",
                      }}
                      allow="encrypted-media"
                      loading="lazy"
                    />
                    {tracksByPlaylist.has(playlist.id) ? (
                      <ul>
                        {(tracksByPlaylist.get(playlist.id) ?? []).map((track) => (
                          <li className="queue-row" key={track.spotifyTrackId}>
                            <span>
                              {track.artist && track.title
                                ? `${track.artist} — ${track.title}`
                                : `Track ${track.spotifyTrackId}`}
                            </span>
                            <button
                              type="button"
                              className="btn btn--ghost btn--small"
                              disabled={track.kept || keepingTrackId === track.spotifyTrackId}
                              onClick={() => keepTrack(playlist.id, track)}
                            >
                              {track.kept
                                ? "Kept"
                                : keepingTrackId === track.spotifyTrackId
                                  ? "Keeping…"
                                  : "Keep"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Skeleton height="40px" />
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
