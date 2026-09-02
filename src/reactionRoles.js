import { pool } from './db.js';

const cache = new Map();
let loaded = false;

export function emojiKey(reaction) {
  return reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name;
}

export async function initReactionRoleCache() {
  const { rows } = await pool.query('SELECT guild_id, message_id, emoji_key, role_id FROM reaction_roles');
  cache.clear();
  for (const row of rows) cache.set(`${row.guild_id}:${row.message_id}:${row.emoji_key}`, row.role_id);
  loaded = true;
}

async function ensureLoaded() {
  if (!loaded) await initReactionRoleCache();
}

export async function addMapping(guildId, messageId, emoji, roleId) {
  await pool.query(`
    INSERT INTO reaction_roles (guild_id, message_id, emoji_key, role_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (guild_id, message_id, emoji_key)
    DO UPDATE SET role_id = EXCLUDED.role_id
  `, [guildId, messageId, emoji, roleId]);
  cache.set(`${guildId}:${messageId}:${emoji}`, roleId);
}

export async function removeMapping(guildId, messageId, emoji) {
  await pool.query(
    'DELETE FROM reaction_roles WHERE guild_id = $1 AND message_id = $2 AND emoji_key = $3',
    [guildId, messageId, emoji]
  );
  cache.delete(`${guildId}:${messageId}:${emoji}`);
}

export async function getMapping(guildId, messageId, emoji) {
  await ensureLoaded();
  return cache.get(`${guildId}:${messageId}:${emoji}`) ?? null;
}

export async function listMappings(guildId, messageId) {
  await ensureLoaded();
  const prefix = `${guildId}:${messageId}:`;
  return [...cache.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, role_id]) => ({ emoji_key: key.slice(prefix.length), role_id }));
}
