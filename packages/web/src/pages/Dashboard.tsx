import { useCallback, useEffect, useState } from "react";
import { ApiError, type StatusResponse, type TasteProfile, api, describeError } from "../api";
import { BudgetMeter } from "../components/BudgetMeter";
import { EraRow } from "../components/EraRow";
import { IconRefresh, IconSparkle } from "../components/Icon";
import { Skeleton } from "../components/Skeleton";
import { WeightedBars } from "../components/WeightedBars";
import { useToast } from "../toast";

function formatSyncSummary(status: StatusResponse): string {
  const sync = status.lastSync;
  if (!sync) return "No sync has run yet.";
  const pages = sync.pagesScraped;
  const cached = sync.fromCache;
  const failures = sync.parseFailures.length;
  const budgetNote = sync.budgetExhausted ? " (stopped: budget exhausted)" : "";
  const failureNote = failures > 0 ? `, ${failures} parse failure${failures === 1 ? "" : "s"}` : "";
  return `Last sync scraped ${pages} page${pages === 1 ? "" : "s"} (${cached} from cache)${failureNote}${budgetNote}.`;
}

export function Dashboard() {
  const { push } = useToast();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [profile, setProfile] = useState<TasteProfile | null>(null);
  const [profileMissing, setProfileMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusResult, profileResult] = await Promise.allSettled([
        api.getStatus(),
        api.getProfile(),
      ]);
      if (statusResult.status === "fulfilled") {
        setStatus(statusResult.value);
      } else {
        setError(describeError(statusResult.reason));
      }
      if (profileResult.status === "fulfilled") {
        setProfile(profileResult.value);
        setProfileMissing(false);
      } else if (profileResult.reason instanceof ApiError && profileResult.reason.status === 404) {
        setProfileMissing(true);
      } else {
        setError((current) => current ?? describeError(profileResult.reason));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runSync = async () => {
    setSyncing(true);
    try {
      await api.sync(25);
      push("Sync complete.", "success");
      await load();
    } catch (err) {
      push(describeError(err), "error");
    } finally {
      setSyncing(false);
    }
  };

  const runDiscover = async () => {
    setDiscovering(true);
    try {
      const result = await api.discover();
      // `result.candidates` is the total count of status='new' candidates after this run, not
      // the delta produced by it -- "found N new" would overstate/understate what changed. State
      // it as what it actually is (M9).
      push(`${result.candidates} candidate${result.candidates === 1 ? "" : "s"} ready.`, "success");
      await load();
    } catch (err) {
      push(describeError(err), "error");
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <div>
      <header className="page-header">
        <h1>Dashboard</h1>
        <div className="page-header__actions">
          <button type="button" className="btn btn--ghost" onClick={runSync} disabled={syncing}>
            <IconRefresh size={16} />
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={runDiscover}
            disabled={discovering}
          >
            <IconSparkle size={16} />
            {discovering ? "Discovering…" : "Discover now"}
          </button>
        </div>
      </header>

      {error && <p className="error-banner">{error}</p>}

      {status?.lastCronError && (
        <p className="error-banner">
          Last automated run failed at step "{status.lastCronError.step}":{" "}
          {status.lastCronError.message} ({new Date(status.lastCronError.at).toLocaleString()})
        </p>
      )}

      {loading && !status ? (
        <div className="stack">
          <Skeleton height="80px" />
          <Skeleton height="160px" />
        </div>
      ) : status ? (
        <div className="stack">
          <section className="card">
            <p className="section-title">Spotify</p>
            {status.spotifyConnected ? (
              <span className="status-pill status-pill--ok">
                <span className="status-dot" /> Connected
              </span>
            ) : (
              <a className="btn btn--primary" href="/auth/spotify">
                Connect Spotify
              </a>
            )}
          </section>

          <section className="card">
            <p className="section-title">Library</p>
            <div className="counts-strip">
              <div>
                <div className="count-tile__value">{status.counts.albums.toLocaleString()}</div>
                <div className="count-tile__label">Albums in graph</div>
              </div>
              <div>
                <div className="count-tile__value">
                  {status.counts.candidatesNew.toLocaleString()}
                </div>
                <div className="count-tile__label">Fresh candidates</div>
              </div>
              <div>
                <div className="count-tile__value">{status.counts.myRatings.toLocaleString()}</div>
                <div className="count-tile__label">Your ratings</div>
              </div>
              <div>
                <div className="count-tile__value">{status.counts.lists.toLocaleString()}</div>
                <div className="count-tile__label">Lists tracked</div>
              </div>
              <div>
                <div className="count-tile__value">{status.counts.twins.toLocaleString()}</div>
                <div className="count-tile__label">Taste twins</div>
              </div>
            </div>
          </section>

          <section className="card">
            <p className="section-title">Crawl budget</p>
            <BudgetMeter budget={status.budget} />
          </section>

          <section className="card">
            <p className="section-title">Last sync</p>
            <p>{formatSyncSummary(status)}</p>
          </section>

          <section className="card">
            <p className="section-title">Taste profile</p>
            {profileMissing ? (
              <p className="empty-state">
                Taste profile hasn't been computed yet. Run a sync, then Discover now.
              </p>
            ) : profile ? (
              <div className="two-col">
                <div>
                  <p className="section-title">Genres</p>
                  <WeightedBars weights={profile.genres} limit={12} />
                </div>
                <div>
                  <p className="section-title">Descriptors</p>
                  <WeightedBars weights={profile.descriptors} limit={12} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <p className="section-title">Era distribution</p>
                  <EraRow eras={profile.eras} />
                </div>
              </div>
            ) : (
              <Skeleton height="120px" />
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
