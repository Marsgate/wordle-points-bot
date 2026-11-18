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
  private readonly finalizing = new Set<string>();

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
    const empty: FinalizeReport = { skipped: true, winners: [], updated: [], failures: [] };

    const day = this.deps.store.data.days[key];
    if (!day || day.finalized || this.finalizing.has(key)) return empty;

    this.finalizing.add(key);
    try {
      const score = scoreDay(Object.values(day.entries));
      const isRegistered = (userId: string) =>
        this.deps.store.data.players[userId]?.registered === true;

      // Everyone takes part in the split, but only registered members are paid.
      const winners = score.winners.filter((winner) => isRegistered(winner.userId));
      day.points = Object.fromEntries(
        Object.entries(score.points).filter(([userId]) => isRegistered(userId)),
      );
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
    } finally {
      this.finalizing.delete(key);
    }
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
    const day = this.deps.store.data.days[key];
    if (!day?.finalized) return { reopened: false, reverted: 0 };

    let reverted = 0;
    for (const [userId, points] of Object.entries(day.points)) {
      const player = this.deps.store.data.players[userId];
      if (!player || points === 0) continue;

      player.total = roundToHalf(player.total - points);

      if (player.registered) {
        const applied = await this.deps.display.applyPoints(
          userId,
          player.total,
          player.roleId ?? null,
        );
        if (applied.ok) player.roleId = applied.roleId;
      } else if (player.roleId) {
        await this.deps.display.removePoints(player.roleId);
        player.roleId = null;
      }

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
      if (!player.registered) {
        if (player.roleId) {
          await this.deps.display.removePoints(player.roleId);
          player.roleId = null;
        }
        continue;
      }

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
