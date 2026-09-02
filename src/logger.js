const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const current = levels[process.env.LOG_LEVEL || 'info'] ?? levels.info;

function write(level, message, meta = undefined) {
  if (levels[level] < current) return;
  const entry = { time: new Date().toISOString(), level, message };
  if (meta !== undefined) entry.meta = meta;
  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (m, x) => write('debug', m, x),
  info: (m, x) => write('info', m, x),
  warn: (m, x) => write('warn', m, x),
  error: (m, x) => write('error', m, x)
};
