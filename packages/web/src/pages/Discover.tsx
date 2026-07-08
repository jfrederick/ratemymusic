import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type CandidateStatus,
  type CandidateView,
  type MethodKey,
  api,
  describeError,
} from "../api";
import { CandidateCard } from "../components/CandidateCard";
import { Skeleton } from "../components/Skeleton";
import { useToast } from "../toast";

const PAGE_SIZE = 20;

const STATUS_TABS: { value: CandidateStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "dismissed", label: "Dismissed" },
  { value: "playlisted", label: "Playlisted" },
  { value: "known", label: "Known" },
];

const METHOD_PILLS: { value: MethodKey | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "list", label: "List" },
  { value: "twin", label: "Twin" },
  { value: "genre", label: "Genre" },
  { value: "descriptor", label: "Descriptor" },
  { value: "new", label: "New" },
];

export function Discover() {
  const { push } = useToast();
  const [status, setStatus] = useState<CandidateStatus>("new");
  const [method, setMethod] = useState<MethodKey | "all">("all");
  const [genre, setGenre] = useState("");
  const [minScore, setMinScore] = useState("");

  const [items, setItems] = useState<CandidateView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [queue, setQueue] = useState<Set<number>>(new Set());
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const query = useMemo(
    () => ({
      status,
      method: method === "all" ? undefined : method,
      genre: genre.trim() || undefined,
      minScore: minScore.trim() ? Number(minScore) : undefined,
      limit: PAGE_SIZE,
    }),
    [status, method, genre, minScore],
  );

  const fetchPage = useCallback(
    async (offset: number) => {
      const page = await api.getCandidates({ ...query, offset });
      return page;
    },
    [query],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage(0)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  useEffect(() => {
    api
      .getQueue()
      .then((ids) => setQueue(new Set(ids)))
      .catch(() => {
        // Non-fatal: queue state degrades to "nothing queued" if this fails.
      });
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await fetchPage(items.length);
      setItems((current) => [...current, ...page.items]);
      setTotal(page.total);
    } catch (err) {
      push(describeError(err), "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const withBusy = async (albumId: number, action: () => Promise<void>) => {
    setBusyIds((current) => new Set(current).add(albumId));
    try {
      await action();
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(albumId);
        return next;
      });
    }
  };

  const removeCard = (
    albumId: number,
    restoreOnFailure: (item: CandidateView, index: number) => void,
    apiCall: () => Promise<void>,
  ) => {
    const index = items.findIndex((c) => c.albumId === albumId);
    if (index === -1) return;
    const [removed] = items.slice(index, index + 1);
    setItems((current) => current.filter((c) => c.albumId !== albumId));
    setTotal((current) => Math.max(0, current - 1));
    withBusy(albumId, async () => {
      try {
        await apiCall();
      } catch (err) {
        restoreOnFailure(removed, index);
        setTotal((current) => current + 1);
        push(describeError(err), "error");
      }
    });
  };

  const handleDismiss = (albumId: number) => {
    removeCard(
      albumId,
      (item, index) =>
        setItems((current) => [...current.slice(0, index), item, ...current.slice(index)]),
      () => api.dismissCandidate(albumId),
    );
  };

  const handleMarkKnown = (albumId: number) => {
    removeCard(
      albumId,
      (item, index) =>
        setItems((current) => [...current.slice(0, index), item, ...current.slice(index)]),
      () => api.markCandidateKnown(albumId),
    );
  };

  const handleRestore = (albumId: number) => {
    removeCard(
      albumId,
      (item, index) =>
        setItems((current) => [...current.slice(0, index), item, ...current.slice(index)]),
      () => api.restoreCandidate(albumId),
    );
  };

  const handleToggleQueue = (albumId: number) => {
    const wasQueued = queue.has(albumId);
    setQueue((current) => {
      const next = new Set(current);
      if (wasQueued) next.delete(albumId);
      else next.add(albumId);
      return next;
    });
    withBusy(albumId, async () => {
      try {
        if (wasQueued) await api.removeFromQueue(albumId);
        else await api.addToQueue(albumId);
      } catch (err) {
        setQueue((current) => {
          const next = new Set(current);
          if (wasQueued) next.add(albumId);
          else next.delete(albumId);
          return next;
        });
        push(describeError(err), "error");
      }
    });
  };

  return (
    <div>
      <header className="page-header">
        <h1>Discover</h1>
      </header>

      <div className="filters-bar">
        <div className="status-tabs" role="tablist" aria-label="Candidate status">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={status === tab.value}
              className={status === tab.value ? "is-active" : ""}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="method-pills" aria-label="Discovery method">
          {METHOD_PILLS.map((pill) => (
            <button
              key={pill.value}
              type="button"
              className={method === pill.value ? "is-active" : ""}
              onClick={() => setMethod(pill.value)}
            >
              {pill.label}
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="genre-filter">Genre</label>
          <input
            id="genre-filter"
            type="text"
            placeholder="e.g. Slowcore"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="min-score-filter">Min score</label>
          <input
            id="min-score-filter"
            type="number"
            min={0}
            max={1}
            step={0.05}
            placeholder="0"
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}

      {loading ? (
        <div className="candidate-list">
          <Skeleton height="120px" />
          <Skeleton height="120px" />
          <Skeleton height="120px" />
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing here.</h3>
          <p>Try a different status tab or loosen the filters.</p>
        </div>
      ) : (
        <>
          <div className="candidate-list">
            {items.map((candidate) => (
              <CandidateCard
                key={candidate.albumId}
                candidate={candidate}
                isQueued={queue.has(candidate.albumId)}
                isPlaying={playingId === candidate.albumId}
                busy={busyIds.has(candidate.albumId)}
                onTogglePlay={() =>
                  setPlayingId((current) =>
                    current === candidate.albumId ? null : candidate.albumId,
                  )
                }
                onToggleQueue={() => handleToggleQueue(candidate.albumId)}
                onDismiss={() => handleDismiss(candidate.albumId)}
                onMarkKnown={() => handleMarkKnown(candidate.albumId)}
                onRestore={() => handleRestore(candidate.albumId)}
              />
            ))}
          </div>
          {items.length < total && (
            <div className="load-more">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : `Load more (${items.length} of ${total})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
