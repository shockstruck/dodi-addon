import { describe, expect, test } from "bun:test";
import type { GamePage } from "./parse";
import { buildPageResults, requestService, searchLogLine } from "./results";

const page: GamePage = {
  title: "Some Game (v1.0) [DODI Repack]",
  name: "Some Game",
  url: "https://dodi.example.invalid/some-game/",
  info: {},
  groups: [
    {
      label: "Torrent",
      kind: "repack",
      links: [
        { url: "https://hoster-a.example.invalid/a", host: "hoster-a.example.invalid" },
        { url: "https://hoster-b.example.invalid/b", host: "hoster-b.example.invalid" },
      ],
    },
    {
      label: "Update v1.1",
      kind: "extra",
      links: [{ url: "https://hoster-a.example.invalid/u", host: "hoster-a.example.invalid" }],
    },
  ],
};

describe("buildPageResults", () => {
  test("turns each group into a request result carrying the page manifest, never a task", () => {
    const results = buildPageResults(page);
    expect(results).toEqual([
      {
        downloadType: "request",
        name: "Torrent (repack) | Some Game",
        manifest: {
          service: "page",
          pageUrl: "https://dodi.example.invalid/some-game/",
          label: "Torrent",
          urls: ["https://hoster-a.example.invalid/a", "https://hoster-b.example.invalid/b"],
        },
      },
      {
        downloadType: "request",
        name: "Update v1.1 (update) | Some Game",
        manifest: {
          service: "page",
          pageUrl: "https://dodi.example.invalid/some-game/",
          label: "Update v1.1",
          urls: ["https://hoster-a.example.invalid/u"],
        },
      },
    ]);
    expect(results.some((r) => r.downloadType === "task")).toBe(false);
  });

  test("no page means no results", () => {
    expect(buildPageResults(null)).toEqual([]);
  });
});

describe("requestService", () => {
  test("dispatches on manifest.service", () => {
    expect(requestService({ service: "local" })).toBe("local");
    expect(requestService({ service: "page", urls: [] })).toBe("page");
  });

  test("anything else is unknown", () => {
    expect(requestService(undefined)).toBeNull();
    expect(requestService({})).toBeNull();
    expect(requestService({ service: "torrent" })).toBeNull();
  });
});

describe("searchLogLine", () => {
  test("reports titles and counts only", () => {
    expect(searchLogLine("Some Game", 3, "Some Game: Deluxe", 2)).toBe(
      'DODI lookup for "Some Game": 3 hits, best "Some Game: Deluxe", 2 groups',
    );
    expect(searchLogLine("Zzz", 0, null, 0)).toBe(
      'DODI lookup for "Zzz": 0 hits, best "none", 0 groups',
    );
  });
});
