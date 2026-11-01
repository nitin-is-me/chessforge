/** Prometheus metrics for operations visibility. */
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: 'chessforge_' });

export const gamesStarted = new Counter({
  name: 'chessforge_games_started_total',
  help: 'Games started',
  labelNames: ['rated', 'category'] as const,
  registers: [registry],
});

export const gamesFinished = new Counter({
  name: 'chessforge_games_finished_total',
  help: 'Games finished',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const movesPlayed = new Counter({
  name: 'chessforge_moves_total',
  help: 'Moves accepted by the server',
  registers: [registry],
});

export const liveGames = new Gauge({
  name: 'chessforge_live_games',
  help: 'Games currently held in memory',
  registers: [registry],
});

export const connectedUsers = new Gauge({
  name: 'chessforge_connected_users',
  help: 'Users with at least one open socket',
  registers: [registry],
});
