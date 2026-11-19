import { afterEach, describe, expect, it } from "vitest";
import { harness, recordResult, type Harness } from "./helpers.js";

let h: Harness | undefined;

afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

async function post(
  test: Harness,
  userId: string,
  guesses: number,
  solved = true,
  at = "2026-11-16T14:00:00Z",
): Promise<void> {
  recordResult(test, userId, guesses, solved, at);
}

function roleNamed(test: Harness, name: string) {
  return [...test.members.roles.values()].find((role) => role.name === name);
}

describe("DailyService.finalizeDay", () => {
  it("creates a personal role for each winner at the end of the day", async () => {
    h = await harness({ nicknames: { "user-1": "𝓐𝓭𝓪 ✦", "user-2": "grace", "user-3": "Linus 🐧" } });
    await post(h, "user-1", 3);
    await post(h, "user-2", 3);
    await post(h, "user-3", 4);

    // Nothing exists while the day is open.
    expect(h.store.data.players["user-1"]?.total).toBe(0);
    expect(h.members.roles.size).toBe(0);

    const report = await h.daily.finalizeDay("2026-11-16");

    expect(report.skipped).toBe(false);
    expect(report.winners).toHaveLength(2);
    expect(h.store.data.players["user-1"]?.total).toBe(5);
    expect(h.store.data.players["user-2"]?.total).toBe(5);
    expect(h.store.data.players["user-3"]?.total).toBe(0);

    expect(h.store.data.days["2026-11-16"]?.finalized).toBe(true);
    expect(h.store.data.days["2026-11-16"]?.points).toEqual({ "user-1": 5, "user-2": 5 });

    const ada = roleNamed(h, "5 points");
    expect(ada).toBeDefined();
    expect(ada?.members.has("user-1")).toBe(true);
    expect(h.store.data.players["user-1"]?.roleId).toBeDefined();
    expect(h.store.data.players["user-3"]?.roleId).toBeNull();
  });

  it("gives each member of a tie their own 3.5 point role", async () => {
    h = await harness();
    await post(h, "user-1", 3);
    await post(h, "user-2", 3);
    await post(h, "user-3", 3);

    await h.daily.finalizeDay("2026-11-16");

    expect(h.store.data.players["user-1"]?.total).toBe(3.5);
    expect(h.members.roles.size).toBe(3);
    for (const userId of ["user-1", "user-2", "user-3"]) {
      const role = h.members.roles.get(h.store.data.players[userId]?.roleId ?? "");
      expect(role?.name).toBe("3.5 points");
      expect(role?.members.has(userId)).toBe(true);
    }
  });

  it("is idempotent — finalizing twice does not double-award or duplicate roles", async () => {
    h = await harness();
    await post(h, "user-1", 2);

    await h.daily.finalizeDay("2026-11-16");
    const second = await h.daily.finalizeDay("2026-11-16");

    expect(second.skipped).toBe(true);
    expect(h.store.data.players["user-1"]?.total).toBe(10);
    expect(h.members.roles.size).toBe(1);
  });

  it("skips a day that has no entries", async () => {
    h = await harness();
    const report = await h.daily.finalizeDay("2020-01-01");
    expect(report.skipped).toBe(true);
  });

  it("commits points even when the role cannot be created", async () => {
    h = await harness();
    await post(h, "user-1", 2);
    h.members.port.syncRole = async () => {
      throw new Error("Missing Permissions");
    };

    const report = await h.daily.finalizeDay("2026-11-16");

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.reason).toContain("Missing Permissions");
    expect(h.store.data.players["user-1"]?.total).toBe(10);
  });

  it("brings a negative total to zero and keeps a 0-point role", async () => {
    h = await harness();
    h.store.player("user-1").total = -10;
    await post(h, "user-1", 3);

    await h.daily.finalizeDay("2026-11-16");

    expect(h.store.data.players["user-1"]?.total).toBe(0);
    expect(roleNamed(h, "0 points")?.members.has("user-1")).toBe(true);
  });

  it("awards nothing when nobody solved", async () => {
    h = await harness();
    await post(h, "user-1", 6, false);
    await post(h, "user-2", 6, false);

    const report = await h.daily.finalizeDay("2026-11-16");

    expect(report.winners).toHaveLength(0);
    expect(h.store.data.players["user-1"]?.total).toBe(0);
    expect(h.members.roles.size).toBe(0);
    expect(h.store.data.days["2026-11-16"]?.finalized).toBe(true);
  });
});

describe("DailyService.reopenDay", () => {
  it("does not take the day's points off twice when two reopens overlap", async () => {
    h = await harness({ nicknames: { "user-1": "Ada" } });
    await post(h, "user-1", 2);
    await h.daily.finalizeDay("2026-11-16");
    expect(h.store.data.players["user-1"]?.total).toBe(10);

    // Park the first role update so the second reopen arrives while the first
    // is still between its "is it closed?" check and its reset.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const syncRole = h.members.port.syncRole;
    let calls = 0;
    h.members.port.syncRole = async (userId, roleName, color, existingRoleId) => {
      calls += 1;
      if (calls === 1) await gate;
      return syncRole(userId, roleName, color, existingRoleId);
    };

    const first = h.daily.reopenDay("2026-11-16");
    const second = h.daily.reopenDay("2026-11-16");
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(h.store.data.players["user-1"]?.total).toBe(0);
    expect([a.reopened, b.reopened].filter(Boolean)).toHaveLength(1);
  });
});

describe("DailyService.rollover", () => {
  it("closes every day missed while the bot was offline", async () => {
    h = await harness();
    await post(h, "user-1", 2, true, "2026-11-14T14:00:00Z");
    await post(h, "user-1", 4, true, "2026-11-15T14:00:00Z");

    const report = await h.daily.rollover(new Date("2026-11-16T05:00:30Z"));

    expect(report.finalized).toEqual(["2026-11-14", "2026-11-15"]);
    expect(h.store.data.players["user-1"]?.total).toBe(20);
    expect(roleNamed(h, "20 points")).toBeDefined();
  });

  it("leaves the current day open", async () => {
    h = await harness();
    await post(h, "user-1", 2, true, "2026-11-16T14:00:00Z");

    const report = await h.daily.rollover(new Date("2026-11-16T20:00:00Z"));

    expect(report.finalized).toEqual([]);
    expect(h.store.data.days["2026-11-16"]?.finalized).toBe(false);
    expect(h.store.data.players["user-1"]?.total).toBe(0);
  });

  it("does not let a new day inherit yesterday's entry", async () => {
    h = await harness();
    await post(h, "user-1", 2, true, "2026-11-16T14:00:00Z");
    await h.daily.rollover(new Date("2026-11-17T05:00:30Z"));

    await post(h, "user-2", 4, true, "2026-11-17T14:00:00Z");
    const today = h.store.data.days["2026-11-17"];
    expect(today?.entries["user-1"]).toBeUndefined();
    expect(today?.entries["user-2"]?.guesses).toBe(4);
  });
});

describe("DailyService.resync", () => {
  it("re-applies stored totals as roles, zero included", async () => {
    h = await harness({ nicknames: { "user-1": "Ada", "user-2": "Bob", "user-3": "Cleo" } });
    const patch = (userId: string, name: string, total: number) => {
      const player = h?.store.player(userId, name);
      if (!player) return;
      player.total = total;
    };
    patch("user-1", "Ada", 12.5);
    patch("user-2", "Bob", 0);
    patch("user-3", "Cleo", 3);

    const report = await h.daily.resync();

    expect(report.updated.sort()).toEqual(["user-1", "user-2", "user-3"]);
    expect(h.members.roles.size).toBe(3);
    expect(roleNamed(h, "12.5 points")).toBeDefined();
    expect(roleNamed(h, "0 points")).toBeDefined();
    expect(roleNamed(h, "3 points")).toBeDefined();
  });

  it("creates a role for a negative total", async () => {
    h = await harness();
    h.store.player("user-1").total = -4;

    const report = await h.daily.resync();

    expect(report.updated).toEqual(["user-1"]);
    expect(roleNamed(h, "-4 points")?.members.has("user-1")).toBe(true);
  });

  it("keeps a 0-point role", async () => {
    h = await harness();
    const player = h.store.player("user-1", "ada");
    player.total = 0;

    const report = await h.daily.resync();

    expect(report.updated).toEqual(["user-1"]);
    expect(roleNamed(h, "0 points")?.members.has("user-1")).toBe(true);
  });
});
