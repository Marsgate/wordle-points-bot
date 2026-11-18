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
  solved: boolean,
  at: string,
): Promise<void> {
  recordResult(test, userId, guesses, solved, at);
}

describe("two days end to end", () => {
  it("scores and syncs roles across two days", async () => {
    h = await harness({
      nicknames: {
        "u-ada": "𝓐𝓭𝓪 ✦",
        "u-grace": "grace",
        "u-linus": "Linus 🐧",
        "u-margaret": "Margaret Hamilton",
      },
    });

    // --- Day 1: three-way tie at 3/6, one failure -------------------------
    await post(h, "u-ada", 3, true, "2026-11-16T14:00:00Z");
    await post(h, "u-grace", 3, true, "2026-11-16T14:10:00Z");
    await post(h, "u-linus", 3, true, "2026-11-16T14:20:00Z");
    await post(h, "u-margaret", 6, false, "2026-11-16T15:00:00Z");
    expect(h.store.data.players["u-ada"]?.total).toBe(0);
    expect(h.members.roles.size).toBe(0);

    const firstMidnight = await h.daily.rollover(new Date("2026-11-17T05:00:30Z"));
    expect(firstMidnight.finalized).toEqual(["2026-11-16"]);

    expect(h.store.data.players["u-ada"]?.total).toBe(3.5);
    expect(h.store.data.players["u-margaret"]?.total).toBe(0);

    const roleOf = (userId: string) => h?.members.roles.get(h.store.data.players[userId]?.roleId ?? "");

    expect(roleOf("u-ada")?.name).toBe("3.5 points");
    expect(roleOf("u-ada")?.members.has("u-ada")).toBe(true);
    expect(roleOf("u-grace")?.name).toBe("3.5 points");
    expect(roleOf("u-grace")?.members.has("u-grace")).toBe(true);
    expect(roleOf("u-linus")?.name).toBe("3.5 points");
    expect(roleOf("u-linus")?.members.has("u-linus")).toBe(true);
    expect(h.store.data.players["u-margaret"]?.roleId ?? null).toBeNull();
    expect(h.members.roles.size).toBe(3);

    // Nicknames are no longer rewritten.
    expect(h.members.nicknames.get("u-ada")).toBe("𝓐𝓭𝓪 ✦");

    // --- Day 2: Ada wins outright -----------------------------------------
    await post(h, "u-ada", 2, true, "2026-11-17T13:00:00Z");
    await post(h, "u-grace", 5, true, "2026-11-17T13:05:00Z");

    const secondMidnight = await h.daily.rollover(new Date("2026-11-18T05:00:30Z"));
    expect(secondMidnight.finalized).toEqual(["2026-11-17"]);

    expect(h.store.data.players["u-ada"]?.total).toBe(13.5);
    expect(h.store.data.players["u-grace"]?.total).toBe(3.5);

    // The same role is renamed, not duplicated.
    expect(h.members.roles.size).toBe(3);
    expect(roleOf("u-ada")?.name).toBe("13.5 points");
    expect(roleOf("u-ada")?.members.has("u-ada")).toBe(true);
    expect(h.members.calls.renamed).toBe(1);
  });
});
