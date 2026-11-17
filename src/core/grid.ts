import type { WordleShare } from "../types.js";

/**
 * Tiles the NYT share format can contain. `⬜` shows up when a player shares
 * from the light theme, so both black and white "miss" tiles are accepted.
 */
const TILES = new Set(["⬛", "⬜", "🟨", "🟩"]);

const HEADER = /wordle\s+#?([0-9][0-9.,]*)\s+([1-6x])\s*\/\s*6\s*(\*)?/iu;

/** Spoiler tags are common around shares; they carry no meaning for parsing. */
function stripSpoilers(text: string): string {
  return text.replace(/\|\|/g, " ");
}

function splitRows(text: string): { rows: string[][]; malformed: boolean } {
  const rows: string[][] = [];
  let malformed = false;

  for (const line of text.split(/\r?\n/u)) {
    const tiles = Array.from(line).filter((char) => TILES.has(char));
    if (tiles.length === 0) continue;
    // A line with tiles but not exactly five of them is a broken paste. Guessing
    // which rows belong to the grid could undercount guesses and inflate a
    // score, so the whole share is rejected instead.
    if (tiles.length !== 5) {
      malformed = true;
      continue;
    }
    rows.push(tiles);
  }

  return { rows, malformed };
}

/**
 * Parse a NYT Wordle share, e.g.
 *
 *   Wordle 1,234 4/6
 *
 *   ⬛⬛🟨⬛⬛
 *   ⬛🟩⬛⬛⬛
 *   🟩🟩⬛🟩🟩
 *   🟩🟩🟩🟩🟩
 *
 * Returns `null` when the text is not a Wordle share. The grid is treated as
 * the source of truth for the guess count, so a stale or mistyped header
 * cannot corrupt scoring; the header is only used for the puzzle number,
 * hard mode, and as a required signal that this really is a share.
 */
export function parseWordleShare(content: string): WordleShare | null {
  if (!content) return null;

  const text = stripSpoilers(content);
  const header = HEADER.exec(text);
  if (!header) return null;

  const { rows, malformed } = splitRows(text);
  if (malformed) return null;
  if (rows.length < 1 || rows.length > 6) return null;
  if (rows.some((row) => row.length !== 5)) return null;

  const lastRow = rows[rows.length - 1];
  if (!lastRow) return null;

  const puzzleDigits = header[1]?.replace(/[.,]/g, "") ?? "";
  const puzzleNumber = puzzleDigits === "" ? null : Number.parseInt(puzzleDigits, 10);

  return {
    puzzleNumber: Number.isFinite(puzzleNumber) ? puzzleNumber : null,
    guesses: rows.length,
    solved: lastRow.every((tile) => tile === "🟩"),
    hardMode: Boolean(header[3]),
    rows,
  };
}
