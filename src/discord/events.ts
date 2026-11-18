import {
  ActionRowBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
} from "discord.js";
import type { SummaryService } from "../services/summary.js";
import type { Logger } from "../services/ports.js";
import { registerMember } from "../services/registration.js";
import { handleInteraction } from "./commands.js";
import type { CommandDeps } from "../commands/handlers.js";

const REGISTER_BUTTON = "wordle-register";
const REGISTER_MODAL = "wordle-register-modal";

async function showRegisterModal(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(REGISTER_MODAL)
    .setTitle("Register for Wordle points")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("points")
          .setLabel("Your current point total (0 if you are new)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
          .setPlaceholder("0"),
      ),
    );

  await interaction.showModal(modal);
}

async function submitRegisterModal(
  interaction: ModalSubmitInteraction,
  deps: CommandDeps,
): Promise<void> {
  const raw = interaction.fields.getTextInputValue("points").trim().replace(",", ".");
  const points = Number.parseFloat(raw);

  const content = await registerMember(
    { store: deps.store, display: deps.display },
    {
      userId: interaction.user.id,
      userName: interaction.user.username,
      points: Number.isFinite(points) ? points : null,
    },
  );

  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

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
      return;
    }

    if (interaction.isButton() && interaction.customId === REGISTER_BUTTON) {
      void showRegisterModal(interaction).catch((error: unknown) =>
        deps.logger.warn("Could not open the registration form", error),
      );
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === REGISTER_MODAL) {
      void submitRegisterModal(interaction, deps.commands).catch(async (error: unknown) => {
        deps.logger.warn("Registration form failed", error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction
            .reply({ content: "Something went wrong. Try `/wordle-register`.", flags: MessageFlags.Ephemeral })
            .catch(() => {});
        }
      });
    }
  });
}
