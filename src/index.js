import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import { initDatabase, pool, closeDatabase } from './db.js';
import { awardMessageXp, flushXp, shutdownLevels } from './levels.js';
import { emojiKey, getMapping, initReactionRoleCache } from './reactionRoles.js';
import { handleCommand, autocompleteReactionRole } from './commands.js';
import { startHealthServer, stopHealthServer, setReady } from './health.js';
import { logger } from './logger.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

let xpFlushTimer;
let shuttingDown = false;

client.once('ready', () => {
  setReady(true);
  logger.info('VDS is online', { tag: client.user.tag, guilds: client.guilds.cache.size });
});

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;
  try {
    const levelUp = await awardMessageXp(message.guild.id, message.author.id);
    if (levelUp) {
      logger.debug('Member leveled up', {
        guildId: message.guild.id,
        userId: message.author.id,
        level: levelUp.level
      });
    }
  } catch (error) {
    logger.error('Message XP processing failed', { error: error.message, guildId: message.guild.id });
  }
});

async function handleReaction(reaction, user, adding) {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (!reaction.message.guild) return;

    const roleId = await getMapping(
      reaction.message.guild.id,
      reaction.message.id,
      emojiKey(reaction)
    );
    if (!roleId) return;

    const member = await reaction.message.guild.members.fetch(user.id);
    const role = reaction.message.guild.roles.cache.get(roleId);
    const me = reaction.message.guild.members.me;
    if (!role || !me || role.managed || role.position >= me.roles.highest.position) return;

    if (adding) await member.roles.add(role, 'VDS reaction role');
    else await member.roles.remove(role, 'VDS reaction role');
  } catch (error) {
    logger.error('Reaction role processing failed', { error: error.message });
  }
}

client.on('messageReactionAdd', (reaction, user) => handleReaction(reaction, user, true));
client.on('messageReactionRemove', (reaction, user) => handleReaction(reaction, user, false));

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'reactionrole') return autocompleteReactionRole(interaction);
      return interaction.respond([]);
    }
    if (!interaction.isChatInputCommand()) return;
    await handleCommand(interaction);
  } catch (error) {
    logger.error('Interaction failed', { command: interaction.commandName, error: error.message });
    const response = { content: 'Something went wrong while processing that request.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(() => {});
    else await interaction.reply(response).catch(() => {});
  }
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  setReady(false);
  logger.info(`Received ${signal}; shutting down`);
  clearInterval(xpFlushTimer);

  const flushed = await shutdownLevels();
  if (!flushed) logger.error('Shutdown completed with unsaved XP in memory');

  client.destroy();
  await stopHealthServer().catch(() => {});
  await closeDatabase().catch((error) => logger.error('Database shutdown failed', { error: error.message }));
  process.exit(flushed ? 0 : 1);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown(signal));
process.on('unhandledRejection', (error) => logger.error('Unhandled rejection', { error: String(error) }));
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  if (!shuttingDown) void shutdown('uncaughtException');
});

async function initialize() {
  startHealthServer();

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await initDatabase();
      break;
    } catch (error) {
      logger.error('Database initialization failed', { attempt, error: error.message });
      if (attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 2000, 10000)));
    }
  }

  await initReactionRoleCache();
  xpFlushTimer = setInterval(() => {
    flushXp().catch((error) => logger.error('Scheduled XP flush failed', { error: error.message }));
  }, config.xpFlushIntervalMs);
  xpFlushTimer.unref();

  try {
    await client.login(config.token);
  } catch (error) {
    logger.error('Discord login failed', { error: error.message });
    await stopHealthServer().catch(() => {});
    await closeDatabase().catch(() => {});
    throw error;
  }
}

try {
  await initialize();
} catch (error) {
  logger.error('VDS failed to start', { error: error.message });
  process.exitCode = 1;
}
