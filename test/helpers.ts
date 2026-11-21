import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/store.js";
import type {
  Logger,
  MemberPort,
  NotifierPort,
  SummaryMessage,
  SummarySourcePort,
} from "../src/services/ports.js";
import { dayKey } from "../src/core/day.js";
import { DailyService } from "../src/services/daily.js";
import { DisplayService } from "../src/services/display.js";
import { SummaryService } from "../src/services/summary.js";
import type { CommandContext, CommandOptions } from "../src/commands/handlers.js";

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export const GUILD = "guild-1";
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
  };

  return { port, nicknames, roles, calls };
}

export function fakeNotifier() {
  const messages: Array<{
    channelId: string;
    content: string;
    button?: { label: string; customId: string };
  }> = [];
  const port: NotifierPort = {
    send: async (channelId, content, button) => {
      messages.push({ channelId, content, ...(button ? { button } : {}) });
    },
  };
  return { port, messages };
}

export function fakeSummarySource() {
  const messagesByChannel = new Map<string, SummaryMessage[]>();
  const port: SummarySourcePort = {
    listTextChannelIds: async () => [...messagesByChannel.keys()],
    fetchRecentMessages: async (channelId) => messagesByChannel.get(channelId) ?? [],
  };
  return { port, messagesByChannel };
}

/** Writes a day entry directly, standing in for a processed summary. */
export function recordResult(
  test: Harness,
  userId: string,
  guesses: number,
  solved = true,
  at = "2026-11-16T14:00:00Z",
): void {
  test.store.player(userId, userId);
  const day = dayKey(new Date(at), test.store.config.timeZone);
  test.store.day(day).entries[userId] = {
    userId,
    guesses,
    solved,
    messageId: "test",
    recordedAt: at,
  };
}

export interface Harness {
  dir: string;
  store: JsonStore;
  members: ReturnType<typeof fakeMemberPort>;
  display: DisplayService;
  daily: DailyService;
  summary: SummaryService;
  summarySource: ReturnType<typeof fakeSummarySource>;
  notifier: ReturnType<typeof fakeNotifier>;
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
    /** Players pre-created at 0 points. Defaults to the usual author. */
    players?: string[];
    /** Channel server-wide notices go to; null uses the summary's channel. */
    noticeChannelId?: string | null;
    /** Existing store directory to reopen, to stand in for a restart. */
    dir?: string;
  } = {},
): Promise<Harness> {
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), "wordle-test-")));
  const ownsDir = options.dir === undefined;
  const store = await JsonStore.open(join(dir, "store.json"), options.timeZone ?? TZ);

  if (options.configure !== false) {
    store.config.guildId = GUILD;
  }

  for (const userId of options.players ?? ["user-1"]) {
    store.player(userId, userId);
  }
  await store.save();

  const members = fakeMemberPort(options.nicknames);
  const summarySource = fakeSummarySource();
  const notifier = fakeNotifier();
  const now = options.now ?? (() => new Date("2026-11-16T20:00:00Z"));

  const display = new DisplayService({ port: members.port, logger: silentLogger });
  const daily = new DailyService({
    store,
    display,
    logger: silentLogger,
    timeZone: () => store.config.timeZone,
    now,
  });
  const summary = new SummaryService({
    store,
    daily,
    display,
    members: members.port,
    source: summarySource.port,
    notifier: notifier.port,
    logger: silentLogger,
    timeZone: () => store.config.timeZone,
    noticeChannelId: () => options.noticeChannelId ?? null,
  });

  return {
    dir,
    store,
    members,
    display,
    daily,
    summary,
    summarySource,
    notifier,
    cleanup: async () => {
      if (ownsDir) await rm(dir, { recursive: true, force: true });
    },
  };
}

export function options(values: {
  user?: { id: string; name: string } | null;
  points?: number | null;
  count?: number | null;
}): CommandOptions {
  return {
    getNumber: (name) => {
      if (name === "points") return values.points ?? null;
      if (name === "count") return values.count ?? null;
      return null;
    },
    getUser: (name) => (name === "user" ? (values.user ?? null) : null),
  };
}

export function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    guildId: GUILD,
    userId: "user-1",
    userName: "tester",
    channelId: "chan-command",
    isAdmin: true,
    options: options({}),
    now: new Date("2026-11-16T20:00:00Z"),
    ...overrides,
  };
}
