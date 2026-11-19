import { dayKey } from "../core/day.js";
import { looksLikeWordleSummary, parseWordleSummary, type SummaryEntry } from "../core/summary.js";
import { computeStreak, previousDayKey } from "../core/streak.js";
import type { JsonStore } from "../store.js";
import { allTimeBoard } from "./board.js";
import type { DailyService } from "./daily.js";
import type { DisplayService } from "./display.js";
import { registerOnPlay } from "./registration.js";
import type {
  Logger,
  MemberPort,
  MemberSummary,
  NotifierPort,
  SummaryMessage,
  SummarySourcePort,
} from "./ports.js";

function rank(entry: { guesses: number; solved: boolean }): number {
  return entry.solved ? entry.guesses : 7;
}

/**
 * Applies the Wordle Activity's daily summary to the day it describes.
 *
 * The summary is yesterday's results, posted the next morning, so this runs
 * after that day was closed: it reopens the day, merges the scores, and
 * closes it again. The all-time board follows in the same channel, right under
 * the Activity's score.
 *
 * The streak is the server's own count. The highest group streak reported
 * around startup becomes the starting line; once locked, later Activity numbers
 * are ignored and the bot simply counts days with a winner.
 */
export class SummaryService {
  private memberCache: { at: number; members: MemberSummary[] } | null = null;

  constructor(
    private readonly deps: {
      store: JsonStore;
      daily: DailyService;
      display: DisplayService;
      members: MemberPort;
      source: SummarySourcePort;
      notifier: NotifierPort;
      logger: Logger;
      timeZone: () => string;
      /** Server-wide notices go here; null answers in the summary's channel. */
      noticeChannelId: () => string | null;
    },
  ) {}

  async handleMessage(message: SummaryMessage): Promise<boolean> {
    return this.process(message);
  }

  /** Scan recent history, in case the gateway does not deliver app messages. */
  async poll(): Promise<number> {
    const config = this.deps.store.config;

    // Scan every readable channel, not just previously seen ones: a new Wordle
    // channel must be discovered so its results join the same daily comparison.
    const channels = await this.deps.source.listTextChannelIds();

    let processed = 0;
    for (const channelId of channels) {
      try {
        const messages = await this.deps.source.fetchRecentMessages(channelId, 100);
        // Oldest first, so the newest summary is considered last.
        messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        for (const message of messages) {
          if (await this.process(message)) processed += 1;
        }
      } catch (error) {
        this.deps.logger.warn(`Could not scan channel ${channelId} for a summary`, error);
      }
    }

    // The scan is where every group's current streak can be seen at once, so
    // this is the last chance to pick the highest before counting starts.
    if (!config.streakFrozen && config.streakSeed) {
      config.streakFrozen = true;
      await this.deps.store.save();
      this.deps.logger.info(
        `Streak baseline locked at ${config.streakSeed.count} through ${config.streakSeed.day}.`,
      );
    }

    return processed;
  }

  private async process(message: SummaryMessage): Promise<boolean> {
    if (!message.authorIsBot) return false;
    if (!looksLikeWordleSummary(message.content)) return false;

    const summary = parseWordleSummary(message.content);
    if (!summary) return false;

    const summaryDay = previousDayKey(dayKey(message.createdAt, this.deps.timeZone()));
    const config = this.deps.store.config;

    // Already skipped as pre-install; do not rescan it.
    if (config.ignoredSummaryIds.includes(message.id)) return false;

    // Days before the bot was set up were already part of any seeded totals;
    // scoring them again would double-count. They still count towards the
    // starting streak, which is the highest group streak around startup.
    const startedOn = config.startedOn;
    if (startedOn && summaryDay < startedOn) {
      this.updateBaseline(summary.streak, summaryDay);
      config.ignoredSummaryIds.push(message.id);
      if (config.ignoredSummaryIds.length > 100) {
        config.ignoredSummaryIds.splice(0, config.ignoredSummaryIds.length - 100);
      }
      await this.deps.store.save();
      this.deps.logger.info(`Summary for ${summaryDay} predates setup (${startedOn}); skipped.`);
      return true;
    }

    const day = this.deps.store.day(summaryDay);

    // The same message is seen by both the gateway and the poller, and every
    // channel's summary describes the same day, so remember every id applied.
    if (day.summaryMessageIds?.includes(message.id) || day.summaryMessageId === message.id) {
      return false;
    }

    const members = await this.membersForResolution();
    const resolved = this.resolveEntries(summary.entries, members);
    await this.registerPlayers(resolved, members);

    let applied = 0;

    for (const entry of resolved) {
      const existing = day.entries[entry.userId];
      if (existing && rank(existing) <= rank(entry)) continue;

      day.entries[entry.userId] = {
        userId: entry.userId,
        guesses: entry.guesses,
        solved: entry.solved,
        messageId: message.id,
        recordedAt: message.createdAt.toISOString(),
      };
      applied += 1;
    }

    day.summaryMessageId = message.id;
    day.summaryMessageIds = [...new Set([...(day.summaryMessageIds ?? []), message.id])];
    this.updateBaseline(summary.streak, summaryDay);

    // Re-close the day with the summary's data merged in.
    if (day.finalized) await this.deps.daily.reopenDay(summaryDay);
    const report = await this.deps.daily.finalizeDay(summaryDay);

    // Server-wide notices are decided before the save so their "sent" marks go
    // to disk with the day they describe: a crash can lose a notice, but a
    // restart can never post the same one again.
    const noticeChannel = this.deps.noticeChannelId() ?? message.channelId;
    const correction =
      summary.streak !== null && !day.streakCorrectionSent
        ? this.streakCorrection(summary.streak, summaryDay)
        : null;
    const postBoard = !day.leaderboardPosted;

    if (correction) day.streakCorrectionSent = true;
    if (postBoard) day.leaderboardPosted = true;

    await this.deps.store.save();

    this.deps.logger.info(
      `Summary for ${summaryDay}: ${applied} result(s) applied, ${report.winners.length} winner(s), ` +
        `streak ${summary.streak ?? "unknown"}.`,
    );

    // The board goes straight under the Activity's score, in its channel.
    if (postBoard) {
      try {
        await this.deps.notifier.send(message.channelId, allTimeBoard(this.deps.store));
      } catch (error) {
        day.leaderboardPosted = false;
        await this.deps.store.save().catch(() => {});
        this.deps.logger.warn("Could not post the leaderboard", error);
      }
    }

    if (correction) {
      try {
        await this.deps.notifier.send(noticeChannel, correction);
      } catch (error) {
        day.streakCorrectionSent = false;
        await this.deps.store.save().catch(() => {});
        this.deps.logger.warn("Could not post the streak correction", error);
      }
    }

    return true;
  }

  /**
   * The correction text when a group's reported streak disagrees with the
   * server-wide streak, or null when they agree.
   */
  private streakCorrection(reported: number, day: string): string | null {
    const serverStreak = computeStreak({
      wonDays: this.wonDays(),
      today: day,
      seed: this.deps.store.config.streakSeed,
      dayIsClosed: true,
    }).current;

    if (serverStreak === reported) return null;
    return (
      `Um, actually 🤓☝️ — the streak is **${serverStreak}** ` +
      `${serverStreak === 1 ? "day" : "days"}.`
    );
  }

  /** Keep the highest streak reported before the baseline is locked. */
  private updateBaseline(streak: number | null, day: string): void {
    const config = this.deps.store.config;
    if (config.streakFrozen || streak === null) return;

    const seed = config.streakSeed;
    if (!seed || streak > seed.count || (streak === seed.count && day > seed.day)) {
      config.streakSeed = { day, count: streak };
    }
  }

  private wonDays(): string[] {
    return Object.values(this.deps.store.data.days)
      .filter((day) => Object.values(day.entries).some((entry) => entry.solved))
      .map((day) => day.key);
  }

  /**
   * Anyone the Activity reports joins at 0 points the first time they appear,
   * so their share of the split is paid rather than dropped. There is no way to
   * opt out: every player the summary names is registered and paid.
   */
  private async registerPlayers(
    entries: Array<{ userId: string }>,
    members: MemberSummary[],
  ): Promise<void> {
    const names = new Map<string, string>();
    for (const member of members) {
      names.set(member.userId, member.nickname ?? member.globalName ?? member.username);
    }

    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.userId)) continue;
      seen.add(entry.userId);
      await registerOnPlay(
        { store: this.deps.store, display: this.deps.display, logger: this.deps.logger },
        { userId: entry.userId, displayName: names.get(entry.userId) ?? "" },
      );
    }
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
