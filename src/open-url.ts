/**
 * Command line that opens `url` in the user's default browser, or null when
 * the URL is not plain http(s). Args are returned as an array so nothing is
 * ever passed through a shell.
 */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform,
): { command: string; args: string[] } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (platform === "win32") {
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", parsed.href] };
  }
  if (platform === "darwin") return { command: "open", args: [parsed.href] };
  return { command: "xdg-open", args: [parsed.href] };
}
