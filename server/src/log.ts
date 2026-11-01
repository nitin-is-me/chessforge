import pino from 'pino';
import { loadConfig } from './env.js';

const config = loadConfig();

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (config.isProduction ? 'info' : 'debug'),
  base: { service: 'chessforge' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.cookie', 'password', 'token', 'authorization'],
    remove: true,
  },
});

export type Logger = typeof logger;
