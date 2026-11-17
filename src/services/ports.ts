/** Narrow interfaces the bot's logic depends on, so tests never touch Discord. */

export interface MemberPort {
  /** Current guild nickname, or null when the member has none. */
  readNickname(userId: string): Promise<string | null>;
  /**
   * Create or update a member's personal points role and make sure they hold it.
   * Idempotent: passing the existing role id must not create a second role.
   */
  syncRole(
    userId: string,
    roleName: string,
    color: number,
    existingRoleId: string | null,
  ): Promise<{ roleId: string; changed: boolean }>;
  /** Delete a points role. Returns false when it was already gone. */
  deleteRole(roleId: string): Promise<boolean>;
}

export interface SpoilerPort {
  /** Give one member access to the spoiler channel. Must be idempotent. */
  grant(userId: string): Promise<void>;
  /** Remove every member overwrite the bot manages. Returns how many were removed. */
  revokeAll(): Promise<number>;
  /** Deny @everyone by default, leaving the channel locked for everyone else. */
  lockDown(): Promise<void>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}
