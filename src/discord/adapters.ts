import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type NewsChannel,
  type Role,
  type TextChannel,
} from "discord.js";
import type {
  Logger,
  MemberPort,
  MemberSummary,
  SpoilerPort,
  SummaryMessage,
  SummarySourcePort,
} from "../services/ports.js";

/**
 * The member-facing surface: a personal points role per player, plus read/write
 * access to nicknames (only used to clean up suffixes from the old design).
 */
export class DiscordMemberPort implements MemberPort {
  constructor(
    private readonly client: Client,
    private readonly guildId: () => string | null,
    private readonly logger: Logger,
  ) {}

  private async requireGuild(): Promise<Guild> {
    const id = this.guildId();
    if (!id) throw new Error("no guild configured");
    const cached = this.client.guilds.cache.get(id);
    if (cached) return cached;
    return this.client.guilds.fetch(id);
  }

  async readNickname(userId: string): Promise<string | null> {
    const member = await (await this.requireGuild()).members.fetch(userId);
    return member.nickname;
  }

  async listMembers(): Promise<MemberSummary[]> {
    const guild = await this.requireGuild();
    const found: MemberSummary[] = [];
    let after: string | undefined;

    // REST listing, not gateway member-request (op 8), which rate limits hard.
    for (let page = 0; page < 5; page += 1) {
      const members = await guild.members.list({ limit: 1000, ...(after ? { after } : {}) });
      for (const member of members.values()) {
        found.push({
          userId: member.id,
          username: member.user.username,
          nickname: member.nickname,
          globalName: member.user.globalName ?? null,
        });
      }
      if (members.size < 1000) break;
      after = members.lastKey();
    }

    return found;
  }

  async syncRole(
    userId: string,
    roleName: string,
    color: number,
    existingRoleId: string | null,
  ): Promise<{ roleId: string; changed: boolean }> {
    const guild = await this.requireGuild();
    const member = await guild.members.fetch(userId);

    let role: Role | null = null;
    if (existingRoleId) {
      role = guild.roles.cache.get(existingRoleId) ?? null;
      if (!role) {
        role = await guild.roles.fetch(existingRoleId).catch(() => null);
      }
    }

    if (!role) {
      const created = await guild.roles.create({
        name: roleName,
        colors: { primaryColor: color },
        permissions: [],
        hoist: false,
        mentionable: false,
        reason: "Wordle points",
      });
      await member.roles.add(created, "Wordle points");
      this.logger.info(`Created points role "${roleName}" for ${member.user.tag}`);
      return { roleId: created.id, changed: true };
    }

    let changed = false;
    if (role.name !== roleName) {
      await role.setName(roleName, "Wordle points updated");
      changed = true;
    }
    if (role.color !== color) {
      await role.setColors({ primaryColor: color }, "Wordle points updated");
      changed = true;
    }
    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role, "Wordle points");
      changed = true;
    }

    return { roleId: role.id, changed };
  }

  async deleteRole(roleId: string): Promise<boolean> {
    const guild = await this.requireGuild();
    const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) return false;
    await role.delete("Wordle points removed");
    return true;
  }
}

/** Per-member overwrites on the spoiler channel: the only access control Discord gives us. */
export class DiscordSpoilerPort implements SpoilerPort {
  constructor(
    private readonly client: Client,
    private readonly channelId: () => string | null,
    private readonly logger: Logger,
  ) {}

  private async requireChannel(): Promise<TextChannel | NewsChannel> {
    const id = this.channelId();
    if (!id) throw new Error("no spoiler channel configured");

    const channel = await this.client.channels.fetch(id);
    if (!channel) throw new Error(`channel ${id} does not exist`);
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      throw new Error(`channel ${id} is not a guild text channel`);
    }
    return channel;
  }

  async grant(userId: string): Promise<void> {
    const channel = await this.requireChannel();

    // Owners, admins and members whose roles already allow View Channel need no
    // overwrite — and Discord refuses to edit overwrites for members above the
    // bot anyway, so skipping avoids a pointless 50001.
    const member = await channel.guild.members.fetch(userId).catch(() => null);
    if (member && channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) {
      return;
    }

    // The explicit type matters: without it discord.js resolves the id to a
    // cached User and throws for members who are not in the cache.
    await channel.permissionOverwrites.edit(
      userId,
      { ViewChannel: true },
      { type: OverwriteType.Member, reason: "Completed today's Wordle" },
    );
  }

  async revokeAll(): Promise<number> {
    const channel = await this.requireChannel();
    const memberOverwrites = channel.permissionOverwrites.cache.filter(
      (overwrite) => overwrite.type === OverwriteType.Member,
    );

    let removed = 0;
    for (const overwrite of memberOverwrites.values()) {
      await channel.permissionOverwrites.delete(overwrite.id, "New Wordle day");
      removed += 1;
    }
    this.logger.info(`Removed ${removed} member overwrite(s) from spoiler channel ${channel.id}`);
    return removed;
  }

  async lockDown(): Promise<void> {
    const channel = await this.requireChannel();
    await channel.permissionOverwrites.edit(
      channel.guild.roles.everyone,
      { ViewChannel: false },
      { reason: "Wordle spoiler channel: locked until you finish the day's puzzle" },
    );
  }
}

/** Reads the Activity's summary messages, live or by scanning history. */
export class DiscordSummarySource implements SummarySourcePort {
  constructor(
    private readonly client: Client,
    private readonly guildId: () => string | null,
  ) {}

  private async requireGuild(): Promise<Guild> {
    const id = this.guildId();
    if (!id) throw new Error("no guild configured");
    const cached = this.client.guilds.cache.get(id);
    if (cached) return cached;
    return this.client.guilds.fetch(id);
  }

  async listTextChannelIds(): Promise<string[]> {
    const guild = await this.requireGuild();
    return guild.channels.cache
      .filter(
        (channel) =>
          (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) &&
          channel.viewable,
      )
      .map((channel) => channel.id);
  }

  async fetchRecentMessages(channelId: string, limit: number): Promise<SummaryMessage[]> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
      return [];
    }

    const messages = await channel.messages.fetch({ limit });
    return [...messages.values()].map((message) => ({
      id: message.id,
      content: message.content,
      authorIsBot: message.author.bot,
      createdAt: message.createdAt,
      channelId,
    }));
  }
}
