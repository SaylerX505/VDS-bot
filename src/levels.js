import { config } from './config.js';
import { pool } from './db.js';
import { logger } from './logger.js';

const cache = new Map();
const cooldowns = new Map();

export function xpForLevel(level) {
  return Math.floor(100 * level * level + 50 * level);
}

export function levelFromXp(xp) {
  let level = 0;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

function key(guildId, userId) { return `${guildId}:${userId}`; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

export async function awardMessageXp(guildId, userId) {
  const k = key(guildId, userId);
  const now = Date.now();
  const last = cooldowns.get(k) || 0;
  if (now - last < config.xpMessageCooldownMs) return null;
  cooldowns.set(k, now);

  let state = cache.get(k);
  if (!state) {
    const { rows } = await pool.query(
      'SELECT xp, level FROM guild_members WHERE guild_id = $1 AND user_id = $2',
      [guildId, userId]
    );
    state = rows[0] ? { xp: Number(rows[0].xp), level: rows[0].level, dirty: false } : { xp: 0, level: 0, dirty: false };
    cache.set(k, state);
  }

  const oldLevel = state.level;
  state.xp += randomInt(config.xpMin, config.xpMax);
  state.level = levelFromXp(state.xp);
  state.dirty = true;
  return state.level > oldLevel ? { ...state, oldLevel } : null;
}

export async function flushXp() {
  const dirty = [...cache.entries()].filter(([, state]) => state.dirty);
  if (!dirty.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [k, state] of dirty) {
      const [guildId, userId] = k.split(':');
      await client.query(`
        INSERT INTO guild_members (guild_id, user_id, xp, level)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (guild_id, user_id)
        DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level, updated_at = NOW()
      `, [guildId, userId, state.xp, state.level]);
      state.dirty = false;
    }
    await client.query('COMMIT');
    logger.debug('Flushed XP cache', { users: dirty.length });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('XP flush failed', { error: error.message });
  } finally {
    client.release();
  }
}

export async function getRank(guildId, userId) {
  const k = key(guildId, userId);
  const state = cache.get(k);
  if (state) return state;
  const { rows } = await pool.query(
    'SELECT xp, level FROM guild_members WHERE guild_id = $1 AND user_id = $2',
    [guildId, userId]
  );
  return rows[0] ? { xp: Number(rows[0].xp), level: rows[0].level } : { xp: 0, level: 0 };
}

export async function getLeaderboard(guildId, limit = 10) {
  const { rows } = await pool.query(
    'SELECT user_id, xp, level FROM guild_members WHERE guild_id = $1 ORDER BY xp DESC LIMIT $2',
    [guildId, limit]
  );
  return rows;
}

export async function shutdownLevels() {
  await flushXp();
  cooldowns.clear();
  cache.clear();
}
