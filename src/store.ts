import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StreakSeed } from "./core/streak.js";

export interface StoredEntry {
  userId: string;
  guesses: number;
  solved: boolean;
  puzzleNumber: number | null;
  messageId: string;
  recordedAt: string;
}

export interface DayRecord {
  key: string;
  entries: Record<string, StoredEntry>;
  /** Points committed at finalization. Empty until the day closes. */
  points: Record<string, number>;
  finalized: boolean;
  finalizedAt?: string;
}

export interface PlayerRecord {
  userId: string;
  /** All-time points, including anything added by /wordle-award. */
  total: number;
  /** Last username seen, used when a member has no nickname. */
  displayName: string;
  /** The bot-managed personal points role, when one exists. */
  roleId: string | null;
  /** Only registered members are scored; registration sets the starting total. */
  registered: boolean;
}

export interface GuildConfig {
  guildId: string | null;
  spoilerChannelId: string | null;
  timeZone: string;
  /** Day whose spoiler access has already been reset, so restarts don't redo it. */
  lastResetDay: string | null;
  /** Streak carried over from before the bot, null when not set. */
  streakSeed: StreakSeed | null;
}

export interface StoreData {
  version: 1;
  config: GuildConfig;
  players: Record<string, PlayerRecord>;
  days: Record<string, DayRecord>;
}

export function emptyData(timeZone: string): StoreData {
  return {
    version: 1,
    config: {
      guildId: null,
      spoilerChannelId: null,
      timeZone,
      lastResetDay: null,
      streakSeed: null,
    },
    players: {},
    days: {},
  };
}

function cloneDefaults(timeZone: string): StoreData {
  return structuredClone(emptyData(timeZone));
}

/**
 * A small JSON document store. The whole file is rewritten atomically
 * (temp file + rename) after each change; a single-guild bot does not need
 * more than that, and the file stays readable when debugging.
 */
export class JsonStore {
  readonly filePath: string;
  private state: StoreData;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly onWarning: (message: string) => void;

  private constructor(filePath: string, state: StoreData, onWarning: (message: string) => void) {
    this.filePath = filePath;
    this.state = state;
    this.onWarning = onWarning;
  }

  static async open(
    filePath: string,
    timeZone: string,
    onWarning: (message: string) => void = () => {},
  ): Promise<JsonStore> {
    const defaults = cloneDefaults(timeZone);
    let loaded: Partial<StoreData> | null = null;

    try {
      const raw = await readFile(filePath, "utf8");
      loaded = JSON.parse(raw) as Partial<StoreData>;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // Do not destroy a corrupt store silently; keep it for inspection.
        const backup = `${filePath}.corrupt-${Date.now()}`;
        try {
          await rename(filePath, backup);
          onWarning(`Store at ${filePath} was unreadable; moved to ${backup} and started fresh.`);
        } catch {
          onWarning(`Store at ${filePath} was unreadable; starting fresh.`);
        }
      }
    }

    if (!loaded) return new JsonStore(filePath, defaults, onWarning);

    const merged: StoreData = {
      ...defaults,
      ...loaded,
      version: 1,
      config: { ...defaults.config, ...(loaded.config ?? {}) },
      players: { ...(loaded.players ?? {}) },
      days: { ...(loaded.days ?? {}) },
    };
    return new JsonStore(filePath, merged, onWarning);
  }

  get data(): StoreData {
    return this.state;
  }

  get config(): GuildConfig {
    return this.state.config;
  }

  day(key: string): DayRecord {
    const existing = this.state.days[key];
    if (existing) return existing;
    const created: DayRecord = { key, entries: {}, points: {}, finalized: false };
    this.state.days[key] = created;
    return created;
  }

  player(userId: string, displayName = ""): PlayerRecord {
    const existing = this.state.players[userId];
    if (existing) {
      if (displayName) existing.displayName = displayName;
      if (existing.roleId === undefined) existing.roleId = null;
      if (existing.registered !== true) existing.registered = false;
      return existing;
    }
    const created: PlayerRecord = { userId, total: 0, displayName, roleId: null, registered: false };
    this.state.players[userId] = created;
    return created;
  }

  /** Days that ended before `todayKey` but were never finalized. */
  openDaysBefore(todayKey: string): string[] {
    return Object.keys(this.state.days)
      .filter((key) => key < todayKey && !this.state.days[key]?.finalized)
      .sort();
  }

  save(): Promise<void> {
    const snapshot = structuredClone(this.state);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await rename(temp, this.filePath);
    });
    return this.writeQueue;
  }
}
