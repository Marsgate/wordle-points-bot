import { roleColorFor, roleNameFor } from "../core/points.js";
import type { Logger, MemberPort } from "./ports.js";

export type ApplyResult =
  | { ok: true; roleId: string; roleName: string; changed: boolean }
  | { ok: false; reason: string };

/**
 * How points appear to members: a personal role named after them plus their
 * total ("𝓐𝓭𝓪 ✦ · 13.5 pts"). Nicknames are only read, never written.
 */
export class DisplayService {
  constructor(
    private readonly deps: {
      port: MemberPort;
      logger: Logger;
    },
  ) {}

  async applyPoints(
    userId: string,
    total: number,
    fallbackName: string,
    existingRoleId: string | null,
  ): Promise<ApplyResult> {
    try {
      const current = await this.deps.port.readNickname(userId);
      const roleName = roleNameFor(current ?? fallbackName, total);
      const { roleId, changed } = await this.deps.port.syncRole(
        userId,
        roleName,
        roleColorFor(total),
        existingRoleId,
      );

      if (changed) {
        this.deps.logger.info(`Synced points role "${roleName}" for <@${userId}>`);
      }
      return { ok: true, roleId, roleName, changed };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Expected when the member outranks the bot or left the server.
      this.deps.logger.warn(`Could not sync the points role for <@${userId}>: ${reason}`);
      return { ok: false, reason };
    }
  }

  /** Used when a member drops to zero, e.g. after a negative award. */
  async removePoints(roleId: string): Promise<boolean> {
    try {
      const removed = await this.deps.port.deleteRole(roleId);
      if (removed) this.deps.logger.info(`Deleted points role ${roleId}`);
      return removed;
    } catch (error) {
      this.deps.logger.warn(`Could not delete points role ${roleId}`, error);
      return false;
    }
  }
}
