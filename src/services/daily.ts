import { dayKey } from "../core/day.js";
import { roundToHalf, scoreDay, type Winner } from "../core/scoring.js";
import type { JsonStore } from "../store.js";
import type { DisplayService } from "./display.js";
import type { Logger } from "./ports.js";

export interface FinalizeReport {
  skipped: boolean;
  winners: Winner[];
  /** Players whose points role was created or updated. */
  updated: string[];
  failures: Array<{ userId: string; reason: string }>;
}

export interface RolloverReport {
  finalized: string[];
}

/**
 * Closes days: commits the prize to the winners' all-time totals and
 * refreshes their personal role.
 *
 * Points are committed at rollover rather than on every result so a day's
 * ranking is stable and roles are not rewritten each time someone else plays.
 */
export class DailyService {
  /**
   * One close or reopen per day at a time. Two summaries for the same day can
   * arrive together (two channels, or a gateway message during the startup
   * scan), and a reopen that interleaves with another reopen takes the day's
   * points off every winner twice while only one close puts them back.
   */
  private readonly dayLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: {
      store: JsonStore;
      display: DisplayService;
      logger: Logger;
      timeZone: () => string;
      now: () => Date;
    },
  ) {}

  async finalizeDay(key: string): Promise<FinalizeReport> {
    return this.serialiseDay(key, () => this.closeDay(key));
  }

  /** Runs one day's close or reopen at a time; see `dayLocks`. */
  private serialiseDay<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.dayLocks.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    this.dayLocks.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async closeDay(key: string): Promise<FinalizeReport> {
    const empty: FinalizeReport = { skipped: true, winners: [], updated: [], failures: [] };

    const day = this.deps.store.data.days[key];
    if (!day || day.finalized) return empty;

    const score = scoreDay(Object.values(day.entries));

    // Everyone the summary named is a player, so everyone who solved shares.
    const winners = score.winners;
    day.points = score.points;
    day.finalized = true;
    day.finalizedAt = this.deps.now().toISOString();

    const updated: string[] = [];
    const failures: Array<{ userId: string; reason: string }> = [];

    for (const winner of winners) {
      const player = this.deps.store.player(winner.userId);

      player.total = roundToHalf(player.total + winner.points);

      const applied = await this.deps.display.applyPoints(
        winner.userId,
        player.total,
        player.roleId ?? null,
      );

      if (applied.ok) {
        player.roleId = applied.roleId;
        updated.push(winner.userId);
      } else {
        failures.push({ userId: winner.userId, reason: applied.reason });
      }
    }

    await this.deps.store.save();
    this.deps.logger.info(
      `Closed ${key}: ${winners.length} winner(s), ${score.players} entrant(s), ` +
        `${updated.length} points role(s) synced.`,
    );

    return { skipped: false, winners, updated, failures };
  }

  /** Finalize anything that ended while the bot was offline. */
  async rollover(now: Date = this.deps.now()): Promise<RolloverReport> {
    const today = dayKey(now, this.deps.timeZone());
    const finalized: string[] = [];

    for (const key of this.deps.store.openDaysBefore(today)) {
      const report = await this.finalizeDay(key);
      if (!report.skipped) finalized.push(key);
    }

    return { finalized };
  }

  /**
   * Undo a close: take the day's awarded points back out of the totals, refresh
   * the roles, and leave the day open so later results count again.
   */
  async reopenDay(key: string): Promise<{ reopened: boolean; reverted: number }> {
    return this.serialiseDay(key, () => this.openDay(key));
  }

  private async openDay(key: string): Promise<{ reopened: boolean; reverted: number }> {
    const day = this.deps.store.data.days[key];
    if (!day?.finalized) return { reopened: false, reverted: 0 };

    let reverted = 0;
    for (const [userId, points] of Object.entries(day.points)) {
      const player = this.deps.store.data.players[userId];
      if (!player || points === 0) continue;

      player.total = roundToHalf(player.total - points);

      const applied = await this.deps.display.applyPoints(
        userId,
        player.total,
        player.roleId ?? null,
      );
      if (applied.ok) player.roleId = applied.roleId;

      reverted += 1;
    }

    day.points = {};
    day.finalized = false;
    delete day.finalizedAt;
    await this.deps.store.save();
    this.deps.logger.info(`Reopened ${key}: reverted points for ${reverted} member(s).`);

    return { reopened: true, reverted };
  }

  /** Re-apply roles from stored totals, e.g. after a manual correction or a restore. */
  async resync(): Promise<{
    updated: string[];
    failures: Array<{ userId: string; reason: string }>;
  }> {
    const updated: string[] = [];
    const failures: Array<{ userId: string; reason: string }> = [];

    for (const player of Object.values(this.deps.store.data.players)) {
      const applied = await this.deps.display.applyPoints(
        player.userId,
        player.total,
        player.roleId ?? null,
      );

      if (applied.ok) {
        player.roleId = applied.roleId;
        updated.push(player.userId);
      } else {
        failures.push({ userId: player.userId, reason: applied.reason });
      }
    }

    await this.deps.store.save();
    return { updated, failures };
  }
}
