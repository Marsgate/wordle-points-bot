import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type Client,
  type Guild,
  type MessageCreateOptions,
  type Role,
} from "discord.js";
import type { Logger, MemberPort, MemberSummary, NotifierPort, SummaryMessage, SummarySourcePort } from "../services/ports.js";

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
}

export class DiscordNotifierPort implements NotifierPort {
  constructor(private readonly client: Client) {}

  async send(channelId: string, content: string, button?: { label: string; customId: string }): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
      throw new Error(`channel ${channelId} is not a guild text channel`);
    }

    const payload: MessageCreateOptions = { content, allowedMentions: { parse: [] } };
    if (button) {
      payload.components = [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(button.customId).setLabel(button.label).setStyle(ButtonStyle.Primary),
        ),
      ];
    }

    await channel.send(payload);
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
