import { describe, expect, it } from "vitest";
import { looksLikeWordleSummary, parseWordleSummary } from "../src/core/summary.js";

const REAL = [
  "**Your group is on a 103 day streak!** 🔥🔥🔥 Here are yesterday's results:",
  "👑 4/6: @Laura <@137969036129468416> <@371136350973591554>",
  "5/6: <@263526840394579978> <@320261520950820866>",
  "6/6: @Binker @Bucket Crab \\(\\+48 points\\) <@428334191118385172>",
].join("\n");

describe("looksLikeWordleSummary", () => {
  it("recognises the real summary", () => {
    expect(looksLikeWordleSummary(REAL)).toBe(true);
  });

  it("rejects ordinary shares and chat", () => {
    expect(looksLikeWordleSummary("Wordle 1,977 3/6\n\n🟩🟩🟩🟩🟩")).toBe(false);
    expect(looksLikeWordleSummary("we hit a 3 day streak!")).toBe(false);
  });
});

describe("parseWordleSummary", () => {
  it("reads the streak", () => {
    expect(parseWordleSummary(REAL)?.streak).toBe(103);
  });

  it("reads mentions as user ids", () => {
    const entries = parseWordleSummary(REAL)?.entries ?? [];
    const ids = entries.filter((entry) => entry.userId).map((entry) => entry.userId);

    expect(ids).toContain("137969036129468416");
    expect(ids).toContain("371136350973591554");
    expect(ids).toContain("263526840394579978");
    expect(ids).toContain("320261520950820866");
    expect(ids).toContain("428334191118385172");
  });

  it("reads plain names and cleans their decoration", () => {
    const entries = parseWordleSummary(REAL)?.entries ?? [];
    const names = entries.filter((entry) => entry.name).map((entry) => entry.name);

    expect(names).toEqual(["Laura", "Binker", "Bucket Crab"]);
  });

  it("carries the guess count with each player", () => {
    const entries = parseWordleSummary(REAL)?.entries ?? [];

    expect(entries.find((entry) => entry.userId === "137969036129468416")).toMatchObject({
      guesses: 4,
      solved: true,
    });
    expect(entries.find((entry) => entry.userId === "428334191118385172")).toMatchObject({
      guesses: 6,
      solved: true,
    });
  });

  it("handles failures and the crown", () => {
    const content = [
      "Your group is on a 3 day streak! Here are yesterday's results:",
      "👑 2/6: <@1>",
      "X/6: <@2> <@3>",
    ].join("\n");
    const parsed = parseWordleSummary(content);

    expect(parsed?.streak).toBe(3);
    expect(parsed?.entries).toEqual([
      { userId: "1", guesses: 2, solved: true },
      { userId: "2", guesses: 6, solved: false },
      { userId: "3", guesses: 6, solved: false },
    ]);
  });

  it("cleans escaped names and signed decorations", () => {
    const content = [
      "Your group is on a 5 day streak! Here are yesterday's results:",
      "4/6: @Big Wiper Señor\\. \\(\\-129 points\\) <@9>",
    ].join("\n");

    const names = parseWordleSummary(content)
      ?.entries.filter((entry) => entry.name)
      .map((entry) => entry.name);

    expect(names).toEqual(["Big Wiper Señor."]);
  });

  it("returns null for a non-summary", () => {
    expect(parseWordleSummary("Wordle 1,977 3/6")).toBeNull();
  });
});
