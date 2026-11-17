import { afterEach, describe, expect, it } from "vitest";
import { harness, shareFor, incomingMessage, type Harness } from "./helpers.js";

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
    expect([...h.members.roles.values()][0]?.name).toBe("Ada · 10 pts");
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

  it("keeps the better of a share and the summary", async () => {
    h = await harness({ nicknames: { "111": "Ada" } });
    register(h, "111", "Ada");
    // A 5/6 share for the same day, already closed.
    await h.results.handle(
      incomingMessage({
        id: "share-1",
        authorId: "111",
        authorName: "Ada",
        content: shareFor(5),
        createdAt: new Date("2026-11-15T14:00:00Z"),
      }),
    );
    await h.daily.finalizeDay("2026-11-15");
    expect(h.store.data.players["111"]?.total).toBe(10);

    // The summary says 3/6, which is better.
    await h.summary.handleMessage(SUMMARY_MESSAGE);

    expect(h.store.data.days["2026-11-15"]?.entries["111"]?.guesses).toBe(3);
    expect(h.store.data.players["111"]?.total).toBe(10);
    expect(h.store.data.days["2026-11-15"]?.points).toEqual({ "111": 10 });
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
    expect(h.store.config.summaryChannelIds).toContain("chan-wordle");
  });
});
