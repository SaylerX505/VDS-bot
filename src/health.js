import http from 'node:http';
import { config } from './config.js';
import { healthCheck } from './db.js';
import { logger } from './logger.js';

let ready = false;
let server;

export function setReady(value) {
  ready = Boolean(value);
}

export function startHealthServer() {
  server = http.createServer(async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
      return;
    }

    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/readyz') {
      if (!ready) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, ready: false }));
        return;
      }

      try {
        await healthCheck();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ready: true, database: 'ok' }));
      } catch (error) {
        logger.warn('Readiness database check failed', { error: error.message });
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, ready: false, database: 'error' }));
      }
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });

  server.on('error', (error) => logger.error('Health server error', { error: error.message }));
  server.listen(config.healthPort, '0.0.0.0', () => {
    logger.info('Health server listening', { port: config.healthPort });
  });
  return server;
}

export async function stopHealthServer() {
  setReady(false);
  if (!server) return;
  await new Promise((resolve) => server.close(() => resolve()));
  server = undefined;
}
