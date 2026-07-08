import type { CandidateView } from "../api";
import { buildEvidenceLine } from "../evidence";
import { CandidateEmbed, CoverArt } from "./CoverArt";
import { IconCheck, IconPlus, IconX } from "./Icon";

const RYM_ORIGIN = "https://rateyourmusic.com";

function ratingLine(candidate: CandidateView): string | null {
  if (candidate.rymAvgRating === null || candidate.rymNumRatings === null) return null;
  return `${candidate.rymAvgRating.toFixed(2)} · ${candidate.rymNumRatings.toLocaleString()} ratings`;
}

export function CandidateCard({
  candidate,
  isQueued,
  isPlaying,
  busy = false,
  onTogglePlay,
  onToggleQueue,
  onDismiss,
  onMarkKnown,
  onRestore,
}: {
  candidate: CandidateView;
  isQueued: boolean;
  isPlaying: boolean;
  busy?: boolean;
  onTogglePlay: () => void;
  onToggleQueue: () => void;
  onDismiss: () => void;
  onMarkKnown: () => void;
  onRestore: () => void;
}) {
  const rating = ratingLine(candidate);
  const evidence = buildEvidenceLine(candidate);

  return (
    <article className="card candidate-card" data-testid={`candidate-${candidate.albumId}`}>
      <CoverArt candidate={candidate} isPlaying={isPlaying} onTogglePlay={onTogglePlay} />

      <div className="candidate-card__body">
        <div className="candidate-card__heading">
          <h3 className="candidate-card__title">
            <a
              href={`${RYM_ORIGIN}${candidate.rymUrl}`}
              target="_blank"
              rel="noreferrer"
              title="Open on RateYourMusic"
            >
              {candidate.artist} - {candidate.title}
            </a>{" "}
            {candidate.year !== null && <span>({candidate.year})</span>}
          </h3>
          <span className="score-badge">{candidate.score.toFixed(2)}</span>
        </div>

        <p className="candidate-card__meta">
          {rating ? <span className="rym-rating">{rating}</span> : "Not yet rated on RYM"}
        </p>

        <p className="candidate-card__evidence">{evidence}</p>

        {candidate.genres.length > 0 && (
          <div className="candidate-card__chips chip-row">
            {candidate.genres.map((genre) => (
              <span className="chip" key={genre}>
                {genre}
              </span>
            ))}
          </div>
        )}

        {isPlaying && candidate.spotifyAlbumId && (
          <CandidateEmbed spotifyAlbumId={candidate.spotifyAlbumId} />
        )}
      </div>

      <div className="candidate-card__actions">
        <button
          type="button"
          className={`icon-btn${isQueued ? " is-active" : ""}`}
          aria-label={
            isQueued ? `Remove ${candidate.title} from queue` : `Queue ${candidate.title}`
          }
          aria-pressed={isQueued}
          onClick={onToggleQueue}
          disabled={busy}
        >
          {isQueued ? <IconCheck /> : <IconPlus />}
        </button>
        {candidate.status === "new" ? (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Dismiss ${candidate.title}`}
              onClick={onDismiss}
              disabled={busy}
            >
              <IconX />
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={onMarkKnown}
              disabled={busy}
            >
              Already know it
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={onRestore}
            disabled={busy}
          >
            Restore to New
          </button>
        )}
      </div>
    </article>
  );
}
