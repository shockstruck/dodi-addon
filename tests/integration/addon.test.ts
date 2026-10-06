import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  makeWorkspace,
  readArgv,
  startFixtureSite,
  startMockOgi,
  type Message,
} from "./harness";

const repoRoot = new URL("../../", import.meta.url).pathname;
const SECRET = "integration-secret";

type Run = {
  ogi: ReturnType<typeof startMockOgi>;
  ws: ReturnType<typeof makeWorkspace>;
  repackDir: string;
  setupExe: string;
  child: ReturnType<typeof Bun.spawn>;
  output: () => string;
};

let site: ReturnType<typeof startFixtureSite>;
let runs: Run[] = [];

beforeEach(() => {
  site = startFixtureSite();
});

afterEach(() => {
  for (const run of runs) {
    run.child.kill();
    run.ogi.stop();
  }
  runs = [];
  site.stop();
});

/** Starts the real addon process against a mock OGI server and waits for it to configure. */
async function startAddon(options: {
  stubExitCode?: number;
  noInstall?: boolean;
  appName?: string;
  textOnly?: boolean;
  sleepSeconds?: number;
  idleMs?: number;
  progressSteps?: number;
  installDir?: string;
  inputs?: (config: Record<string, any>, run: Run) => Record<string, unknown>;
}): Promise<Run> {
  const holder: { run?: Run } = {};
  const ws = makeWorkspace();
  const repackDir = join(ws.root, "repack");
  mkdirSync(repackDir, { recursive: true });
  const setupExe = join(repackDir, "setup.exe");
  writeFileSync(setupExe, "stub installer");
  mkdirSync(ws.home, { recursive: true });

  const ogi = startMockOgi({
    secret: SECRET,
    appName: options.appName ?? "ELDEN RING",
    inputs: (name, _description, config) => {
      const answer = options.inputs?.(config, holder.run!);
      if (answer) return answer;
      throw new Error(`unexpected input prompt: ${name} ${Object.keys(config)}`);
    },
  });
  const child = Bun.spawn(
    [process.execPath, "run", "src/main.ts", `--addonSecret=${SECRET}`, `--addonPort=${ogi.port}`],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: ws.home,
        DODI_BASE_URL: site.baseUrl,
        OGI_UMU_RUN: ws.stub,
        DODI_OPEN_CMD: ws.openStub,
        STUB_OPEN_FILE: ws.openFile,
        STUB_ARGV_FILE: ws.argvFile,
        STUB_GAME_EXE: ws.gameExe,
        STUB_EXIT_CODE: String(options.stubExitCode ?? 0),
        STUB_INSTALL_TEXT_ONLY: options.textOnly ? "1" : "",
        STUB_SLEEP: options.sleepSeconds ? String(options.sleepSeconds) : "",
        DODI_SILENT_IDLE_MS: options.idleMs ? String(options.idleMs) : "",
        DODI_SILENT_SAMPLE_MS: options.idleMs ? "100" : "",
        STUB_PROGRESS_STEPS: options.progressSteps ? String(options.progressSteps) : "",
        STUB_PID_FILE: ws.pidFile,
        STUB_NO_INSTALL: options.noInstall ? "1" : "",
        STUB_INSTALL_DIR: options.installDir ?? "",
      },
    },
  );
  let log = "";
  for (const stream of [child.stdout, child.stderr] as ReadableStream<Uint8Array>[]) {
    void (async () => {
      for await (const chunk of stream) log += new TextDecoder().decode(chunk);
    })();
  }
  const run: Run = { ogi, ws, repackDir, setupExe, child, output: () => log };
  holder.run = run;
  runs.push(run);
  try {
    await ogi.waitForEvent("configure");
  } catch (error) {
    throw new Error(`${error}\naddon output:\n${log}`);
  }
  return run;
}

const setupArgs = (run: Run) => ({
  path: run.repackDir,
  type: "empty",
  name: "ELDEN RING",
  usedRealDebrid: false,
  appID: 1245620,
  storefront: "steam",
  manifest: { service: "local", setupExe: run.setupExe, pathOfSetupExe: run.repackDir },
});

describe("handshake and configuration", () => {
  test("authenticates with the secret, then offers the automate option off by default", async () => {
    const run = await startAddon({});
    const auth = await run.ogi.waitForEvent("authenticate");
    expect(auth.args).toMatchObject({
      id: "dodi-addon",
      name: "DODI Repacks",
      author: "ShockStruck",
      secret: SECRET,
    });

    const configure = await run.ogi.waitForEvent("configure");
    expect(Object.keys(configure.args)).toEqual(["automateWineSetup"]);
    expect(configure.args.automateWineSetup).toMatchObject({
      type: "boolean",
      defaultValue: false,
      displayName: "Automate Setup under Wine (experimental)",
    });
    const description: string = configure.args.automateWineSetup.description;
    expect(configure.args.automateWineSetup.defaultValue).toBe(false);
    expect(description.toLowerCase()).toContain("experimental");
    expect(description).toContain("DODI");
    expect(description).not.toContain("FitGirl");
    expect(description).toContain("custom start screen and a component page");
    expect(description).toContain("ISDone/unarc");
    expect(description).toContain("expect it to fail");
    expect(description).toContain("exit code and the log path");
    expect(description).toContain("manual flow");
  });
});

describe("search", () => {
  test("returns the six fixture groups as request results plus Local Files, last, with no task results", async () => {
    const run = await startAddon({});
    const response = await run.ogi.request("search", { appID: 1245620, storefront: "steam", for: "game" });
    expect(response.statusError).toBeUndefined();
    const results = response.args as any[];

    expect(results.some((r) => r.downloadType === "task")).toBe(false);
    const groups = results.filter((r) => r.manifest.service === "page");
    expect(groups.every((r) => r.downloadType === "request")).toBe(true);
    expect(groups.map((r) => r.manifest.label)).toEqual([
      "Torrent",
      "SwiftUploads",
      "DataNodes",
      "Update v1.16.1",
      "Update v1.17 / Tarnished Pack",
      "Alternative links",
    ]);
    expect(groups[0].manifest.urls).toEqual([
      "http://file-me.top/erut1gx2w5s1.html",
      "https://www.up-4ever.net/osw2tzsu5o8r",
      "https://www.swiftuploads.com/rk9zKRVQ30lY/file",
    ]);
    expect(groups[0].name).toContain("(repack)");
    expect(groups[3].name).toContain("(update)");

    expect(results).toHaveLength(7);
    expect(results.at(-1)).toMatchObject({ downloadType: "request", name: "Local Files", manifest: { service: "local" } });
  });

  test("logs one title-only line per lookup", async () => {
    const run = await startAddon({});
    await run.ogi.request("search", { appID: 1245620, storefront: "steam", for: "game" });
    expect(run.output()).toMatch(/DODI lookup for "ELDEN RING": \d+ hits, best "[^"]+", 6 groups/);
  });

  test("a title with no DODI listing still offers Local Files", async () => {
    const run = await startAddon({ appName: "Zzzqqq Nonexistent Game" });
    const response = await run.ogi.request("search", { appID: 1, storefront: "steam", for: "game" });
    expect((response.args as any[]).map((r) => r.name)).toEqual(["Local Files"]);
  });

  test("a task-type search offers only Local Files and never touches the site", async () => {
    const run = await startAddon({});
    const response = await run.ogi.request("search", { appID: 1, storefront: "steam", for: "task" });
    expect((response.args as any[]).map((r) => r.name)).toEqual(["Local Files"]);
  });
});

describe("request-dl", () => {
  test("Local Files asks for setup.exe and resolves an empty download carrying the manifest", async () => {
    const run = await startAddon({
      inputs: (config, r) => (config.setupExe ? { setupExe: r.setupExe } : undefined as never),
    });
    const response = await run.ogi.request("request-dl", {
      appID: 1245620,
      info: { downloadType: "request", name: "Local Files", manifest: { service: "local" } },
    });
    expect(response.statusError).toBeUndefined();
    expect(response.args).toMatchObject({
      downloadType: "empty",
      manifest: { service: "local", setupExe: run.setupExe, pathOfSetupExe: run.repackDir },
    });
  });

  test("a page request opens the first link in the browser, asks for setup.exe and resolves a local empty download", async () => {
    const run = await startAddon({
      inputs: (config, r) => (config.setupExe ? { setupExe: r.setupExe } : undefined as never),
    });
    const response = await run.ogi.request("request-dl", {
      appID: 1245620,
      info: {
        downloadType: "request",
        name: "Torrent (repack) | Elden Ring",
        manifest: {
          service: "page",
          pageUrl: "https://dodi.example.invalid/elden-ring/",
          label: "Torrent",
          urls: ["file:///etc/passwd", "https://hoster-a.example.invalid/a", "https://hoster-b.example.invalid/b"],
        },
      },
    });
    expect(response.statusError).toBeUndefined();
    // The first valid http(s) URL is opened; the rejected file: URL is skipped.
    expect(readArgv(run.ws.openFile)).toEqual(["https://hoster-a.example.invalid/a"]);
    const prompt = run.ogi.received.find((m) => m.event === "input-asked")!;
    expect(prompt.args.description).toBe(
      "Download the repack in your browser, extract it, then select its setup.exe",
    );
    expect(response.args).toMatchObject({
      downloadType: "empty",
      name: "Torrent | Torrent (repack) | Elden Ring",
      manifest: {
        service: "local",
        setupExe: run.setupExe,
        pathOfSetupExe: run.repackDir,
        pageUrl: "https://dodi.example.invalid/elden-ring/",
      },
    });
  });

  test("a page request with no valid link fails before asking for anything", async () => {
    const run = await startAddon({});
    const response = await run.ogi.request("request-dl", {
      appID: 1245620,
      info: { downloadType: "request", name: "x", manifest: { service: "page", urls: ["magnet:?xt=1"] } },
    });
    expect(response.statusError).toContain("No valid http(s) download link");
  });

  test("a page request fails with the existing message when setup.exe is missing", async () => {
    const run = await startAddon({ inputs: () => ({ setupExe: "/nonexistent/setup.exe" }) });
    const response = await run.ogi.request("request-dl", {
      appID: 1245620,
      info: { downloadType: "request", name: "x", manifest: { service: "page", urls: ["https://hoster-a.example.invalid/a"] } },
    });
    expect(response.statusError).toContain("The selected setup.exe does not exist.");
  });

  test("an unknown service still fails", async () => {
    const run = await startAddon({});
    const response = await run.ogi.request("request-dl", {
      appID: 1,
      info: { downloadType: "request", name: "x", manifest: { service: "torrent" } },
    });
    expect(response.statusError).toBe("Unknown download request.");
  });

  test("fails when the chosen setup.exe does not exist", async () => {
    const run = await startAddon({ inputs: () => ({ setupExe: "/nonexistent/setup.exe" }) });
    const response = await run.ogi.request("request-dl", {
      appID: 1245620,
      info: { downloadType: "request", name: "Local Files", manifest: { service: "local" } },
    });
    expect(response.statusError).toContain("does not exist");
  });
});

describe("setup, manual branch", () => {
  test("launches the wizard through umu with only setup.exe, then detects the installed Game.exe", async () => {
    const prompts: string[] = [];
    const installDir = join(tmpdir(), `dodi-it-install-${process.pid}`);
    mkdirSync(installDir, { recursive: true });
    const run = await startAddon({
      installDir,
      inputs: (config) => {
        prompts.push(Object.keys(config).join(","));
        if (config.installDir) return { installDir };
        if (config.finished) return { finished: true };
        return undefined as never;
      },
    });
    const response = await run.ogi.request("setup", setupArgs(run));
    expect(response.statusError).toBeUndefined();

    expect(readArgv(run.ws.argvFile)).toEqual([run.setupExe]);
    expect(prompts).toEqual(["installDir", "finished"]);
    expect(response.args).toMatchObject({
      launchExecutable: join(installDir, "Game.exe"),
      cwd: installDir,
      launchArguments: "%command%",
      umu: { umuId: "steam:1245620" },
      version: "1.16",
    });
    rmSync(installDir, { recursive: true, force: true });
  });

  test("a non-zero wizard exit fails with the mapped Inno message", async () => {
    const run = await startAddon({
      stubExitCode: 2,
      inputs: (config) => (config.installDir ? { installDir: "/tmp" } : undefined as never),
    });
    const response = await run.ogi.request("setup", setupArgs(run));
    expect(response.statusError).toContain("Inno Setup exited with code 2: Setup was cancelled before the actual installation started.");
  });
});

describe("setup, silent branch", () => {
  async function enableAutomation(run: Run) {
    const update = await run.ogi.request("config-update", { automateWineSetup: true });
    expect(update.args).toEqual({ success: true });
  }

  test("runs /VERYSILENT through umu with the exact argv and picks the installed Game.exe", async () => {
    const run = await startAddon({}); // no prompts are expected: any prompt throws
    await enableAutomation(run);
    const response = await run.ogi.request("setup", setupArgs(run));
    expect(response.statusError).toBeUndefined();

    const installDir = join(run.repackDir, "DODI Install");
    const z = (p: string) => `Z:${p.split("/").join("\\")}`;
    expect(readArgv(run.ws.argvFile)).toEqual([
      run.setupExe,
      "/VERYSILENT",
      "/SUPPRESSMSGBOXES",
      "/SP-",
      "/NORESTART",
      `/LOADINF=${z(join(run.repackDir, "dodi-setup.inf"))}`,
      `/LOG=${z(join(run.repackDir, "dodi-setup.log"))}`,
    ]);
    expect(readFileSync(join(run.repackDir, "dodi-setup.inf"), "utf-8")).toBe(
      `[Setup]\nLang=en\nDir=${z(installDir)}\n`,
    );
    expect(readdirSync(installDir)).toEqual(["Game.exe"]);
    expect(response.args).toMatchObject({
      launchExecutable: join(installDir, "Game.exe"),
      cwd: installDir,
      umu: { umuId: "steam:1245620" },
    });
  });

  test("a failing installer maps the Inno exit code and names the log, deleting nothing", async () => {
    const run = await startAddon({ stubExitCode: 4 });
    await enableAutomation(run);
    const response = await run.ogi.request("setup", setupArgs(run));
    expect(response.statusError).toBe(
      `Inno Setup exited with code 4: A fatal error occurred during the actual installation process. Log: ${join(run.repackDir, "dodi-setup.log")}`,
    );
    expect(readFileSync(run.setupExe, "utf-8")).toBe("stub installer");
  });

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  test("an installer that makes no progress is killed with its whole process group", async () => {
    const run = await startAddon({ sleepSeconds: 60, idleMs: 1500 });
    await enableAutomation(run);
    const started = Date.now();
    const response = await run.ogi.request("setup", setupArgs(run));
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(response.statusError).toBe(
      `Unattended setup made no progress for 2 seconds and was stopped. Log: ${join(run.repackDir, "dodi-setup.log")}`,
    );
    const shellPid = Number(readFileSync(run.ws.pidFile, "utf-8"));
    const sleepPid = Number(readFileSync(`${run.ws.pidFile}.child`, "utf-8"));
    expect(shellPid).toBeGreaterThan(1);
    expect(sleepPid).toBeGreaterThan(1);
    await Bun.sleep(300);
    expect(alive(shellPid)).toBe(false);
    expect(alive(sleepPid)).toBe(false);
  });

  test("an installer that keeps writing its log is not killed, even past the idle limit", async () => {
    // 12 steps x 0.25s = 3s of steady log growth against a 1.5s idle limit.
    const run = await startAddon({ progressSteps: 12, idleMs: 1500 });
    await enableAutomation(run);
    const response = await run.ogi.request("setup", setupArgs(run));
    expect(response.statusError).toBeUndefined();
    expect(response.args).toMatchObject({ launchExecutable: join(run.repackDir, "DODI Install", "Game.exe") });
  });

  test("a zero exit with no game executable fails with the log path instead of prompting", async () => {
    const run = await startAddon({ textOnly: true }); // any prompt would throw
    await enableAutomation(run);
    const response = await run.ogi.request("setup", setupArgs(run));
    expect(response.statusError).toBe(
      `Unattended setup exited 0 but no game executable was found in ${join(run.repackDir, "DODI Install")}. Log: ${join(run.repackDir, "dodi-setup.log")}`,
    );
  });

  test("an unrecognised exit code is reported as such", async () => {
    const run = await startAddon({ stubExitCode: 99 });
    await enableAutomation(run);
    const response = await run.ogi.request("setup", setupArgs(run));
    expect(response.statusError).toContain("Inno Setup exited with an unrecognized code 99.");
  });

  test("a zero exit that installs nothing fails instead of detecting a game", async () => {
    const run = await startAddon({ noInstall: true });
    await enableAutomation(run);
    const response = await run.ogi.request("setup", setupArgs(run));
    expect(response.statusError).toBe(
      `Setup reported success but the install folder is empty: ${join(run.repackDir, "DODI Install")}. Log: ${join(run.repackDir, "dodi-setup.log")}`,
    );
  });

  test("a missing setup.exe fails before anything is launched", async () => {
    const run = await startAddon({});
    await enableAutomation(run);
    const args = setupArgs(run);
    args.manifest.setupExe = join(run.repackDir, "missing.exe");
    const response = await run.ogi.request("setup", args);
    expect(response.statusError).toContain("setup.exe not found");
  });
});
