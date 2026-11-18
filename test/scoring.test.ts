import { describe, expect, it } from "vitest";
import { roundToHalf, scoreDay, splitPrize } from "../src/core/scoring.js";

const entry = (userId: string, guesses: number, solved = true) => ({ userId, guesses, solved });

describe("roundToHalf", () => {
  it("rounds to the nearest half point", () => {
    expect(roundToHalf(3.333)).toBe(3.5);
    expect(roundToHalf(3.1)).toBe(3);
    expect(roundToHalf(2.25)).toBe(2.5);
    expect(roundToHalf(2.24)).toBe(2);
  });
});

describe("splitPrize", () => {
  it("gives the whole prize to one winner", () => {
    expect(splitPrize(1)).toBe(10);
  });

  it("splits ties and rounds to halves", () => {
    expect(splitPrize(2)).toBe(5);
    expect(splitPrize(3)).toBe(3.5); // 3.33 -> 3.5 (the user's example)
    expect(splitPrize(4)).toBe(2.5);
    expect(splitPrize(6)).toBe(1.5); // 1.67 -> 1.5
    expect(splitPrize(9)).toBe(1);
  });

  it("never rounds an award below half a point", () => {
    expect(splitPrize(40)).toBe(0.5); // 0.25 would round to 0
  });

  it("rejects a prize with no winners", () => {
    expect(() => splitPrize(0)).toThrow();
  });
});

describe("scoreDay", () => {
  it("awards 10 points to a single best solver", () => {
    const score = scoreDay([entry("a", 4), entry("b", 3), entry("c", 5)]);
    expect(score.bestGuesses).toBe(3);
    expect(score.points).toEqual({ b: 10 });
    expect(score.winners).toEqual([{ userId: "b", guesses: 3, points: 10 }]);
  });

  it("splits 10 points between a three-way tie as 3.5 each", () => {
    const score = scoreDay([entry("a", 3), entry("b", 3), entry("c", 3), entry("d", 4)]);
    expect(score.points).toEqual({ a: 3.5, b: 3.5, c: 3.5 });
  });

  it("gives nothing to anyone who did not place first", () => {
    const score = scoreDay([entry("a", 2), entry("b", 4), entry("c", 6)]);
    expect(score.points).toEqual({ a: 10 });
  });

  it("never awards points for an X/6", () => {
    const score = scoreDay([entry("a", 6, false), entry("b", 5), entry("c", 6, false)]);
    expect(score.points).toEqual({ b: 10 });
  });

  it("awards nothing when nobody solved", () => {
    const score = scoreDay([entry("a", 6, false), entry("b", 6, false)]);
    expect(score.points).toEqual({});
    expect(score.winners).toEqual([]);
    expect(score.bestGuesses).toBeNull();
    expect(score.players).toBe(2);
    expect(score.solvers).toBe(0);
  });

  it("treats every solver at the best score as tied", () => {
    const score = scoreDay([entry("a", 6), entry("b", 6)]);
    expect(score.points).toEqual({ a: 5, b: 5 });
  });

  it("ignores malformed guess counts", () => {
    const score = scoreDay([entry("a", 0), entry("b", 9), entry("c", 3)]);
    expect(score.points).toEqual({ c: 10 });
  });

  it("returns empty results for an empty day", () => {
    const score = scoreDay([]);
    expect(score).toEqual({ bestGuesses: null, winners: [], points: {}, solvers: 0, players: 0 });
  });
});
