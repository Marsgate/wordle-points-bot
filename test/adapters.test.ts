import { ChannelType, Collection, OverwriteType, type Client } from "discord.js";
import { describe, expect, it } from "vitest";
import { DiscordMemberPort, DiscordSpoilerPort } from "../src/discord/adapters.js";
import { silentLogger } from "./helpers.js";

interface Overwrite {
  id: string;
  type: number;
}

function fakeSpoilerChannel(channelType: number = ChannelType.GuildText, canSee = false) {
  const overwrites = new Collection<string, Overwrite>();
  overwrites.set("user-1", { id: "user-1", type: OverwriteType.Member });
  overwrites.set("user-2", { id: "user-2", type: OverwriteType.Member });
  overwrites.set("role-1", { id: "role-1", type: OverwriteType.Role });

  const edits: Array<{
    target: unknown;
    options: Record<string, boolean>;
    reason?: string;
    type?: number;
  }> = [];
  const deletes: string[] = [];

  const channel = {
    id: "chan-spoilers",
    type: channelType,
    guild: {
      roles: { everyone: { id: "role-everyone" } },
      members: { fetch: async (id: string) => ({ id }) },
    },
    permissionsFor: () => ({ has: () => canSee }),
    permissionOverwrites: {
      cache: overwrites,
      edit: async (
        target: unknown,
        options: Record<string, boolean>,
        editOptions?: { reason?: string; type?: number },
      ) => {
        edits.push({ target, options, reason: editOptions?.reason, type: editOptions?.type });
      },
      delete: async (id: string) => {
        deletes.push(id);
      },
    },
  };

  return { channel, edits, deletes };
}

function clientWithChannels(channel: unknown): Client {
  return { channels: { fetch: async () => channel } } as unknown as Client;
}

describe("DiscordSpoilerPort", () => {
  it("grants view access with a per-member overwrite", async () => {
    const { channel, edits } = fakeSpoilerChannel();
    const port = new DiscordSpoilerPort(clientWithChannels(channel), () => "chan-spoilers", silentLogger);

    await port.grant("user-7");

    expect(edits).toHaveLength(1);
    expect(edits[0]?.target).toBe("user-7");
    expect(edits[0]?.options).toEqual({ ViewChannel: true });
    // discord.js needs the explicit type, or it throws for uncached members.
    expect(edits[0]?.type).toBe(OverwriteType.Member);
  });

  it("skips the overwrite when the member can already see the channel", async () => {
    const { channel, edits } = fakeSpoilerChannel(ChannelType.GuildText, true);
    const port = new DiscordSpoilerPort(clientWithChannels(channel), () => "chan-spoilers", silentLogger);

    await port.grant("user-7");

    // Owners and admins already see it; Discord refuses to edit their overwrite.
    expect(edits).toHaveLength(0);
  });

  it("removes only member overwrites, never role overwrites", async () => {
    const { channel, deletes } = fakeSpoilerChannel();
    const port = new DiscordSpoilerPort(clientWithChannels(channel), () => "chan-spoilers", silentLogger);

    const removed = await port.revokeAll();

    expect(removed).toBe(2);
    expect(deletes.sort()).toEqual(["user-1", "user-2"]);
  });

  it("locks the channel for @everyone", async () => {
    const { channel, edits } = fakeSpoilerChannel();
    const port = new DiscordSpoilerPort(clientWithChannels(channel), () => "chan-spoilers", silentLogger);

    await port.lockDown();

    expect(edits[0]?.target).toEqual({ id: "role-everyone" });
    expect(edits[0]?.options).toEqual({ ViewChannel: false });
  });

  it("refuses a channel type Discord cannot overwrite", async () => {
    const { channel } = fakeSpoilerChannel(ChannelType.GuildVoice);
    const port = new DiscordSpoilerPort(clientWithChannels(channel), () => "chan-spoilers", silentLogger);

    await expect(port.grant("user-7")).rejects.toThrow(/not a guild text channel/u);
  });

  it("fails clearly when no channel is configured", async () => {
    const port = new DiscordSpoilerPort(clientWithChannels(null), () => null, silentLogger);
    await expect(port.grant("user-7")).rejects.toThrow(/no spoiler channel configured/u);
  });
});

interface FakeRole {
  id: string;
  name: string;
  color: number;
  setName(name: string): Promise<void>;
  setColors(colors: { primaryColor: number }, reason?: string): Promise<void>;
  delete(reason?: string): Promise<void>;
}

function fakeGuild() {
  const writtenNicknames: string[] = [];
  const addedRoles: string[] = [];
  const createdOptions: Array<{ name: string; colors?: { primaryColor?: number }; permissions?: unknown }> = [];
  const roles = new Collection<string, FakeRole>();
  let sequence = 0;

  const member = {
    nickname: "Ada ✦" as string | null,
    user: { tag: "ada#0001" },
    roles: {
      cache: new Collection<string, FakeRole>(),
      add: async (role: FakeRole) => {
        member.roles.cache.set(role.id, role);
        addedRoles.push(role.name);
      },
    },
    setNickname: async (nickname: string) => {
      member.nickname = nickname;
      writtenNicknames.push(nickname);
    },
  };

  const guild = {
    members: { fetch: async () => member },
    roles: {
      cache: roles,
      create: async (options: { name: string; colors?: { primaryColor?: number }; permissions?: unknown }) => {
        sequence += 1;
        const role = {
          id: `role-${sequence}`,
          name: options.name,
          color: options.colors?.primaryColor ?? 0,
          setName: async (name: string) => {
            role.name = name;
          },
          setColors: async (colors: { primaryColor: number }) => {
            role.color = colors.primaryColor;
          },
          delete: async () => {
            roles.delete(role.id);
          },
        } as FakeRole;
        roles.set(role.id, role);
        createdOptions.push(options);
        return role;
      },
      fetch: async (id: string) => roles.get(id) ?? null,
    },
  };

  const client = {
    guilds: { cache: new Collection([["guild-1", guild]]), fetch: async () => guild },
  } as unknown as Client;

  return { client, member, roles, writtenNicknames, addedRoles, createdOptions };
}

describe("DiscordMemberPort", () => {
  it("reads nicknames for role naming", async () => {
    const { client } = fakeGuild();
    const port = new DiscordMemberPort(client, () => "guild-1", silentLogger);

    expect(await port.readNickname("user-1")).toBe("Ada ✦");
  });

  it("creates a permissionless personal role and assigns it", async () => {
    const { client, addedRoles, createdOptions } = fakeGuild();
    const port = new DiscordMemberPort(client, () => "guild-1", silentLogger);

    const result = await port.syncRole("user-1", "Ada ✦ · 3.5 pts", 0x57f287, null);

    expect(result.changed).toBe(true);
    expect(result.roleId).toBe("role-1");
    expect(createdOptions[0]?.name).toBe("Ada ✦ · 3.5 pts");
    expect(createdOptions[0]?.colors?.primaryColor).toBe(0x57f287);
    expect(createdOptions[0]?.permissions).toEqual([]);
    expect(addedRoles).toEqual(["Ada ✦ · 3.5 pts"]);
  });

  it("renames the existing role instead of creating another", async () => {
    const { client, roles, createdOptions } = fakeGuild();
    const port = new DiscordMemberPort(client, () => "guild-1", silentLogger);

    const first = await port.syncRole("user-1", "Ada ✦ · 3.5 pts", 0x99aab5, null);
    const second = await port.syncRole("user-1", "Ada ✦ · 13.5 pts", 0x57f287, first.roleId);

    expect(second.roleId).toBe(first.roleId);
    expect(second.changed).toBe(true);
    expect(createdOptions).toHaveLength(1);
    expect(roles.get(first.roleId)?.name).toBe("Ada ✦ · 13.5 pts");
    expect(roles.get(first.roleId)?.color).toBe(0x57f287);
  });

  it("reports no change when the role already matches", async () => {
    const { client } = fakeGuild();
    const port = new DiscordMemberPort(client, () => "guild-1", silentLogger);

    const first = await port.syncRole("user-1", "Ada ✦ · 3.5 pts", 0x99aab5, null);
    const second = await port.syncRole("user-1", "Ada ✦ · 3.5 pts", 0x99aab5, first.roleId);

    expect(second.changed).toBe(false);
  });

  it("re-assigns a role the member lost", async () => {
    const { client, member, addedRoles } = fakeGuild();
    const port = new DiscordMemberPort(client, () => "guild-1", silentLogger);

    const { roleId } = await port.syncRole("user-1", "Ada ✦ · 3.5 pts", 0x99aab5, null);
    member.roles.cache.delete(roleId);
    addedRoles.length = 0;

    const again = await port.syncRole("user-1", "Ada ✦ · 3.5 pts", 0x99aab5, roleId);

    expect(again.changed).toBe(true);
    expect(addedRoles).toEqual(["Ada ✦ · 3.5 pts"]);
  });

  it("deletes a role and tolerates one that is already gone", async () => {
    const { client, roles } = fakeGuild();
    const port = new DiscordMemberPort(client, () => "guild-1", silentLogger);

    const { roleId } = await port.syncRole("user-1", "Ada ✦ · 3.5 pts", 0x99aab5, null);
    expect(await port.deleteRole(roleId)).toBe(true);
    expect(roles.size).toBe(0);
    expect(await port.deleteRole(roleId)).toBe(false);
  });
});
