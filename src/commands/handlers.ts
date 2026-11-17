import { dayKey, formatDayLabel } from "../core/day.js";
import { formatPoints } from "../core/points.js";
import { roundToHalf, scoreDay, type ScoredEntry } from "../core/scoring.js";
import { computeStreak, previousDayKey } from "../core/streak.js";
import type { JsonStore } from "../store.js";
import type { DailyService } from "../services/daily.js";
import type { DisplayService } from "../services/display.js";
import type { SpoilerPort } from "../services/ports.js";

export interface CommandOptions {
  getString(name: string): string | null;
  getBoolean(name: string): boolean | null;
  getNumber(name: string): number | null;
  getUser(name: string): { id: string; name: string } | null;
  getChannel(name: string): { id: string; name: string } | null;
}

export interface CommandContext {
  guildId: string;
  userId: string;
  userName: string;
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
  spoilers: SpoilerPort | null;
  now: () => Date;
}

const ephemeral = (content: string): CommandReply => ({ content, ephemeral: true });
const visible = (content: string): CommandReply => ({ content, ephemeral: false });

function mention(userId: string): string {
  return `<@${userId}>`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function rankOf(entry: ScoredEntry): number {
  return entry.solved ? entry.guesses : 7;
}

/** Days on which at least one member solved the puzzle. */
function wonDays(store: JsonStore): string[] {
  return Object.values(store.data.days)
    .filter((day) => Object.values(day.entries).some((entry) => entry.solved))
    .map((day) => day.key);
}

function hasWinnerOn(store: JsonStore, key: string): boolean {
  const day = store.data.days[key];
  return Boolean(day && Object.values(day.entries).some((entry) => entry.solved));
}

function medal(index: number): string {
  return ["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`;
}

function leaderboardToday(store: JsonStore, now: Date): CommandReply {
  const tz = store.config.timeZone;
  const key = dayKey(now, tz);
  const day = store.data.days[key];

  if (!day || Object.keys(day.entries).length === 0) {
    return visible(
      `**Wordle — ${formatDayLabel(key, tz)}**\nNo shares recorded yet today. Post your Wordle result in any channel to enter.`,
    );
  }

  const entries = Object.values(day.entries);
  const score = scoreDay(entries);
  const sorted = [...entries].sort((a, b) => rankOf(a) - rankOf(b) || a.recordedAt.localeCompare(b.recordedAt));

  const lines = sorted.map((entry, index) => {
    const points = day.finalized ? (day.points[entry.userId] ?? 0) : (score.points[entry.userId] ?? 0);
    const result = entry.solved ? `${entry.guesses}/6` : "X/6";
    const pointsLabel = points > 0 ? ` · **${formatPoints(points)} pts**` : "";
    return `${medal(index)} ${mention(entry.userId)} — ${result}${pointsLabel}`;
  });

  const tieNote =
    score.winners.length > 1
      ? `\n_Tie at ${score.bestGuesses}/6: prize split ${score.winners.length} ways (${formatPoints(score.winners[0]?.points ?? 0)} each)._`
      : "";
  const status = day.finalized ? "Final" : "Provisional — points commit at midnight";

  return visible(`**Wordle — ${formatDayLabel(key, tz)}** _(${status})_\n${lines.join("\n")}${tieNote}`);
}

function leaderboardAllTime(store: JsonStore): CommandReply {
  const players = Object.values(store.data.players)
    .filter((player) => player.total > 0)
    .sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName))
    .slice(0, 15);

  if (players.length === 0) return visible("No points have been awarded yet.");

  const lines = players.map(
    (player, index) => `${medal(index)} ${mention(player.userId)} — **${formatPoints(player.total)} pts**`,
  );
  return visible(`**Wordle all-time**\n${lines.join("\n")}`);
}

/**
 * Single entry point for slash commands. Returns the reply rather than sending
 * it, which keeps every command testable without a Discord connection.
 */
export async function runCommand(name: string, ctx: CommandContext, deps: CommandDeps): Promise<CommandReply> {
  switch (name) {
    case "wordle-setup": {
      if (!ctx.isAdmin) return ephemeral("You need **Manage Server** to configure Wordle.");

      const spoilers = ctx.options.getChannel("spoilers");
      if (!spoilers) {
        return ephemeral("Choose the channel that stays hidden until someone finishes the puzzle.");
      }

      const config = deps.store.config;
      config.guildId = ctx.guildId;
      config.spoilerChannelId = spoilers.id;

      let spoilerNote: string;
      try {
        await deps.spoilers?.lockDown();
        spoilerNote = `${mentionChannel(spoilers.id)} (locked to @everyone; access is granted when a share is recorded)`;
      } catch (error) {
        spoilerNote = `configured, but I could not lock it down (${
          error instanceof Error ? error.message : String(error)
        }). Give me **Manage Roles** on that channel.`;
      }

      await deps.store.save();

      return ephemeral(
        [
          "**Wordle bot configured**",
          "Results: counted in every channel",
          `Spoiler channel: ${spoilerNote}`,
          `Day rolls over at midnight, ${config.timeZone}.`,
          "Members: run `/wordle-register` once, then post your Wordle result anywhere.",
        ].join("\n"),
      );
    }

    case "wordle-status": {
      const config = deps.store.config;
      const key = dayKey(ctx.now, config.timeZone);
      const day = deps.store.data.days[key];
      const count = day ? Object.keys(day.entries).length : 0;
      const registered = Object.values(deps.store.data.players).filter((player) => player.registered).length;
      return ephemeral(
        [
          "**Wordle bot status**",
          "Results: counted in every channel",
          `Spoiler channel: ${config.spoilerChannelId ? mentionChannel(config.spoilerChannelId) : "not set"}`,
          `Time zone: ${config.timeZone}`,
          `Registered players: ${registered}`,
          `Today (${key}): ${plural(count, "share")} recorded`,
        ].join("\n"),
      );
    }

    case "wordle-leaderboard": {
      const scope = ctx.options.getString("scope") ?? "today";
      return scope === "all" ? leaderboardAllTime(deps.store) : leaderboardToday(deps.store, ctx.now);
    }

    case "points": {
      const target = ctx.options.getUser("user");
      const userId = target?.id ?? ctx.userId;
      const player = deps.store.data.players[userId];
      if (!player?.registered) return ephemeral(`${mention(userId)} is not registered yet.`);

      const wins = Object.values(deps.store.data.days).filter((day) => (day.points[userId] ?? 0) > 0).length;
      const key = dayKey(ctx.now, deps.store.config.timeZone);
      const today = deps.store.data.days[key]?.entries[userId];

      const lines = [`${mention(userId)} has **${formatPoints(player.total)} points** · ${plural(wins, "win")}.`];
      if (today) {
        const score = scoreDay(Object.values(deps.store.data.days[key]?.entries ?? {}));
        const points = score.points[userId] ?? 0;
        lines.push(
          `Today: ${today.solved ? `${today.guesses}/6` : "X/6"}` +
            (points > 0 ? ` — provisionally ${formatPoints(points)} pts.` : " — out of the points."),
        );
      }
      return ephemeral(lines.join("\n"));
    }

    case "wordle-register": {
      const existing = deps.store.data.players[ctx.userId];
      if (existing?.registered) {
        return ephemeral(
          `You are already registered with **${formatPoints(existing.total)} points**. ` +
            "Ask an admin to use `/wordle-award` if that is wrong.",
        );
      }

      const raw = ctx.options.getNumber("points");
      if (raw === null || !Number.isFinite(raw)) {
        return ephemeral("Enter your current point total — use `0` if you are starting fresh.");
      }

      const total = roundToHalf(raw);
      const player = deps.store.player(ctx.userId, ctx.userName);
      player.total = total;
      player.registered = true;

      // Every registered member has a role, including at exactly 0.
      const applied = await deps.display.applyPoints(ctx.userId, total, player.roleId ?? null);
      const note = applied.ok
        ? ` Your role is \`${applied.roleName}\`.`
        : ` (role not created: ${applied.reason})`;
      if (applied.ok) player.roleId = applied.roleId;

      await deps.store.save();

      return ephemeral(
        [
          `**Registered** with **${formatPoints(total)} points**.${note}`,
          "Remove any points text from your nickname yourself — I never edit names.",
          "Your shares now count toward the daily prize.",
        ].join("\n"),
      );
    }

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
      // An admin awarding points implicitly vouches for the member.
      player.registered = true;
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
      if (!ctx.isAdmin) return ephemeral("You need **Manage Server** to close a day.");

      const timeZone = deps.store.config.timeZone;
      const key = dayKey(ctx.now, timeZone);
      const day = deps.store.data.days[key];
      if (!day || Object.keys(day.entries).length === 0) {
        return ephemeral(`No shares recorded for ${key} yet, so there is nothing to close.`);
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
          "Later shares today will not count. The next day starts at midnight.",
        ].join("\n"),
      );
    }

    case "wordle-reopen": {
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
          "Later shares today count again. Close it again with `/wordle-close`.",
        ].join("\n"),
      );
    }

    case "wordle-unregister": {
      const target = ctx.options.getUser("user");
      const userId = target?.id ?? ctx.userId;
      if (userId !== ctx.userId && !ctx.isAdmin) {
        return ephemeral("You need **Manage Server** to unregister someone else.");
      }

      const player = deps.store.data.players[userId];
      if (!player?.registered) return ephemeral(`${mention(userId)} is not registered.`);

      player.registered = false;
      if (player.roleId) {
        await deps.display.removePoints(player.roleId);
        player.roleId = null;
      }
      await deps.store.save();

      return ephemeral(
        `Unregistered ${mention(userId)} and removed their points role. ` +
          `Their total (${formatPoints(player.total)}) is kept in case they rejoin.`,
      );
    }

    case "wordle-resync": {
      if (!ctx.isAdmin) return ephemeral("You need **Manage Server** to resync points roles.");

      const report = await deps.daily.resync();
      const parts = [`Updated ${plural(report.updated.length, "points role")}.`];
      if (report.failures.length > 0) {
        parts.push(`${plural(report.failures.length, "member")} could not be updated (they may outrank me).`);
      }
      return ephemeral(parts.join(" "));
    }

    default:
      return ephemeral(`Unknown command: \`${name}\`.`);
  }
}

function mentionChannel(channelId: string): string {
  return `<#${channelId}>`;
}
