import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
    expect(day?.entries["333"]).toMatchObject({ guesses: 6, solved: false });
    expect(day?.finalized).toBe(true);
    expect(day?.points).toEqual({ "111": 10 });
    expect(h.store.data.players["111"]?.total).toBe(10);
    expect(h.store.data.players["222"]?.total).toBe(0);
    expect([...h.members.roles.values()][0]?.name).toBe("10 points");
  });

  it("splits a tie with an unregistered player but only pays the registered one", async () => {
    h = await harness();
    register(h, "111", "Ada");

    const tied = {
      ...SUMMARY_MESSAGE,
      content:
        "**Your group is on a 12 day streak!** Here are yesterday's results:\n3/6: <@111> <@333>",
    };
    await h.summary.handleMessage(tied);

    const day = h.store.data.days["2026-11-15"];
    expect(day?.entries["333"]).toMatchObject({ guesses: 3, solved: true });
    expect(day?.points).toEqual({ "111": 5 });
    expect(h.store.data.players["111"]?.total).toBe(5);
    expect(h.store.data.players["333"]).toBeUndefined();
  });

  it("awards nothing when only unregistered players solved", async () => {
    h = await harness();
    register(h, "111", "Ada");

    const ghostsOnly = {
      ...SUMMARY_MESSAGE,
      content: "**Your group is on a 12 day streak!** Here are yesterday's results:\n2/6: <@333>",
    };
    await h.summary.handleMessage(ghostsOnly);

    expect(h.store.data.days["2026-11-15"]?.points).toEqual({});
    expect(h.store.data.players["111"]?.total).toBe(0);
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

  it("applies each channel's summary once for the same day", async () => {
    h = await harness();
    register(h, "111", "Ada");

    const fromA = { ...SUMMARY_MESSAGE, id: "sum-a", channelId: "chan-a" };
    const fromB = { ...SUMMARY_MESSAGE, id: "sum-b", channelId: "chan-b" };

    expect(await h.summary.handleMessage(fromA)).toBe(true);
    expect(await h.summary.handleMessage(fromB)).toBe(true);
    expect(await h.summary.handleMessage(fromA)).toBe(false);
    expect(await h.summary.handleMessage(fromB)).toBe(false);

    expect(h.store.data.players["111"]?.total).toBe(10);
    expect(h.store.data.days["2026-11-15"]?.summaryMessageIds).toEqual(
      expect.arrayContaining(["sum-a", "sum-b"]),
    );
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

  it("posts the streak correction once when two channels report the same day", async () => {
    h = await harness();
    register(h, "111", "Ada");
    h.store.config.streakFrozen = true;
    h.store.config.streakSeed = { day: "2026-11-14", count: 12 };

    const fromA = { ...SUMMARY_MESSAGE, id: "sum-a", channelId: "chan-a" };
    const fromB = { ...SUMMARY_MESSAGE, id: "sum-b", channelId: "chan-b" };

    await h.summary.handleMessage(fromA);
    await h.summary.handleMessage(fromB);

    const corrections = h.notifier.messages.filter((message) => message.content.includes("Um, actually"));
    expect(corrections).toHaveLength(1);
    expect(h.store.data.days["2026-11-15"]?.streakCorrectionSent).toBe(true);
  });

  it("posts notices in the configured Wordle channel", async () => {
    h = await harness({ noticeChannelId: "chan-home" });
    register(h, "111", "Ada");
    h.store.config.streakFrozen = true;
    h.store.config.streakSeed = { day: "2026-11-14", count: 12 };

    await h.summary.handleMessage({ ...SUMMARY_MESSAGE, channelId: "chan-elsewhere" });

    const correction = h.notifier.messages.find((message) => message.content.includes("Um, actually"));
    expect(correction?.channelId).toBe("chan-home");

    const ping = h.notifier.messages.find((message) => message.button?.customId === "wordle-register");
    expect(ping?.channelId).toBe("chan-home");
  });

  it("does not repeat notices after a restart", async () => {
    h = await harness({ nicknames: { "222": "Bob" } });
    register(h, "111", "Ada");
    h.store.config.streakFrozen = true;
    h.store.config.streakSeed = { day: "2026-11-14", count: 12 };

    const fromA = { ...SUMMARY_MESSAGE, id: "sum-a", channelId: "chan-a" };
    const fromB = { ...SUMMARY_MESSAGE, id: "sum-b", channelId: "chan-b" };

    await h.summary.handleMessage(fromA);
    await h.summary.handleMessage(fromB);
    expect(h.notifier.messages.length).toBeGreaterThan(0);

    // A restart reopens the store and rescans the same history.
    const restarted = await harness({ dir: h.dir, nicknames: { "222": "Bob" } });
    restarted.summarySource.messagesByChannel.set("chan-a", [fromA]);
    restarted.summarySource.messagesByChannel.set("chan-b", [fromB]);

    expect(await restarted.summary.handleMessage(fromA)).toBe(false);
    expect(await restarted.summary.poll()).toBe(0);
    expect(restarted.notifier.messages).toHaveLength(0);
  });

  it("records a notice before posting it", async () => {
    h = await harness();
    register(h, "111", "Ada");
    h.store.config.streakFrozen = true;
    h.store.config.streakSeed = { day: "2026-11-14", count: 12 };
    const test = h;

    // The flag must already be on disk when the send starts, so a crash can
    // lose a notice but never post one twice.
    let recordedBeforeSend: boolean | undefined;
    test.notifier.port.send = async () => {
      const raw = JSON.parse(await readFile(join(test.dir, "store.json"), "utf8"));
      recordedBeforeSend = raw.days["2026-11-15"]?.streakCorrectionSent;
    };

    await test.summary.handleMessage(SUMMARY_MESSAGE);

    expect(recordedBeforeSend).toBe(true);
  });

  it("stays quiet when a recorded summary id is lost", async () => {
    h = await harness();
    register(h, "111", "Ada");
    h.store.config.streakFrozen = true;
    h.store.config.streakSeed = { day: "2026-11-14", count: 12 };

    await h.summary.handleMessage(SUMMARY_MESSAGE);

    const day = h.store.data.days["2026-11-15"];
    if (!day) throw new Error("the summary day was not recorded");
    expect(day.streakCorrectionSent).toBe(true);

    // As if the id dedupe were lost with an old store: the notice itself must
    // still not be repeated.
    day.summaryMessageIds = [];
    delete day.summaryMessageId;

    await h.summary.handleMessage(SUMMARY_MESSAGE);

    const corrections = h.notifier.messages.filter((message) => message.content.includes("Um, actually"));
    expect(corrections).toHaveLength(1);
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

  it("prompts each unregistered player once per day", async () => {
    h = await harness();
    register(h, "111", "Ada");

    const fromA = {
      ...SUMMARY_MESSAGE,
      id: "sum-a",
      channelId: "chan-a",
      content: "**Your group is on a 12 day streak!** Here are yesterday's results:\n3/6: <@111> <@333>",
    };
    const fromB = {
      ...SUMMARY_MESSAGE,
      id: "sum-b",
      channelId: "chan-b",
      content: "**Your group is on a 12 day streak!** Here are yesterday's results:\n4/6: <@444>",
    };

    await h.summary.handleMessage(fromA);
    await h.summary.handleMessage(fromB);

    const pings = h.notifier.messages.filter((message) => message.button?.customId === "wordle-register");
    expect(pings).toHaveLength(2);
    expect(pings[0]?.content).toContain("<@333>");
    expect(pings[1]?.content).toContain("<@444>");
    expect(pings[1]?.content).not.toContain("<@333>");
    expect(h.store.data.days["2026-11-15"]?.registrationPrompted).toEqual(
      expect.arrayContaining(["333", "444"]),
    );
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

  it("keeps unregistered players out of the points", async () => {
    h = await harness();
    register(h, "111", "Ada");

    await h.summary.handleMessage(SUMMARY_MESSAGE);

    expect(h.store.data.days["2026-11-15"]?.entries["333"]).toMatchObject({ solved: false });
    expect(h.store.data.players["333"]).toBeUndefined();
    expect(h.store.data.days["2026-11-15"]?.points).toEqual({ "111": 10 });
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
