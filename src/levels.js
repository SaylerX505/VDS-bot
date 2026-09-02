import { EmbedBuilder } from 'discord.js';
import { config } from './config.js';
import { pool } from './db.js';
import { logger } from './logger.js';

const MAX_LEVEL = 100;
const cache = new Map();
const cooldowns = new Map();
const settingsCache = new Map();

// Tuned quadratic curve: fast early progression, meaningful high levels, hard cap at 100.
export function xpForLevel(level) {
  const safe = Math.min(MAX_LEVEL, Math.max(0, Math.floor(Number(level) || 0)));
  if (safe === 0) return 0;
  return Math.floor(5 * safe * safe + 50 * safe + 100);
}

export function levelFromXp(xp) {
  const value = Math.max(0, Number(xp) || 0);
  let low = 0;
  let high = MAX_LEVEL;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (xpForLevel(mid) <= value) low = mid;
    else high = mid - 1;
  }
  return low;
}

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function emptyState() {
  return { textXp: 0, textLevel: 0, voiceXp: 0, voiceLevel: 0, dirty: false };
}

async function loadState(guildId, userId) {
  const k = key(guildId, userId);
  const cached = cache.get(k);
  if (cached) return cached;
  const { rows } = await pool.query(
    'SELECT text_xp, text_level, voice_xp, voice_level FROM guild_members WHERE guild_id = $1 AND user_id = $2',
    [guildId, userId]
  );
  const row = rows[0];
  const state = row ? {
    textXp: Number(row.text_xp),
    textLevel: Number(row.text_level),
    voiceXp: Number(row.voice_xp),
    voiceLevel: Number(row.voice_level),
    dirty: false
  } : emptyState();
  cache.set(k, state);
  return state;
}

export async function getGuildSettings(guildId) {
  if (settingsCache.has(guildId)) return settingsCache.get(guildId);
  const { rows } = await pool.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
  if (!rows[0]) {
    await pool.query('INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [guildId]);
    const { rows: created } = await pool.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
    settingsCache.set(guildId, created[0]);
    return created[0];
  }
  settingsCache.set(guildId, rows[0]);
  return rows[0];
}

export async function updateGuildSettings(guildId, patch) {
  const allowed = new Set([
    'xp_enabled', 'text_xp_enabled', 'voice_xp_enabled', 'xp_min', 'xp_max',
    'xp_cooldown_ms', 'voice_xp_amount', 'voice_xp_interval_ms', 'levelup_channel_id',
    'levelup_message', 'levelup_dm', 'remove_lower_rewards', 'no_xp_roles', 'no_xp_channels'
  ]);
  const entries = Object.entries(patch).filter(([field, value]) => allowed.has(field) && value !== undefined);
  if (!entries.length) return getGuildSettings(guildId);
  const values = [guildId];
  const assignments = [];
  for (const [field, value] of entries) {
    values.push(value);
    assignments.push(`${field} = $${values.length}`);
  }
  await pool.query(
    `INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO UPDATE SET ${assignments.join(', ')}`,
    values
  );
  settingsCache.delete(guildId);
  return getGuildSettings(guildId);
}

function isIgnored(settings, member, channelId) {
  return settings.no_xp_roles?.some((id) => member.roles.cache.has(id)) || settings.no_xp_channels?.includes(channelId);
}

function pruneCooldowns(now = Date.now()) {
  if (cooldowns.size < 1000) return;
  for (const [k, timestamp] of cooldowns) {
    if (now - timestamp >= config.xpMessageCooldownMs) cooldowns.delete(k);
  }
}

export async function awardMessageXp(guildId, userId, member, channelId) {
  const settings = await getGuildSettings(guildId);
  if (!settings.xp_enabled || !settings.text_xp_enabled || isIgnored(settings, member, channelId)) return null;

  const k = key(guildId, userId);
  const now = Date.now();
  const last = cooldowns.get(k) || 0;
  const cooldown = Number(settings.xp_cooldown_ms) || config.xpMessageCooldownMs;
  if (now - last < cooldown) return null;
  cooldowns.set(k, now);
  pruneCooldowns(now);

  const state = await loadState(guildId, userId);
  const oldLevel = state.textLevel;
  const oldXp = state.textXp;
  const min = Number(settings.xp_min);
  const max = Number(settings.xp_max);
  state.textXp += randomInt(min, max);
  state.textLevel = levelFromXp(state.textXp);
  state.dirty = true;
  return state.textLevel > oldLevel ? {
    type: 'text', oldLevel, level: state.textLevel, xp: state.textXp, gained: state.textXp - oldXp, state
  } : null;
}

export async function awardVoiceXp(guildId, userId, member) {
  const settings = await getGuildSettings(guildId);
  if (!settings.xp_enabled || !settings.voice_xp_enabled || !member?.voice?.channelId || isIgnored(settings, member, member.voice.channelId)) return null;

  const channel = member.voice.channel;
  if (!channel || channel.members.filter((m) => !m.user.bot).size < 2) return null;
  if (channel.guild.afkChannelId === channel.id) return null;

  const state = await loadState(guildId, userId);
  const oldLevel = state.voiceLevel;
  const oldXp = state.voiceXp;
  state.voiceXp += Number(settings.voice_xp_amount) || config.voiceXpAmount;
  state.voiceLevel = levelFromXp(state.voiceXp);
  state.dirty = true;
  return state.voiceLevel > oldLevel ? {
    type: 'voice', oldLevel, level: state.voiceLevel, xp: state.voiceXp, gained: state.voiceXp - oldXp, state
  } : null;
}

export async function flushXp({ throwOnError = false } = {}) {
  const dirty = [...cache.entries()]
    .map(([k, state]) => ({ k, state, textXp: state.textXp, textLevel: state.textLevel, voiceXp: state.voiceXp, voiceLevel: state.voiceLevel }))
    .filter((item) => cache.get(item.k)?.dirty);
  if (!dirty.length) return true;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of dirty) {
      const separator = item.k.indexOf(':');
      const guildId = item.k.slice(0, separator);
      const userId = item.k.slice(separator + 1);
      await client.query(`
        INSERT INTO guild_members (guild_id, user_id, text_xp, text_level, voice_xp, voice_level)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (guild_id, user_id)
        DO UPDATE SET text_xp = EXCLUDED.text_xp, text_level = EXCLUDED.text_level,
          voice_xp = EXCLUDED.voice_xp, voice_level = EXCLUDED.voice_level, updated_at = NOW()
      `, [guildId, userId, item.textXp, item.textLevel, item.voiceXp, item.voiceLevel]);
    }
    await client.query('COMMIT');
    for (const item of dirty) {
      const current = cache.get(item.k);
      if (current && current.textXp === item.textXp && current.textLevel === item.textLevel && current.voiceXp === item.voiceXp && current.voiceLevel === item.voiceLevel) current.dirty = false;
    }
    logger.debug('Flushed XP cache', { users: dirty.length });
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('XP flush failed', { error: error.message, users: dirty.length });
    if (throwOnError) throw error;
    return false;
  } finally {
    client.release();
  }
}

export async function getRank(guildId, userId) {
  const state = await loadState(guildId, userId);
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) + 1 FROM guild_members m2 WHERE m2.guild_id = $1 AND m2.text_xp > m.text_xp) AS text_rank,
      (SELECT COUNT(*) + 1 FROM guild_members m3 WHERE m3.guild_id = $1 AND m3.voice_xp > m.voice_xp) AS voice_rank
    FROM guild_members m WHERE m.guild_id = $1 AND m.user_id = $2
  `, [guildId, userId]);
  return { ...state, textRank: Number(rows[0]?.text_rank || 1), voiceRank: Number(rows[0]?.voice_rank || 1) };
}

export async function getLeaderboard(guildId, type = 'text', limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  const column = type === 'voice' ? 'voice_xp' : 'text_xp';
  const level = type === 'voice' ? 'voice_level' : 'text_level';
  const { rows } = await pool.query(
    `SELECT user_id, ${column} AS xp, ${level} AS level FROM guild_members WHERE guild_id = $1 ORDER BY ${column} DESC LIMIT $2`,
    [guildId, safeLimit]
  );
  return rows;
}

export async function setXp(guildId, userId, type, xp) {
  const value = Math.max(0, Math.floor(Number(xp) || 0));
  const field = type === 'voice' ? 'voice_xp' : 'text_xp';
  const levelField = type === 'voice' ? 'voice_level' : 'text_level';
  await pool.query(`INSERT INTO guild_members (guild_id, user_id, ${field}, ${levelField}) VALUES ($1, $2, $3, $4)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET ${field} = EXCLUDED.${field}, ${levelField} = EXCLUDED.${levelField}, updated_at = NOW()`,
    [guildId, userId, value, levelFromXp(value)]);
  cache.delete(key(guildId, userId));
  return getRank(guildId, userId);
}

export async function setLevel(guildId, userId, type, level) {
  const value = Math.min(MAX_LEVEL, Math.max(0, Math.floor(Number(level) || 0)));
  return setXp(guildId, userId, type, xpForLevel(value));
}

export async function resetXp(guildId, userId = null, type = 'all') {
  const fields = type === 'text' ? 'text_xp = 0, text_level = 0' : type === 'voice' ? 'voice_xp = 0, voice_level = 0' : 'text_xp = 0, text_level = 0, voice_xp = 0, voice_level = 0';
  if (userId) await pool.query(`DELETE FROM guild_members WHERE guild_id = $1 AND user_id = $2`, [guildId, userId]).then(async () => {
    if (type !== 'all') await pool.query(`INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2)`, [guildId, userId]);
  });
  else await pool.query(`UPDATE guild_members SET ${fields}, updated_at = NOW() WHERE guild_id = $1`, [guildId]);
  if (userId) cache.delete(key(guildId, userId));
  else for (const k of cache.keys()) if (k.startsWith(`${guildId}:`)) cache.delete(k);
}

export async function getRewards(guildId) {
  const { rows } = await pool.query('SELECT reward_id, role_id, text_level, voice_level FROM level_rewards WHERE guild_id = $1 ORDER BY GREATEST(text_level, voice_level), reward_id', [guildId]);
  return rows;
}

export async function addReward(guildId, roleId, textLevel = 0, voiceLevel = 0) {
  await pool.query(`INSERT INTO level_rewards (guild_id, role_id, text_level, voice_level) VALUES ($1, $2, $3, $4)
    ON CONFLICT (guild_id, role_id, text_level, voice_level) DO NOTHING`, [guildId, roleId, textLevel, voiceLevel]);
  return getRewards(guildId);
}

export async function removeReward(guildId, rewardId) {
  await pool.query('DELETE FROM level_rewards WHERE guild_id = $1 AND reward_id = $2', [guildId, rewardId]);
}

function rewardSatisfied(reward, state) {
  return (Number(reward.text_level) === 0 || state.textLevel >= Number(reward.text_level)) &&
    (Number(reward.voice_level) === 0 || state.voiceLevel >= Number(reward.voice_level));
}

export async function syncLevelRewards(guild, member, state = null) {
  if (!guild || !member) return;
  const current = state || await loadState(guild.id, member.id);
  const [settings, rewards] = await Promise.all([getGuildSettings(guild.id), getRewards(guild.id)]);
  if (!rewards.length) return;
  const me = guild.members.me;
  if (!me) return;

  const satisfied = rewards.filter((reward) => rewardSatisfied(reward, current));
  const targetIds = new Set(satisfied.map((reward) => reward.role_id));
  if (settings.remove_lower_rewards && satisfied.length) {
    const highest = Math.max(...satisfied.map((reward) => Math.max(Number(reward.text_level), Number(reward.voice_level))));
    for (const reward of rewards) {
      if (Math.max(Number(reward.text_level), Number(reward.voice_level)) < highest) targetIds.delete(reward.role_id);
    }
  }

  for (const reward of rewards) {
    const role = guild.roles.cache.get(reward.role_id);
    if (!role || role.managed || role.position >= me.roles.highest.position) continue;
    const shouldHave = targetIds.has(role.id);
    const has = member.roles.cache.has(role.id);
    if (shouldHave && !has) await member.roles.add(role, 'VDS level reward').catch(() => {});
    if (!shouldHave && has && settings.remove_lower_rewards) await member.roles.remove(role, 'VDS level reward').catch(() => {});
  }
}

export async function announceLevelUp(guild, member, info) {
  const settings = await getGuildSettings(guild.id);
  if (!settings.levelup_channel_id) return;
  const channel = guild.channels.cache.get(settings.levelup_channel_id);
  if (!channel?.isTextBased()) return;
  const message = String(settings.levelup_message || 'Congratulations [user]! You reached **Level [level]**.')
    .replaceAll('[user]', `<@${member.id}>`)
    .replaceAll('[user.id]', member.id)
    .replaceAll('[user.username]', member.user.username)
    .replaceAll('[level]', String(info.level))
    .replaceAll('[oldLevel]', String(info.oldLevel))
    .replaceAll('[type]', info.type);
  await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription(message).setFooter({ text: `VDS • ${info.type === 'voice' ? 'Voice' : 'Text'} Level Up` })] }).catch(() => {});
  if (settings.levelup_dm && info.type === 'text') await member.send(`You reached **Level ${info.level}** in **${guild.name}**.`).catch(() => {});
}

export async function shutdownLevels() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await flushXp()) {
      cooldowns.clear();
      cache.clear();
      settingsCache.clear();
      return true;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  logger.error('Final XP flush failed after retries; retaining in-memory cache until process exit');
  return false;
}
