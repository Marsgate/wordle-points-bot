import { describe, expect, it } from "vitest";
import {
  formatPoints,
  MAX_ROLE_NAME_LENGTH,
  roleColorFor,
  roleNameFor,
  stripPointsSuffix,
  truncateToLength,
} from "../src/core/points.js";

describe("formatPoints", () => {
  it("renders whole and half points compactly", () => {
    expect(formatPoints(12)).toBe("12");
    expect(formatPoints(12.5)).toBe("12.5");
    expect(formatPoints(0)).toBe("0");
  });

  it("rounds stray values to a half point", () => {
    expect(formatPoints(3.33)).toBe("3.5");
    expect(formatPoints(3.2)).toBe("3");
  });

  it("refuses non-finite input", () => {
    expect(() => formatPoints(Number.NaN)).toThrow();
  });
});

describe("stripPointsSuffix", () => {
  it("removes suffixes written by either design", () => {
    expect(stripPointsSuffix("Ada · 3.5")).toBe("Ada");
    expect(stripPointsSuffix("Ada · 5 pts")).toBe("Ada");
  });

  it("removes hand-typed separators too", () => {
    expect(stripPointsSuffix("Ada | 12")).toBe("Ada");
    expect(stripPointsSuffix("Ada • 0.5")).toBe("Ada");
  });

  it("keeps decorated names intact", () => {
    expect(stripPointsSuffix("𝓐𝓭𝓪 ✦ · 3.5")).toBe("𝓐𝓭𝓪 ✦");
    expect(stripPointsSuffix("Linus 🐧 · 10 pts")).toBe("Linus 🐧");
  });

  it("strips stacked suffixes", () => {
    expect(stripPointsSuffix("Ada · 3 · 4")).toBe("Ada");
  });

  it("leaves names without a suffix alone", () => {
    expect(stripPointsSuffix("Margaret Hamilton")).toBe("Margaret Hamilton");
    expect(stripPointsSuffix("Ada")).toBe("Ada");
  });
});

describe("roleNameFor", () => {
  it("combines the decorated name and the total", () => {
    expect(roleNameFor("𝓐𝓭𝓪 ✦", 13.5)).toBe("𝓐𝓭𝓪 ✦ · 13.5 pts");
    expect(roleNameFor("grace", 5)).toBe("grace · 5 pts");
  });

  it("strips an old suffix instead of stacking a new one", () => {
    expect(roleNameFor("Ada · 3.5", 8)).toBe("Ada · 8 pts");
  });

  it("falls back to Player for an empty base", () => {
    expect(roleNameFor("", 5)).toBe("Player · 5 pts");
  });

  it("keeps the points when the base is too long", () => {
    const name = roleNameFor("A".repeat(200), 12.5);
    expect(name.length).toBe(MAX_ROLE_NAME_LENGTH);
    expect(name.endsWith(" · 12.5 pts")).toBe(true);
  });

  it("never splits an emoji grapheme", () => {
    const name = roleNameFor("🎉".repeat(80), 0.5);
    expect(name.length).toBeLessThanOrEqual(MAX_ROLE_NAME_LENGTH);
    expect(name.endsWith(" · 0.5 pts")).toBe(true);
    const units = Array.from(name);
    expect(units.every((unit) => !/[\uD800-\uDFFF]/u.test(unit))).toBe(true);
  });
});

describe("roleColorFor", () => {
  it("bands the colours by total", () => {
    expect(roleColorFor(0.5)).toBe(0x99aab5);
    expect(roleColorFor(9.5)).toBe(0x99aab5);
    expect(roleColorFor(10)).toBe(0x57f287);
    expect(roleColorFor(24.5)).toBe(0x57f287);
    expect(roleColorFor(25)).toBe(0x5865f2);
    expect(roleColorFor(49.5)).toBe(0x5865f2);
    expect(roleColorFor(50)).toBe(0xfee75c);
    expect(roleColorFor(500)).toBe(0xfee75c);
  });
});

describe("truncateToLength", () => {
  it("cuts by grapheme, not code unit", () => {
    expect(truncateToLength("abcdef", 3)).toBe("abc");
    expect(truncateToLength("🎉🎉🎉", 5)).toBe("🎉🎉");
    expect(truncateToLength("short", 50)).toBe("short");
    expect(truncateToLength("anything", 0)).toBe("");
  });
});
