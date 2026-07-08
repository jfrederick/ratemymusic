import { describe, expect, it } from "vitest";
import type { CandidateView } from "../src/api";
import { buildEvidenceLine } from "../src/evidence";

function baseCandidate(overrides: Partial<CandidateView> = {}): CandidateView {
  return {
    albumId: 1,
    score: 0.8,
    status: "new",
    components: {},
    artist: "Have a Nice Life",
    title: "Deathconsciousness",
    year: 2008,
    rymUrl: "/release/album/have-a-nice-life/deathconsciousness/",
    genres: ["Slowcore"],
    descriptors: ["melancholic"],
    rymAvgRating: 3.82,
    rymNumRatings: 27931,
    spotifyAlbumId: "abc123",
    ...overrides,
  };
}

describe("buildEvidenceLine", () => {
  it("formats the list method as 'On N lists you love: ...'", () => {
    const candidate = baseCandidate({
      components: {
        list: {
          score: 0.5,
          evidence: {
            method: "list",
            lists: [
              { rymUrl: "/list/a/", title: "Dark Winter", affinity: 0.9 },
              { rymUrl: "/list/b/", title: "Cold Waves", affinity: 0.7 },
              { rymUrl: "/list/c/", title: "Nordic Doom", affinity: 0.6 },
            ],
          },
        },
      },
    });
    expect(buildEvidenceLine(candidate)).toBe(
      "On 3 lists you love: Dark Winter, Cold Waves, +1 more",
    );
  });

  it("uses singular 'list' for exactly one list", () => {
    const candidate = baseCandidate({
      components: {
        list: {
          score: 0.5,
          evidence: {
            method: "list",
            lists: [{ rymUrl: "/list/a/", title: "Dark Winter", affinity: 0.9 }],
          },
        },
      },
    });
    expect(buildEvidenceLine(candidate)).toBe("On 1 list you love: Dark Winter");
  });

  it("formats the twin method with the top-rated twin", () => {
    const candidate = baseCandidate({
      components: {
        twin: {
          score: 0.4,
          evidence: {
            method: "twin",
            twins: [
              { username: "sad_boy_99", affinity: 0.6, rating: 4.0 },
              { username: "ghost_note", affinity: 0.8, rating: 5.0 },
            ],
          },
        },
      },
    });
    expect(buildEvidenceLine(candidate)).toBe("taste-twin ghost_note rated it 5.0 (+1 more)");
  });

  it("formats the genre method as '#N in Genre'", () => {
    const candidate = baseCandidate({
      components: {
        genre: {
          score: 0.3,
          evidence: {
            method: "genre",
            charts: [
              { rymUrl: "/x/", genre: "Slowcore", position: 7 },
              { rymUrl: "/y/", genre: "Slowcore", position: 4 },
            ],
          },
        },
      },
    });
    expect(buildEvidenceLine(candidate)).toBe("#4 in Slowcore");
  });

  it("formats the descriptor method as '#N among \"descriptor\" picks'", () => {
    const candidate = baseCandidate({
      components: {
        descriptor: {
          score: 0.2,
          evidence: {
            method: "descriptor",
            charts: [{ rymUrl: "/z/", descriptor: "melancholic", position: 12 }],
          },
        },
      },
    });
    expect(buildEvidenceLine(candidate)).toBe('#12 among "melancholic" picks');
  });

  it("formats the new method as '#N on the new-music chart'", () => {
    const candidate = baseCandidate({
      components: {
        new: {
          score: 0.1,
          evidence: { method: "new", charts: [{ rymUrl: "/n/", position: 23 }] },
        },
      },
    });
    expect(buildEvidenceLine(candidate)).toBe("#23 on the new-music chart");
  });

  it("joins multiple present methods with a middle dot, in list/twin/genre/descriptor/new order", () => {
    const candidate = baseCandidate({
      components: {
        genre: {
          score: 0.3,
          evidence: {
            method: "genre",
            charts: [{ rymUrl: "/y/", genre: "Slowcore", position: 4 }],
          },
        },
        list: {
          score: 0.5,
          evidence: {
            method: "list",
            lists: [{ rymUrl: "/list/a/", title: "Dark Winter", affinity: 0.9 }],
          },
        },
        twin: {
          score: 0.4,
          evidence: {
            method: "twin",
            twins: [{ username: "ghost_note", affinity: 0.8, rating: 5.0 }],
          },
        },
      },
    });
    expect(buildEvidenceLine(candidate)).toBe(
      "On 1 list you love: Dark Winter · taste-twin ghost_note rated it 5.0 · #4 in Slowcore",
    );
  });

  it("falls back to a generic line when no components are present", () => {
    const candidate = baseCandidate({ components: {} });
    expect(buildEvidenceLine(candidate)).toBe("Surfaced by your taste profile.");
  });
});
