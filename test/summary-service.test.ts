import { afterEach, describe, expect, it } from "vitest";
import { harness, type Harness } from "./helpers.js";

let h: Harness | undefined;

afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

const SUMMARY = [
  "**Your group is on a 12 day streak!** 🔥 Here are yesterday's results:",
  "👑 3/6: <@111>",
  "4/6: @Bob",
  "X/6: <@333>",
].join("\n");

const SUMMARY_MESSAGE = {
  id: "sum-1",
  content: SUMMARY,
  authorIsBot: true,
  // 06:55 local on 2026-11-16, so the summary describes 2026-11-15.
  createdAt: new Date("2026-11-16T11:55:00Z"),
  channelId: "chan-wordle",
};

function register(test: Harness, userId: string, nickname?: string): void {
  test.store.player(userId, userId).registered = true;
  if (nickname) test.members.nicknames.set(userId, nickname);
}

describe("SummaryService", () => {
  it("applies yesterday's scores and awards points", async () => {
    h = await harness({ nicknames: { "111": "Ada", "222": "Bob" } });
    register(h, "111", "Ada");
    register(h, "222", "Bob");

    const applied = await h.summary.handleMessage(SUMMARY_MESSAGE);

    expect(applied).toBe(true);
    const day = h.store.data.days["2026-11-15"];
    expect(day?.entries["111"]).toMatchObject({ guesses: 3, solved: true });
    expect(day?.entries["222"]).toMatchObject({ guesses: 4, solved: true });
    expect(day?.entries["333"]).toBeUndefined();
    expect(day?.finalized).toBe(true);
    expect(day?.points).toEqual({ "111": 10 });
    expect(h.store.data.players["111"]?.total).toBe(10);
    expect(h.store.data.players["222"]?.total).toBe(0);
    expect([...h.members.roles.values()][0]?.name).toBe("10 points");
  });

  it("syncs the reported group streak", async () => {
    h = await harness();
    register(h, "111", "Ada");

    await h.summary.handleMessage(SUMMARY_MESSAGE);

    expect(h.store.config.streakSeed).toEqual({ day: "2026-11-15", count: 12 });
  });

  it("ignores the same summary twice", async () => {
    h = await harness();
    register(h, "111", "Ada");

    expect(await h.summary.handleMessage(SUMMARY_MESSAGE)).toBe(true);
    expect(await h.summary.handleMessage(SUMMARY_MESSAGE)).toBe(false);
    expect(h.store.data.players["111"]?.total).toBe(10);
  });

  it("never lets an older summary overwrite a newer streak", async () => {
    h = await harness();
    register(h, "111", "Ada");

    const newer = { ...SUMMARY_MESSAGE, createdAt: new Date("2026-11-17T11:55:00Z") };
    const older = { ...SUMMARY_MESSAGE, id: "sum-0", createdAt: new Date("2026-11-16T11:55:00Z") };

    await h.summary.handleMessage(newer);
    await h.summary.handleMessage(older);

    expect(h.store.config.streakSeed).toEqual({ day: "2026-11-16", count: 12 });
  });

  it("takes the highest reported streak as the baseline", async () => {
    h = await harness();
    register(h, "111", "Ada");
    const lower = {
      ...SUMMARY_MESSAGE,
      id: "sum-low",
      channelId: "chan-a",
      content: SUMMARY.replace("12 day", "5 day"),
    };

    await h.summary.handleMessage(SUMMARY_MESSAGE);
    await h.summary.handleMessage(lower);

    expect(h.store.config.streakSeed).toEqual({ day: "2026-11-15", count: 12 });
  });

  it("locks the baseline after a scan and ignores later numbers", async () => {
    h = await harness();
    register(h, "111", "Ada");
    h.summarySource.messagesByChannel.set("chan-wordle", [SUMMARY_MESSAGE]);

    await h.summary.poll();

    expect(h.store.config.streakSeed).toEqual({ day: "2026-11-15", count: 12 });
    expect(h.store.config.streakFrozen).toBe(true);

    const higher = { ...SUMMARY_MESSAGE, id: "sum-higher", content: SUMMARY.replace("12 day", "99 day") };
    await h.summary.handleMessage(higher);

    expect(h.store.config.streakSeed).toEqual({ day: "2026-11-15", count: 12 });
  });

  it("corrects a group summary that disagrees with the server streak", async () => {
    h = await harness();
    register(h, "111", "Ada");
    h.store.config.streakFrozen = true;
    h.store.config.streakSeed = { day: "2026-11-14", count: 12 };

    await h.summary.handleMessage(SUMMARY_MESSAGE);

    const correction = h.notifier.messages.find((message) => message.content.includes("Um, actually"));
    expect(correction?.channelId).toBe("chan-wordle");
    expect(correction?.content).toContain("**13**");
    expect(correction?.content).toContain("🤓☝️");
    expect(correction?.content).not.toContain("server-wide");
    expect(correction?.content).not.toContain("summary says");
  });

  it("stays quiet when the group number matches the server streak", async () => {
    h = await harness();
    register(h, "111", "Ada");
    h.store.config.streakFrozen = true;
    h.store.config.streakSeed = { day: "2026-11-15", count: 12 };

    await h.summary.handleMessage(SUMMARY_MESSAGE);

    expect(h.notifier.messages.some((message) => message.content.includes("Um, actually"))).toBe(false);
  });

  it("pings unregistered players who finished", async () => {
    h = await harness({ nicknames: { "222": "Bob" } });
    register(h, "111", "Ada");

    await h.summary.handleMessage(SUMMARY_MESSAGE);

    const ping = h.notifier.messages.find((message) => message.button?.customId === "wordle-register");
    expect(ping?.content).toContain("<@222>");
    expect(ping?.content).toContain("<@333>");
    expect(ping?.content).toContain("/wordle-register");
    expect(ping?.button).toEqual({ label: "Register", customId: "wordle-register" });
  });

  it("compares results across channels on the same day", async () => {
    h = await harness();
    register(h, "111", "Ada");
    register(h, "222", "Bob");

    const summary = (id: string, channelId: string, scoreLine: string) => ({
      id,
      channelId,
      authorIsBot: true,
      createdAt: new Date("2026-11-16T11:55:00Z"),
      content: `**Your group is on a 12 day streak!** Here are yesterday's results:\n${scoreLine}`,
    });

    // Ada solves in channel A first and takes the prize.
    await h.summary.handleMessage(summary("sum-a", "chan-a", "3/6: <@111>"));
    expect(h.store.data.players["111"]?.total).toBe(10);

    // Bob beats her from channel B; the day is re-scored.
    await h.summary.handleMessage(summary("sum-b", "chan-b", "2/6: <@222>"));

    expect(h.store.data.days["2026-11-15"]?.points).toEqual({ "222": 10 });
    expect(h.store.data.players["111"]?.total).toBe(0);
    expect(h.store.data.players["222"]?.total).toBe(10);

    const roleOf = (userId: string) => h?.members.roles.get(h.store.data.players[userId]?.roleId ?? "");
    expect(roleOf("222")?.name).toBe("10 points");
    expect(roleOf("111")?.name).toBe("0 points");
  });

  it("ignores summaries from before the bot was set up", async () => {
    h = await harness();
    register(h, "111", "Ada");
    h.store.config.startedOn = "2026-11-16";

    const applied = await h.summary.handleMessage(SUMMARY_MESSAGE);

    expect(applied).toBe(true);
    expect(h.store.data.players["111"]?.total).toBe(0);
    expect(h.store.data.days["2026-11-15"]).toBeUndefined();
    expect(h.store.config.ignoredSummaryIds).toContain("sum-1");
    expect(h.store.config.streakSeed).toEqual({ day: "2026-11-15", count: 12 });

    // A rescan recognises it and stays quiet.
    expect(await h.summary.handleMessage(SUMMARY_MESSAGE)).toBe(false);
  });

  it("skips unregistered players", async () => {
    h = await harness();
    register(h, "111", "Ada");

    await h.summary.handleMessage(SUMMARY_MESSAGE);

    expect(h.store.data.days["2026-11-15"]?.entries["333"]).toBeUndefined();
    expect(h.store.data.players["333"]).toBeUndefined();
  });

  it("polls history and applies a summary once", async () => {
    h = await harness();
    register(h, "111", "Ada");
    h.summarySource.messagesByChannel.set("chan-wordle", [SUMMARY_MESSAGE]);

    expect(await h.summary.poll()).toBeCloseTo(1);
    expect(await h.summary.poll()).toBe(0);
    expect(h.store.data.players["111"]?.total).toBe(10);
  });
});
