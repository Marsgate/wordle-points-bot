import { describe, expect, it } from "vitest";
import { formatPoints, roleColorFor, roleNameFor } from "../src/core/points.js";

describe("formatPoints", () => {
  it("renders whole and half points compactly", () => {
    expect(formatPoints(12)).toBe("12");
    expect(formatPoints(12.5)).toBe("12.5");
    expect(formatPoints(0)).toBe("0");
    expect(formatPoints(-10)).toBe("-10");
    expect(formatPoints(-0.5)).toBe("-0.5");
  });

  it("rounds stray values to a half point", () => {
    expect(formatPoints(3.33)).toBe("3.5");
    expect(formatPoints(3.2)).toBe("3");
  });

  it("refuses non-finite input", () => {
    expect(() => formatPoints(Number.NaN)).toThrow();
  });
});

describe("roleNameFor", () => {
  it("is the number followed by the unit, with no nickname", () => {
    expect(roleNameFor(13.5)).toBe("13.5 points");
    expect(roleNameFor(0)).toBe("0 points");
    expect(roleNameFor(-114)).toBe("-114 points");
    expect(roleNameFor(1000)).toBe("1000 points");
  });

  it("rounds like the display", () => {
    expect(roleNameFor(3.33)).toBe("3.5 points");
  });
});

describe("roleColorFor", () => {
  it("bands the colours by total", () => {
    expect(roleColorFor(0.5)).toBe(0x99aab5);
    expect(roleColorFor(-114)).toBe(0x99aab5);
    expect(roleColorFor(9.5)).toBe(0x99aab5);
    expect(roleColorFor(10)).toBe(0x57f287);
    expect(roleColorFor(24.5)).toBe(0x57f287);
    expect(roleColorFor(25)).toBe(0x5865f2);
    expect(roleColorFor(49.5)).toBe(0x5865f2);
    expect(roleColorFor(50)).toBe(0xfee75c);
  });
});
