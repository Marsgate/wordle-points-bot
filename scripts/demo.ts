/**
 * Offline simulation of one Wordle day. No Discord connection, no token:
 * the same services the bot uses are wired to in-memory ports, so the output
 * shows exactly what would happen in a real server.
 *
 *   npm run demo
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DailyService } from "../src/services/daily.js";
import { DisplayService } from "../src/services/display.js";
import { ResultsService } from "../src/services/results.js";
import type { Logger, MemberPort, SpoilerPort } from "../src/services/ports.js";
import { JsonStore } from "../src/store.js";

const TZ = "America/Indianapolis";
const WORDLE_CHANNEL = "wordle";
const SPOILER_CHANNEL = "wordle-spoilers";
const GOSSIP_CHANNEL = "general";

const logger: Logger = {
  info: (message) => console.log(`   · ${message}`),
  warn: (message) => console.log(`   ! ${message}`),
  error: (message) => console.log(`   ✗ ${message}`),
};

const nicknames = new Map<string, string>([
  ["u-ada", "𝓐𝓭𝓪 ✦"],
  ["u-grace", "grace"],
  ["u-linus", "Linus 🐧 · 3.5"],
  ["u-margaret", "Margaret Hamilton"],
]);
const roles = new Map<string, { name: string; color: number; members: Set<string> }>();
const spoilerAccess = new Set<string>();
let roleSequence = 0;

const memberPort: MemberPort = {
  readNickname: async (userId) => nicknames.get(userId) ?? null,
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

const SHARES: Array<{ authorId: string; authorName: string; channelId: string; content: string; at: string }> = [
  {
    authorId: "u-ada",
    authorName: "ada",
    channelId: WORDLE_CHANNEL,
    at: "2026-11-16T14:05:00Z",
    content: ["Wordle 1,512 3/6*", "", "⬛🟨⬛⬛⬛", "⬛🟩🟩🟨⬛", "🟩🟩🟩🟩🟩"].join("\n"),
  },
  {
    authorId: "u-grace",
    authorName: "grace",
    channelId: WORDLE_CHANNEL,
    at: "2026-11-16T14:12:00Z",
    content: ["Wordle 1,512 3/6", "", "⬛⬛🟨⬛⬛", "🟨🟩⬛🟩⬛", "🟩🟩🟩🟩🟩"].join("\n"),
  },
  {
    authorId: "u-linus",
    authorName: "linus",
    channelId: WORDLE_CHANNEL,
    at: "2026-11-16T14:20:00Z",
    content: ["||Wordle 1,512 3/6||", "||⬛🟨⬛⬛⬛||", "||⬛⬛🟩🟨⬛||", "||🟩🟩🟩🟩🟩||"].join("\n"),
  },
  {
    authorId: "u-margaret",
    authorName: "margaret",
    channelId: GOSSIP_CHANNEL,
    at: "2026-11-16T15:00:00Z",
    content: ["Wordle 1,512 5/6", "", "⬛⬛🟨⬛⬛", "⬛🟨⬛⬛⬛", "🟨⬛⬛🟨⬛", "⬛⬛🟨⬛⬛", "🟩🟩🟩🟩🟩"].join("\n"),
  },
];

function banner(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function colorName(color: number): string {
  if (color === 0xfee75c) return "gold";
  if (color === 0x5865f2) return "blue";
  if (color === 0x57f287) return "green";
  return "grey";
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "wordle-demo-"));
  try {
    const store = await JsonStore.open(join(dir, "store.json"), TZ);
    store.config.guildId = "guild-1";
    store.config.spoilerChannelId = SPOILER_CHANNEL;

    // Everyone registers with their current total before shares count.
    for (const share of SHARES) {
      store.player(share.authorId, share.authorName).registered = true;
    }
    await store.save();

    const display = new DisplayService({ port: memberPort, logger });
    const daily = new DailyService({
      store,
      display,
      spoilers: spoilerPort,
      logger,
      timeZone: () => store.config.timeZone,
      now: () => new Date(),
    });
    const results = new ResultsService({ store, spoilers: spoilerPort, logger });

    banner("Monday: three people share 3/6 in #wordle, one shares 5/6 in #general");
    for (const share of SHARES) {
      const outcome = await results.handle({
        id: `msg-${share.authorId}`,
        guildId: "guild-1",
        channelId: share.channelId,
        authorId: share.authorId,
        authorName: share.authorName,
        authorIsBot: false,
        content: share.content,
        createdAt: new Date(share.at),
      });
      console.log(`   ${share.authorName.padEnd(9)} → ${outcome.kind} (posted in #${share.channelId})`);
    }

    banner("Spoiler channel access before midnight");
    console.log(`   ${spoilerAccess.size} member(s): ${[...spoilerAccess].join(", ") || "nobody"}`);
    console.log("   (Results count in every channel, so Margaret's #general share unlocked it too.)");

    banner("Midnight rollover (America/Indianapolis)");
    const report = await daily.rollover(new Date("2026-11-17T05:00:30Z"));
    console.log(`   closed: ${report.finalized.join(", ") || "nothing"}`);
    console.log(`   spoiler overwrites removed: ${report.spoilerMembersRevoked}`);

    banner("Result for Wordle 1,512");
    const day = store.data.days["2026-11-16"];
    for (const [userId, entry] of Object.entries(day?.entries ?? {})) {
      const points = day?.points[userId] ?? 0;
      const result = entry.solved ? `${entry.guesses}/6` : "X/6";
      console.log(`   ${userId.padEnd(11)} ${result.padEnd(4)} ${points > 0 ? `${points} pts` : "no points"}`);
    }
    console.log("   (10 points split 3 ways = 3.5 each.)");

    banner("Personal points roles (one per member, coloured by total)");
    for (const [roleId, role] of roles) {
      console.log(`   ${roleId.padEnd(7)} ${role.name.padEnd(26)} ${colorName(role.color).padEnd(6)} ${[...role.members].join(", ")}`);
    }

    banner("Nicknames after rollover (no longer edited)");
    for (const [userId, nickname] of nicknames) console.log(`   ${userId.padEnd(11)} ${nickname}`);

    banner("Next day");
    console.log(`   spoiler access: ${spoilerAccess.size} member(s) — reset for the new puzzle`);
    console.log(`   all-time: ${Object.values(store.data.players).map((p) => `${p.displayName}=${p.total}`).join(", ")}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
