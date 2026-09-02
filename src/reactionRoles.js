import { pool } from './db.js';

export function emojiKey(reaction) {
  return reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name;
}

export async function addMapping(guildId, messageId, emoji, roleId) {
  await pool.query(`
    INSERT INTO reaction_roles (guild_id, message_id, emoji_key, role_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (guild_id, message_id, emoji_key)
    DO UPDATE SET role_id = EXCLUDED.role_id
  `, [guildId, messageId, emoji, roleId]);
}

export async function removeMapping(guildId, messageId, emoji) {
  await pool.query(
    'DELETE FROM reaction_roles WHERE guild_id = $1 AND message_id = $2 AND emoji_key = $3',
    [guildId, messageId, emoji]
  );
}

export async function getMapping(guildId, messageId, emoji) {
  const { rows } = await pool.query(
    'SELECT role_id FROM reaction_roles WHERE guild_id = $1 AND message_id = $2 AND emoji_key = $3',
    [guildId, messageId, emoji]
  );
  return rows[0]?.role_id ?? null;
}

export async function listMappings(guildId, messageId) {
  const { rows } = await pool.query(
    'SELECT emoji_key, role_id FROM reaction_roles WHERE guild_id = $1 AND message_id = $2 ORDER BY emoji_key',
    [guildId, messageId]
  );
  return rows;
}
