import { dayKey, formatDayLabel } from "../core/day.js";
import { formatPoints } from "../core/points.js";
import { roundToHalf } from "../core/scoring.js";
import { computeStreak, previousDayKey } from "../core/streak.js";
import type { JsonStore } from "../store.js";
import type { DailyService } from "../services/daily.js";
import type { DisplayService } from "../services/display.js";
import { allTimeBoard, medal } from "../services/board.js";
import type { Logger, NotifierPort } from "../services/ports.js";

export interface CommandOptions {
  getNumber(name: string): number | null;
  getUser(name: string): { id: string; name: string } | null;
}

export interface CommandContext {
  guildId: string;
  userId: string;
  userName: string;
  /** Channel the command came from; where notices go when no notice channel is set. */
  channelId: string | null;
  /** Has Manage Server (or Administrator). */
  isAdmin: boolean;
  options: CommandOptions;
  now: Date;
}

export interface CommandReply {
  content: string;
  ephemeral: boolean;
}

export interface CommandDeps {
  store: JsonStore;
  daily: DailyService;
  display: DisplayService;
  /** Posts the public record of a manual award. */
  notifier: NotifierPort;
  /** Server-wide notice channel; null falls back to the command's own channel. */
  noticeChannelId: () => string | null;
  logger: Logger;
  /** Show developer-only commands (close/reopen). Off unless DEBUG_TOOLS is set. */
  debug: boolean;
  now: () => Date;
}

const ephemeral = (content: string): CommandReply => ({ content, ephemeral: true });

const DEBUG_OFF =
  "Developer tools are off. Set `DEBUG_TOOLS=true` in the bot's `.env` and restart to enable them.";
const visible = (content: string): CommandReply => ({ content, ephemeral: false });

function mention(userId: string): string {
  return `<@${userId}>`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Days on which at least one player solved the puzzle, registered or not. */
function wonDays(store: JsonStore): string[] {  return Object.values(store.data.days)
    .filter((day) => Object.values(day.entries).some((entry) => entry.solved))
    .map((day) => day.key);
}

function hasWinnerOn(store: JsonStore, key: string): boolean {
  const day = store.data.days[key];
  return Boolean(day && Object.values(day.entries).some((entry) => entry.solved));
}

/**
 * Posts a manual award where the server can see it: the configured notice
 * channel, or the channel the command came from. The award is already saved,
 * so a failed post is logged rather than turned into a failed command.
 */
async function announceAward(
  deps: CommandDeps,
  ctx: CommandContext,
  userId: string,
  delta: number,
  total: number,
): Promise<void> {
  const channelId = deps.noticeChannelId() ?? ctx.channelId;
  if (!channelId) {
    deps.logger.warn(`Award for <@${userId}> was not announced: no notice channel available.`);
    return;
  }

  const sign = delta > 0 ? "+" : "";
  try {
    await deps.notifier.send(
      channelId,
      "**Wordle points adjusted**\n" +
        `${mention(ctx.userId)} adjusted ${mention(userId)} by ` +
        `**${sign}${formatPoints(delta)} points**; their total is now **${formatPoints(total)} points**.`,
    );
  } catch (error) {
    deps.logger.warn(`Could not announce the award for <@${userId}>`, error);
  }
}

/**
 * Single entry point for slash commands. Returns the reply rather than sending
 * it, which keeps every command testable without a Discord connection.
 */
export async function runCommand(name: string, ctx: CommandContext, deps: CommandDeps): Promise<CommandReply> {
  switch (name) {
    case "wordle-leaderboard":
      return visible(allTimeBoard(deps.store));

    case "wordle-award": {
      if (!ctx.isAdmin) return ephemeral("You need **Manage Server** to adjust points.");

      const target = ctx.options.getUser("user");
      const rawPoints = ctx.options.getNumber("points");
      if (!target) return ephemeral("Choose a member to award.");
      if (rawPoints === null || !Number.isFinite(rawPoints) || rawPoints === 0) {
        return ephemeral("Give a non-zero number of points (halves are fine, e.g. `2.5`).");
      }

      const delta = roundToHalf(rawPoints);
      const player = deps.store.player(target.id, target.name);
      // Totals may be zero or negative; the role always follows the total.
      player.total = roundToHalf(player.total + delta);

      const applied = await deps.display.applyPoints(target.id, player.total, player.roleId ?? null);
      const note = applied.ok
        ? applied.changed
          ? ` Role is now \`${applied.roleName}\`.`
          : ""
        : ` (role not updated: ${applied.reason})`;
      if (applied.ok) player.roleId = applied.roleId;

      await deps.store.save();
      await announceAward(deps, ctx, target.id, delta, player.total);

      const sign = delta > 0 ? "+" : "";
      return ephemeral(
        `Awarded ${mention(target.id)} ${sign}${formatPoints(delta)} points → **${formatPoints(player.total)} total**.${note}`,
      );
    }

    case "wordle-streak": {
      const config = deps.store.config;
      const today = dayKey(ctx.now, config.timeZone);
      const raw = ctx.options.getNumber("count");

      if (raw !== null) {
        if (!ctx.isAdmin) return ephemeral("You need **Manage Server** to set the server streak.");
        if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) {
          return ephemeral("Enter a whole number of days (`0` clears the seeded streak).");
        }

        if (raw === 0) {
          config.streakSeed = null;
          await deps.store.save();
          return ephemeral("Seeded streak cleared; the streak now counts recorded days only.");
        }

        // A number that already includes today's win is anchored to today;
        // otherwise it covers everything through yesterday.
        const seedDay = hasWinnerOn(deps.store, today) ? today : previousDayKey(today);
        config.streakSeed = { day: seedDay, count: raw };
        await deps.store.save();

        return ephemeral(
          `Server streak set to **${raw} ${raw === 1 ? "day" : "days"}** through ` +
            `${formatDayLabel(seedDay, config.timeZone)}.`,
        );
      }

      const streak = computeStreak({ wonDays: wonDays(deps.store), today, seed: config.streakSeed });
      const seedNote = config.streakSeed
        ? `\n_Includes a seeded ${config.streakSeed.count}-day run through ${config.streakSeed.day}._`
        : "";

      return ephemeral(`🔥 **${streak.current} day server streak** · best **${streak.best}**${seedNote}`);
    }

    case "wordle-close": {
      if (!deps.debug) return ephemeral(DEBUG_OFF);
      if (!ctx.isAdmin) return ephemeral("You need **Manage Server** to close a day.");

      const timeZone = deps.store.config.timeZone;
      const key = dayKey(ctx.now, timeZone);
      const day = deps.store.data.days[key];
      if (!day || Object.keys(day.entries).length === 0) {
        return ephemeral(`No results recorded for ${key} yet, so there is nothing to close.`);
      }
      if (day.finalized) {
        return ephemeral(`**${key}** is already closed. The next day starts at midnight, ${timeZone}.`);
      }

      const report = await deps.daily.finalizeDay(key);
      if (report.skipped) {
        return ephemeral(`**${key}** was closed by another action a moment ago.`);
      }

      const lines =
        report.winners.length > 0
          ? report.winners.map(
              (winner, index) =>
                `${medal(index)} ${mention(winner.userId)} — ${winner.guesses}/6 · **${formatPoints(winner.points)} pts**`,
            )
          : ["No points awarded — nobody solved it."];

      const failureNote =
        report.failures.length > 0
          ? `\n${plural(report.failures.length, "role")} could not be updated (they may outrank me).`
          : "";

      const streak = computeStreak({
        wonDays: wonDays(deps.store),
        today: key,
        seed: deps.store.config.streakSeed,
      });

      return ephemeral(
        [
          `**Closed ${formatDayLabel(key, timeZone)}**`,
          ...lines,
          `Updated ${plural(report.updated.length, "points role")}.${failureNote}`,
          `🔥 ${streak.current} day server streak (best ${streak.best}).`,
          "Later results today will not count. The next day starts at midnight.",
        ].join("\n"),
      );
    }

    case "wordle-reopen": {
      if (!deps.debug) return ephemeral(DEBUG_OFF);
      if (!ctx.isAdmin) return ephemeral("You need **Manage Server** to reopen a day.");

      const timeZone = deps.store.config.timeZone;
      const key = dayKey(ctx.now, timeZone);
      const day = deps.store.data.days[key];
      if (!day?.finalized) {
        return ephemeral(`**${formatDayLabel(key, timeZone)}** is not closed, so there is nothing to reopen.`);
      }

      const report = await deps.daily.reopenDay(key);
      return ephemeral(
        [
          `**Reopened ${formatDayLabel(key, timeZone)}**`,
          `Reverted awarded points for ${plural(report.reverted, "member")}.`,
          "Later results today count again. Close it again with `/wordle-close`.",
        ].join("\n"),
      );
    }

    default:
      return ephemeral(`Unknown command: \`${name}\`.`);
  }
}