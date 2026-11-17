import { afterEach, describe, expect, it } from "vitest";
import { harness, incomingMessage, shareFor, type Harness } from "./helpers.js";

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
  if (!test.store.data.players[userId]?.registered) {
    test.store.player(userId, userId).registered = true;
  }
  await test.results.handle(
    incomingMessage({
      id: `msg-${userId}-${at}`,
      authorId: userId,
      authorName: userId,
      content: shareFor(guesses, solved),
      createdAt: new Date(at),
    }),
  );
}

function roleNamed(test: Harness, name: string) {
  return [...test.members.roles.values()].find((role) => role.name === name);
}

describe("two days end to end", () => {
  it("scores, syncs roles, unlocks and relocks the spoiler channel", async () => {
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

    expect(h.spoilers.members.size).toBe(4);
    expect(h.store.data.players["u-ada"]?.total).toBe(0);
    expect(h.members.roles.size).toBe(0);

    const firstMidnight = await h.daily.rollover(new Date("2026-11-17T05:00:30Z"));
    expect(firstMidnight.finalized).toEqual(["2026-11-16"]);
    expect(firstMidnight.spoilerMembersRevoked).toBe(4);

    expect(h.store.data.players["u-ada"]?.total).toBe(3.5);
    expect(h.store.data.players["u-margaret"]?.total).toBe(0);

    const roleOf = (userId: string) => h?.members.roles.get(h.store.data.players[userId]?.roleId ?? "");

    expect(roleOf("u-ada")?.name).toBe("3.5");
    expect(roleOf("u-ada")?.members.has("u-ada")).toBe(true);
    expect(roleOf("u-grace")?.name).toBe("3.5");
    expect(roleOf("u-grace")?.members.has("u-grace")).toBe(true);
    expect(roleOf("u-linus")?.name).toBe("3.5");
    expect(roleOf("u-linus")?.members.has("u-linus")).toBe(true);
    expect(h.store.data.players["u-margaret"]?.roleId ?? null).toBeNull();
    expect(h.members.roles.size).toBe(3);

    // Nicknames are no longer rewritten.
    expect(h.members.nicknames.get("u-ada")).toBe("𝓐𝓭𝓪 ✦");
    expect(h.spoilers.members.size).toBe(0);

    // --- Day 2: Ada wins outright -----------------------------------------
    await post(h, "u-ada", 2, true, "2026-11-17T13:00:00Z");
    await post(h, "u-grace", 5, true, "2026-11-17T13:05:00Z");

    const secondMidnight = await h.daily.rollover(new Date("2026-11-18T05:00:30Z"));
    expect(secondMidnight.finalized).toEqual(["2026-11-17"]);

    expect(h.store.data.players["u-ada"]?.total).toBe(13.5);
    expect(h.store.data.players["u-grace"]?.total).toBe(3.5);

    // The same role is renamed, not duplicated.
    expect(h.members.roles.size).toBe(3);
    expect(roleOf("u-ada")?.name).toBe("13.5");
    expect(roleOf("u-ada")?.members.has("u-ada")).toBe(true);
    expect(h.members.calls.renamed).toBe(1);
  });

  it("ignores an unregistered member but keeps their name untouched", async () => {
    h = await harness({ nicknames: { "u-new": "Newcomer (-10 points)" } });
    const outcome = await h.results.handle(
      incomingMessage({
        id: "msg-new",
        authorId: "u-new",
        authorName: "newcomer",
        content: shareFor(3),
        createdAt: new Date("2026-11-16T14:00:00Z"),
      }),
    );

    expect(outcome).toMatchObject({ kind: "ignored", reason: "unregistered" });
    expect(h.store.data.days["2026-11-16"]).toBeUndefined();
    expect(h.members.nicknames.get("u-new")).toBe("Newcomer (-10 points)");
    expect(h.members.roles.size).toBe(0);
  });
});
