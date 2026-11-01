/**
 * Matchmaking pools.
 *
 * Players wait in a queue keyed by time control and rated/casual. Every second
 * the queue is scanned oldest-first and compatible pairs are created, with a
 * rating window that widens the longer both players have waited.
 */
import type { Game } from '../game/Game.js';
import type { PlayerIdentity, CreateGameOptions } from '../game/manager.js';

export interface PoolEntry extends PlayerIdentity {
  socketId: string;
  rating: number;
  joinedAt: number;
  baseSec: number;
  incSec: number;
  rated: boolean;
}

export interface MatchmakerDeps {
  now: () => number;
  create: (options: CreateGameOptions) => Promise<Game>;
  onPaired: (entry: PoolEntry, gameId: string, color: 'w' | 'b') => void;
  onWaiting: (entry: PoolEntry, waiting: number) => void;
  log: (message: string, meta?: Record<string, unknown>) => void;
  /** Returns true when the two users block each other in either direction. */
  areBlocked: (a: string, b: string) => Promise<boolean>;
}

const INITIAL_WINDOW = 100;
const WINDOW_GROWTH_PER_SEC = 25;
const MAX_WINDOW = 900;

export function queueKey(baseSec: number, incSec: number, rated: boolean): string {
  return `${baseSec}+${incSec}:${rated ? 'rated' : 'casual'}`;
}

export class Matchmaker {
  private readonly queues = new Map<string, PoolEntry[]>();
  private readonly byUser = new Map<string, PoolEntry>();
  private matching = false;

  constructor(private readonly deps: MatchmakerDeps) {}

  join(entry: Omit<PoolEntry, 'joinedAt'>): PoolEntry {
    this.leave(entry.id);
    const full: PoolEntry = { ...entry, joinedAt: this.deps.now() };
    const key = queueKey(entry.baseSec, entry.incSec, entry.rated);
    const queue = this.queues.get(key) ?? [];
    queue.push(full);
    this.queues.set(key, queue);
    this.byUser.set(entry.id, full);
    this.deps.onWaiting(full, queue.length);
    this.deps.log('player joined pool', { userId: entry.id, key });
    return full;
  }

  leave(userId: string): void {
    const entry = this.byUser.get(userId);
    if (!entry) return;
    this.byUser.delete(userId);
    const key = queueKey(entry.baseSec, entry.incSec, entry.rated);
    const queue = this.queues.get(key);
    if (!queue) return;
    const next = queue.filter((candidate) => candidate.id !== userId);
    if (next.length > 0) this.queues.set(key, next);
    else this.queues.delete(key);
  }

  isWaiting(userId: string): boolean {
    return this.byUser.has(userId);
  }

  count(baseSec: number, incSec: number, rated: boolean): number {
    return this.queues.get(queueKey(baseSec, incSec, rated))?.length ?? 0;
  }

  /** Scans every queue once. Safe to call concurrently. */
  tick(): void {
    if (this.matching) return;
    this.matching = true;
    try {
      const now = this.deps.now();
      for (const [, queue] of this.queues) {
        const sorted = [...queue].sort((a, b) => a.joinedAt - b.joinedAt);
        let index = 0;
        while (index < sorted.length) {
          const first = sorted[index]!;
          let paired: PoolEntry | null = null;
          for (let next = index + 1; next < sorted.length; next += 1) {
            const candidate = sorted[next]!;
            const window = Math.min(
              MAX_WINDOW,
              INITIAL_WINDOW +
                WINDOW_GROWTH_PER_SEC *
                  Math.max(0, Math.floor((now - Math.max(first.joinedAt, candidate.joinedAt)) / 1000)),
            );
            if (Math.abs(first.rating - candidate.rating) <= window) {
              paired = candidate;
              sorted.splice(next, 1);
              break;
            }
          }
          if (paired) {
            sorted.splice(index, 1);
            void this.match(first, paired);
          } else {
            index += 1;
          }
        }
        if (sorted.length !== queue.length) {
          if (sorted.length > 0) this.queues.set(queueKey(sorted[0]!.baseSec, sorted[0]!.incSec, sorted[0]!.rated), sorted);
          else this.queues.delete(queueKey(queue[0]!.baseSec, queue[0]!.incSec, queue[0]!.rated));
        }
      }
    } finally {
      this.matching = false;
    }
  }

  private async match(a: PoolEntry, b: PoolEntry): Promise<void> {
    if (await this.deps.areBlocked(a.id, b.id)) {
      this.deps.log('pool match skipped: blocked', { white: a.id, black: b.id });
      return;
    }
    this.byUser.delete(a.id);
    this.byUser.delete(b.id);
    const firstIsWhite = Math.random() < 0.5;
    const white = firstIsWhite ? a : b;
    const black = firstIsWhite ? b : a;
    const rated = a.rated && b.rated && !a.isGuest && !b.isGuest;

    try {
      const game = await this.deps.create({
        white: { id: white.id, username: white.username, displayName: white.displayName, isGuest: white.isGuest },
        black: { id: black.id, username: black.username, displayName: black.displayName, isGuest: black.isGuest },
        rated,
        baseSec: a.baseSec,
        incSec: a.incSec,
      });
      this.deps.onPaired(white, game.id, 'w');
      this.deps.onPaired(black, game.id, 'b');
      this.deps.log('pool matched', { gameId: game.id, white: white.id, black: black.id });
    } catch (error) {
      this.deps.log('pool match failed', { error: String(error) });
    }
  }
}
