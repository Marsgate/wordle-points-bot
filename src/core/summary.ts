/** One player's line in the daily summary. */
export interface SummaryEntry {
  /** Present when the summary used a real mention. */
  userId?: string;
  /** Present when the summary used plain "@Name" text. */
  name?: string;
  guesses: number;
  solved: boolean;
}

export interface WordleSummary {
  /** The group's streak as reported by the Activity. */
  streak: number | null;
  entries: SummaryEntry[];
}

const STREAK_PATTERN = /(\d+)\s*day streak/iu;
const SCORE_LINE = /^\s*(?:👑\s*)?([1-6x])\/6\s*:\s*(.+)$/iu;
const MENTION = /<@!?(\d+)>/gu;

/** True when this looks like the Activity's daily summary message. */
export function looksLikeWordleSummary(content: string): boolean {
  return /day streak/iu.test(content) && /[1-6x]\/6\s*:/iu.test(content);
}

/** Strip escapes and decorations the Activity adds around plain names. */
function cleanName(raw: string): string {
  let name = raw.replace(/\s+/gu, " ").trim();
  // The Activity escapes punctuation: "Señor\." -> "Señor.", "\-129" -> "-129".
  name = name.replace(/\\(.)/gu, "$1");
  // Drop trailing score decorations like "(+48 points)" or "(-129 points)".
  name = name.replace(/\s*\(\s*[+-]?\d+(?:\.\d+)?\s*points?\s*\)\s*$/iu, "").trim();
  return name;
}

/**
 * Parse the Wordle Activity's daily summary, e.g.
 *
 *   **Your group is on a 103 day streak!** 🔥🔥🔥 Here are yesterday's results:
 *   👑 4/6: @Laura <@137969036129468416>
 *   5/6: <@263526840394579978>
 *   6/6: @Binker @Bucket Crab \(\+48 points\) <@428334191118385172>
 *
 * Mentions become `userId`; plain "@Name" text becomes `name` and is resolved
 * later against guild members. Returns null when the message is not a summary.
 */
export function parseWordleSummary(content: string): WordleSummary | null {
  if (!content || !looksLikeWordleSummary(content)) return null;

  const streakMatch = STREAK_PATTERN.exec(content);
  const streak = streakMatch?.[1] ? Number.parseInt(streakMatch[1], 10) : null;
  const entries: SummaryEntry[] = [];

  for (const line of content.split(/\r?\n/u)) {
    const match = SCORE_LINE.exec(line);
    if (!match) continue;

    const rawScore = match[1] ?? "";
    const guesses = rawScore.toLowerCase() === "x" ? 6 : Number.parseInt(rawScore, 10);
    const solved = rawScore.toLowerCase() !== "x" && guesses >= 1 && guesses <= 6;
    const body = match[2] ?? "";

    // Mentions first; they are unambiguous.
    const withoutMentions = body.replace(MENTION, (_whole, id: string) => {
      entries.push({ userId: id, guesses, solved });
      return " ";
    });

    // Anything left starting with "@" is plain text.
    for (const chunk of withoutMentions.split("@").slice(1)) {
      const name = cleanName(chunk);
      if (name) entries.push({ name, guesses, solved });
    }
  }

  if (entries.length === 0) return null;
  return { streak: Number.isFinite(streak) ? streak : null, entries };
}
