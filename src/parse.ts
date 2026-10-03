import { JSDOM } from "jsdom";

export const DODI_ORIGIN = "https://dodi-repacks.site";

export type SearchHit = {
  /** Full post title as shown on the site. */
  title: string;
  /** Game name with the post number, version, size and "[DODI Repack]" stripped. */
  name: string;
  url: string;
  /** DODI's running post number (the "2150-" prefix), if present. */
  postNumber?: number;
  /** "From 20.2 GB", as shown in the title. */
  size?: string;
  published?: string;
};

export type DownloadLink = { url: string; host: string };

export type DownloadGroup = {
  /** Label shown on the page, e.g. "Torrent", "DataNodes", "Update v1.17 / Tarnished Pack". */
  label: string;
  /** "repack" links sit above the page's <hr>; everything after it is an update or alternative. */
  kind: "repack" | "extra";
  links: DownloadLink[];
};

export type GamePage = {
  title: string;
  name: string;
  url: string;
  coverImage?: string;
  info: Record<string, string>;
  repackSize?: string;
  finalSize?: string;
  groups: DownloadGroup[];
};

const WS = /\s+/g;
const clean = (text: string | null | undefined) =>
  (text ?? "").replace(/ /g, " ").replace(WS, " ").trim();

/**
 * Strips DODI's title decoration: the "1269-" post number, every trailing
 * parenthesised block (version, DLCs, size) and the "[DODI Repack]" tag.
 */
export function cleanTitle(title: string): string {
  return clean(title)
    .replace(/^\d+\s*-\s*/, "")
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .replace(/(\s*\([^()]*(?:\([^()]*\)[^()]*)*\))+\s*$/, "")
    .trim();
}

function postNumber(title: string): number | undefined {
  const match = /^\s*(\d+)\s*-/.exec(title);
  return match ? Number(match[1]) : undefined;
}

function titleSize(title: string): string | undefined {
  return /\(\s*(From\s+[\d.,]+\s*[KMGT]B)\s*\)/i.exec(title)?.[1];
}

export function buildSearchUrl(name: string): string {
  const query = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(WS, " ")
    .trim();
  return `${DODI_ORIGIN}/?s=${encodeURIComponent(query).replace(/%20/g, "+")}`;
}

export function parseSearchResults(html: string): SearchHit[] {
  const { document } = new JSDOM(html).window;
  const hits: SearchHit[] = [];
  for (const article of document.querySelectorAll("article.post")) {
    const anchor = article.querySelector<HTMLAnchorElement>(
      "h2.entry-title a[href]",
    );
    if (!anchor) continue;
    const title = clean(anchor.textContent);
    if (!/\[DODI Repack\]/i.test(title)) continue;
    hits.push({
      title,
      name: cleanTitle(title),
      url: anchor.href,
      postNumber: postNumber(title),
      size: titleSize(title),
      published:
        article
          .querySelector("time.entry-date.published")
          ?.getAttribute("datetime") ?? undefined,
    });
  }
  return hits;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isExternalLink(href: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.replace(/^www\./, "");
  return (
    host !== new URL(DODI_ORIGIN).hostname &&
    !/(^|\.)(youtube\.com|youtu\.be)$/.test(host)
  );
}

/** "Torrent – Click Here – or – Click Here –" -> "Torrent". */
function groupLabel(block: Element): string {
  const text = clean(block.textContent);
  const label = text.split(/\s[–—-]\s/)[0] ?? "";
  return clean(label.replace(/click here/gi, ""));
}

function infoFrom(content: Element): Record<string, string> {
  const info: Record<string, string> = {};
  const body = content.querySelector(".sp-body");
  if (!body) return info;
  for (const line of body.innerHTML.split(/<br\s*\/?>/i)) {
    const text = clean(new JSDOM(`<p>${line}</p>`).window.document.body.textContent);
    const match = /^([A-Za-z][A-Za-z ]{1,24}?)\s*:\s*(.+)$/.exec(text);
    if (match && !/^(minimum|recommended)/i.test(match[1])) {
      // The page does not close the info block before the requirements, so the
      // last field can run into the "SYSTEM REQUIREMENTS:" heading.
      info[match[1].trim()] = match[2].replace(/\s*SYSTEM REQUIREMENTS:?\s*$/i, "").trim();
    }
  }
  return info;
}

function sizeAfter(label: string, content: Element): string | undefined {
  const text = clean(content.textContent);
  return new RegExp(`${label}\\s*:\\s*(?:From\\s+)?([\\d.,]+\\s*[KMGT]B)`, "i").exec(
    text,
  )?.[1];
}

export function parseGamePage(html: string, url: string): GamePage | null {
  const { document } = new JSDOM(html, { url }).window;
  const titleEl = document.querySelector("h1.entry-title");
  const content = document.querySelector(".entry-content");
  if (!titleEl || !content) return null;
  const title = clean(titleEl.textContent);

  const hr = content.querySelector("hr");
  const groups = new Map<Element, DownloadGroup>();
  for (const anchor of content.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (!isExternalLink(anchor.href)) continue;
    // Skip the YouTube/gameplay heading and other non-download links.
    if (!/click here/i.test(anchor.textContent ?? "")) continue;
    const block = anchor.closest("li, p");
    if (!block) continue;
    let group = groups.get(block);
    if (!group) {
      const afterRule =
        !!hr &&
        !!(hr.compareDocumentPosition(anchor) & 4) /* DOCUMENT_POSITION_FOLLOWING */;
      group = {
        label: groupLabel(block) || hostOf(anchor.href),
        kind: afterRule ? "extra" : "repack",
        links: [],
      };
      groups.set(block, group);
    }
    if (!group.links.some((link) => link.url === anchor.href)) {
      group.links.push({ url: anchor.href, host: hostOf(anchor.href) });
    }
  }

  return {
    title,
    name: cleanTitle(title),
    url,
    coverImage: content.querySelector("img")?.getAttribute("src") ?? undefined,
    info: infoFrom(content),
    repackSize: sizeAfter("Repack Size", content),
    finalSize: sizeAfter("Final Size", content),
    groups: [...groups.values()],
  };
}
