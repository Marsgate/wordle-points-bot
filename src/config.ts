import { isValidTimeZone } from "./core/day.js";

export interface AppConfig {
  token: string;
  /** When set, slash commands are registered to this guild immediately. */
  guildId: string | null;
  dataDir: string;
  timeZone: string;
  /** Channel for server-wide notices; null answers in the summary's own channel. */
  wordleChannelId: string | null;
  /** Exposes developer-only commands such as /wordle-close. */
  debugTools: boolean;
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
    wordleChannelId: env.DISCORD_WORDLE_CHANNEL_ID?.trim() || null,
    debugTools: /^(1|true|yes|on)$/i.test(env.DEBUG_TOOLS?.trim() ?? ""),
  };
}
