import type { SearchResult } from "ogi-addon";
import type { GamePage } from "./parse";

/**
 * One `request` result per download group. OGI hides `task` results for games
 * the user does not own, so the repacks are offered as requests instead; the
 * `request-dl` handler then opens the page and asks for the extracted setup.exe.
 */
export function buildPageResults(page: GamePage | null): SearchResult[] {
  return (page?.groups ?? []).map((group) => ({
    downloadType: "request",
    name: `${group.label} (${group.kind === "repack" ? "repack" : "update"}) | ${page!.name}`,
    manifest: {
      service: "page",
      pageUrl: page!.url,
      label: group.label,
      urls: group.links.map((link) => link.url),
    },
  }));
}

/** Which `request-dl` flow a manifest asks for, or null when it is not one of ours. */
export function requestService(
  manifest: Record<string, unknown> | undefined,
): "local" | "page" | null {
  const service = manifest?.service;
  return service === "local" || service === "page" ? service : null;
}

/** Titles and counts only: no URLs. */
export function searchLogLine(
  name: string,
  hits: number,
  best: string | null,
  groups: number,
): string {
  return `DODI lookup for "${name}": ${hits} hits, best "${best ?? "none"}", ${groups} groups`;
}
