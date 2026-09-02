import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import { initDatabase, pool, closeDatabase } from './db.js';
import { announceLevelUp, awardMessageXp, awardVoiceXp, flushXp, shutdownLevels, syncLevelRewards } from './levels.js';
import { emojiKey, getMapping, initReactionRoleCache } from './reactionRoles.js';
import { handleCommand, autocompleteReactionRole } from './commands.js';
import { startHealthServer, stopHealthServer, setReady } from './health.js';
import { logger } from './logger.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

let xpFlushTimer;
let voiceXpTimer;
let shuttingDown = false;

client.once('ready', () => {
  setReady(true);
  logger.info('VDS is online', { tag: client.user.tag, guilds: client.guilds.cache.size });
});

async function handleLevelUp(guild, userId, info) {
  try {
    const member = await guild.members.fetch(userId);
    await syncLevelRewards(guild, member, info.state);
    await announceLevelUp(guild, member, info);
    logger.debug('Member leveled up', { guildId: guild.id, userId, type: info.type, level: info.level });
  } catch (error) {
    logger.error('Level-up handling failed', { error: error.message, guildId: guild.id, userId });
  }
}

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;
  try {
    const levelUp = await awardMessageXp(message.guild.id, message.author.id, message.member, message.channelId);
    if (levelUp) await handleLevelUp(message.guild, message.author.id, levelUp);
  } catch (error) {
    logger.error('Message XP processing failed', { error: error.message, guildId: message.guild.id });
  }
});

async function processVoiceXp() {
  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased?.() || channel.type === 13) continue;
      for (const member of channel.members.values()) {
        if (member.user.bot) continue;
        try {
          const levelUp = await awardVoiceXp(guild.id, member.id, member);
          if (levelUp) await handleLevelUp(guild, member.id, levelUp);
        } catch (error) {
          logger.error('Voice XP processing failed', { error: error.message, guildId: guild.id, userId: member.id });
        }
      }
    }
  }
}

async function handleReaction(reaction, user, adding) {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (!reaction.message.guild) return;
    const roleId = await getMapping(reaction.message.guild.id, reaction.message.id, emojiKey(reaction));
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
  clearInterval(voiceXpTimer);
  const flushed = await shutdownLevels();
  if (!flushed) logger.error('Shutdown completed with unsaved XP in memory');
  client.destroy();
  await stopHealthServer().catch(() => {});
  await closeDatabase().catch((error) => logger.error('Database shutdown failed', { error: error.message }));
  process.exit(flushed ? 0 : 1);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown(signal));
process.on('unhandledRejection', (error) => logger.error('Unhandled rejection', { error: String(error) }));
process.on('uncaughtException', (error) => { logger.error('Uncaught exception', { error: error.message, stack: error.stack }); if (!shuttingDown) void shutdown('uncaughtException'); });

async function initialize() {
  startHealthServer();
  for (let attempt = 1; attempt <= 5; attempt++) {
    try { await initDatabase(); break; }
    catch (error) { logger.error('Database initialization failed', { attempt, error: error.message }); if (attempt === 5) throw error; await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 2000, 10000))); }
  }
  await initReactionRoleCache();
  xpFlushTimer = setInterval(() => { flushXp().catch((error) => logger.error('Scheduled XP flush failed', { error: error.message })); }, config.xpFlushIntervalMs);
  xpFlushTimer.unref();
  voiceXpTimer = setInterval(() => { processVoiceXp().catch((error) => logger.error('Voice XP sweep failed', { error: error.message })); }, 30000);
  voiceXpTimer.unref();
  try { await client.login(config.token); }
  catch (error) { logger.error('Discord login failed', { error: error.message }); await stopHealthServer().catch(() => {}); await closeDatabase().catch(() => {}); throw error; }
}

try { await initialize(); }
catch (error) { logger.error('VDS failed to start', { error: error.message }); process.exitCode = 1; }
