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
import type { ResultsService } from "../services/results.js";
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
    results: ResultsService;
    summary: SummaryService;
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
        if (message.author.bot) {
          // The Wordle Activity's daily summary arrives as a bot message.
          const applied = await deps.summary.handleMessage({
            id: message.id,
            content: message.content,
            authorIsBot: true,
            createdAt: message.createdAt,
            channelId: message.channelId,
          });
          if (applied) deps.logger.info(`Applied a Wordle summary in channel ${message.channelId}`);
          return;
        }

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
                "Run `/wordle-register points:<your total>` (use `0` if you are new) to join.",
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
