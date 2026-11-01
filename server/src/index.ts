import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { loadConfig } from './env.js';
import { logger } from './log.js';
import { prisma, disconnectDb } from './db.js';
import { GameManager } from './game/manager.js';
import { PresenceService } from './presence.js';
import { Matchmaker } from './matchmaking/pools.js';
import { attachSockets, bindBroadcaster, pushFriendsUpdate, type IO } from './sockets/index.js';
import { createApiRouter } from './http/routes.js';
import { classifyTimeControl } from '@shared/timeControl.js';
import { connectedUsers, gamesStarted, liveGames } from './metrics.js';

const config = loadConfig();
const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(
  helmet({
    contentSecurityPolicy: config.isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            // Stockfish is a single-threaded WASM build: compiling it needs
            // 'wasm-unsafe-eval', which is not covered by 'self'.
            scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'", 'ws:', 'wss:'],
            workerSrc: ["'self'", 'blob:'],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  }),
);

const server = http.createServer(app);
const io: IO = new Server(server, {
  cors: {
    origin: [config.appOrigin, config.clientDevOrigin],
    credentials: true,
  },
  maxHttpBufferSize: 100_000,
  pingInterval: 25_000,
  pingTimeout: 20_000,
});

const manager = new GameManager();
const presence = new PresenceService();
const matchmaker = new Matchmaker({
  now: () => Date.now(),
  create: (options) => manager.create(options),
  onPaired: (entry, gameId) => {
    io.to(`user:${entry.id}`).emit('pool:paired', { gameId });
  },
  onWaiting: (entry, waiting) => {
    io.to(`user:${entry.id}`).emit('pool:status', {
      presetId: `${entry.baseSec}+${entry.incSec}`,
      category: classifyTimeControl(entry),
      waiting,
      since: entry.joinedAt,
    });
  },
  log: (message, meta) => logger.debug({ ...meta }, message),
  areBlocked: async (a, b) => {
    const block = await prisma.block.findFirst({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    });
    return block !== null;
  },
});

bindBroadcaster(io, manager);
attachSockets(io, { manager, presence, matchmaker });

app.use(
  '/api',
  createApiRouter({
    manager,
    presence,
    matchmaker,
    notifyFriendsChanged: async (userIds) => {
      await pushFriendsUpdate(io, userIds, presence);
    },
  }),
);

// Fallback JSON 404 for unhandled /api calls
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'API endpoint not found' });
});

// JSON error handler for /api calls so Express never returns HTML
app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'API unhandled error');
  const status = typeof err.status === 'number' ? err.status : 500;
  res.status(status).json({
    error: err.code || 'internal_error',
    message: err.message || 'Something went wrong',
  });
});

// Serve the built client in production; in development Vite handles it.
const clientDir = path.resolve(process.cwd(), 'dist/client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir, { index: false, maxAge: '7d', setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  } }));
  app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

manager.onFinished(() => {
  liveGames.set(manager.liveCount);
});

const matchTimer = setInterval(() => {
  matchmaker.tick();
}, 1_000);
matchTimer.unref?.();

const gaugeTimer = setInterval(() => {
  liveGames.set(manager.liveCount);
  connectedUsers.set(presence.onlineCount);
}, 5_000);
gaugeTimer.unref?.();

/**
 * Guest retention: delete guest accounts older than 30 days that have no
 * finished games, no sessions, and no friends. Runs daily.
 */
const GUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const guestCleanupTimer = setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - GUEST_RETENTION_MS);
    const staleGuests = await prisma.user.findMany({
      where: {
        isGuest: true,
        createdAt: { lt: cutoff },
        sessions: { none: {} },
        whiteGames: { none: { status: { in: ['FINISHED', 'ABORTED'] } } },
        blackGames: { none: { status: { in: ['FINISHED', 'ABORTED'] } } },
        sentRequests: { none: {} },
        receivedReqs: { none: {} },
      },
      select: { id: true },
    });
    if (staleGuests.length > 0) {
      const ids = staleGuests.map((u) => u.id);
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      logger.info({ count: ids.length }, 'deleted stale guest accounts');
    }
  } catch (error) {
    logger.error({ err: error }, 'guest cleanup failed');
  }
}, 24 * 60 * 60 * 1000);
guestCleanupTimer.unref?.();

async function start(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    logger.error({ err: error }, 'database unreachable at startup');
    process.exitCode = 1;
    return;
  }

  await manager.recover();
  server.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv, origin: config.appOrigin, client: fs.existsSync(clientDir) },
      'ChessForge listening',
    );
  });
}

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'shutting down');
  clearInterval(matchTimer);
  clearInterval(gaugeTimer);
  clearInterval(guestCleanupTimer);
  io.close();
  server.close();
  await manager.dispose();
  await disconnectDb();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled rejection');
});

void start();

// Keep the metric imported to avoid tree-shaking surprises in the bundler.
void gamesStarted;
