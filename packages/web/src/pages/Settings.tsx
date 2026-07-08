import { useEffect, useState } from "react";
import { type StatusResponse, api, describeError } from "../api";
import { Skeleton } from "../components/Skeleton";
import { useToast } from "../toast";

// Single-user tool; the RYM account mined for taste data is configured server-side and
// isn't part of the API contract, so it's surfaced here as a fixed label.
const RYM_USERNAME = "jimbof36";

const SPEC_URL =
  "https://github.com/jfrederick/ratemymusic/blob/main/docs/superpowers/specs/2026-07-08-ratemymusic-design.md";
const ROADMAP_URL =
  "https://github.com/jfrederick/ratemymusic/blob/main/docs/superpowers/plans/2026-07-08-ratemymusic-roadmap.md";

export function Settings() {
  const { push } = useToast();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getStatus()
      .then(setStatus)
      .catch((err) => setError(describeError(err)));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("spotify") === "connected") {
      push("Spotify connected.", "success");
      params.delete("spotify");
      const rest = params.toString();
      const cleanUrl = `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`;
      window.history.replaceState(null, "", cleanUrl);
    }
    // Runs once on mount to consume the OAuth-redirect query param.
  }, [push]);

  return (
    <div>
      <header className="page-header">
        <h1>Settings</h1>
      </header>

      {error && <p className="error-banner">{error}</p>}

      {!status ? (
        <Skeleton height="200px" />
      ) : (
        <div className="stack">
          <section className="card">
            <p className="section-title">Connections</p>
            <p>
              Spotify:{" "}
              {status.spotifyConnected ? (
                <span className="status-pill status-pill--ok">
                  <span className="status-dot" /> Connected
                </span>
              ) : (
                <span className="status-pill status-pill--warn">
                  <span className="status-dot" /> Not connected
                </span>
              )}
            </p>
            <p style={{ marginTop: 10, color: "var(--text-muted)" }}>
              RateYourMusic account: <span className="score-badge">{RYM_USERNAME}</span>
            </p>
          </section>

          <section className="card">
            <p className="section-title">Crawl budget caps</p>
            <p>
              Daily cap: <span className="score-badge">{status.budget.daily.toLocaleString()}</span>
            </p>
            <p style={{ marginTop: 8 }}>
              Total cap:{" "}
              <span className="score-badge">{status.budget.initial.toLocaleString()}</span>
            </p>
          </section>

          <section className="card">
            <p className="section-title">Reference</p>
            <ul className="stack" style={{ gap: 8 }}>
              <li>
                <a href={SPEC_URL} target="_blank" rel="noreferrer">
                  Design spec
                </a>
              </li>
              <li>
                <a href={ROADMAP_URL} target="_blank" rel="noreferrer">
                  Roadmap / runbook
                </a>
              </li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
