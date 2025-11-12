import { describe, expect, test } from "vitest";
import { isWithinActiveWindow } from "../scheduler.js";

const d = (iso) => new Date(iso);

describe("isWithinActiveWindow", () => {
  test("non-wrap end exclusive", () => {
    const bot = { behavior: { activeTimeZone: "America/Chicago" } };
    const window = { start: "08:00", end: "09:00" };

    expect(
      isWithinActiveWindow(bot, d("2025-11-12T14:05:00Z"), window)
    ).toBe(true);
    expect(
      isWithinActiveWindow(bot, d("2025-11-12T15:00:00Z"), window)
    ).toBe(false);
  });

  test("wrap-around end exclusive", () => {
    const bot = { behavior: { activeTimeZone: "America/New_York" } };
    const window = { start: "23:20", end: "00:05" };

    expect(
      isWithinActiveWindow(bot, d("2025-11-13T04:30:00Z"), window)
    ).toBe(true);
    expect(
      isWithinActiveWindow(bot, d("2025-11-13T05:02:00Z"), window)
    ).toBe(true);
    expect(
      isWithinActiveWindow(bot, d("2025-11-13T05:05:00Z"), window)
    ).toBe(false);
  });
});

