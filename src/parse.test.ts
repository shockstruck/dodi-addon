import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildSearchUrl,
  cleanTitle,
  hostOf,
  parseGamePage,
  parseSearchResults,
} from "./parse";
import { pickBestHit } from "./search";

const fixture = (name: string) =>
  readFileSync(new URL(`../tests/fixtures/${name}`, import.meta.url), "utf-8");

describe("cleanTitle", () => {
  test("strips post number, parenthesised blocks and the repack tag", () => {
    expect(
      cleanTitle(
        "1269- ELDEN RING: Deluxe Edition + Shadow of the Erdtree Premium Bundle ( + Update v1.17 / Tarnished Update + All DLCs + MULTi15) (From 49.9 GB) [DODI Repack]",
      ),
    ).toBe("ELDEN RING: Deluxe Edition + Shadow of the Erdtree Premium Bundle");
    expect(cleanTitle("1003- Dragon Age 2 Ultimate Edition (v1.04 + All DLCs + MULTi7) [DODI Repack]")).toBe(
      "Dragon Age 2 Ultimate Edition",
    );
  });

  test("keeps parentheses that are part of the name", () => {
    expect(cleanTitle("12- Game (Remastered) Edition (v1.0) [DODI Repack]")).toBe(
      "Game (Remastered) Edition",
    );
  });

  test("leaves an undecorated title alone", () => {
    expect(cleanTitle("Portal")).toBe("Portal");
  });
});

describe("buildSearchUrl", () => {
  test("drops punctuation and encodes spaces as +", () => {
    expect(buildSearchUrl("ELDEN RING: Deluxe")).toBe(
      "https://dodi-repacks.site/?s=ELDEN+RING+Deluxe",
    );
  });
});

describe("parseSearchResults", () => {
  const hits = parseSearchResults(fixture("search-elden-ring.html"));

  test("extracts every repack listing", () => {
    expect(hits.map((hit) => hit.url)).toEqual([
      "https://dodi-repacks.site/elden-ring-nightreign/",
      "https://dodi-repacks.site/elden-ring/",
      "https://dodi-repacks.site/dragon-age-2/",
      "https://dodi-repacks.site/803-thehunter-call-of-the-wild-v1898534-all-dlcs-multi10-dodi-repack/",
    ]);
  });

  test("extracts name, post number, size and date", () => {
    expect(hits[1]).toMatchObject({
      name: "ELDEN RING: Deluxe Edition + Shadow of the Erdtree Premium Bundle",
      postNumber: 1269,
      size: "From 49.9 GB",
      published: "2026-08-28T00:00:16+00:00",
    });
    expect(hits[2]?.size).toBeUndefined();
  });

  test("returns nothing for the no-results page", () => {
    expect(parseSearchResults(fixture("search-empty.html"))).toEqual([]);
  });

  test("picks the base game over the spin-off", () => {
    expect(pickBestHit("ELDEN RING", hits)?.url).toBe(
      "https://dodi-repacks.site/elden-ring/",
    );
    expect(pickBestHit("Elden Ring Nightreign", hits)?.url).toBe(
      "https://dodi-repacks.site/elden-ring-nightreign/",
    );
  });

  test("returns null when nothing is close", () => {
    expect(pickBestHit("Stardew Valley", hits)).toBeNull();
  });
});

describe("parseGamePage", () => {
  const page = parseGamePage(
    fixture("game-elden-ring.html"),
    "https://dodi-repacks.site/elden-ring/",
  );

  test("parses the page", () => {
    expect(page).not.toBeNull();
    expect(page?.name).toBe(
      "ELDEN RING: Deluxe Edition + Shadow of the Erdtree Premium Bundle",
    );
    expect(page?.repackSize).toBe("49.9 GB");
    expect(page?.finalSize).toBe("69.1 GB");
    expect(page?.coverImage).toStartWith("https://");
  });

  test("extracts the info block", () => {
    expect(page?.info).toMatchObject({
      Genre: "Action / RPG",
      Developer: "FromSoftware Inc.",
      "Game version": "v1.16",
      Crack: "RUNE / 0xdeadc0de",
    });
  });

  test("groups download links by label and splits repack from extras", () => {
    const summary = page?.groups.map((group) => [
      group.label,
      group.kind,
      group.links.length,
    ]);
    expect(summary).toEqual([
      ["Torrent", "repack", 3],
      ["SwiftUploads", "repack", 2],
      ["DataNodes", "repack", 2],
      ["Update v1.16.1", "extra", 2],
      ["Update v1.17 / Tarnished Pack", "extra", 2],
      ["Alternative links", "extra", 2],
    ]);
  });

  test("ignores site-internal and video links", () => {
    const urls = page?.groups.flatMap((group) => group.links.map((l) => l.url));
    expect(urls?.some((url) => url.includes("youtu.be"))).toBe(false);
    expect(urls?.some((url) => url.includes("dodi-repacks.site"))).toBe(false);
  });

  test("returns null for a page that is not a post", () => {
    expect(parseGamePage("<html><body>hi</body></html>", "https://x.test/")).toBeNull();
  });
});

describe("hostOf", () => {
  test("strips www and tolerates garbage", () => {
    expect(hostOf("https://www.up-4ever.net/abc")).toBe("up-4ever.net");
    expect(hostOf("not a url")).toBe("");
  });
});
