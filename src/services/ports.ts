/** Narrow interfaces the bot's logic depends on, so tests never touch Discord. */

/** A member as far as name resolution is concerned. */
export interface MemberSummary {
  userId: string;
  username: string;
  nickname: string | null;
  globalName: string | null;
}

export interface MemberPort {
  /** Every member of the guild, for resolving plain names in a summary. */
  listMembers(): Promise<MemberSummary[]>;
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
}

/** A single button attached to a bot message. */
export interface NotifierButton {
  label: string;
  customId: string;
}

export interface NotifierPort {
  send(channelId: string, content: string, button?: NotifierButton): Promise<void>;
}

export interface SummarySourcePort {
  /** Guild text channels the bot can read. */
  listTextChannelIds(): Promise<string[]>;
  /** The most recent messages in a channel, newest first is fine. */
  fetchRecentMessages(channelId: string, limit: number): Promise<SummaryMessage[]>;
}

export interface SummaryMessage {
  id: string;
  content: string;
  authorIsBot: boolean;
  createdAt: Date;
  channelId: string;
}

export interface Logger {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}
