import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtureDir = new URL("../fixtures/", import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, fixtureDir), "utf-8");

export type Message = {
  event: string;
  id?: string;
  args: any;
  statusError?: string;
};

/**
 * Local stand-in for dodi-repacks.site that serves the saved fixtures. Only
 * the three pages the tests need exist; anything else is a 404, so a stray
 * request fails loudly instead of leaving the machine.
 */
export function startFixtureSite() {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/" && url.searchParams.has("s")) {
        const query = url.searchParams.get("s")!.toLowerCase();
        return new Response(
          fixture(query.includes("elden") ? "search-elden-ring.html" : "search-empty.html"),
          { headers: { "content-type": "text/html" } },
        );
      }
      if (url.pathname === "/elden-ring/") {
        return new Response(fixture("game-elden-ring.html"), {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { baseUrl: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

type Waiter = { predicate: (m: Message) => boolean; resolve: (m: Message) => void };

/**
 * Minimal OGI addon server: speaks the websocket envelope
 * ({ event, id, args, statusError }) the SDK uses. Records every message the
 * addon sends, answers the addon's own requests (`input-asked`,
 * `get-app-details`) from the registered handlers, and lets a test send
 * server-initiated requests (`search`, `request-dl`, `setup`, `config-update`)
 * and await the correlated `response`.
 */
export function startMockOgi(options: {
  secret: string;
  appName: string;
  inputs: (name: string, description: string, config: Record<string, any>) => Record<string, unknown>;
}) {
  const received: Message[] = [];
  const waiters: Waiter[] = [];
  let socket: { send(data: string): void } | undefined;
  let counter = 0;

  const server = Bun.serve({
    port: 0,
    fetch(request, srv) {
      return srv.upgrade(request) ? undefined : new Response("ws only", { status: 426 });
    },
    websocket: {
      open(ws) {
        socket = ws;
      },
      message(ws, raw) {
        const message = JSON.parse(String(raw)) as Message;
        received.push(message);
        if (message.event === "get-app-details") {
          ws.send(JSON.stringify({ event: "response", id: message.id, args: { name: options.appName, latestVersion: "1.16" } }));
        } else if (message.event === "input-asked") {
          const { name, description, config } = message.args;
          ws.send(JSON.stringify({ event: "response", id: message.id, args: options.inputs(name, description, config) }));
        }
        for (const waiter of [...waiters]) {
          if (waiter.predicate(message)) {
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve(message);
          }
        }
      },
    },
  });

  const waitFor = (predicate: (m: Message) => boolean, label: string, timeoutMs = 20_000) => {
    const existing = received.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}; saw: ${received.map((m) => m.event).join(", ")}`)), timeoutMs);
      waiters.push({ predicate, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  };

  return {
    port: server.port,
    secret: options.secret,
    received,
    waitForEvent: (event: string) => waitFor((m) => m.event === event, event),
    /** Sends a server-initiated request and resolves with the addon's `response`. */
    async request(event: string, args: unknown, timeoutMs = 60_000): Promise<Message> {
      if (!socket) throw new Error("addon has not connected");
      const id = `t${++counter}`;
      const pending = waitFor((m) => m.event === "response" && m.id === id, `response to ${event}`, timeoutMs);
      socket.send(JSON.stringify({ event, id, args }));
      return pending;
    },
    stop: () => server.stop(true),
  };
}

/** Smallest header `executable-detection` accepts: MZ + PE, x64, Windows GUI subsystem. */
export function fakeGameExe(): Buffer {
  const peOffset = 0x40;
  const buffer = Buffer.alloc(256);
  buffer.write("MZ", 0, "ascii");
  buffer.writeUInt32LE(peOffset, 0x3c);
  buffer.writeUInt32LE(0x00004550, peOffset);
  buffer.writeUInt16LE(0x8664, peOffset + 4);
  buffer.writeUInt16LE(0x0102, peOffset + 22);
  buffer.writeUInt16LE(2, peOffset + 24 + 68);
  return buffer;
}

/**
 * Stub for `umu-run`. Records its argv (one arg per line) and creates
 * `Game.exe` where the installer would: in the `Dir=` of the `/LOADINF` file
 * for an unattended run, or in $STUB_INSTALL_DIR for the manual wizard. Exits
 * with $STUB_EXIT_CODE. It never starts Wine.
 */
const STUB_SCRIPT = `#!/bin/sh
printf '%s\\n' "$@" > "$STUB_ARGV_FILE"
target="$STUB_INSTALL_DIR"
for arg in "$@"; do
  case "$arg" in
    /LOADINF=*)
      inf=$(printf '%s' "\${arg#/LOADINF=}" | sed 's/^Z://; s|\\\\|/|g')
      target=$(sed -n 's/^Dir=//p' "$inf" | tr -d '\\r' | sed 's/^Z://; s|\\\\|/|g')
      ;;
  esac
done
[ -n "$STUB_SLEEP" ] && exec sleep "$STUB_SLEEP"
if [ -n "$target" ] && [ -z "$STUB_NO_INSTALL" ]; then
  mkdir -p "$target"
  if [ -n "$STUB_INSTALL_TEXT_ONLY" ]; then echo hi > "$target/readme.txt"; else cp "$STUB_GAME_EXE" "$target/Game.exe"; fi
fi
exit "\${STUB_EXIT_CODE:-0}"
`;

export function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "dodi-it-"));
  const stub = join(root, "umu-run-stub");
  writeFileSync(stub, STUB_SCRIPT);
  chmodSync(stub, 0o755);
  const gameExe = join(root, "game-template.exe");
  writeFileSync(gameExe, fakeGameExe());
  return { root, stub, gameExe, argvFile: join(root, "argv.txt"), home: join(root, "home") };
}

export function readArgv(file: string): string[] {
  return readFileSync(file, "utf-8").split("\n").slice(0, -1);
}
