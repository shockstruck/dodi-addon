import { describe, expect, test } from "bun:test";
import { makeDodiSetupINF } from "./run-setup";

describe("makeDodiSetupINF", () => {
  test("sets only the destination; no FitGirl components or tasks", () => {
    expect(makeDodiSetupINF("Z:\\home\\u\\Games\\DODI Install")).toBe(
      "[Setup]\nLang=en\nDir=Z:\\home\\u\\Games\\DODI Install\n",
    );
  });
});
