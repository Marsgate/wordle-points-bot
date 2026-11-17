import { afterEach, describe, expect, it } from "vitest";
import { runCommand, type CommandDeps } from "../src/commands/handlers.js";
import { context, GUILD, harness, incomingMessage, options, shareFor, type Harness } from "./helpers.js";

let h: Harness | undefined;

afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

function deps(test: Harness): CommandDeps {
  return {
    store: test.store,
    daily: test.daily,
    display: test.display,
    spoilers: test.spoilers.port,
    now: () => new Date("2026-11-16T20:00:00Z"),
  };
}

async function post(test: Harness, userId: string, guesses: number, solved = true): Promise<void> {
  if (!test.store.data.players[userId]?.registered) {
    test.store.player(userId, userId).registered = true;
  }
  await test.results.handle(
    incomingMessage({ id: `msg-${userId}`, authorId: userId, authorName: userId, content: shareFor(guesses, solved) }),
  );
}

describe("/wordle-setup", () => {
  it("stores the spoiler channel and locks it", async () => {
    h = await harness({ configure: false });
    const reply = await runCommand(
      "wordle-setup",
      context({ options: options({ spoilers: { id: "spoilers-new", name: "spoilers" } }) }),
      deps(h),
    );

    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain("<#spoilers-new>");
    expect(reply.content).toContain("counted in every channel");
    expect(h.store.config.spoilerChannelId).toBe("spoilers-new");
    expect(h.store.config.timeZone).toBe("America/Indianapolis");
    expect(h.store.config.startedOn).toBe("2026-11-16");
    expect(h.spoilers.calls.lockdowns).toBe(1);
  });

  it("refuses non-admins", async () => {
    h = await harness({ configure: false });
    const reply = await runCommand(
      "wordle-setup",
      context({ isAdmin: false, options: options({ spoilers: { id: "spoilers-new", name: "spoilers" } }) }),
      deps(h),
    );

    expect(reply.content).toContain("Manage Server");
    expect(h.store.config.spoilerChannelId).toBeNull();
  });

  it("requires a spoiler channel", async () => {
    h = await harness({ configure: false });
    const reply = await runCommand("wordle-setup", context(), deps(h));

    expect(reply.content).toContain("Choose the channel");
    expect(h.store.config.spoilerChannelId).toBeNull();
  });

  it("keeps the configuration when the spoiler channel cannot be locked", async () => {
    h = await harness({ configure: false });
    h.spoilers.port.lockDown = async () => {
      throw new Error("Missing Access");
    };

    const reply = await runCommand(
      "wordle-setup",
      context({ options: options({ spoilers: { id: "spoilers-new", name: "spoilers" } }) }),
      deps(h),
    );

    expect(reply.content).toContain("could not lock it down");
    expect(h.store.config.spoilerChannelId).toBe("spoilers-new");
  });
});

describe("/wordle-status", () => {
  it("shows the configured channels and today's count", async () => {
    h = await harness();
    await post(h, "user-1", 3);

    const reply = await runCommand("wordle-status", context(), deps(h));

    expect(reply.content).toContain("<#chan-spoilers>");
    expect(reply.content).toContain("America/Indianapolis");
    expect(reply.content).toContain("Registered players: 1");
    expect(reply.content).toContain("1 share recorded");
  });
});

describe("/wordle-leaderboard", () => {
  it("says so when the day is empty", async () => {
    h = await harness();
    const reply = await runCommand("wordle-leaderboard", context({ options: options({ scope: "today" }) }), deps(h));
    expect(reply.content).toContain("No shares recorded yet today");
    expect(reply.ephemeral).toBe(false);
  });

  it("shows today's ranking with a tie note", async () => {
    h = await harness();
    await post(h, "user-1", 3);
    await post(h, "user-2", 3);
    await post(h, "user-3", 3);
    await post(h, "user-4", 5);

    const reply = await runCommand("wordle-leaderboard", context({ options: options({ scope: "today" }) }), deps(h));

    expect(reply.content).toContain("3/6");
    expect(reply.content).toContain("3.5 pts");
    expect(reply.content).toContain("Tie at 3/6");
    expect(reply.content).toContain("Provisional");
  });

  it("shows the all-time board sorted by points", async () => {
    h = await harness();
    h.store.player("user-1", "one").total = 5;
    h.store.player("user-2", "two").total = 20;

    const reply = await runCommand("wordle-leaderboard", context({ options: options({ scope: "all" }) }), deps(h));

    expect(reply.content.indexOf("user-2")).toBeLessThan(reply.content.indexOf("user-1"));
    expect(reply.content).toContain("20 pts");
  });
});

describe("/points", () => {
  it("reports a zero total for a registered member", async () => {
    h = await harness();
    const reply = await runCommand("points", context(), deps(h));
    expect(reply.content).toContain("0 points");
  });

  it("says so for an unregistered member", async () => {
    h = await harness();
    const reply = await runCommand(
      "points",
      context({ options: options({ user: { id: "user-8", name: "eight" } }) }),
      deps(h),
    );
    expect(reply.content).toContain("not registered yet");
  });

  it("reports totals and wins for another member", async () => {
    h = await harness();
    const player = h.store.player("user-2", "two");
    player.total = 12.5;
    player.registered = true;
    h.store.day("2026-11-15").points["user-2"] = 10;

    const reply = await runCommand(
      "points",
      context({ options: options({ user: { id: "user-2", name: "two" } }) }),
      deps(h),
    );

    expect(reply.content).toContain("12.5 points");
    expect(reply.content).toContain("1 win");
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
});

describe("/wordle-unregister", () => {
  it("lets members leave and stops scoring them", async () => {
    h = await harness();
    await post(h, "user-1", 3);

    const reply = await runCommand("wordle-unregister", context(), deps(h));

    expect(reply.content).toContain("Unregistered");
    expect(h.store.data.players["user-1"]?.registered).toBe(false);

    const outcome = await h.results.handle(
      incomingMessage({ id: "after", authorId: "user-1", content: shareFor(2) }),
    );
    expect(outcome).toMatchObject({ kind: "ignored", reason: "unregistered" });
  });

  it("requires an admin to unregister someone else", async () => {
    h = await harness();
    h.store.player("user-2", "two").registered = true;

    const denied = await runCommand(
      "wordle-unregister",
      context({ isAdmin: false, options: options({ user: { id: "user-2", name: "two" } }) }),
      deps(h),
    );
    expect(denied.content).toContain("Manage Server");
    expect(h.store.data.players["user-2"]?.registered).toBe(true);

    const allowed = await runCommand(
      "wordle-unregister",
      context({ options: options({ user: { id: "user-2", name: "two" } }) }),
      deps(h),
    );
    expect(allowed.content).toContain("Unregistered");
    expect(h.store.data.players["user-2"]?.registered).toBe(false);
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

describe("/wordle-resync", () => {
  it("re-applies every stored total as a role", async () => {
    h = await harness({ nicknames: { "user-1": "Ada", "user-2": "Bob" } });
    const ada = h.store.player("user-1", "Ada");
    ada.total = 4;
    const bob = h.store.player("user-2", "Bob");
    bob.total = 1.5;
    bob.registered = true;

    const reply = await runCommand("wordle-resync", context(), deps(h));

    expect(reply.content).toContain("Updated 2 points roles");
    expect(h.members.roles.size).toBe(2);
    const names = [...h.members.roles.values()].map((role) => role.name).sort();
    expect(names).toEqual(["1.5 points", "4 points"]);
  });
});

describe("/wordle-register", () => {
  it("sets the starting total and creates the role", async () => {
    h = await harness({ nicknames: { "user-9": "Nine ✦" } });

    const reply = await runCommand(
      "wordle-register",
      context({ userId: "user-9", userName: "nine", options: options({ points: 12.5 }) }),
      deps(h),
    );

    const player = h.store.data.players["user-9"];
    expect(player?.registered).toBe(true);
    expect(player?.total).toBe(12.5);
    expect(reply.content).toContain("Registered");
    expect([...h.members.roles.values()][0]?.name).toBe("12.5 points");
  });

  it("registers at zero with a 0-point role", async () => {
    h = await harness();

    const reply = await runCommand(
      "wordle-register",
      context({ userId: "user-9", userName: "nine", options: options({ points: 0 }) }),
      deps(h),
    );

    expect(h.store.data.players["user-9"]?.registered).toBe(true);
    expect(h.store.data.players["user-9"]?.total).toBe(0);
    expect([...h.members.roles.values()][0]?.name).toBe("0 points");
    expect(reply.content).toContain("0 points");
  });

  it("accepts a negative starting total and gives it a role", async () => {
    h = await harness();

    const reply = await runCommand(
      "wordle-register",
      context({ userId: "user-9", userName: "nine", options: options({ points: -10 }) }),
      deps(h),
    );

    expect(h.store.data.players["user-9"]?.total).toBe(-10);
    expect([...h.members.roles.values()][0]?.name).toBe("-10 points");
    expect(reply.content).toContain("Your role is");
  });

  it("refuses a second registration", async () => {
    h = await harness();

    const reply = await runCommand(
      "wordle-register",
      context({ options: options({ points: 5 }) }),
      deps(h),
    );

    expect(reply.content).toContain("already registered");
    expect(h.store.data.players["user-1"]?.total).toBe(0);
  });

  it("requires a number", async () => {
    h = await harness();
    const reply = await runCommand(
      "wordle-register",
      context({ userId: "user-9", userName: "nine" }),
      deps(h),
    );
    expect(reply.content).toContain("current point total");
    expect(h.store.data.players["user-9"]).toBeUndefined();
  });
});

describe("unknown commands", () => {
  it("reports them instead of throwing", async () => {
    h = await harness();
    const reply = await runCommand("nope", context(), deps(h));
    expect(reply.content).toContain("Unknown command");
  });
});
