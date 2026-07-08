import { useEffect, useState } from "react";
import {
  type CandidateView,
  type PlaylistMode,
  type PlaylistSummary,
  api,
  describeError,
  isDisconnectedError,
} from "../api";
import { IconX } from "../components/Icon";
import { Skeleton } from "../components/Skeleton";
import { useToast } from "../toast";

const MODE_INFO: { value: PlaylistMode; label: string; description: string }[] = [
  { value: "sampler", label: "sampler", description: "A broad taste of many artists and styles." },
  { value: "top", label: "top", description: "Only the highest-scored candidates, no filler." },
  { value: "deep", label: "deep", description: "Fewer artists, deeper cuts from each one." },
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
      const result = await api.createPlaylist({ name, mode, albumIds: queue });
      setLastCreated(result.spotifyPlaylistId);
      push(`Created "${name}" with ${result.trackCount} tracks.`, "success");
      refreshHistory();
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
                      {new Date(playlist.created_at).toLocaleDateString()} · {playlist.mode} ·{" "}
                      {playlist.trackCount} tracks
                    </div>
                  </div>
                  <div className="page-header__actions">
                    <a
                      className="btn btn--ghost btn--small"
                      href={`https://open.spotify.com/playlist/${playlist.spotify_id}`}
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
                  <iframe
                    title={`Preview of ${playlist.name}`}
                    src={`https://open.spotify.com/embed/playlist/${playlist.spotify_id}?theme=0`}
                    height={152}
                    style={{ width: "100%", border: "none", borderRadius: "var(--radius-control)" }}
                    allow="encrypted-media"
                    loading="lazy"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
