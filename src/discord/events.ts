import { Events, type Client } from "discord.js";
import type { ResultsService } from "../services/results.js";
import type { Logger } from "../services/ports.js";
import { handleInteraction } from "./commands.js";
import type { CommandDeps } from "../commands/handlers.js";

export function attachEvents(
  client: Client,
  deps: {
    results: ResultsService;
    commands: CommandDeps;
    logger: Logger;
  },
): void {
  // One registration nudge per member per bot run.
  const nudged = new Set<string>();

  client.on(Events.MessageCreate, (message) => {
    // Fire-and-forget: a slow Discord call must not block the gateway.
    void (async () => {
      try {
        const outcome = await deps.results.handle({
          id: message.id,
          guildId: message.guildId,
          channelId: message.channelId,
          authorId: message.author.id,
          authorName: message.author.username,
          authorIsBot: message.author.bot,
          content: message.content,
          createdAt: message.createdAt,
        });

        if (outcome.kind === "recorded") {
          deps.logger.info(
            `Share from <@${message.author.id}>: ${outcome.guesses}/6 on ${outcome.day}` +
              (outcome.spoilerGranted ? " (spoiler access granted)" : ""),
          );
          return;
        }

        if (outcome.reason === "unregistered" && !nudged.has(message.author.id)) {
          nudged.add(message.author.id);
          await message
            .reply({
              content:
                `You are not registered for Wordle points yet, <@${message.author.id}>. ` +
                "Run `/wordle-register` with your current total to join.",
              allowedMentions: { repliedUser: false },
            })
            .catch((error: unknown) => deps.logger.warn("Could not send the registration nudge", error));
        }
      } catch (error) {
        deps.logger.error("Failed to process message", error);
      }
    })();
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    void handleInteraction(interaction, deps.commands, deps.logger);
  });
}
