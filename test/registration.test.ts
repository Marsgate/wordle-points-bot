import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerOnPlay } from "../src/services/registration.js";
import { JsonStore } from "../src/store.js";
import { harness, silentLogger, TZ, type Harness } from "./helpers.js";

let h: Harness | undefined;

afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe("registerOnPlay", () => {
  it("puts the player and its role on disk before returning", async () => {
    h = await harness({ players: [] });

    await registerOnPlay(
      { store: h.store, display: h.display, logger: silentLogger },
      { userId: "user-9", displayName: "Nine" },
    );

    // A second store on the same file is the disk's answer, not the cache's.
    const reopened = await JsonStore.open(join(h.dir, "store.json"), TZ);
    expect(reopened.data.players["user-9"]?.total).toBe(0);
    expect(reopened.data.players["user-9"]?.roleId).toBe("role-1");
  });

  it("still records the player when the role cannot be created", async () => {
    h = await harness({ players: [] });
    h.members.port.syncRole = async () => {
      throw new Error("Missing Permissions");
    };

    await registerOnPlay(
      { store: h.store, display: h.display, logger: silentLogger },
      { userId: "user-9", displayName: "Nine" },
    );

    const reopened = await JsonStore.open(join(h.dir, "store.json"), TZ);
    expect(reopened.data.players["user-9"]?.total).toBe(0);
    expect(reopened.data.players["user-9"]?.roleId).toBeNull();
  });
});
