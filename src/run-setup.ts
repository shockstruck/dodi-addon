import { spawn } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
import {
  KILL_GRACE_MS,
  SILENT_IDLE_LIMIT_MS,
  SILENT_SAMPLE_INTERVAL_MS,
  describeDuration,
  isStalled,
  observe,
  startWatch,
} from "./stall";
import {
  buildSilentSetupArgs,
  describeInnoExitCode,
  toWineZPath,
} from "./wine-setup";

/**
 * Inno Setup INF for an unattended DODI install. DODI-specific: fatboy's
 * `makeSetupINF` targets FitGirl's `INSTALL HERE` staging folder and her
 * `text`/`bonus` components. DODI repacks have neither, so this only sets the
 * destination and leaves every component and task at the installer's default.
 * `installWinDir` is written verbatim; callers pass a Wine `Z:` path.
 */
export function makeDodiSetupINF(installWinDir: string): string {
  return `[Setup]\nLang=en\nDir=${installWinDir}\n`;
}

export type Watchdog = {
  /** Samples progress; any change in the returned string counts as progress. */
  sample: () => string;
  intervalMs: number;
  idleLimitMs: number;
};

export type RunOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  onLog: (line: string) => void;
  /** Stop the process group when `watchdog` sees no progress for `idleLimitMs`. Unset: never stop it. */
  watchdog?: Watchdog;
};

/**
 * Spawns a process in its own group and streams its output to `onLog`.
 * Resolves with the exit code, or with `stalled: true` after SIGTERM (then
 * SIGKILL after KILL_GRACE_MS) to the whole group when the watchdog trips.
 */
export function runProcess(
  command: string,
  args: string[],
  { cwd, env, onLog, watchdog }: RunOptions,
): Promise<{ code: number; stalled: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: !!watchdog });
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        // group already gone
      }
    };
    let stalled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let watchTimer: ReturnType<typeof setInterval> | undefined;
    if (watchdog) {
      let state = startWatch(watchdog.sample(), Date.now());
      watchTimer = setInterval(() => {
        const now = Date.now();
        state = observe(state, watchdog.sample(), now);
        if (!stalled && isStalled(state, now, watchdog.idleLimitMs)) {
          stalled = true;
          signalGroup("SIGTERM");
          killTimer = setTimeout(() => signalGroup("SIGKILL"), KILL_GRACE_MS);
        }
      }, watchdog.intervalMs);
    }
    const cleanup = () => {
      clearInterval(watchTimer);
      clearTimeout(killTimer);
    };
    child.stdout.on("data", (data: Buffer) => onLog(data.toString()));
    child.stderr.on("data", (data: Buffer) => onLog(data.toString()));
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      // Anything the installer left in the group (Wine helpers) goes too.
      if (stalled) signalGroup("SIGKILL");
      resolve({ code: code ?? -1, stalled });
    });
  });
}

/** Bytes under `dir`, recursively; 0 if it does not exist. */
function treeBytes(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    try {
      total += entry.isDirectory() ? treeBytes(full) : fs.statSync(full).size;
    } catch {
      // file vanished mid-scan
    }
  }
  return total;
}

/** Progress signature: the Inno log's size plus the install folder's total bytes. */
export function sampleProgress(logPath: string, installDir: string): string {
  let logBytes = 0;
  try {
    logBytes = fs.statSync(logPath).size;
  } catch {
    // no log yet
  }
  return `${logBytes}:${treeBytes(installDir)}`;
}

export type SilentSetupOptions = {
  umuBin: string;
  setupExe: string;
  repackDir: string;
  /** Absolute host path the installer should write the game to. */
  installDir: string;
  winePrefix: string;
  env: NodeJS.ProcessEnv;
  onLog: (line: string) => void;
  idleLimitMs?: number;
  sampleIntervalMs?: number;
};

export type SilentSetupResult =
  | { ok: true; log: string }
  | { ok: false; message: string; log: string };

/**
 * Runs the repack's Inno Setup unattended under umu/Wine, installing straight
 * into `installDir`. Deletes nothing: on any failure the repack directory is
 * left as it was so the user can retry or use the manual flow.
 */
export async function runSilentSetup(
  options: SilentSetupOptions,
): Promise<SilentSetupResult> {
  const { umuBin, setupExe, repackDir, installDir, winePrefix, env, onLog } =
    options;
  const idleLimitMs = options.idleLimitMs ?? SILENT_IDLE_LIMIT_MS;
  const infPath = join(repackDir, "dodi-setup.inf");
  const logPath = join(repackDir, "dodi-setup.log");
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(infPath, makeDodiSetupINF(toWineZPath(installDir)));
  onLog(`Setup INF created at ${infPath}`);

  const args = buildSilentSetupArgs({
    infWinPath: toWineZPath(infPath),
    logWinPath: toWineZPath(logPath),
  });
  onLog("Running unattended DODI setup via Wine...");

  let exitCode: number;
  try {
    const run = await runProcess(umuBin, [setupExe, ...args], {
      cwd: repackDir,
      env: { ...env, WINEPREFIX: winePrefix },
      onLog,
      watchdog: {
        sample: () => sampleProgress(logPath, installDir),
        intervalMs: options.sampleIntervalMs ?? SILENT_SAMPLE_INTERVAL_MS,
        idleLimitMs,
      },
    });
    if (run.stalled) {
      return {
        ok: false,
        log: logPath,
        message: `Unattended setup made no progress for ${describeDuration(idleLimitMs)} and was stopped. Log: ${logPath}`,
      };
    }
    exitCode = run.code;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      log: logPath,
      message: `Error launching unattended setup via Wine: ${reason}. Log: ${logPath}`,
    };
  }
  if (exitCode !== 0) {
    return {
      ok: false,
      log: logPath,
      message: `${describeInnoExitCode(exitCode)} Log: ${logPath}`,
    };
  }
  if (fs.readdirSync(installDir).length === 0) {
    return {
      ok: false,
      log: logPath,
      message: `Setup reported success but the install folder is empty: ${installDir}. Log: ${logPath}`,
    };
  }
  return { ok: true, log: logPath };
}
