/** A streak carried in from before the bot started counting. */
export interface StreakSeed {
  /** The last day the carried streak covers, inclusive. */
  day: string;
  /** Consecutive winning days ending on that day. */
  count: number;
}

/** The calendar day before a `YYYY-MM-DD` key. */
export function previousDayKey(key: string): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Consecutive days with at least one solver, ending today (or yesterday while
 * today has no result yet — a streak only breaks once a day is over).
 *
 * A seed covers everything up to and including its day, so a long-running
 * streak from a previous system survives the switch.
 */
export function computeStreak(input: {
  wonDays: Iterable<string>;
  today: string;
  seed?: StreakSeed | null;
  /** True when the day is already over, so a missing win breaks the streak. */
  dayIsClosed?: boolean;
}): { current: number; best: number } {
  const won = new Set(input.wonDays);
  const seed = input.seed && input.seed.count > 0 ? input.seed : null;

  let current = 0;

  if (input.dayIsClosed && !won.has(input.today)) {
    // A day that ended without a solve breaks the streak, unless the seed
    // itself covers that day.
    current = seed?.day === input.today ? seed.count : 0;
  } else {
    let key = won.has(input.today) ? input.today : previousDayKey(input.today);

    for (;;) {
      if (seed && key === seed.day) {
        current += seed.count;
        break;
      }
      if (!won.has(key)) break;
      current += 1;
      key = previousDayKey(key);
    }
  }

  // Longest run ever, with the seed treated as a pre-existing run.
  const days = new Set(won);
  if (seed) days.add(seed.day);
  const sorted = [...days].sort();

  let best = 0;
  let run = 0;
  let offset = 0;
  let previous: string | null = null;

  for (const day of sorted) {
    if (previous && previousDayKey(day) === previous) {
      run += 1;
    } else {
      run = 1;
      offset = 0;
    }
    if (seed && day === seed.day) offset = seed.count - 1;
    best = Math.max(best, run + offset);
    previous = day;
  }

  return { current, best: Math.max(best, current) };
}
