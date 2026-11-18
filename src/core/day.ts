/** True when the runtime recognises the IANA time zone. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The local calendar date ("YYYY-MM-DD") at `date` in `timeZone`. This is the
 * "Wordle day" key used for scoring and rollover.
 */
export function dayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** "Mon, Nov 16" for a day key, rendered in the guild's zone. */
export function formatDayLabel(key: string, timeZone: string): string {
  const noonUtc = new Date(`${key}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(noonUtc);
}
