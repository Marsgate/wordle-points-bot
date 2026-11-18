import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonStore } from "../src/store.js";

const TZ = "America/Indianapolis";

describe("JsonStore", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wordle-store-"));
    file = join(dir, "store.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts from defaults when the file is missing", async () => {
    const store = await JsonStore.open(file, TZ);
    expect(store.config.timeZone).toBe(TZ);
    expect(store.config.streakSeed).toBeNull();
    expect(store.data.players).toEqual({});
    expect(store.data.days).toEqual({});
  });

  it("persists across reopen", async () => {
    const store = await JsonStore.open(file, TZ);
    store.config.streakSeed = { day: "2026-11-15", count: 12 };
    store.player("user-1", "tester").total = 7.5;
    store.day("2026-11-16").entries["user-1"] = {
      userId: "user-1",
      guesses: 3,
      solved: true,
      puzzleNumber: 1512,
      messageId: "m1",
      recordedAt: "2026-11-16T14:00:00.000Z",
    };
    await store.save();

    const reopened = await JsonStore.open(file, TZ);
    expect(reopened.config.streakSeed).toEqual({ day: "2026-11-15", count: 12 });
    expect(reopened.data.players["user-1"]?.total).toBe(7.5);
    expect(reopened.data.days["2026-11-16"]?.entries["user-1"]?.guesses).toBe(3);
  });

  it("creates day and player records lazily and idempotently", async () => {
    const store = await JsonStore.open(file, TZ);
    const first = store.day("2026-11-16");
    const second = store.day("2026-11-16");
    expect(first).toBe(second);
    expect(first.finalized).toBe(false);

    const player = store.player("user-9", "nine");
    expect(player.total).toBe(0);
    expect(store.player("user-9").displayName).toBe("nine");
  });

  it("lists only unfinalized days before today", async () => {
    const store = await JsonStore.open(file, TZ);
    store.day("2026-11-14");
    store.day("2026-11-15").finalized = true;
    store.day("2026-11-16");
    store.day("2026-11-17");

    expect(store.openDaysBefore("2026-11-17")).toEqual(["2026-11-14", "2026-11-16"]);
  });

  it("backs up a corrupt file instead of silently discarding it", async () => {
    await writeFile(file, "{not json", "utf8");
    const warnings: string[] = [];
    const store = await JsonStore.open(file, TZ, (message) => warnings.push(message));

    expect(store.config.timeZone).toBe(TZ);
    expect(warnings).toHaveLength(1);
    const files = (await import("node:fs/promises")).readdir(dir);
    expect((await files).some((name) => name.includes(".corrupt-"))).toBe(true);
  });

  it("writes valid JSON even when saves are fired concurrently", async () => {
    const store = await JsonStore.open(file, TZ);
    store.player("a").total = 1;
    const first = store.save();
    store.player("b").total = 2;
    const second = store.save();
    await Promise.all([first, second]);

    const text = await readFile(file, "utf8");
    const parsed = JSON.parse(text) as { players: Record<string, { total: number }> };
    expect(parsed.players["a"]?.total).toBe(1);
    expect(parsed.players["b"]?.total).toBe(2);
  });
});
