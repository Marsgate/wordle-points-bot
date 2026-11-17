import { describe, expect, it } from "vitest";
import { computeStreak, previousDayKey } from "../src/core/streak.js";

const TODAY = "2026-11-17";

describe("previousDayKey", () => {
  it("steps back a day", () => {
    expect(previousDayKey("2026-11-17")).toBe("2026-11-16");
  });

  it("crosses month and year boundaries", () => {
    expect(previousDayKey("2026-12-01")).toBe("2026-11-30");
    expect(previousDayKey("2027-01-01")).toBe("2026-12-31");
    expect(previousDayKey("2028-03-01")).toBe("2028-02-29");
  });
});

describe("computeStreak", () => {
  it("is zero with no winning days", () => {
    expect(computeStreak({ wonDays: [], today: TODAY }).current).toBe(0);
  });

  it("counts today's win", () => {
    expect(computeStreak({ wonDays: [TODAY], today: TODAY }).current).toBe(1);
  });

  it("counts a run ending today", () => {
    const streak = computeStreak({
      wonDays: ["2026-11-15", "2026-11-16", TODAY],
      today: TODAY,
    });
    expect(streak.current).toBe(3);
    expect(streak.best).toBe(3);
  });

  it("keeps yesterday's streak alive while today is unplayed", () => {
    const streak = computeStreak({
      wonDays: ["2026-11-15", "2026-11-16"],
      today: TODAY,
    });
    expect(streak.current).toBe(2);
  });

  it("breaks when yesterday had no winner", () => {
    expect(computeStreak({ wonDays: ["2026-11-15"], today: TODAY }).current).toBe(0);
  });

  it("counts only the trailing run", () => {
    const streak = computeStreak({
      wonDays: ["2026-11-10", "2026-11-14", "2026-11-15", "2026-11-16"],
      today: TODAY,
    });
    expect(streak.current).toBe(3);
    expect(streak.best).toBe(3);
  });

  it("uses a seed through yesterday", () => {
    const streak = computeStreak({
      wonDays: [],
      today: TODAY,
      seed: { day: "2026-11-16", count: 105 },
    });
    expect(streak.current).toBe(105);
    expect(streak.best).toBe(105);
  });

  it("extends a seed with today's win", () => {
    const streak = computeStreak({
      wonDays: [TODAY],
      today: TODAY,
      seed: { day: "2026-11-16", count: 105 },
    });
    expect(streak.current).toBe(106);
    expect(streak.best).toBe(106);
  });

  it("anchors a seed that already includes today", () => {
    const streak = computeStreak({
      wonDays: [TODAY],
      today: TODAY,
      seed: { day: TODAY, count: 105 },
    });
    expect(streak.current).toBe(105);
  });

  it("ignores a seed when a gap breaks it", () => {
    const streak = computeStreak({
      wonDays: [TODAY],
      today: TODAY,
      seed: { day: "2026-11-14", count: 105 },
    });
    expect(streak.current).toBe(1);
  });

  it("tracks the best historical run", () => {
    const streak = computeStreak({
      wonDays: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", TODAY],
      today: TODAY,
    });
    expect(streak.current).toBe(1);
    expect(streak.best).toBe(4);
  });

  it("counts the seed into the best run", () => {
    const streak = computeStreak({
      wonDays: ["2026-11-15", "2026-11-16", TODAY],
      today: TODAY,
      seed: { day: "2026-11-14", count: 100 },
    });
    expect(streak.current).toBe(103);
    expect(streak.best).toBe(103);
  });
});
