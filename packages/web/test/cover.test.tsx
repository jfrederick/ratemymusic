import { describe, expect, it } from "vitest";
import { hueFromAlbumId, initialsFromCandidate } from "../src/cover";

describe("hueFromAlbumId", () => {
  it("returns a value in [0, 360) for any non-negative integer id", () => {
    for (const id of [0, 1, 2, 3, 100, 9999, 123456]) {
      const hue = hueFromAlbumId(id);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("is deterministic for the same id", () => {
    expect(hueFromAlbumId(42)).toBe(hueFromAlbumId(42));
  });

  it("distributes sequential ids away from each other (golden-angle spread)", () => {
    const a = hueFromAlbumId(1);
    const b = hueFromAlbumId(2);
    expect(Math.abs(a - b)).toBeGreaterThan(30);
  });
});

describe("initialsFromCandidate", () => {
  it("takes the first letter of artist and title, uppercased", () => {
    expect(initialsFromCandidate("Have a Nice Life", "Deathconsciousness")).toBe("HD");
  });

  it("falls back to '??' when both fields are empty", () => {
    expect(initialsFromCandidate("", "")).toBe("??");
  });

  it("handles a missing title gracefully", () => {
    expect(initialsFromCandidate("Boards of Canada", "")).toBe("B?");
  });
});
