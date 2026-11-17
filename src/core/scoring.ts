/** Points handed to first place each day. */
export const DAILY_PRIZE = 10;

/** Floor for a single player's share, so a big tie still awards something. */
export const MIN_SHARE = 0.5;

export interface ScoredEntry {
  userId: string;
  guesses: number;
  solved: boolean;
}

export interface Winner {
  userId: string;
  guesses: number;
  points: number;
}

export interface DayScore {
  /** Fewest guesses among solvers, or null when nobody solved. */
  bestGuesses: number | null;
  winners: Winner[];
  /** User id -> points earned today (winners only). */
  points: Record<string, number>;
  solvers: number;
  players: number;
}

/** Round to the nearest half point, e.g. 3.333 -> 3.5, 1.2 -> 1. */
export function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

/**
 * Split the daily prize between tied first place, rounded to the nearest half
 * point. 1 winner -> 10, 2 -> 5, 3 -> 3.5, 4 -> 2.5, 6 -> 1.5, 20 -> 0.5.
 *
 * Rounding means a three-way tie hands out 10.5 points in total; the prize is
 * a target, not a budget, and that is the documented behaviour.
 */
export function splitPrize(winners: number, prize: number = DAILY_PRIZE): number {
  if (winners < 1) throw new Error("splitPrize needs at least one winner");
  return Math.max(MIN_SHARE, roundToHalf(prize / winners));
}

/**
 * Rank one day's entries. Only solvers can win: an X/6 player is "finished"
 * for spoiler purposes but never takes first place.
 */
export function scoreDay(entries: Iterable<ScoredEntry>, prize: number = DAILY_PRIZE): DayScore {
  const all = [...entries];
  const solvers = all.filter(
    (entry) => entry.solved && Number.isInteger(entry.guesses) && entry.guesses >= 1 && entry.guesses <= 6,
  );

  if (solvers.length === 0) {
    return { bestGuesses: null, winners: [], points: {}, solvers: 0, players: all.length };
  }

  const bestGuesses = Math.min(...solvers.map((entry) => entry.guesses));
  const firstPlace = solvers.filter((entry) => entry.guesses === bestGuesses);
  const points = splitPrize(firstPlace.length, prize);

  const winners: Winner[] = firstPlace
    .map((entry) => ({ userId: entry.userId, guesses: entry.guesses, points }))
    .sort((a, b) => a.userId.localeCompare(b.userId));

  const pointsByUser: Record<string, number> = {};
  for (const winner of winners) pointsByUser[winner.userId] = winner.points;

  return {
    bestGuesses,
    winners,
    points: pointsByUser,
    solvers: solvers.length,
    players: all.length,
  };
}
