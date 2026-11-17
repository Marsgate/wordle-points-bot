import { dayKey } from "../core/day.js";
import { parseWordleShare } from "../core/grid.js";
import type { JsonStore } from "../store.js";
import type { Logger, SpoilerPort } from "./ports.js";

export interface IncomingMessage {
  id: string;
  guildId: string | null;
  channelId: string;
  authorId: string;
  authorName: string;
  authorIsBot: boolean;
  content: string;
  createdAt: Date;
}

export type RecordOutcome =
  | { kind: "ignored"; reason: "bot" | "no-share" | "no-guild" | "other-guild" | "unregistered" }
  | {
      kind: "recorded";
      day: string;
      guesses: number;
      solved: boolean;
      improved: boolean;
      spoilerGranted: boolean;
    };

/** Lower is better; an unsolved 6 counts as worse than any solve. */
function rank(guesses: number, solved: boolean): number {
  return solved ? guesses : 7;
}

/**
 * Turns Wordle shares into day entries, wherever they are posted in the guild.
 *
 * The bot cannot see inside Discord's Wordle Activity, so a share is the only
 * signal that someone finished. Any channel counts; a share in a channel the
 * bot cannot read simply never reaches it.
 */
export class ResultsService {
  constructor(
    private readonly deps: {
      store: JsonStore;
      spoilers: SpoilerPort | null;
      logger: Logger;
    },
  ) {}

  async handle(message: IncomingMessage): Promise<RecordOutcome> {
    if (message.authorIsBot) return { kind: "ignored", reason: "bot" };
    if (!message.guildId) return { kind: "ignored", reason: "no-guild" };

    const share = parseWordleShare(message.content);
    if (!share) return { kind: "ignored", reason: "no-share" };

    const { store } = this.deps;
    const config = store.config;
    if (config.guildId && config.guildId !== message.guildId) return { kind: "ignored", reason: "other-guild" };

    // Registration is the source of truth: no registration, no score.
    const player = store.data.players[message.authorId];
    if (!player?.registered) return { kind: "ignored", reason: "unregistered" };
    if (message.authorName && message.authorName !== player.displayName) {
      player.displayName = message.authorName;
    }

    const day = dayKey(message.createdAt, config.timeZone);

    const record = store.day(day);
    const existing = record.entries[message.authorId];
    const improved = !existing || rank(share.guesses, share.solved) < rank(existing.guesses, existing.solved);

    if (improved) {
      record.entries[message.authorId] = {
        userId: message.authorId,
        guesses: share.guesses,
        solved: share.solved,
        puzzleNumber: share.puzzleNumber,
        messageId: message.id,
        recordedAt: message.createdAt.toISOString(),
      };
      await store.save();
    }

    const spoilerGranted = await this.grantSpoilers(message.authorId);

    this.deps.logger.info(
      `Recorded ${share.solved ? `${share.guesses}/6` : "X/6"} for <@${message.authorId}> on ${day} ` +
        `(channel ${message.channelId})` +
        (improved ? "" : " — kept earlier, better result"),
    );

    return {
      kind: "recorded",
      day,
      guesses: share.guesses,
      solved: share.solved,
      improved,
      spoilerGranted,
    };
  }

  private async grantSpoilers(userId: string): Promise<boolean> {
    const { store, spoilers, logger } = this.deps;
    if (!store.config.spoilerChannelId || !spoilers) return false;
    try {
      await spoilers.grant(userId);
      return true;
    } catch (error) {
      logger.warn(`Could not grant spoiler access to <@${userId}>`, error);
      return false;
    }
  }
}
