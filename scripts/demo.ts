/**
 * Offline simulation of one Activity summary. No Discord connection, no token:
 * the same services the bot uses are wired to in-memory ports.
 *
 *   npm run demo
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DailyService } from "../src/services/daily.js";
import { DisplayService } from "../src/services/display.js";
import { registerMember } from "../src/services/registration.js";
import { SummaryService } from "../src/services/summary.js";
import type { Logger, MemberPort, NotifierPort, SpoilerPort } from "../src/services/ports.js";
import { JsonStore } from "../src/store.js";

const TZ = "America/Indianapolis";
const GUILD = "guild-1";

const logger: Logger = {
  info: (message) => console.log(`   · ${message}`),
  warn: (message) => console.log(`   ! ${message}`),
  error: (message) => console.log(`   ✗ ${message}`),
};

const nicknames = new Map<string, string>([
  ["111", "Ada ✦"],
  ["222", "Grace"],
  ["333", "Linus 🐧"],
  ["444", "Margaret"],
]);
const roles = new Map<string, { name: string; color: number; members: Set<string> }>();
const spoilerAccess = new Set<string>();
const sent: string[] = [];
let roleSequence = 0;

const memberPort: MemberPort = {
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
      roleSequence += 1;
      roleId = `role-${roleSequence}`;
      role = { name: roleName, color, members: new Set() };
      roles.set(roleId, role);
      changed = true;
    } else {
      if (role.name !== roleName) {
        role.name = roleName;
        changed = true;
      }
      if (role.color !== color) {
        role.color = color;
        changed = true;
      }
    }

    if (!role.members.has(userId)) {
      role.members.add(userId);
      changed = true;
    }
    return { roleId: roleId as string, changed };
  },
  deleteRole: async (roleId) => roles.delete(roleId),
};

const spoilerPort: SpoilerPort = {
  grant: async (userId) => {
    spoilerAccess.add(userId);
  },
  revokeAll: async () => {
    const count = spoilerAccess.size;
    spoilerAccess.clear();
    return count;
  },
  lockDown: async () => {},
};

const notifier: NotifierPort = {
  send: async (_channelId, content) => {
    sent.push(content);
  },
};

const summarySource = {
  listTextChannelIds: async () => ["plains"],
  fetchRecentMessages: async () => [],
};

function banner(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "wordle-demo-"));
  try {
    const store = await JsonStore.open(join(dir, "store.json"), TZ);
    store.config.guildId = GUILD;
    store.config.spoilerChannelId = "wordle-spoilers";
    store.config.startedOn = "2026-11-16";
    await store.save();

    const display = new DisplayService({ port: memberPort, logger });

    banner("Members register with the totals they are bringing in");
    const starters: Array<[string, string, number]> = [
      ["111", "ada", 0],
      ["222", "grace", 0],
      ["333", "linus", 3.5],
      ["444", "margaret", -4],
    ];
    for (const [userId, name, points] of starters) {
      const reply = await registerMember(
        { store, display },
        { userId, userName: name, points },
      );
      console.log(`   ${nicknames.get(userId)?.padEnd(12)} ${reply.split("\n")[0]?.replace(/\*\*/g, "")}`);
    }

    const daily = new DailyService({
      store,
      display,
      spoilers: spoilerPort,
      logger,
      timeZone: () => store.config.timeZone,
      now: () => new Date("2026-11-17T12:00:00Z"),
    });
    const summary = new SummaryService({
      store,
      daily,
      members: memberPort,
      source: summarySource,
      notifier,
      logger,
      timeZone: () => store.config.timeZone,
    });

    banner("The Activity posts yesterday's summary in #plains");
    const content = [
      "**Your group is on a 103 day streak!** 🔥🔥🔥 Here are yesterday's results:",
      "👑 4/6: <@111> <@222>",
      "5/6: <@333>",
      "X/6: <@444>",
    ].join("\n");
    console.log(content.replace(/^/gm, "   "));

    await summary.handleMessage({
      id: "summary-1",
      content,
      authorIsBot: true,
      createdAt: new Date("2026-11-17T11:55:00Z"),
      channelId: "plains",
    });

    banner("Result for Wordle on Nov 16");
    const day = store.data.days["2026-11-16"];
    for (const [userId, entry] of Object.entries(day?.entries ?? {})) {
      const points = day?.points[userId] ?? 0;
      const result = entry.solved ? `${entry.guesses}/6` : "X/6";
      console.log(`   ${userId.padEnd(5)} ${result.padEnd(4)} ${points > 0 ? `${points} pts` : "no points"}`);
    }
    console.log("   (Ada and Grace tied at 4/6, so the 10 points split: 5 each.)");

    banner("Roles");
    for (const [roleId, role] of roles) {
      console.log(`   ${roleId.padEnd(7)} ${role.name.padEnd(12)} ${[...role.members].join(", ")}`);
    }

    banner("Streak");
    const seed = store.config.streakSeed;
    console.log(`   baseline ${seed?.count} through ${seed?.day} (read from the summary)`);
    console.log(`   spoiled members: ${spoilerAccess.size} (no share step needed)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
