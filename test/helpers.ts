import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/store.js";
import type {
  Logger,
  MemberPort,
  SpoilerPort,
  SummaryMessage,
  SummarySourcePort,
} from "../src/services/ports.js";
import type { IncomingMessage } from "../src/services/results.js";
import { DailyService } from "../src/services/daily.js";
import { DisplayService } from "../src/services/display.js";
import { ResultsService } from "../src/services/results.js";
import { SummaryService } from "../src/services/summary.js";
import type { CommandContext, CommandOptions } from "../src/commands/handlers.js";

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export const GUILD = "guild-1";
export const WORDLE_CHANNEL = "chan-wordle";
export const SPOILER_CHANNEL = "chan-spoilers";
export const OTHER_CHANNEL = "chan-general";
export const TZ = "America/Indianapolis";

export function fakeMemberPort(initialNicknames: Record<string, string> = {}) {
  const nicknames = new Map<string, string>(Object.entries(initialNicknames));
  const roles = new Map<string, { name: string; color: number; members: Set<string> }>();
  const calls = { created: 0, renamed: 0, assigned: 0, deleted: 0 };
  let sequence = 0;

  const port: MemberPort = {
    listMembers: async () =>
      [...nicknames.entries()].map(([userId, nickname]) => ({
        userId,
        username: userId,
        nickname,
        globalName: null,
      })),
    syncRole: async (userId, roleName, color, existingRoleId) => {
      let roleId = existingRoleId;
      let role = roleId ? roles.get(roleId) : undefined;
      let changed = false;

      if (!role) {
        sequence += 1;
        roleId = `role-${sequence}`;
        role = { name: roleName, color, members: new Set() };
        roles.set(roleId, role);
        calls.created += 1;
        changed = true;
      } else {
        if (role.name !== roleName) {
          role.name = roleName;
          calls.renamed += 1;
          changed = true;
        }
        if (role.color !== color) {
          role.color = color;
          changed = true;
        }
      }

      if (!role.members.has(userId)) {
        role.members.add(userId);
        if (!changed) calls.assigned += 1;
        changed = true;
      }

      return { roleId: roleId as string, changed };
    },
    deleteRole: async (roleId) => {
      const existed = roles.delete(roleId);
      if (existed) calls.deleted += 1;
      return existed;
    },
  };

  return { port, nicknames, roles, calls };
}

export function fakeSpoilers() {
  const members = new Set<string>();
  const calls = { grants: [] as string[], revokes: 0, lockdowns: 0 };
  const port: SpoilerPort = {
    grant: async (userId) => {
      members.add(userId);
      calls.grants.push(userId);
    },
    revokeAll: async () => {
      calls.revokes += 1;
      const count = members.size;
      members.clear();
      return count;
    },
    lockDown: async () => {
      calls.lockdowns += 1;
    },
  };
  return { port, members, calls };
}

export function fakeSummarySource() {
  const messagesByChannel = new Map<string, SummaryMessage[]>();
  const port: SummarySourcePort = {
    listTextChannelIds: async () => [...messagesByChannel.keys()],
    fetchRecentMessages: async (channelId) => messagesByChannel.get(channelId) ?? [],
  };
  return { port, messagesByChannel };
}

/** Builds a valid share text for a given guess count. */export function shareFor(guesses: number, solved = true, puzzle = 1512): string {
  const rows = Array.from({ length: guesses }, (_, index) =>
    solved && index === guesses - 1 ? "🟩🟩🟩🟩🟩" : "⬛⬛⬛⬛⬛",
  );
  const header = `Wordle ${puzzle.toLocaleString("en-US")} ${solved ? guesses : "X"}/6`;
  return [header, "", ...rows].join("\n");
}

export function incomingMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: "msg-1",
    guildId: GUILD,
    channelId: WORDLE_CHANNEL,
    authorId: "user-1",
    authorName: "tester",
    authorIsBot: false,
    content: shareFor(3),
    createdAt: new Date("2026-11-16T14:00:00Z"),
    ...overrides,
  };
}

export interface Harness {
  dir: string;
  store: JsonStore;
  members: ReturnType<typeof fakeMemberPort>;
  spoilers: ReturnType<typeof fakeSpoilers>;
  display: DisplayService;
  daily: DailyService;
  results: ResultsService;
  summary: SummaryService;
  summarySource: ReturnType<typeof fakeSummarySource>;
  cleanup: () => Promise<void>;
}

/**
 * Builds the real services against a temp-file store and fake Discord ports.
 * Nothing here touches the network, a token, or a gateway.
 */
export async function harness(
  options: {
    nicknames?: Record<string, string>;
    timeZone?: string;
    now?: () => Date;
    configure?: boolean;
    withSpoilers?: boolean;
    /** Members pre-registered at 0 points. Defaults to the usual author. */
    registered?: string[];
  } = {},
): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "wordle-test-"));
  const store = await JsonStore.open(join(dir, "store.json"), options.timeZone ?? TZ);

  if (options.configure !== false) {
    store.config.guildId = GUILD;
    store.config.spoilerChannelId = options.withSpoilers === false ? null : SPOILER_CHANNEL;
  }

  for (const userId of options.registered ?? ["user-1"]) {
    store.player(userId, userId).registered = true;
  }
  await store.save();

  const members = fakeMemberPort(options.nicknames);
  const spoilers = fakeSpoilers();
  const summarySource = fakeSummarySource();
  const now = options.now ?? (() => new Date("2026-11-16T20:00:00Z"));

  const display = new DisplayService({ port: members.port, logger: silentLogger });
  const daily = new DailyService({
    store,
    display,
    spoilers: spoilers.port,
    logger: silentLogger,
    timeZone: () => store.config.timeZone,
    now,
  });
  const results = new ResultsService({
    store,
    spoilers: spoilers.port,
    logger: silentLogger,
  });
  const summary = new SummaryService({
    store,
    daily,
    members: members.port,
    source: summarySource.port,
    logger: silentLogger,
    timeZone: () => store.config.timeZone,
  });

  return {
    dir,
    store,
    members,
    spoilers,
    display,
    daily,
    results,
    summary,
    summarySource,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export function options(values: {
  spoilers?: { id: string; name: string } | null;
  scope?: string | null;
  user?: { id: string; name: string } | null;
  points?: number | null;
  count?: number | null;
}): CommandOptions {
  return {
    getString: (name) => (name === "scope" ? (values.scope ?? null) : null),
    getBoolean: () => null,
    getNumber: (name) => {
      if (name === "points") return values.points ?? null;
      if (name === "count") return values.count ?? null;
      return null;
    },
    getUser: (name) => (name === "user" ? (values.user ?? null) : null),
    getChannel: (name) => (name === "spoilers" ? (values.spoilers ?? null) : null),
  };
}

export function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    guildId: GUILD,
    userId: "user-1",
    userName: "tester",
    isAdmin: true,
    options: options({}),
    now: new Date("2026-11-16T20:00:00Z"),
    ...overrides,
  };
}
