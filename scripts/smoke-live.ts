/**
 * Opt-in live check: runs the real search + page parse against dodi-repacks.site.
 * Read-only GETs to that one host; no hoster page or payload is ever fetched.
 * Not part of `bun test`. Run: bun run smoke
 */
import {
  DODI_ORIGIN,
  buildSearchUrl,
  parseGamePage,
  parseSearchResults,
} from "../src/parse";
import { pickBestHit } from "../src/search";

async function get(url: string): Promise<string> {
  const response = await fetch(url);
  if (response.status === 403) {
    throw new Error(`HTTP 403 from ${url}: the site is blocking plain requests`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.text();
}

// Newest listing on the front page, so one title is always recent.
const front = parseSearchResults(await get(`${DODI_ORIGIN}/`));
const newest = front.filter((hit) => hit.published).sort((a, b) => b.published!.localeCompare(a.published!))[0];

const titles = ["ELDEN RING", "Dragon Age 2", newest?.name ?? "Dune Awakening"];
let failed = false;
for (const title of titles) {
  const hits = parseSearchResults(await get(buildSearchUrl(title)));
  const best = pickBestHit(title, hits);
  console.log(`\n== ${title}${title === newest?.name ? " (newest on front page)" : ""}`);
  console.log(`search: ${hits.length} hit(s); best: ${best ? `${best.name} <${best.url}> published ${best.published}` : "none"}`);
  if (!best) {
    failed = true;
    continue;
  }
  const page = parseGamePage(await get(best.url), best.url);
  if (!page || page.groups.length === 0) {
    console.log("page: no download groups parsed");
    failed = true;
    continue;
  }
  console.log(`page: "${page.name}", repack ${page.repackSize ?? "?"}, final ${page.finalSize ?? "?"}`);
  for (const group of page.groups) {
    console.log(`  [${group.kind}] ${group.label}: ${group.links.map((l) => l.host).join(", ")}`);
  }
}
process.exit(failed ? 1 : 0);
