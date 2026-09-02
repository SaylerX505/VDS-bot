import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  maxUses: 1000
});

pool.on('error', (err) => logger.error('PostgreSQL pool error', { error: err.message }));

export async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_members (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      xp BIGINT NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS guild_members_leaderboard_idx
      ON guild_members (guild_id, xp DESC);

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      xp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      xp_min INTEGER NOT NULL DEFAULT 15,
      xp_max INTEGER NOT NULL DEFAULT 25,
      xp_cooldown_ms INTEGER NOT NULL DEFAULT 60000,
      levelup_channel_id TEXT
    );

    CREATE TABLE IF NOT EXISTS reaction_roles (
      guild_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      emoji_key TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, message_id, emoji_key)
    );
    CREATE INDEX IF NOT EXISTS reaction_roles_message_idx
      ON reaction_roles (guild_id, message_id);
  `);
  logger.info('Database initialized');
}

export async function healthCheck() {
  await pool.query('SELECT 1');
}
