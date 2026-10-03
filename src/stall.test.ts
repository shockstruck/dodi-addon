import { describe, expect, test } from "bun:test";
import {
  describeDuration,
  isStalled,
  observe,
  startWatch,
} from "./stall";

const MIN = 60_000;

describe("stall decision", () => {
  test("not stalled until the idle limit has passed with an unchanged signature", () => {
    const state = startWatch("a", 0);
    expect(isStalled(state, 14 * MIN + 59_999, 15 * MIN)).toBe(false);
    expect(isStalled(state, 15 * MIN, 15 * MIN)).toBe(true);
  });

  test("an unchanged sample does not restart the clock", () => {
    const state = observe(startWatch("a", 0), "a", 10 * MIN);
    expect(state.changedAt).toBe(0);
    expect(isStalled(state, 15 * MIN, 15 * MIN)).toBe(true);
  });

  test("a changed sample restarts the clock", () => {
    const state = observe(startWatch("a", 0), "b", 10 * MIN);
    expect(state).toEqual({ signature: "b", changedAt: 10 * MIN });
    expect(isStalled(state, 24 * MIN, 15 * MIN)).toBe(false);
    expect(isStalled(state, 25 * MIN, 15 * MIN)).toBe(true);
  });
});

describe("describeDuration", () => {
  test("formats whole minutes and short test limits", () => {
    expect(describeDuration(15 * MIN)).toBe("15 minutes");
    expect(describeDuration(MIN)).toBe("1 minute");
    expect(describeDuration(1500)).toBe("2 seconds");
    expect(describeDuration(100)).toBe("1 second");
  });
});
