import { describe, expect, it } from "vitest";
import {
  absoluteRymUrl,
  canonicalRymUrl,
  collectionUrl,
  genrePageUrl,
  genreSlugFromUrl,
  newMusicUrl,
} from "../../src/rym/urls.js";

describe("canonicalRymUrl", () => {
  it("strips origin, query, and fragment", () => {
    expect(canonicalRymUrl("https://rateyourmusic.com/genre/slowcore/?x=1#frag")).toBe(
      "/genre/slowcore/",
    );
  });

  it("ensures a leading and trailing slash", () => {
    expect(canonicalRymUrl("release/album/bon-iver/for-emma-forever-ago")).toBe(
      "/release/album/bon-iver/for-emma-forever-ago/",
    );
  });

  it("lowercases ordinary paths", () => {
    expect(canonicalRymUrl("https://rateyourmusic.com/Release/Album/Bon-Iver/For-Emma/")).toBe(
      "/release/album/bon-iver/for-emma/",
    );
  });

  it("preserves username case in /collection/<user>/", () => {
    expect(canonicalRymUrl("https://rateyourmusic.com/collection/JimboF36/R5.0")).toBe(
      "/collection/JimboF36/r5.0/",
    );
  });

  it("preserves username case in /~<user>", () => {
    expect(canonicalRymUrl("https://rateyourmusic.com/~JimboF36")).toBe("/~JimboF36/");
  });

  it("preserves author case in /list/<user>/ but lowercases the slug", () => {
    expect(canonicalRymUrl("https://rateyourmusic.com/list/GentlemanCritic/Dark-Winter/")).toBe(
      "/list/GentlemanCritic/dark-winter/",
    );
  });
});

describe("collectionUrl", () => {
  it("builds a tier url without a page", () => {
    expect(collectionUrl("jimbof36", "5.0")).toBe("/collection/jimbof36/r5.0");
  });

  it("builds a tier url with a page", () => {
    expect(collectionUrl("jimbof36", "4.0", 2)).toBe("/collection/jimbof36/r4.0/2");
  });
});

describe("genrePageUrl / newMusicUrl / absoluteRymUrl / genreSlugFromUrl", () => {
  it("builds a genre page url", () => {
    expect(genrePageUrl("slowcore")).toBe("/genre/slowcore/");
  });

  it("builds the new music url", () => {
    expect(newMusicUrl()).toBe("/new-music/");
  });

  it("builds an absolute url from a path", () => {
    expect(absoluteRymUrl("/genre/slowcore/")).toBe("https://rateyourmusic.com/genre/slowcore/");
  });

  it("extracts a genre slug from a genre url", () => {
    expect(genreSlugFromUrl("https://rateyourmusic.com/genre/slowcore/")).toBe("slowcore");
  });

  it("returns null for a non-genre url", () => {
    expect(genreSlugFromUrl("https://rateyourmusic.com/new-music/")).toBeNull();
  });
});
