import { Collection, type Client } from "discord.js";
import { describe, expect, it } from "vitest";
import { DiscordMemberPort } from "../src/discord/adapters.js";
import { silentLogger } from "./helpers.js";

interface FakeRole {
  id: string;
  name: string;
  color: number;
  setName(name: string): Promise<void>;
  setColors(colors: { primaryColor: number }, reason?: string): Promise<void>;
  delete(reason?: string): Promise<void>;
}

function fakeGuild() {
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

  return { client, member, roles, addedRoles, createdOptions };
}

describe("DiscordMemberPort", () => {
  it("creates a permissionless personal role and assigns it", async () => {
    const { client, addedRoles, createdOptions } = fakeGuild();
    const port = new DiscordMemberPort(client, () => "guild-1", silentLogger);

    const result = await port.syncRole("user-1", "3.5 points", 0x57f287, null);

    expect(result.changed).toBe(true);
    expect(result.roleId).toBe("role-1");
    expect(createdOptions[0]?.name).toBe("3.5 points");
    expect(createdOptions[0]?.colors?.primaryColor).toBe(0x57f287);
    expect(createdOptions[0]?.permissions).toEqual([]);
    expect(addedRoles).toEqual(["3.5 points"]);
  });

  it("renames the existing role instead of creating another", async () => {
    const { client, roles, createdOptions } = fakeGuild();
    const port = new DiscordMemberPort(client, () => "guild-1", silentLogger);

    const first = await port.syncRole("user-1", "3.5 points", 0x99aab5, null);
    const second = await port.syncRole("user-1", "13.5 points", 0x57f287, first.roleId);

    expect(second.roleId).toBe(first.roleId);
    expect(second.changed).toBe(true);
    expect(createdOptions).toHaveLength(1);
    expect(roles.get(first.roleId)?.name).toBe("13.5 points");
    expect(roles.get(first.roleId)?.color).toBe(0x57f287);
  });

  it("reports no change when the role already matches", async () => {
    const { client } = fakeGuild();
    const port = new DiscordMemberPort(client, () => "guild-1", silentLogger);

    const first = await port.syncRole("user-1", "3.5 points", 0x99aab5, null);
    const second = await port.syncRole("user-1", "3.5 points", 0x99aab5, first.roleId);

    expect(second.changed).toBe(false);
  });

  it("re-assigns a role the member lost", async () => {
    const { client, member, addedRoles } = fakeGuild();
    const port = new DiscordMemberPort(client, () => "guild-1", silentLogger);

    const { roleId } = await port.syncRole("user-1", "3.5 points", 0x99aab5, null);
    member.roles.cache.delete(roleId);
    addedRoles.length = 0;

    const again = await port.syncRole("user-1", "3.5 points", 0x99aab5, roleId);

    expect(again.changed).toBe(true);
    expect(addedRoles).toEqual(["3.5 points"]);
  });

  it("deletes a role and tolerates one that is already gone", async () => {
    const { client, roles } = fakeGuild();
    const port = new DiscordMemberPort(client, () => "guild-1", silentLogger);

    const { roleId } = await port.syncRole("user-1", "3.5 points", 0x99aab5, null);
    expect(await port.deleteRole(roleId)).toBe(true);
    expect(roles.size).toBe(0);
    expect(await port.deleteRole(roleId)).toBe(false);
  });
});
