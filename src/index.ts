import "dotenv/config";
import { join } from "node:path";
import { Client, Events, GatewayIntentBits, PermissionFlagsBits } from "discord.js";
import { loadEnv } from "./config.js";
import { dayKey } from "./core/day.js";
import { consoleLogger as logger } from "./logger.js";
import { JsonStore } from "./store.js";
import { DailyService } from "./services/daily.js";
import { DisplayService } from "./services/display.js";
import { ResultsService } from "./services/results.js";
import { SummaryService } from "./services/summary.js";
import { DiscordMemberPort, DiscordSpoilerPort, DiscordSummarySource } from "./discord/adapters.js";
import { registerCommands, registerGuildCommands } from "./discord/commands.js";
import { attachEvents } from "./discord/events.js";

const TICK_MS = 30_000;
const SUMMARY_POLL_MS = 10 * 60_000;

const INVITE_PERMISSIONS =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.ManageRoles;

let timer: NodeJS.Timeout | null = null;
let summaryTimer: NodeJS.Timeout | null = null;

async function main(): Promise<void> {
  const env = loadEnv();

  const store = await JsonStore.open(
    join(env.dataDir, "wordle.json"),
    env.timeZone,
    (message) => logger.warn(message),
  );

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
  });

  client.on(Events.Error, (error) => logger.error("Discord client error", error));

  const memberPort = new DiscordMemberPort(client, () => store.config.guildId, logger);
  const display = new DisplayService({ port: memberPort, logger });
  const spoilers = new DiscordSpoilerPort(client, () => store.config.spoilerChannelId, logger);
  const daily = new DailyService({
    store,
    display,
    spoilers,
    logger,
    timeZone: () => store.config.timeZone,
    now: () => new Date(),
  });
  const results = new ResultsService({ store, spoilers, logger });
  const summary = new SummaryService({
    store,
    daily,
    members: memberPort,
    source: new DiscordSummarySource(client, () => store.config.guildId),
    logger,
    timeZone: () => store.config.timeZone,
  });

  attachEvents(client, {
    results,
    summary,
    logger,
    commands: { store, daily, display, spoilers, now: () => new Date() },
  });

  let ticking = false;
  const tick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    try {
      const report = await daily.rollover(new Date());
      if (report.finalized.length > 0) {
        logger.info(`Closed ${report.finalized.join(", ")} after a day boundary.`);
      }
    } catch (error) {
      logger.error("Daily rollover failed", error);
    } finally {
      ticking = false;
    }
  };

  client.once(Events.ClientReady, (ready) => {
    void (async () => {
      logger.info(`Logged in as ${ready.user.tag}`);

      if (!client.options.intents.has(GatewayIntentBits.MessageContent)) {
        logger.warn(
          "The Message Content intent is disabled, so shares cannot be read. Enable it in the Developer Portal → Bot.",
        );
      }

      // Results count in every channel, so the guild id is all the bot needs to
      // start scoring. Pick it up automatically for a single-server install.
      if (!store.config.guildId && ready.guilds.cache.size === 1) {
        const onlyGuild = ready.guilds.cache.first();
        if (onlyGuild) {
          store.config.guildId = onlyGuild.id;
          store.config.startedOn ??= dayKey(new Date(), store.config.timeZone);
          await store.save();
          logger.info(`Using guild "${onlyGuild.name}" (${onlyGuild.id}); results count in every channel.`);
        }
      } else if (!store.config.guildId && ready.guilds.cache.size > 1) {
        logger.warn("In more than one server; run /wordle-setup in the one you want scored.");
      }

      if (!store.config.spoilerChannelId) {
        logger.info("No spoiler channel configured yet. An admin can run /wordle-setup to add one.");
      }

      try {
        await registerCommands(client, env.guildId, logger);
      } catch (error) {
        logger.error("Could not register slash commands", error);
      }

      try {
        await daily.rollover(new Date());
      } catch (error) {
        logger.error("Startup rollover failed", error);
      }

      // Keep existing roles in step with the stored totals (also renames them
      // when the role-name format changes).
      try {
        const synced = await daily.resync();
        if (synced.updated.length > 0) {
          logger.info(`Re-synced ${synced.updated.length} points role(s) at startup.`);
        }
      } catch (error) {
        logger.warn("Could not sync points roles at startup", error);
      }

      logger.info(
        `Invite URL: https://discord.com/api/oauth2/authorize?client_id=${ready.user.id}` +
          `&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`,
      );

      try {
        const found = await summary.poll();
        if (found > 0) logger.info(`Summary scan applied ${found} message(s) from history.`);
      } catch (error) {
        logger.warn("Summary scan failed", error);
      }

      timer = setInterval(() => void tick(), TICK_MS);
      summaryTimer = setInterval(() => {
        void summary.poll().catch((error: unknown) => logger.warn("Summary scan failed", error));
      }, SUMMARY_POLL_MS);
    })();
  });

  // A newly joined server gets its commands immediately, so it can be set up
  // without editing the environment or waiting for a global rollout.
  client.on(Events.GuildCreate, (guild) => {
    void registerGuildCommands(guild, logger).catch((error: unknown) => {
      logger.warn(`Could not register commands in ${guild.name}`, error);
    });
  });

  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down.`);
    if (timer) clearInterval(timer);
    if (summaryTimer) clearInterval(summaryTimer);
    void client.destroy().finally(() => process.exit(0));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  await client.login(env.token);
}

main().catch((error: unknown) => {
  logger.error("Bot failed to start", error);
  process.exitCode = 1;
});
