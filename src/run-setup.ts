import { spawn } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
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

export type RunOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  onLog: (line: string) => void;
  /** Kill the process (and its group) after this long. No limit when unset. */
  timeoutMs?: number;
};

/**
 * Spawns a process, streams its output to `onLog`, resolves with the exit
 * code, or with `timedOut` after killing it when `timeoutMs` elapses.
 */
export function runProcess(
  command: string,
  args: string[],
  { cwd, env, onLog, timeoutMs }: RunOptions,
): Promise<{ code: number; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: true });
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          try {
            if (child.pid) process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }, timeoutMs)
      : undefined;
    child.stdout.on("data", (data: Buffer) => onLog(data.toString()));
    child.stderr.on("data", (data: Buffer) => onLog(data.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, timedOut });
    });
  });
}

/** How long an unattended install may run before it is treated as hung. */
export const SILENT_SETUP_TIMEOUT_MS = 30 * 60 * 1000;

export type SilentSetupOptions = {
  umuBin: string;
  setupExe: string;
  repackDir: string;
  /** Absolute host path the installer should write the game to. */
  installDir: string;
  winePrefix: string;
  env: NodeJS.ProcessEnv;
  onLog: (line: string) => void;
  timeoutMs?: number;
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
  const timeoutMs = options.timeoutMs ?? SILENT_SETUP_TIMEOUT_MS;
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
      timeoutMs,
    });
    if (run.timedOut) {
      return {
        ok: false,
        log: logPath,
        message: `Unattended setup did not finish within ${Math.round(timeoutMs / 1000)}s and was stopped; it is probably waiting on a page it cannot answer. Use the manual flow. Log: ${logPath}`,
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
