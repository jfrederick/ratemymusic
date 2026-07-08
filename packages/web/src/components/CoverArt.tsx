import type { CandidateView } from "../api";
import { hueFromAlbumId, initialsFromCandidate } from "../cover";
import { IconPlay, IconStop } from "./Icon";

/**
 * We don't store cover art URLs. When a Spotify id exists, the play button reveals the
 * real embed (see CandidateEmbed); until then, and always as the resting state, this
 * typographic placeholder carries the color so the grid doesn't read as flat rows of text.
 */
export function CoverArt({
  candidate,
  isPlaying,
  onTogglePlay,
}: {
  candidate: CandidateView;
  isPlaying: boolean;
  onTogglePlay: () => void;
}) {
  const hue = hueFromAlbumId(candidate.albumId);
  const initials = initialsFromCandidate(candidate.artist, candidate.title);
  const canPreview = Boolean(candidate.spotifyAlbumId);

  return (
    <div className="candidate-card__cover">
      <div
        className="candidate-card__cover-placeholder"
        style={{
          background: `linear-gradient(155deg, hsl(${hue} 52% 36%), hsl(${(hue + 30) % 360} 40% 20%))`,
        }}
      >
        {initials}
      </div>
      {canPreview && (
        <button
          type="button"
          className="candidate-card__play"
          aria-label={
            isPlaying ? `Stop preview of ${candidate.title}` : `Preview ${candidate.title}`
          }
          aria-pressed={isPlaying}
          onClick={onTogglePlay}
        >
          {isPlaying ? <IconStop size={20} /> : <IconPlay size={20} />}
        </button>
      )}
    </div>
  );
}

export function CandidateEmbed({ spotifyAlbumId }: { spotifyAlbumId: string }) {
  return (
    <div className="candidate-card__embed">
      <iframe
        title="Spotify preview"
        src={`https://open.spotify.com/embed/album/${spotifyAlbumId}?theme=0`}
        height={152}
        allow="encrypted-media"
        loading="lazy"
      />
    </div>
  );
}
