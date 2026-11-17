/** 12 -> "12", 12.5 -> "12.5", 3.33 -> "3.5", -10 -> "-10". */
export function formatPoints(points: number): string {
  if (!Number.isFinite(points)) throw new Error(`Cannot format points: ${points}`);
  const rounded = Math.round(points * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * The points role name: the number followed by the unit ("13.5 points",
 * "0 points", "-114 points"). No nickname, no decoration.
 */
export function roleNameFor(points: number): string {
  return `${formatPoints(points)} points`;
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
