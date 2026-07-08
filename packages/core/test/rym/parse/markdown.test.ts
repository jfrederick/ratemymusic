import { describe, expect, it } from "vitest";
import {
  extractLinks,
  extractNextPageUrl,
  extractReleaseItems,
  splitTableRow,
  unescapeMarkdown,
} from "../../../src/rym/parse/markdown.js";

describe("extractLinks", () => {
  it("extracts a plain link with text and href", () => {
    const links = extractLinks("[Bon Iver](https://rateyourmusic.com/artist/bon-iver)");
    expect(links).toEqual([
      {
        text: "Bon Iver",
        href: "https://rateyourmusic.com/artist/bon-iver",
        title: null,
        isImage: false,
        index: 0,
      },
    ]);
  });

  it("extracts a link title attribute, tolerating the RYM footnote quirk", () => {
    const links = extractLinks(
      '[Mingus](https://rateyourmusic.com/artist/charles-mingus "[Artist275]")',
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      text: "Mingus",
      href: "https://rateyourmusic.com/artist/charles-mingus",
      title: "[Artist275]",
      isImage: false,
    });
  });

  it("extracts a standalone image link", () => {
    const links = extractLinks("![5.00 stars](https://cdn.sonemic.net/2.5/img/images/10m.png)");
    expect(links).toEqual([
      {
        text: "5.00 stars",
        href: "https://cdn.sonemic.net/2.5/img/images/10m.png",
        title: null,
        isImage: true,
        index: 0,
      },
    ]);
  });

  it("extracts a wrapped cover-image link (image inside a link) as an image link to the outer href", () => {
    const md =
      "[![For Emma, Forever Ago](https://cdn.sonemic.net/i/75/w/x/1)](https://rateyourmusic.com/release/album/bon-iver/for-emma-forever-ago/)";
    const links = extractLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      text: "For Emma, Forever Ago",
      href: "https://rateyourmusic.com/release/album/bon-iver/for-emma-forever-ago/",
      isImage: true,
    });
  });

  it("tolerates escaped brackets inside link text, and unescapes them in the returned text", () => {
    const md =
      "[Depressive Silence \\[II\\]](https://rateyourmusic.com/release/album/depressive-silence/depressive-silence-ii/)";
    const links = extractLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe("Depressive Silence [II]");
  });

  it("unescapes an escaped underscore in link text (e.g. a RYM username)", () => {
    const links = extractLinks("[No\\_Username](https://rateyourmusic.com/~no_username)");
    expect(links[0].text).toBe("No_Username");
  });

  it("unescapes the title attribute too", () => {
    const links = extractLinks('[X](https://a.example/ "The Beatles \\[White Album\\]")');
    expect(links[0].title).toBe("The Beatles [White Album]");
  });

  it("extracts multiple links in document order with correct indices", () => {
    const md = "[A](https://a.example/) and [B](https://b.example/)";
    const links = extractLinks(md);
    expect(links.map((l) => l.text)).toEqual(["A", "B"]);
    expect(links[0].index).toBe(0);
    expect(links[1].index).toBeGreaterThan(links[0].index);
  });

  it("returns an empty array when there are no links", () => {
    expect(extractLinks("just some plain text")).toEqual([]);
  });
});

describe("unescapeMarkdown", () => {
  it("strips the backslash from an escaped character", () => {
    expect(unescapeMarkdown("Depressive Silence \\[II\\]")).toBe("Depressive Silence [II]");
    expect(unescapeMarkdown("No\\_Username")).toBe("No_Username");
  });

  it("leaves plain text unchanged", () => {
    expect(unescapeMarkdown("Plain Title")).toBe("Plain Title");
  });
});

describe("splitTableRow", () => {
  it("splits a pipe-delimited row into trimmed cells, dropping the outer empty cells", () => {
    expect(splitTableRow("| a | b | c |")).toEqual(["a", "b", "c"]);
  });

  it("preserves empty inner cells", () => {
    expect(splitTableRow("| a |  | c |")).toEqual(["a", "", "c"]);
  });
});

describe("extractNextPageUrl", () => {
  it("finds the link whose text is current-page + 1", () => {
    const md =
      "Page 1 [2](https://rateyourmusic.com/collection/jimbof36/r4.0/2) " +
      "[3](https://rateyourmusic.com/collection/jimbof36/r4.0/3) " +
      "[>>](https://rateyourmusic.com/collection/jimbof36/r4.0/2)";
    expect(extractNextPageUrl(md)).toBe("/collection/jimbof36/r4.0/2");
  });

  it("preserves the raw href shape (no forced trailing slash or case change)", () => {
    const md =
      "Page 1 [2](https://rateyourmusic.com/list/GentlemanCritic/dark-winter/2/) " +
      "[3](https://rateyourmusic.com/list/GentlemanCritic/dark-winter/3/) " +
      "[>>](https://rateyourmusic.com/list/GentlemanCritic/dark-winter/2/)";
    expect(extractNextPageUrl(md)).toBe("/list/GentlemanCritic/dark-winter/2/");
  });

  it("returns null when there is no pagination line", () => {
    expect(extractNextPageUrl("nothing to see here")).toBeNull();
  });
});

describe("extractReleaseItems", () => {
  it("dedupes a cover-image link and its title link, keeping the non-image text", () => {
    const md =
      "[![Vespertine](https://cdn.example/img.png)](https://rateyourmusic.com/release/album/bjork/vespertine/) " +
      "## [Björk](https://rateyourmusic.com/artist/bjork)<br>" +
      "### [Vespertine](https://rateyourmusic.com/release/album/bjork/vespertine/)(2001)";
    const items = extractReleaseItems(md);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      rymUrl: "/release/album/bjork/vespertine/",
      title: "Vespertine",
      artist: "Björk",
      year: 2001,
    });
  });

  it("preserves document order across multiple releases", () => {
    const md =
      "[A](https://rateyourmusic.com/release/album/x/a/) [Artist X](https://rateyourmusic.com/artist/x) " +
      "[B](https://rateyourmusic.com/release/album/y/b/) [Artist Y](https://rateyourmusic.com/artist/y)";
    const items = extractReleaseItems(md);
    expect(items.map((i) => i.rymUrl)).toEqual(["/release/album/x/a/", "/release/album/y/b/"]);
  });

  it("unescapes backslash-escaped brackets in the title", () => {
    const md =
      "[The Beatles \\[White Album\\]](https://rateyourmusic.com/release/album/the-beatles/white-album/) " +
      "[The Beatles](https://rateyourmusic.com/artist/the-beatles)";
    const items = extractReleaseItems(md);
    expect(items[0].title).toBe("The Beatles [White Album]");
  });
});
