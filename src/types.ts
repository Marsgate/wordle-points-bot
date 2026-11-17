/** A single parsed Wordle share. */
export interface WordleShare {
  /** NYT puzzle number from the share header, when present. */
  puzzleNumber: number | null;
  /** Number of guesses used, derived from the grid rows (1-6). */
  guesses: number;
  /** True when the last row is all green. */
  solved: boolean;
  /** True when the share header carried the hard-mode asterisk. */
  hardMode: boolean;
  /** The grid as rows of tile characters. */
  rows: string[][];
}
