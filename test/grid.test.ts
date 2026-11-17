import { describe, expect, it } from "vitest";
import { parseWordleShare } from "../src/core/grid.js";

const share = (...lines: string[]): string => lines.join("\n");

describe("parseWordleShare", () => {
  it("parses a normal solved share", () => {
    const parsed = parseWordleShare(
      share("Wordle 1,512 3/6", "", "⬛🟨⬛⬛⬛", "⬛🟩🟩🟨⬛", "🟩🟩🟩🟩🟩"),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.puzzleNumber).toBe(1512);
    expect(parsed?.guesses).toBe(3);
    expect(parsed?.solved).toBe(true);
    expect(parsed?.hardMode).toBe(false);
    expect(parsed?.rows).toEqual([
      ["⬛", "🟨", "⬛", "⬛", "⬛"],
      ["⬛", "🟩", "🟩", "🟨", "⬛"],
      ["🟩", "🟩", "🟩", "🟩", "🟩"],
    ]);
  });

  it("parses a 1/6 win", () => {
    const parsed = parseWordleShare(share("Wordle 900 1/6", "", "🟩🟩🟩🟩🟩"));
    expect(parsed?.guesses).toBe(1);
    expect(parsed?.solved).toBe(true);
  });

  it("treats X/6 as finished but unsolved", () => {
    const parsed = parseWordleShare(
      share("Wordle 1,513 X/6", "", "⬛⬛🟨⬛⬛", "⬛🟨⬛⬛🟨", "⬛⬛⬛⬛⬛", "⬛⬛⬛⬛⬛", "⬛⬛⬛⬛⬛", "⬛⬛⬛⬛⬛"),
    );
    expect(parsed?.guesses).toBe(6);
    expect(parsed?.solved).toBe(false);
  });

  it("recognises the hard-mode asterisk", () => {
    const parsed = parseWordleShare(share("Wordle 1,512 4/6*", "", "⬛⬛⬛⬛⬛", "⬛⬛⬛⬛⬛", "⬛⬛⬛⬛⬛", "🟩🟩🟩🟩🟩"));
    expect(parsed?.hardMode).toBe(true);
  });

  it("parses spoiler-wrapped rows", () => {
    const parsed = parseWordleShare(
      share("||Wordle 1,512 2/6||", "||⬛🟨⬛⬛⬛||", "||🟩🟩🟩🟩🟩||"),
    );
    expect(parsed?.guesses).toBe(2);
    expect(parsed?.solved).toBe(true);
  });

  it("accepts light-theme white tiles", () => {
    const parsed = parseWordleShare(share("Wordle 7 2/6", "", "⬜⬜⬜⬜⬜", "🟩🟩🟩🟩🟩"));
    expect(parsed?.guesses).toBe(2);
  });

  it("prefers the grid over a wrong header count", () => {
    // Header says 4 but only three rows were pasted.
    const parsed = parseWordleShare(share("Wordle 1,512 4/6", "", "⬛⬛⬛⬛⬛", "⬛⬛⬛⬛⬛", "🟩🟩🟩🟩🟩"));
    expect(parsed?.guesses).toBe(3);
    expect(parsed?.solved).toBe(true);
  });

  it("tolerates spaces between tiles", () => {
    const parsed = parseWordleShare(share("Wordle 1,512 2/6", "", "⬛ 🟨 ⬛ ⬛ ⬛", "🟩 🟩 🟩 🟩 🟩"));
    expect(parsed?.guesses).toBe(2);
  });

  it("ignores prose posted around the grid", () => {
    const parsed = parseWordleShare(
      share("got it in 2 today!", "Wordle 1,512 2/6", "", "⬛🟨⬛⬛⬛", "🟩🟩🟩🟩🟩", "nice"),
    );
    expect(parsed?.guesses).toBe(2);
  });

  it("rejects a plain message with no header", () => {
    expect(parseWordleShare("⬛🟨⬛⬛⬛\n🟩🟩🟩🟩🟩")).toBeNull();
  });

  it("rejects chat that merely mentions Wordle", () => {
    expect(parseWordleShare("Wordle was hard today, I got a 4/6 eventually")).toBeNull();
  });

  it("rejects a row that is not five tiles", () => {
    expect(parseWordleShare(share("Wordle 1,512 2/6", "", "⬛🟨⬛⬛", "🟩🟩🟩🟩🟩"))).toBeNull();
  });

  it("rejects more than six rows", () => {
    const rows = Array.from({ length: 7 }, () => "⬛⬛⬛⬛⬛");
    expect(parseWordleShare(share("Wordle 1,512 X/6", "", ...rows))).toBeNull();
  });

  it("rejects an empty payload", () => {
    expect(parseWordleShare("")).toBeNull();
  });
});
