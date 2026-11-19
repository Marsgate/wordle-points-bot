import type { JsonStore } from "../store.js";
import type { DisplayService } from "./display.js";
import type { Logger } from "./ports.js";

export interface RegistrationDeps {
  store: JsonStore;
  display: DisplayService;
}

/**
 * Joins a player the first time the Activity reports them: 0 points, their own
 * role, and a full share of the split. Registration is not a step anybody has to
 * take, so a result is never dropped for want of a sign-up.
 */
export async function registerOnPlay(
  deps: RegistrationDeps & { logger: Logger },
  input: { userId: string; displayName?: string },
): Promise<void> {
  if (deps.store.data.players[input.userId]) return;

  const player = deps.store.player(input.userId, input.displayName ?? "");
  player.total = 0;

  const applied = await deps.display.applyPoints(input.userId, 0, null);
  if (applied.ok) {
    player.roleId = applied.roleId;
    deps.logger.info(`Auto-registered <@${input.userId}> at 0 points.`);
  } else {
    deps.logger.warn(
      `Auto-registered <@${input.userId}> at 0 points, but no role: ${applied.reason}`,
    );
  }
}
