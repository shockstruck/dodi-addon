/** Inactivity watchdog for the unattended installer. The decision is pure; sampling is in run-setup. */

/** Default: kill an unattended install that shows no progress for 15 minutes. */
export const SILENT_IDLE_LIMIT_MS = 15 * 60 * 1000;
/** Default: look for progress every 30 seconds. */
export const SILENT_SAMPLE_INTERVAL_MS = 30 * 1000;
/** Grace between SIGTERM and SIGKILL when stopping a stalled install. */
export const KILL_GRACE_MS = 10 * 1000;

export type WatchState = {
  /** What progress looked like at the last sample (log size + install-folder bytes). */
  signature: string;
  /** When `signature` last changed. */
  changedAt: number;
};

export function startWatch(signature: string, now: number): WatchState {
  return { signature, changedAt: now };
}

/** Folds a new sample into the state: the clock only restarts when the signature changes. */
export function observe(state: WatchState, signature: string, now: number): WatchState {
  return signature === state.signature ? state : { signature, changedAt: now };
}

/** True once nothing has changed for at least `idleLimitMs`. */
export function isStalled(state: WatchState, now: number, idleLimitMs: number): boolean {
  return now - state.changedAt >= idleLimitMs;
}

/** "15 minutes", "1 minute", "2 seconds": for the stall message, including shortened test limits. */
export function describeDuration(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    const minutes = ms / 60_000;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}
