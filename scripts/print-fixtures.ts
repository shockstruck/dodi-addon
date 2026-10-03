import { readFileSync } from "node:fs";
import { parseGamePage, parseSearchResults } from "../src/parse";
import { pickBestHit } from "../src/search";

const dir = new URL("../tests/fixtures/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), "utf-8");

const hits = parseSearchResults(read("search-elden-ring.html"));
console.log("search-elden-ring.html ->", JSON.stringify(hits, null, 2));
console.log("best match for 'ELDEN RING':", pickBestHit("ELDEN RING", hits)?.url);
console.log(
  "search-empty.html ->",
  JSON.stringify(parseSearchResults(read("search-empty.html"))),
);
const page = parseGamePage(read("game-elden-ring.html"), "https://dodi-repacks.site/elden-ring/");
console.log("game-elden-ring.html ->", JSON.stringify(page, null, 2));
