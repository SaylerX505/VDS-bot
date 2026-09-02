import 'dotenv/config';

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'DATABASE_URL'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

export const config = Object.freeze({
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  databaseUrl: process.env.DATABASE_URL,
  devGuildId: process.env.DEV_GUILD_ID || null,
  nodeEnv: process.env.NODE_ENV || 'production',
  xpFlushIntervalMs: Number(process.env.XP_FLUSH_INTERVAL_MS || 30000),
  xpMessageCooldownMs: Number(process.env.XP_MESSAGE_COOLDOWN_MS || 60000),
  xpMin: Number(process.env.XP_MIN || 15),
  xpMax: Number(process.env.XP_MAX || 25),
  logLevel: process.env.LOG_LEVEL || 'info'
});

if (config.xpMin < 0 || config.xpMax < config.xpMin) throw new Error('Invalid XP range');
if (config.xpFlushIntervalMs < 5000) throw new Error('XP_FLUSH_INTERVAL_MS must be >= 5000');
