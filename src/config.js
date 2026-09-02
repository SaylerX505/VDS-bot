import 'dotenv/config';

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'DATABASE_URL'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

const xpFlushIntervalMs = Number(process.env.XP_FLUSH_INTERVAL_MS || 30000);
const xpMessageCooldownMs = Number(process.env.XP_MESSAGE_COOLDOWN_MS || 120000);
const xpMin = Number(process.env.XP_MIN || 10);
const xpMax = Number(process.env.XP_MAX || 40);
const voiceXpAmount = Number(process.env.VOICE_XP_AMOUNT || 10);
const voiceXpIntervalMs = Number(process.env.VOICE_XP_INTERVAL_MS || 120000);
const healthPort = Number(process.env.PORT || process.env.HEALTH_PORT || 3000);

export const config = Object.freeze({
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  databaseUrl: process.env.DATABASE_URL,
  devGuildId: process.env.DEV_GUILD_ID || null,
  nodeEnv: process.env.NODE_ENV || 'production',
  xpFlushIntervalMs,
  xpMessageCooldownMs,
  xpMin,
  xpMax,
  voiceXpAmount,
  voiceXpIntervalMs,
  healthPort,
  logLevel: process.env.LOG_LEVEL || 'info'
});

if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65535) {
  throw new Error('PORT/HEALTH_PORT must be a valid TCP port');
}
if (!Number.isInteger(xpMin) || !Number.isInteger(xpMax) || xpMin < 0 || xpMax < xpMin) {
  throw new Error('Invalid XP range');
}
if (!Number.isInteger(voiceXpAmount) || voiceXpAmount < 0) {
  throw new Error('VOICE_XP_AMOUNT must be an integer >= 0');
}
if (!Number.isInteger(xpFlushIntervalMs) || xpFlushIntervalMs < 5000) {
  throw new Error('XP_FLUSH_INTERVAL_MS must be an integer >= 5000');
}
if (!Number.isInteger(xpMessageCooldownMs) || xpMessageCooldownMs < 0) {
  throw new Error('XP_MESSAGE_COOLDOWN_MS must be an integer >= 0');
}
if (!Number.isInteger(voiceXpIntervalMs) || voiceXpIntervalMs < 30000) {
  throw new Error('VOICE_XP_INTERVAL_MS must be an integer >= 30000');
}
