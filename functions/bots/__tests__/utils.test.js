import { describe, it, expect, afterEach, vi } from "vitest";
import { weightedChoice } from "../utils.js";

describe("weightedChoice", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects key based on weights when random is low", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    expect(weightedChoice({ a: 1, b: 2 })).toBe("a");
  });

  it("selects the second key when random falls in upper range", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    expect(weightedChoice({ a: 1, b: 1 })).toBe("b");
  });

  it("returns null when no positive weights", () => {
    expect(weightedChoice({ a: 0, b: -1 })).toBeNull();
  });
});
