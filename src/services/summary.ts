import { dayKey } from "../core/day.js";
import { looksLikeWordleSummary, parseWordleSummary, type SummaryEntry } from "../core/summary.js";
import { previousDayKey } from "../core/streak.js";
import type { JsonStore } from "../store.js";
import type { DailyService } from "./daily.js";
import type { Logger, MemberPort, MemberSummary, SummaryMessage, SummarySourcePort } from "./ports.js";

function rank(entry: { guesses: number; solved: boolean }): number {
  return entry.solved ? entry.guesses : 7;
}

/**
 * Applies the Wordle Activity's daily summary to the day it describes.
 *
 * The summary is yesterday's results, posted the next morning, so this runs
 * after that day was closed: it reopens the day, merges the scores (keeping the
 * better of a share and the summary), and closes it again. Only registered
 * members are scored. The reported group streak seeds the streak counter.
 */
export class SummaryService {
  private memberCache: { at: number; members: MemberSummary[] } | null = null;

  constructor(
    private readonly deps: {
      store: JsonStore;
      daily: DailyService;
      members: MemberPort;
      source: SummarySourcePort;
      logger: Logger;
      timeZone: () => string;
    },
  ) {}

  async handleMessage(message: SummaryMessage): Promise<boolean> {
    return this.process(message);
  }

  /** Scan recent history, in case the gateway does not deliver app messages. */
  async poll(): Promise<number> {
    const config = this.deps.store.config;
    const known = config.summaryChannelIds ?? [];
    const channels = known.length > 0 ? known : await this.deps.source.listTextChannelIds();

    let processed = 0;
    for (const channelId of channels) {
      try {
        const messages = await this.deps.source.fetchRecentMessages(channelId, 100);
        // Oldest first, so a newer summary's streak wins over an older one.
        messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        for (const message of messages) {
          if (await this.process(message)) processed += 1;
        }
      } catch (error) {
        this.deps.logger.warn(`Could not scan channel ${channelId} for a summary`, error);
      }
    }
    return processed;
  }

  private async process(message: SummaryMessage): Promise<boolean> {
    if (!message.authorIsBot) return false;
    if (!looksLikeWordleSummary(message.content)) return false;

    const summary = parseWordleSummary(message.content);
    if (!summary) return false;

    const summaryDay = previousDayKey(dayKey(message.createdAt, this.deps.timeZone()));
    const day = this.deps.store.day(summaryDay);

    // The same message is seen by both the gateway and the poller.
    if (day.summaryMessageId === message.id) return false;

    const members = await this.membersForResolution();
    const resolved = this.resolveEntries(summary.entries, members);

    let applied = 0;
    for (const entry of resolved) {
      if (!this.deps.store.data.players[entry.userId]?.registered) continue;

      const existing = day.entries[entry.userId];
      if (existing && rank(existing) <= rank(entry)) continue;

      day.entries[entry.userId] = {
        userId: entry.userId,
        guesses: entry.guesses,
        solved: entry.solved,
        puzzleNumber: null,
        messageId: message.id,
        recordedAt: message.createdAt.toISOString(),
      };
      applied += 1;
    }

    day.summaryMessageId = message.id;

    if (summary.streak !== null) {
      // Never let an older summary overwrite a newer streak.
      const current = this.deps.store.config.streakSeed;
      if (!current || summaryDay >= current.day) {
        this.deps.store.config.streakSeed = { day: summaryDay, count: summary.streak };
      }
    }
    if (!this.deps.store.config.summaryChannelIds.includes(message.channelId)) {
      this.deps.store.config.summaryChannelIds.push(message.channelId);
    }

    // Re-close the day with the summary's data merged in.
    if (day.finalized) await this.deps.daily.reopenDay(summaryDay);
    const report = await this.deps.daily.finalizeDay(summaryDay);
    await this.deps.store.save();

    this.deps.logger.info(
      `Summary for ${summaryDay}: ${applied} result(s) applied, ${report.winners.length} winner(s), ` +
        `streak ${summary.streak ?? "unknown"}.`,
    );
    return true;
  }

  /** Member lists are expensive; one fetch serves every summary in a scan. */
  private async membersForResolution(): Promise<MemberSummary[]> {
    if (this.memberCache && Date.now() - this.memberCache.at < 5 * 60_000) {
      return this.memberCache.members;
    }
    const members = await this.deps.members.listMembers();
    this.memberCache = { at: Date.now(), members };
    return members;
  }

  private resolveEntries(
    entries: SummaryEntry[],
    members: MemberSummary[],
  ): Array<{ userId: string; guesses: number; solved: boolean }> {
    const byName = new Map<string, string[]>();
    for (const member of members) {
      for (const name of [member.username, member.nickname, member.globalName]) {
        if (!name) continue;
        const key = name.toLowerCase();
        const ids = byName.get(key) ?? [];
        if (!ids.includes(member.userId)) ids.push(member.userId);
        byName.set(key, ids);
      }
    }

    const resolved: Array<{ userId: string; guesses: number; solved: boolean }> = [];

    for (const entry of entries) {
      if (entry.userId) {
        resolved.push({ userId: entry.userId, guesses: entry.guesses, solved: entry.solved });
        continue;
      }
      if (!entry.name) continue;

      const ids = byName.get(entry.name.toLowerCase()) ?? [];
      if (ids.length === 1 && ids[0]) {
        resolved.push({ userId: ids[0], guesses: entry.guesses, solved: entry.solved });
      } else {
        this.deps.logger.warn(
          `Summary name "${entry.name}" ${ids.length === 0 ? "matched no member" : "is ambiguous"}; skipped.`,
        );
      }
    }

    return resolved;
  }
}
