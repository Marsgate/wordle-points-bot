import { formatPoints } from "../core/points.js";
import { roundToHalf } from "../core/scoring.js";
import type { JsonStore } from "../store.js";
import type { DisplayService } from "./display.js";

export interface RegistrationDeps {
  store: JsonStore;
  display: DisplayService;
}

export interface RegistrationInput {
  userId: string;
  userName: string;
  /** Null when the input was not a number. */
  points: number | null;
}

/**
 * Registers a member with their starting total. Shared by the slash command and
 * the Register button's modal so both behave identically.
 */
export async function registerMember(deps: RegistrationDeps, input: RegistrationInput): Promise<string> {
  const existing = deps.store.data.players[input.userId];
  if (existing?.registered) {
    return (
      `You are already registered with **${formatPoints(existing.total)} points**. ` +
      "Ask an admin to use `/wordle-award` if that is wrong."
    );
  }

  if (input.points === null || !Number.isFinite(input.points)) {
    return "Enter your current point total — use `0` if you are starting fresh.";
  }

  const total = roundToHalf(input.points);
  const player = deps.store.player(input.userId, input.userName);
  player.total = total;
  player.registered = true;

  const applied = await deps.display.applyPoints(input.userId, total, player.roleId ?? null);
  if (applied.ok) player.roleId = applied.roleId;
  const note = applied.ok
    ? ` Your role is \`${applied.roleName}\`.`
    : ` (role not created: ${applied.reason})`;

  await deps.store.save();

  return [
    `**Registered** with **${formatPoints(total)} points**.${note}`,
    "Remove any points text from your nickname yourself — I never edit names.",
    "Your results now count toward the daily prize.",
  ].join("\n");
}
