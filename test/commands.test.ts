import { afterEach, describe, expect, it } from "vitest";
import { runCommand, type CommandDeps } from "../src/commands/handlers.js";
import { handleInteraction } from "../src/discord/commands.js";
import { context, harness, options, recordResult, silentLogger, type Harness } from "./helpers.js";

let h: Harness | undefined;

afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

function deps(test: Harness, noticeChannelId: string | null = null): CommandDeps {
  return {
    store: test.store,
    daily: test.daily,
    display: test.display,
    notifier: test.notifier.port,
    noticeChannelId: () => noticeChannelId,
    logger: silentLogger,
    debug: true,
    now: () => new Date("2026-11-16T20:00:00Z"),
  };
}

async function post(test: Harness, userId: string, guesses: number, solved = true): Promise<void> {
  recordResult(test, userId, guesses, solved);
}

describe("/wordle-leaderboard", () => {
  it("says so when nobody is on the board", async () => {
    h = await harness({ players: [] });
    const reply = await runCommand("wordle-leaderboard", context(), deps(h));
    expect(reply.content).toContain("No players yet");
    expect(reply.ephemeral).toBe(false);
  });

  it("shows the all-time board sorted by points", async () => {
    h = await harness();
    h.store.player("user-1", "one").total = 5;
    h.store.player("user-2", "two").total = 20;

    const reply = await runCommand("wordle-leaderboard", context(), deps(h));

    expect(reply.content.indexOf("user-2")).toBeLessThan(reply.content.indexOf("user-1"));
    expect(reply.content).toContain("20 pts");
  });

  it("defaults to overall totals, including negative ones", async () => {
    h = await harness();
    h.store.player("user-1", "one").total = -12;
    h.store.player("user-2", "two").total = 7;

    const reply = await runCommand("wordle-leaderboard", context(), deps(h));

    expect(reply.content).toContain("Wordle all-time points");
    expect(reply.content).toContain("7 pts");
    expect(reply.content).toContain("-12 pts");
    expect(reply.content.indexOf("user-2")).toBeLessThan(reply.content.indexOf("user-1"));
  });
});

describe("/wordle-award", () => {
  it("adds points and creates the personal role", async () => {
    h = await harness({ nicknames: { "user-9": "Nine ✦" } });
    const reply = await runCommand(
      "wordle-award",
      context({ options: options({ user: { id: "user-9", name: "nine" }, points: 2.5 }) }),
      deps(h),
    );

    expect(reply.content).toContain("+2.5");
    expect(reply.content).toContain("Role is now");
    expect(h.store.data.players["user-9"]?.total).toBe(2.5);

    const role = [...h.members.roles.values()][0];
    expect(role?.name).toBe("2.5 points");
    expect(role?.members.has("user-9")).toBe(true);
  });

  it("subtracts into negative totals and shows them in the role", async () => {
    h = await harness({ nicknames: { "user-9": "Nine ✦" } });
    const player = h.store.player("user-9", "nine");
    player.total = 3;
    player.roleId = "role-1";
    h.members.roles.set("role-1", { name: "Nine ✦ · 3 pts", color: 0, members: new Set(["user-9"]) });

    const reply = await runCommand(
      "wordle-award",
      context({ options: options({ user: { id: "user-9", name: "nine" }, points: -10 }) }),
      deps(h),
    );

    expect(player.total).toBe(-7);
    expect(h.store.data.players["user-9"]?.roleId).toBe("role-1");
    expect(h.members.roles.get("role-1")?.name).toBe("-7 points");
    expect(reply.content).toContain("-7");
  });

  it("keeps a 0-point role at exactly zero", async () => {
    h = await harness({ nicknames: { "user-9": "Nine ✦" } });
    const player = h.store.player("user-9", "nine");
    player.total = 3;
    player.roleId = "role-1";
    h.members.roles.set("role-1", { name: "Nine ✦ · 3 pts", color: 0, members: new Set(["user-9"]) });

    const reply = await runCommand(
      "wordle-award",
      context({ options: options({ user: { id: "user-9", name: "nine" }, points: -3 }) }),
      deps(h),
    );

    expect(player.total).toBe(0);
    expect(player.roleId).toBe("role-1");
    expect(h.members.roles.get("role-1")?.name).toBe("0 points");
    expect(reply.content).toContain("0");
  });

  it("announces the award in the notice channel", async () => {
    h = await harness({ nicknames: { "user-9": "Nine ✦" } });

    await runCommand(
      "wordle-award",
      context({ options: options({ user: { id: "user-9", name: "nine" }, points: 2.5 }) }),
      deps(h, "chan-wordle"),
    );

    expect(h.notifier.messages).toHaveLength(1);
    const message = h.notifier.messages[0];
    expect(message?.channelId).toBe("chan-wordle");
    expect(message?.content).toContain("<@user-1> adjusted <@user-9>");
    expect(message?.content).toContain("**+2.5 points**");
    expect(message?.content).toContain("**2.5 points**");
  });

  it("falls back to the channel the command came from", async () => {
    h = await harness({ nicknames: { "user-9": "Nine ✦" } });

    await runCommand(
      "wordle-award",
      context({
        channelId: "chan-play",
        options: options({ user: { id: "user-9", name: "nine" }, points: -4 }),
      }),
      deps(h),
    );

    expect(h.notifier.messages).toHaveLength(1);
    expect(h.notifier.messages[0]?.channelId).toBe("chan-play");
    expect(h.notifier.messages[0]?.content).toContain("**-4 points**");
  });

  it("announces nothing when the award is refused", async () => {
    h = await harness();

    await runCommand(
      "wordle-award",
      context({ isAdmin: false, options: options({ user: { id: "user-9", name: "nine" }, points: 2 }) }),
      deps(h),
    );
    await runCommand(
      "wordle-award",
      context({ options: options({ user: { id: "user-9", name: "nine" }, points: 0 }) }),
      deps(h),
    );

    expect(h.notifier.messages).toHaveLength(0);
  });
});

describe("/wordle-award guards", () => {
  it("refuses non-admins and zero awards", async () => {
    h = await harness();

    const denied = await runCommand(
      "wordle-award",
      context({ isAdmin: false, options: options({ user: { id: "user-9", name: "nine" }, points: 2 }) }),
      deps(h),
    );
    expect(denied.content).toContain("Manage Server");

    const zero = await runCommand(
      "wordle-award",
      context({ options: options({ user: { id: "user-9", name: "nine" }, points: 0 }) }),
      deps(h),
    );
    expect(zero.content).toContain("non-zero");
  });
});

describe("/wordle-close", () => {
  it("refuses to run when developer tools are off", async () => {
    h = await harness();
    const reply = await runCommand("wordle-close", context(), { ...deps(h), debug: false });
    expect(reply.content).toContain("Developer tools are off");
  });
  it("finalizes today, awards points and reports the winner", async () => {
    h = await harness();
    await post(h, "user-1", 3);
    await post(h, "user-2", 5);

    const reply = await runCommand("wordle-close", context(), deps(h));

    expect(reply.content).toContain("Closed");
    expect(reply.content).toContain("10 pts");
    expect(reply.content).toContain("server streak");
    expect(h.store.data.players["user-1"]?.total).toBe(10);
    expect(h.store.data.days["2026-11-16"]?.finalized).toBe(true);
    expect(h.members.roles.size).toBe(1);
  });

  it("refuses when there is nothing to close or it is already closed", async () => {
    h = await harness();
    const empty = await runCommand("wordle-close", context(), deps(h));
    expect(empty.content).toContain("nothing to close");

    await post(h, "user-1", 3);
    await runCommand("wordle-close", context(), deps(h));
    const again = await runCommand("wordle-close", context(), deps(h));
    expect(again.content).toContain("already closed");
    expect(h.store.data.players["user-1"]?.total).toBe(10);
  });

  it("is admin-only", async () => {
    h = await harness();
    await post(h, "user-1", 3);

    const reply = await runCommand("wordle-close", context({ isAdmin: false }), deps(h));

    expect(reply.content).toContain("Manage Server");
    expect(h.store.data.days["2026-11-16"]?.finalized).toBe(false);
  });
});

describe("/wordle-streak", () => {
  it("reports the streak from recorded winning days", async () => {
    h = await harness();
    await post(h, "user-1", 3);

    const reply = await runCommand("wordle-streak", context(), deps(h));

    expect(reply.content).toContain("1 day server streak");
  });

  it("counts a day solved by someone with no player record", async () => {
    h = await harness();
    h.store.config.streakSeed = { day: "2026-11-14", count: 10 };
    h.store.day("2026-11-15").entries["ghost"] = {
      userId: "ghost",
      guesses: 2,
      solved: true,
      messageId: "m",
      recordedAt: "2026-11-15T14:00:00Z",
    };

    const reply = await runCommand("wordle-streak", context(), deps(h));

    expect(reply.content).toContain("11 day server streak");
  });

  it("lets an admin seed a long streak", async () => {
    h = await harness();

    const reply = await runCommand("wordle-streak", context({ options: options({ count: 105 }) }), deps(h));
    expect(reply.content).toContain("105");

    const view = await runCommand("wordle-streak", context(), deps(h));
    expect(view.content).toContain("105 day server streak");
  });

  it("extends the seed with today's win", async () => {
    h = await harness();
    await runCommand("wordle-streak", context({ options: options({ count: 105 }) }), deps(h));
    await post(h, "user-1", 3);

    const view = await runCommand("wordle-streak", context(), deps(h));

    expect(view.content).toContain("106 day server streak");
  });

  it("refuses a non-admin seed and non-whole numbers", async () => {
    h = await harness();

    const denied = await runCommand(
      "wordle-streak",
      context({ isAdmin: false, options: options({ count: 5 }) }),
      deps(h),
    );
    expect(denied.content).toContain("Manage Server");

    const invalid = await runCommand("wordle-streak", context({ options: options({ count: 2.5 }) }), deps(h));
    expect(invalid.content).toContain("whole number");
  });

  it("clears the seed with 0", async () => {
    h = await harness();
    await runCommand("wordle-streak", context({ options: options({ count: 105 }) }), deps(h));
    await runCommand("wordle-streak", context({ options: options({ count: 0 }) }), deps(h));

    expect(h.store.config.streakSeed).toBeNull();
  });
});

describe("/wordle-reopen", () => {
  it("takes the awarded points back and lets the day close again", async () => {
    h = await harness();
    await post(h, "user-1", 3);
    await runCommand("wordle-close", context(), deps(h));
    expect(h.store.data.players["user-1"]?.total).toBe(10);

    const reply = await runCommand("wordle-reopen", context(), deps(h));

    expect(reply.content).toContain("Reopened");
    expect(h.store.data.players["user-1"]?.total).toBe(0);
    expect(h.store.data.days["2026-11-16"]?.finalized).toBe(false);
    expect(h.store.data.days["2026-11-16"]?.points).toEqual({});
    expect([...h.members.roles.values()][0]?.name).toBe("0 points");

    await runCommand("wordle-close", context(), deps(h));
    expect(h.store.data.players["user-1"]?.total).toBe(10);
  });

  it("refuses an open day and non-admins", async () => {
    h = await harness();
    const open = await runCommand("wordle-reopen", context(), deps(h));
    expect(open.content).toContain("not closed");

    await post(h, "user-1", 3);
    await runCommand("wordle-close", context(), deps(h));
    const denied = await runCommand("wordle-reopen", context({ isAdmin: false }), deps(h));
    expect(denied.content).toContain("Manage Server");
    expect(h.store.data.players["user-1"]?.total).toBe(10);
  });
});

describe("unknown commands", () => {
  it("reports them instead of throwing", async () => {
    h = await harness();
    const reply = await runCommand("nope", context(), deps(h));
    expect(reply.content).toContain("Unknown command");
  });
});

describe("interaction replies", () => {
  it("never notify mentioned members", async () => {
    h = await harness();
    const replies: Array<{ content: string; allowedMentions?: unknown }> = [];

    const interaction = {
      guildId: "guild-1",
      user: { id: "user-1", username: "tester" },
      memberPermissions: { has: () => false },
      commandName: "wordle-leaderboard",
      options: { getNumber: () => null, getUser: () => null },
      replied: false,
      deferred: false,
      reply: async (payload: (typeof replies)[number]) => {
        replies.push(payload);
      },
      followUp: async (payload: (typeof replies)[number]) => {
        replies.push(payload);
      },
    } as unknown as Parameters<typeof handleInteraction>[0];

    await handleInteraction(interaction, deps(h), silentLogger);

    expect(replies).toHaveLength(1);
    expect(replies[0]?.allowedMentions).toEqual({ parse: [] });
  });
});
