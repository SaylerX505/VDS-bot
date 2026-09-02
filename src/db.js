import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  maxUses: 1000,
  keepAlive: true
});

pool.on('error', (err) => logger.error('PostgreSQL pool error', { error: err.message }));

export async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_members (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      text_xp BIGINT NOT NULL DEFAULT 0,
      text_level INTEGER NOT NULL DEFAULT 0,
      voice_xp BIGINT NOT NULL DEFAULT 0,
      voice_level INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS text_xp BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS text_level INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS voice_xp BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS voice_level INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE guild_members DROP COLUMN IF EXISTS xp;
    ALTER TABLE guild_members DROP COLUMN IF EXISTS level;

    CREATE INDEX IF NOT EXISTS guild_members_text_leaderboard_idx
      ON guild_members (guild_id, text_xp DESC);
    CREATE INDEX IF NOT EXISTS guild_members_voice_leaderboard_idx
      ON guild_members (guild_id, voice_xp DESC);

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      xp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      text_xp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      voice_xp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      xp_min INTEGER NOT NULL DEFAULT 10,
      xp_max INTEGER NOT NULL DEFAULT 40,
      xp_cooldown_ms INTEGER NOT NULL DEFAULT 120000,
      voice_xp_amount INTEGER NOT NULL DEFAULT 10,
      voice_xp_interval_ms INTEGER NOT NULL DEFAULT 120000,
      levelup_channel_id TEXT,
      levelup_message TEXT NOT NULL DEFAULT 'Congratulations [user]! You reached **Level [level]**.',
      levelup_dm BOOLEAN NOT NULL DEFAULT FALSE,
      remove_lower_rewards BOOLEAN NOT NULL DEFAULT TRUE,
      no_xp_roles TEXT[] NOT NULL DEFAULT '{}',
      no_xp_channels TEXT[] NOT NULL DEFAULT '{}'
    );

    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS text_xp_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS voice_xp_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS voice_xp_amount INTEGER NOT NULL DEFAULT 10;
    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS voice_xp_interval_ms INTEGER NOT NULL DEFAULT 120000;
    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS levelup_message TEXT NOT NULL DEFAULT 'Congratulations [user]! You reached **Level [level]**.';
    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS levelup_dm BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS remove_lower_rewards BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS no_xp_roles TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS no_xp_channels TEXT[] NOT NULL DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS level_rewards (
      guild_id TEXT NOT NULL,
      reward_id BIGSERIAL PRIMARY KEY,
      role_id TEXT NOT NULL,
      text_level INTEGER NOT NULL DEFAULT 0,
      voice_level INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, role_id, text_level, voice_level),
      CHECK (text_level >= 0 AND voice_level >= 0 AND (text_level > 0 OR voice_level > 0))
    );
    CREATE INDEX IF NOT EXISTS level_rewards_guild_idx ON level_rewards (guild_id);

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

export async function closeDatabase() {
  await pool.end();
}
