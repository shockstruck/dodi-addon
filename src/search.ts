import { SearchTool } from "ogi-addon";
import { findBestGameMatch, type Game } from "./string-similarity";
import type { SearchHit } from "./parse";

/** Picks the listing whose cleaned name best matches the store title. */
export function pickBestHit(
  gameName: string,
  hits: SearchHit[],
): SearchHit | null {
  const games: (Game & { hit: SearchHit })[] = hits.map((hit) => ({
    name: hit.name,
    url: hit.url,
    hit,
  }));
  const search = new SearchTool<Game>([], ["name"], {
    threshold: 0.1,
    includeScore: true,
  });
  const match = findBestGameMatch(gameName, games, search);
  return games.find((game) => game.url === match?.url)?.hit ?? null;
}
