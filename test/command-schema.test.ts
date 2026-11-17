import { describe, expect, it } from "vitest";
import { commandDefinitions } from "../src/discord/commands.js";

/** The JSON body Discord's API accepts, narrowed just enough to assert on. */
interface JsonOption {
  name: string;
  description: string;
  type: number;
  required?: boolean;
  choices?: Array<{ name: string; value: string }>;
}
interface JsonCommand {
  name: string;
  description: string;
  type?: number;
  options?: JsonOption[];
}

const definitions = commandDefinitions as unknown as JsonCommand[];

describe("slash command definitions", () => {
  it("are unique, valid chat-input commands", () => {
    const names = definitions.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(11);

    for (const command of definitions) {
      expect(command.name).toMatch(/^[a-z0-9-]{1,32}$/u);
      expect(command.type).toBe(1); // CHAT_INPUT
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.description.length).toBeLessThanOrEqual(100);
    }
  });

  it("use unique, valid option names and descriptions", () => {
    for (const command of definitions) {
      const optionNames = (command.options ?? []).map((option) => option.name);
      expect(new Set(optionNames).size).toBe(optionNames.length);
      for (const option of command.options ?? []) {
        expect(option.name).toMatch(/^[a-z0-9-_]{1,32}$/u);
        expect(option.description.length).toBeGreaterThan(0);
        expect(option.description.length).toBeLessThanOrEqual(100);
      }
    }
  });

  it("requires only the spoiler channel and offers today/all scopes", () => {
    const setup = definitions.find((command) => command.name === "wordle-setup");
    const spoilers = setup?.options?.find((option) => option.name === "spoilers");
    expect(spoilers?.type).toBe(7); // CHANNEL
    expect(spoilers?.required).toBe(true);
    expect(setup?.options).toHaveLength(1);

    const leaderboard = definitions.find((command) => command.name === "wordle-leaderboard");
    const scope = leaderboard?.options?.find((option) => option.name === "scope");
    expect(scope?.choices?.map((choice) => choice.value)).toEqual(["today", "all"]);
  });
});
