import { describe, it, expect, beforeEach, vi } from "vitest";

const randomIntMock = vi.fn();
const randomFloatMock = vi.fn();

vi.mock("../utils.js", () => ({
  randomInt: (...args) => randomIntMock(...args),
  randomFloat: (...args) => randomFloatMock(...args),
}));

const { maybeAddTypos, introduceSingleTypo } = await import("../typoUtils.js");

describe("maybeAddTypos", () => {
  beforeEach(() => {
    randomIntMock.mockReset();
    randomFloatMock.mockReset();
  });

  it("returns original text when typo chance is zero", () => {
    const result = maybeAddTypos(
      { behavior: { typoChance: 0, maxTyposPerComment: 2 } },
      "sample"
    );
    expect(result).toBe("sample");
    expect(randomFloatMock).not.toHaveBeenCalled();
  });

  it("returns original text when random chance exceeds threshold", () => {
    randomFloatMock.mockReturnValueOnce(0.9);
    const result = maybeAddTypos(
      { behavior: { typoChance: 0.1, maxTyposPerComment: 2 } },
      "sample"
    );
    expect(result).toBe("sample");
  });

  it("introduces a typo when chance succeeds", () => {
    randomFloatMock
      .mockReturnValueOnce(0.05) // pass chance check
      .mockReturnValueOnce(0.2); // choose swap branch

    randomIntMock
      .mockReturnValueOnce(1) // number of typos
      .mockReturnValueOnce(0); // index for swap

    const result = maybeAddTypos(
      { behavior: { typoChance: 1, maxTyposPerComment: 2 } },
      "hello"
    );

    expect(result).toBe("ehllo");
  });
});

describe("introduceSingleTypo", () => {
  beforeEach(() => {
    randomIntMock.mockReset();
    randomFloatMock.mockReset();
  });

  it("swaps characters when roll < 0.33", () => {
    randomIntMock.mockReturnValueOnce(0);
    randomFloatMock.mockReturnValueOnce(0.2);
    expect(introduceSingleTypo("world")).toBe("owrld");
  });

  it("deletes a character when roll falls in middle range", () => {
    randomIntMock.mockReturnValueOnce(2);
    randomFloatMock.mockReturnValueOnce(0.5);
    expect(introduceSingleTypo("world")).toBe("world".slice(0, 2) + "ld");
  });

  it("replaces a character when roll >= 0.66", () => {
    randomIntMock
      .mockReturnValueOnce(1) // index
      .mockReturnValueOnce(0); // replacement char index => 'a'
    randomFloatMock.mockReturnValueOnce(0.9);
    expect(introduceSingleTypo("world")).toBe("warld");
  });
});
