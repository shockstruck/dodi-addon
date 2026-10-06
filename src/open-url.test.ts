import { describe, expect, test } from "bun:test";
import { browserCommand } from "./open-url";

describe("browserCommand", () => {
  test("uses the platform opener without a shell", () => {
    expect(browserCommand("https://a.test/x", "linux")).toEqual({
      command: "xdg-open",
      args: ["https://a.test/x"],
    });
    expect(browserCommand("https://a.test/x", "darwin")?.command).toBe("open");
    expect(browserCommand("https://a.test/x", "win32")?.command).toBe("rundll32");
  });

  test("refuses anything that is not http(s)", () => {
    expect(browserCommand("file:///etc/passwd", "linux")).toBeNull();
    expect(browserCommand("javascript:alert(1)", "linux")).toBeNull();
    expect(browserCommand("magnet:?xt=urn:btih:abc", "linux")).toBeNull();
    expect(browserCommand("nope", "linux")).toBeNull();
  });

  test("an override command replaces the platform opener but keeps the http(s) check", () => {
    expect(browserCommand("https://a.test/x", "linux", "/opt/stub")).toEqual({
      command: "/opt/stub",
      args: ["https://a.test/x"],
    });
    expect(browserCommand("file:///etc/passwd", "linux", "/opt/stub")).toBeNull();
  });
});
