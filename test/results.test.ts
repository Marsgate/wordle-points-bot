import { afterEach, describe, expect, it } from "vitest";
import { harness, incomingMessage, OTHER_CHANNEL, shareFor, type Harness } from "./helpers.js";

let h: Harness | undefined;

afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe("ResultsService", () => {
  it("records a valid share from the configured channel", async () => {
    h = await harness();
    const outcome = await h.results.handle(incomingMessage({ content: shareFor(3) }));

    expect(outcome).toMatchObject({
      kind: "recorded",
      day: "2026-11-16",
      guesses: 3,
      solved: true,
      improved: true,
      spoilerGranted: true,
    });
    expect(h.store.data.days["2026-11-16"]?.entries["user-1"]?.guesses).toBe(3);
    expect(h.store.data.players["user-1"]?.displayName).toBe("tester");
    expect(h.spoilers.members.has("user-1")).toBe(true);
  });

  it("files a late-night share under the local day, not UTC", async () => {
    h = await harness();
    // 2026-11-17T04:30Z is 23:30 on the 16th in Indianapolis.
    const outcome = await h.results.handle(
      incomingMessage({ content: shareFor(2), createdAt: new Date("2026-11-17T04:30:00Z") }),
    );
    expect(outcome.kind).toBe("recorded");
    if (outcome.kind === "recorded") expect(outcome.day).toBe("2026-11-16");
  });

  it("counts a share posted in any channel", async () => {
    h = await harness();
    const outcome = await h.results.handle(incomingMessage({ channelId: OTHER_CHANNEL, content: shareFor(3) }));

    expect(outcome).toMatchObject({ kind: "recorded", guesses: 3, improved: true, spoilerGranted: true });
    expect(h.store.data.days["2026-11-16"]?.entries["user-1"]?.guesses).toBe(3);
  });

  it("keeps the better of two shares the same day", async () => {
    h = await harness();
    await h.results.handle(incomingMessage({ content: shareFor(5), id: "m1" }));
    await h.results.handle(incomingMessage({ content: shareFor(3), id: "m2" }));
    const worse = await h.results.handle(incomingMessage({ content: shareFor(4), id: "m3" }));

    expect(worse).toMatchObject({ kind: "recorded", improved: false });
    expect(h.store.data.days["2026-11-16"]?.entries["user-1"]?.guesses).toBe(3);
  });

  it("does not let an X/6 overwrite a solved result", async () => {
    h = await harness();
    await h.results.handle(incomingMessage({ content: shareFor(4), id: "m1" }));
    await h.results.handle(incomingMessage({ content: shareFor(6, false), id: "m2" }));

    const entry = h.store.data.days["2026-11-16"]?.entries["user-1"];
    expect(entry?.guesses).toBe(4);
    expect(entry?.solved).toBe(true);
  });

  it("unlocks spoilers for an X/6 too — the puzzle is finished either way", async () => {
    h = await harness();
    const outcome = await h.results.handle(incomingMessage({ content: shareFor(6, false) }));

    expect(outcome).toMatchObject({ kind: "recorded", solved: false, spoilerGranted: true });
    expect(h.spoilers.members.has("user-1")).toBe(true);
  });

  it("works without a spoiler channel configured", async () => {
    h = await harness({ withSpoilers: false });
    const outcome = await h.results.handle(incomingMessage({ content: shareFor(3) }));

    expect(outcome).toMatchObject({ kind: "recorded", spoilerGranted: false });
    expect(h.spoilers.calls.grants).toHaveLength(0);
  });

  it("still records when granting spoiler access fails", async () => {
    h = await harness();
    h.spoilers.port.grant = async () => {
      throw new Error("Missing Access");
    };

    const outcome = await h.results.handle(incomingMessage({ content: shareFor(3) }));
    expect(outcome).toMatchObject({ kind: "recorded", spoilerGranted: false });
    expect(h.store.data.days["2026-11-16"]?.entries["user-1"]).toBeDefined();
  });

  it("ignores shares from unregistered members", async () => {
    h = await harness();
    const outcome = await h.results.handle(
      incomingMessage({ authorId: "user-9", authorName: "nine", content: shareFor(3) }),
    );

    expect(outcome).toMatchObject({ kind: "ignored", reason: "unregistered" });
    expect(h.store.data.days["2026-11-16"]).toBeUndefined();
    expect(h.spoilers.calls.grants).toHaveLength(0);
  });

  it("ignores bots, non-shares, DMs and other guilds, but scores before setup", async () => {
    h = await harness();

    expect(await h.results.handle(incomingMessage({ authorIsBot: true }))).toMatchObject({ reason: "bot" });
    expect(await h.results.handle(incomingMessage({ content: "morning all" }))).toMatchObject({ reason: "no-share" });
    expect(await h.results.handle(incomingMessage({ guildId: null }))).toMatchObject({ reason: "no-guild" });
    expect(await h.results.handle(incomingMessage({ guildId: "guild-2" }))).toMatchObject({ reason: "other-guild" });

    await h.cleanup();
    h = await harness({ configure: false });
    expect(await h.results.handle(incomingMessage({ content: shareFor(3) }))).toMatchObject({
      kind: "recorded",
      spoilerGranted: false,
    });
  });
});
