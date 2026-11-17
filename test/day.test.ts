import { describe, expect, it } from "vitest";
import { dayKey, formatDayLabel, isValidTimeZone } from "../src/core/day.js";

const TZ = "America/Indianapolis";

describe("dayKey", () => {
  it("uses the local date, not UTC", () => {
    // 2026-11-16 04:59Z is 23:59 on the 15th in Indianapolis (EST, UTC-5).
    expect(dayKey(new Date("2026-11-16T04:59:00Z"), TZ)).toBe("2026-11-15");
    expect(dayKey(new Date("2026-11-16T05:00:00Z"), TZ)).toBe("2026-11-16");
  });

  it("handles daylight saving time in summer", () => {
    // EDT is UTC-4 in July.
    expect(dayKey(new Date("2026-07-01T03:59:00Z"), TZ)).toBe("2026-06-30");
    expect(dayKey(new Date("2026-07-01T04:00:00Z"), TZ)).toBe("2026-07-01");
  });

  it("handles the spring-forward transition", () => {
    // After 2026-03-08 02:00 EST the zone is EDT (UTC-4).
    expect(dayKey(new Date("2026-03-09T03:30:00Z"), TZ)).toBe("2026-03-08");
    expect(dayKey(new Date("2026-03-09T04:30:00Z"), TZ)).toBe("2026-03-09");
  });

  it("works for UTC as a plain zone", () => {
    expect(dayKey(new Date("2026-03-09T03:30:00Z"), "UTC")).toBe("2026-03-09");
  });

  it("zero-pads month and day", () => {
    expect(dayKey(new Date("2026-01-05T12:00:00Z"), TZ)).toBe("2026-01-05");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names", () => {
    expect(isValidTimeZone("America/Indianapolis")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects nonsense and empty strings", () => {
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("formatDayLabel", () => {
  it("renders a readable label for a day key", () => {
    expect(formatDayLabel("2026-11-16", TZ)).toBe("Mon, Nov 16");
  });
});
