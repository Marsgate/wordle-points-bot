import { formatPoints } from "../core/points.js";
import type { JsonStore } from "../store.js";

/**
 * The text of the all-time points board. A plain string, so the slash command
 * and the copy posted under the Activity's score share one renderer.
 */

function mention(userId: string): string {
  return `<@${userId}>`;
}

export function medal(index: number): string {
  return ["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`;
}

export function allTimeBoard(store: JsonStore): string {
  const players = Object.values(store.data.players)
    .sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName))
    .slice(0, 15);

  if (players.length === 0) return "No players yet. The board fills in when the Activity posts a summary.";

  const lines = players.map(
    (player, index) => `${medal(index)} ${mention(player.userId)} — **${formatPoints(player.total)} pts**`,
  );
  return `**Wordle all-time points**\n${lines.join("\n")}`;
}
