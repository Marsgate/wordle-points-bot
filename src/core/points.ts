/** Discord caps role names at 100 characters (UTF-16 code units). */
export const MAX_ROLE_NAME_LENGTH = 100;

/**
 * Matches a trailing points suffix, with or without the "pts" the bot adds to
 * role names. `|` is included so older hand-typed suffixes can be cleaned up.
 */
const SUFFIX_PATTERN = /\s*[·•|]\s*\d+(?:\.\d+)?(?:\s*pts?)?\s*$/u;

/** 12 -> "12", 12.5 -> "12.5", 3.33 -> "3.5". */
export function formatPoints(points: number): string {
  if (!Number.isFinite(points)) throw new Error(`Cannot format points: ${points}`);
  const rounded = Math.round(points * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Remove a trailing points suffix, keeping decoration intact:
 * "𝓜𝓲𝓬𝓪𝓱 ✦ · 3.5" -> "𝓜𝓲𝓬𝓪𝓱 ✦". Repeated suffixes are stripped.
 */
export function stripPointsSuffix(name: string): string {
  let current = name.trim();
  for (;;) {
    const next = current.replace(SUFFIX_PATTERN, "").trim();
    if (next === current) return current;
    current = next;
  }
}

/**
 * Cut text to at most `maxUnits` UTF-16 code units without splitting a
 * grapheme cluster, so fancy-font letters and emoji stay intact.
 */
export function truncateToLength(text: string, maxUnits: number): string {
  if (text.length <= maxUnits) return text;
  if (maxUnits <= 0) return "";
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let out = "";
  for (const { segment } of segmenter.segment(text)) {
    if (out.length + segment.length > maxUnits) break;
    out += segment;
  }
  return out;
}

/**
 * The member's personal points role name, e.g. "𝓐𝓭𝓪 ✦ · 13.5 pts". The points
 * suffix always survives; the decorated name is trimmed first if space is short.
 */
export function roleNameFor(base: string, points: number, maxUnits: number = MAX_ROLE_NAME_LENGTH): string {
  const suffix = ` · ${formatPoints(points)} pts`;
  const cleaned = stripPointsSuffix(base) || "Player";
  const room = maxUnits - suffix.length;
  if (room <= 0) return truncateToLength(suffix, maxUnits);
  return `${truncateToLength(cleaned, room)}${suffix}`;
}

/**
 * Role colour by band, so the member list still reads as a ranking at a glance:
 * grey below 10, green at 10, blue at 25, gold at 50.
 */
export function roleColorFor(points: number): number {
  if (points >= 50) return 0xfee75c;
  if (points >= 25) return 0x5865f2;
  if (points >= 10) return 0x57f287;
  return 0x99aab5;
}
