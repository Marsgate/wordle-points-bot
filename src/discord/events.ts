import { Events, type Client } from "discord.js";
import type { SummaryService } from "../services/summary.js";
import type { Logger } from "../services/ports.js";
import { handleInteraction } from "./commands.js";
import type { CommandDeps } from "../commands/handlers.js";

export function attachEvents(
  client: Client,
  deps: {
    summary: SummaryService;
    commands: CommandDeps;
    logger: Logger;
  },
): void {
  client.on(Events.MessageCreate, (message) => {
    if (!message.author.bot) return; // only the Activity's summaries are read

    // Fire-and-forget: a slow Discord call must not block the gateway.
    void (async () => {
      try {
        const applied = await deps.summary.handleMessage({
          id: message.id,
          content: message.content,
          authorIsBot: true,
          createdAt: message.createdAt,
          channelId: message.channelId,
        });
        if (applied) deps.logger.info(`Applied a Wordle summary in channel ${message.channelId}`);
      } catch (error) {
        deps.logger.error("Failed to process message", error);
      }
    })();
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand()) {
      void handleInteraction(interaction, deps.commands, deps.logger);
    }
  });
}
