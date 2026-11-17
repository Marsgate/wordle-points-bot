import { dayKey, isValidTimeZone } from "./core/day.js";

export interface AppConfig {
  token: string;
  /** When set, slash commands are registered to this guild immediately. */
  guildId: string | null;
  dataDir: string;
  timeZone: string;
}

export const DEFAULT_TIME_ZONE = "America/Indianapolis";

/** Read and validate the environment. Throws with a message a human can act on. */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const token = env.DISCORD_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "DISCORD_TOKEN is not set. Copy .env.example to .env, then paste your bot token into it.",
    );
  }

  const timeZone = env.TZ?.trim() || DEFAULT_TIME_ZONE;
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`TZ="${timeZone}" is not a valid IANA time zone (try ${DEFAULT_TIME_ZONE}).`);
  }

  return {
    token,
    guildId: env.DISCORD_GUILD_ID?.trim() || null,
    dataDir: env.DATA_DIR?.trim() || "./data",
    timeZone,
  };
}

/** Small helper used in logs: which day does the bot think it is? */
export function describeDay(timeZone: string, now: Date = new Date()): string {
  return `${dayKey(now, timeZone)} (${timeZone})`;
}
