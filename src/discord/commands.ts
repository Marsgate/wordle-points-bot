import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
} from "discord.js";
import { runCommand, type CommandContext, type CommandDeps, type CommandOptions } from "../commands/handlers.js";
import type { Logger } from "../services/ports.js";

const builder = (name: string, description: string): SlashCommandBuilder =>
  new SlashCommandBuilder().setName(name).setDescription(description);

export function commandDefinitions(includeDebug = false) {
  const base = [
    builder("wordle-register", "Join the points game and enter your current total").addNumberOption((option) =>
      option
        .setName("points")
        .setDescription("Your current Wordle points — use 0 if you are starting fresh")
        .setRequired(true),
    ),

    builder("wordle-leaderboard", "Show overall point totals (or today's ranking)").addStringOption((option) =>
      option
        .setName("scope")
        .setDescription("Overall totals by default")
        .addChoices({ name: "All-time", value: "all" }, { name: "Today", value: "today" }),
    ),

    builder("wordle-award", "Manually add or remove Wordle points")
      .addUserOption((option) => option.setName("user").setDescription("Member to adjust").setRequired(true))
      .addNumberOption((option) =>
        option.setName("points").setDescription("Points to add (negative removes, halves allowed)").setRequired(true),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    builder("wordle-streak", "Show the server's Wordle streak; admins can seed it").addNumberOption((option) =>
      option
        .setName("count")
        .setDescription("Admin: set the current streak in days (0 clears it)"),
    ),

    builder("wordle-unregister", "Leave the game and drop your points role").addUserOption((option) =>
      option.setName("user").setDescription("Member to unregister (admins only; defaults to you)"),
    ),
  ];

  const debug = [
    builder("wordle-close", "Close today's results now and award points (later results will not count)")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    builder("wordle-reopen", "Undo today's close: take the points back and let later results count")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ];

  return [...base, ...(includeDebug ? debug : [])].map((command) => command.toJSON());
}

/** Register the command set in one guild. Used at startup and on join. */
export async function registerGuildCommands(
  guild: Guild,
  logger: Logger,
  includeDebug = false,
): Promise<void> {
  const registered = await guild.commands.set(commandDefinitions(includeDebug));
  const names = [...registered.values()].map((command) => command.name).join(", ");
  logger.info(`Registered ${registered.size} slash commands in guild ${guild.name}: ${names}`);
}

/** Global commands take up to an hour to appear; a guild id makes them instant. */
export async function registerCommands(
  client: Client,
  guildId: string | null,
  logger: Logger,
  includeDebug = false,
): Promise<void> {
  const application = client.application;
  if (!application) throw new Error("Discord client is not ready; cannot register commands");

  if (guildId) {
    const guild = await client.guilds.fetch(guildId);
    await registerGuildCommands(guild, logger, includeDebug);
    return;
  }

  const registered = await application.commands.set(commandDefinitions(includeDebug));
  logger.info(
    `Registered ${registered.size} global slash commands (may take up to an hour to appear): ` +
      [...registered.values()].map((command) => command.name).join(", "),
  );
}

function readOptions(interaction: ChatInputCommandInteraction): CommandOptions {
  return {
    getString: (name) => interaction.options.getString(name),
    getNumber: (name) => interaction.options.getNumber(name),
    getUser: (name) => {
      const user = interaction.options.getUser(name);
      return user ? { id: user.id, name: user.username } : null;
    },
  };
}

export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
  deps: CommandDeps,
  logger: Logger,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Use this bot inside a server.",
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const context: CommandContext = {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    userName: interaction.user.username,
    isAdmin: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
    options: readOptions(interaction),
    now: deps.now(),
  };

  try {
    const reply = await runCommand(interaction.commandName, context, deps);
    const payload = {
      content: reply.content,
      allowedMentions: { parse: [] as const },
      ...(reply.ephemeral ? { flags: MessageFlags.Ephemeral as const } : {}),
    };

    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (error) {
    logger.error(`Command /${interaction.commandName} failed`, error);
    const payload = {
      content: "Something went wrong. Check the bot logs.",
      allowedMentions: { parse: [] as const },
      flags: MessageFlags.Ephemeral as const,
    };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  }
}
