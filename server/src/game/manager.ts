/**
 * Owns live games: persistence, flag timers, restart recovery and ratings.
 *
 * `Game` is pure rules; this manager is where those rules meet Postgres,
 * timers and the network. Every event the game emits is persisted in order
 * through a per-game promise chain, so writes cannot interleave: the board the
 * client is shown is always one the database will agree with once the queue
 * drains. Moves are broadcast immediately (persistence is queued behind them),
 * while a finished game's result is only broadcast after its transaction has
 * committed.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  EndReason as DbEndReason,
  GameResult as DbGameResult,
  GameStatus as DbGameStatus,
  OpponentType,
  Prisma,
} from '@prisma/client';
import type {
  Color,
  EndReason,
  GameMovePayload,
  GameResult,
  GameSnapshot,
  MoveRecord,
} from '@shared/protocol.js';
import {
  classifyTimeControl,
  formatTimeControl,
  isRatedAllowed,
  type TimeCategory,
} from '@shared/timeControl.js';
import { prisma } from '../db.js';
import { logger } from '../log.js';
import { DB_CATEGORY, loadRating } from '../rating/service.js';
import { ratingDelta, roundRating, updateGlicko2 } from '../rating/glicko2.js';
import { Game, createPlayerState, type GameEvent, type PlayerState } from './Game.js';
import { RESUME_GRACE_MS } from './clock.js';

const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

/** Finished games stay in memory briefly so rematch and rejoin are instant. */
const FINISHED_GAME_TTL_MS = 5 * 60_000;

/**
 * The finishing write holds row locks while it waits for its own statements.
 * Over a pooled, high-latency link the default 5s interactive-transaction
 * budget is too tight, and a timeout would drop a result that already ended.
 */
const END_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

export function newGameId(): string {
  const bytes = randomBytes(8);
  let id = '';
  for (let i = 0; i < 8; i += 1) id += ALPHABET[bytes[i]! % ALPHABET.length];
  return id;
}

const RESULT_TO_DB: Record<GameResult, DbGameResult> = {
  white: DbGameResult.WHITE,
  black: DbGameResult.BLACK,
  draw: DbGameResult.DRAW,
};

const REASON_TO_DB: Record<EndReason, DbEndReason> = {
  checkmate: DbEndReason.CHECKMATE,
  resignation: DbEndReason.RESIGNATION,
  timeout: DbEndReason.TIMEOUT,
  stalemate: DbEndReason.STALEMATE,
  insufficient: DbEndReason.INSUFFICIENT_MATERIAL,
  'fifty-moves': DbEndReason.FIFTY_MOVES,
  threefold: DbEndReason.THREEFOLD_REPETITION,
  fivefold: DbEndReason.FIVEFOLD_REPETITION,
  'seventy-five-moves': DbEndReason.SEVENTY_FIVE_MOVES,
  agreement: DbEndReason.AGREEMENT,
  aborted: DbEndReason.ABORTED,
  disconnect: DbEndReason.DISCONNECT,
};

const RESULT_FROM_DB: Record<DbGameResult, GameResult> = {
  [DbGameResult.WHITE]: 'white',
  [DbGameResult.BLACK]: 'black',
  [DbGameResult.DRAW]: 'draw',
};

const REASON_FROM_DB: Record<DbEndReason, EndReason> = {
  [DbEndReason.CHECKMATE]: 'checkmate',
  [DbEndReason.RESIGNATION]: 'resignation',
  [DbEndReason.TIMEOUT]: 'timeout',
  [DbEndReason.STALEMATE]: 'stalemate',
  [DbEndReason.INSUFFICIENT_MATERIAL]: 'insufficient',
  [DbEndReason.FIFTY_MOVES]: 'fifty-moves',
  [DbEndReason.THREEFOLD_REPETITION]: 'threefold',
  [DbEndReason.FIVEFOLD_REPETITION]: 'fivefold',
  [DbEndReason.SEVENTY_FIVE_MOVES]: 'seventy-five-moves',
  [DbEndReason.AGREEMENT]: 'agreement',
  [DbEndReason.ABORTED]: 'aborted',
  [DbEndReason.DISCONNECT]: 'disconnect',
};

export interface PlayerIdentity {
  id: string;
  username: string;
  displayName: string;
  isGuest: boolean;
}

export interface CreateGameOptions {
  white: PlayerIdentity | null;
  black: PlayerIdentity | null;
  rated: boolean;
  baseSec: number;
  incSec: number;
  opponent?: 'human' | 'computer';
}

interface LiveGame {
  game: Game;
  timer: NodeJS.Timeout | null;
  chain: Promise<void>;
  lastSnapshot: number;
  /** True once the end event has been queued; suppresses intermediate states. */
  ending: boolean;
  /** True when the finished game reached Postgres and the final state was sent. */
  endPersisted: boolean;
}

export type GameBroadcaster = (game: Game, event: GameEvent) => void;
export type GameFinishedHook = (game: Game) => void;

export class GameManager {
  private readonly games = new Map<string, LiveGame>();
  private readonly joinLocks = new Map<string, Promise<unknown>>();
  private broadcaster: GameBroadcaster | null = null;
  private finishedHook: GameFinishedHook | null = null;
  private disposed = false;

  constructor(private readonly now: () => number = Date.now) {}

  setBroadcaster(broadcaster: GameBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  onFinished(hook: GameFinishedHook): void {
    this.finishedHook = hook;
  }

  /** Creates and persists a game, seating whichever players are supplied. */
  async create(options: CreateGameOptions): Promise<Game> {
    const now = this.now();
    const category = classifyTimeControl(options);
    // `rated` is the creator's intent. startGame() downgrades it to casual when
    // the second seat is a guest, which keeps a rated room link honest instead
    // of silently turning casual at creation time.
    const rated = options.rated && isRatedAllowed(options);

    const white = options.white ? await this.buildPlayer(options.white, category) : null;
    const black = options.black ? await this.buildPlayer(options.black, category) : null;

    const game = new Game({
      id: newGameId(),
      rated,
      category,
      baseSec: options.baseSec,
      incSec: options.incSec,
      white,
      black,
      now,
      opponent: options.opponent ?? 'human',
    });

    await prisma.game.create({
      data: {
        id: game.id,
        status: DbGameStatus.WAITING,
        rated,
        category: DB_CATEGORY[category],
        baseSec: options.baseSec,
        incSec: options.incSec,
        opponent: options.opponent === 'computer' ? OpponentType.COMPUTER : OpponentType.HUMAN,
        whiteId: white?.userId ?? null,
        blackId: black?.userId ?? null,
        whiteName: white?.username ?? null,
        blackName: black?.username ?? null,
        whiteRating: white?.rating ?? null,
        blackRating: black?.rating ?? null,
        fen: game.chess.fen(),
        turn: 'w',
        whiteMs: game.clocks.w,
        blackMs: game.clocks.b,
        plyCount: 0,
        createdAt: new Date(now),
      },
    });

    this.register(game);
    // Pools, challenges and rematches are created with both players already
    // seated, so creation is the only place that can start them. Rooms start
    // later, when the second player calls joinSeat().
    if (game.seated) await this.startGame(game);
    logger.info({ gameId: game.id, category, rated }, 'game created');
    return game;
  }

  private register(game: Game): LiveGame {
    const live: LiveGame = {
      game,
      timer: null,
      chain: Promise.resolve(),
      lastSnapshot: this.now(),
      ending: false,
      endPersisted: false,
    };
    this.games.set(game.id, live);
    game.on((event) => this.handleEvent(live, event));
    return live;
  }

  private async buildPlayer(identity: PlayerIdentity, category: TimeCategory): Promise<PlayerState> {
    if (identity.isGuest) {
      return createPlayerState({
        userId: identity.id,
        username: identity.username,
        displayName: identity.displayName,
        isGuest: true,
        rating: 1500,
        rd: 350,
        category,
      });
    }
    const rating = await loadRating(identity.id, DB_CATEGORY[category]);
    return createPlayerState({
      userId: identity.id,
      username: identity.username,
      displayName: identity.displayName,
      isGuest: identity.isGuest,
      rating: rating.rating,
      rd: rating.rd,
      category,
    });
  }

  /** Returns a live game, hydrating it from Postgres when it is not in memory. */
  async get(gameId: string): Promise<Game | null> {
    const live = this.games.get(gameId);
    if (live) return live.game;
    return this.hydrate(gameId);
  }

  async hydrate(gameId: string): Promise<Game | null> {
    const row = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        moves: { orderBy: { ply: 'asc' } },
        chatLink: { include: { messages: { orderBy: { createdAt: 'asc' } } } },
      },
    });
    if (!row) return null;

    const userIds = [row.whiteId, row.blackId].filter((id): id is string => Boolean(id));
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          include: { ratings: true },
        })
      : [];
    const byId = new Map(users.map((user) => [user.id, user]));

    const category = Object.entries(DB_CATEGORY).find(([, value]) => value === row.category)?.[0] as
      | TimeCategory
      | undefined;

    const rowCategory = category ? DB_CATEGORY[category] : null;

    const makePlayer = (userId: string | null, rating: number | null): PlayerState | null => {
      if (!userId) return null;
      const user = byId.get(userId);
      // Restore the real deviation, otherwise every player comes back from a
      // restart looking provisional.
      const stored = rowCategory
        ? user?.ratings?.find((entry) => entry.category === rowCategory)
        : undefined;
      return createPlayerState({
        userId,
        username: user?.username ?? 'Player',
        displayName: user?.displayName ?? 'Player',
        isGuest: user?.isGuest ?? false,
        rating: rating ?? stored?.rating ?? null,
        rd: stored?.rd ?? null,
        category: category ?? 'blitz',
      });
    };

    const now = this.now();
    const game = new Game({
      id: row.id,
      rated: row.rated,
      category: category ?? 'blitz',
      baseSec: row.baseSec,
      incSec: row.incSec,
      white: makePlayer(row.whiteId, row.whiteRating),
      black: makePlayer(row.blackId, row.blackRating),
      now,
      opponent: row.opponent === OpponentType.COMPUTER ? 'computer' : 'human',
      engineLevel: row.engineLevel ?? null,
      createdAt: row.createdAt.getTime(),
      status:
        row.status === DbGameStatus.FINISHED
          ? 'finished'
          : row.status === DbGameStatus.ABORTED
            ? 'aborted'
            : row.status === DbGameStatus.STARTED
              ? 'started'
              : 'waiting',
      startedAt: row.startedAt ? row.startedAt.getTime() : null,
      chatState: row.chatLink?.state === 'OPEN' ? 'open' : row.chatLink?.state === 'REQUESTED' ? 'requested' : row.chatLink?.state === 'DECLINED' ? 'declined' : 'none',
      chatMessages: (row.chatLink?.messages ?? []).map((message) => ({
        id: message.id,
        senderId: message.senderId,
        senderName: byId.get(message.senderId)?.username ?? 'Player',
        body: message.body,
        at: message.createdAt.getTime(),
      })),
    });

    // Replay the stored moves so the board is authoritative even after a restart.
    for (const move of row.moves) {
      try {
        game.replayMove(move.uci);
        const record = game.moves[game.moves.length - 1]!;
        record.clockAfterMs = move.clockAfterMs;
        record.chargedMs = move.chargedMs;
        record.lagCompMs = move.lagCompMs;
      } catch (error) {
        logger.error({ err: error, gameId: row.id, ply: move.ply }, 'failed to replay move');
      }
    }

    if (row.status === DbGameStatus.FINISHED || row.status === DbGameStatus.ABORTED) {
      game.result = row.result ? RESULT_FROM_DB[row.result] : null;
      game.reason = row.reason ? REASON_FROM_DB[row.reason] : null;
      game.endedAt = row.endedAt ? row.endedAt.getTime() : null;
      game.ratingsAfter = {
        whiteBefore: row.whiteRating ?? null,
        whiteAfter: row.whiteRatingAfter ?? null,
        blackBefore: row.blackRating ?? null,
        blackAfter: row.blackRatingAfter ?? null,
      };
    }

    game.clocks.w = row.whiteMs;
    game.clocks.b = row.blackMs;
    game.chatRequestedBy =
      row.chatLink?.requestedBy && row.chatLink.requestedBy === row.whiteId
        ? 'w'
        : row.chatLink?.requestedBy && row.chatLink.requestedBy === row.blackId
          ? 'b'
          : null;

    // A finished game is read-only. Hydrating it must not keep it in the live
    // map, or every visit to a history page leaks an entry forever.
    if (row.status === DbGameStatus.FINISHED || row.status === DbGameStatus.ABORTED) {
      return game;
    }

    const live = this.register(game);

    if (game.status === 'started') {
      // Downtime is never adjudicated: the clock resumes after a grace period.
      game.turnStartedAt = now + RESUME_GRACE_MS;
      this.schedule(live);
      logger.info({ gameId: game.id }, 'resumed game after restart with grace period');
    }

    return game;
  }

  /** Seats a player in an open seat and starts the game when both are filled. */
  async joinSeat(
    gameId: string,
    identity: PlayerIdentity,
  ): Promise<{ game: Game; color: Color } | null> {
    const prevLock = this.joinLocks.get(gameId) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.joinLocks.set(gameId, prevLock.then(() => lock));

    try {
      await prevLock;
      return await this.performJoinSeat(gameId, identity);
    } finally {
      release();
      if (this.joinLocks.get(gameId) === lock) {
        this.joinLocks.delete(gameId);
      }
    }
  }

  private async performJoinSeat(
    gameId: string,
    identity: PlayerIdentity,
  ): Promise<{ game: Game; color: Color } | null> {
    const game = await this.get(gameId);
    if (!game) return null;
    const existing = game.colorFor(identity.id);
    if (existing) return { game, color: existing };
    if (game.status !== 'waiting') return null;

    const color: Color | null = !game.white ? 'w' : !game.black ? 'b' : null;
    if (!color) return null;

    // Check if the seat is already taken
    if (game.playerFor(color)) return null;

    const player = await this.buildPlayer(identity, game.category);

    // Re-verify after async buildPlayer
    const recheckedExisting = game.colorFor(identity.id);
    if (recheckedExisting) return { game, color: recheckedExisting };
    if (game.playerFor(color)) return null;

    try {
      game.seat(color, player);
    } catch {
      return null;
    }

    await prisma.game.update({
      where: { id: game.id },
      data:
        color === 'w'
          ? {
              whiteId: player.userId,
              whiteName: player.username,
              whiteRating: player.rating,
            }
          : {
              blackId: player.userId,
              blackName: player.username,
              blackRating: player.rating,
            },
    });

    const live = this.games.get(game.id);
    if (live) this.broadcast(live, { type: 'event', kind: 'opponent-joined', by: color });

    if (game.seated) await this.startGame(game);
    return { game, color };
  }

  async startGame(game: Game): Promise<void> {
    // A rated game needs two registered players. Rooms persist the creator's
    // intent before the second seat exists, so re-check the invariant when the
    // game actually starts.
    if (game.rated && (!game.white || !game.black || game.white.isGuest || game.black.isGuest)) {
      game.setRated(false);
    }
    if (!game.start(this.now())) return;
    const live = this.games.get(game.id);
    await prisma.game.update({
      where: { id: game.id },
      data: {
        status: DbGameStatus.STARTED,
        rated: game.rated,
        startedAt: new Date(game.startedAt ?? this.now()),
        whiteMs: game.clocks.w,
        blackMs: game.clocks.b,
        fen: game.chess.fen(),
      },
    });
    if (live) this.schedule(live);
    await this.openFriendChat(game);
    logger.info({ gameId: game.id, rated: game.rated }, 'game started');
  }

  /**
   * Friends skip the chat consent request: when a game starts between two
   * registered friends the chat link is opened immediately.
   */
  private async openFriendChat(game: Game): Promise<void> {
    if (!game.white || !game.black) return;
    if (game.white.isGuest || game.black.isGuest) return;
    if (game.chatState === 'open') return;
    const friendship = await prisma.friendship.findFirst({
      where: {
        status: 'ACCEPTED',
        OR: [
          { requesterId: game.white.userId, addresseeId: game.black.userId },
          { requesterId: game.black.userId, addresseeId: game.white.userId },
        ],
      },
      select: { id: true },
    });
    if (!friendship) return;
    await prisma.chatLink.upsert({
      where: { gameId: game.id },
      update: { state: 'OPEN', requestedBy: null },
      create: { gameId: game.id, state: 'OPEN' },
    });
    game.setChatState('open');
  }

  // --------------------------------------------------------------- event flow

  private handleEvent(live: LiveGame, event: GameEvent): void {
    if (event.type === 'move') {
      this.enqueue(live, () => this.persistMove(live, event.move));
      this.schedule(live);
      this.broadcast(live, event);
      return;
    }

    if (event.type === 'ended') {
      // Ratings are written in the same transaction as the finished game, so
      // the final broadcast (which carries the rating deltas) must wait for it.
      live.ending = true;
      this.enqueue(live, async () => {
        await this.persistEnd(live);
        this.broadcast(live, event);
      });
      return;
    }

    // Any snapshot emitted while the final write is still in flight would show
    // the pre-rating state; skip it, the authoritative one follows. Once the
    // result has landed, snapshots flow again (chat, rematch offers, joins).
    if (live.ending && !live.endPersisted && event.type === 'state') return;
    this.broadcast(live, event);
  }

  private enqueue(live: LiveGame, task: () => Promise<void>): void {
    live.chain = live.chain.then(task).catch((error) => {
      logger.error({ err: error, gameId: live.game.id }, 'game persistence failed');
    });
  }

  private async persistMove(live: LiveGame, move: MoveRecord): Promise<void> {
    const game = live.game;
    await prisma.$transaction([
      prisma.move.create({
        data: {
          gameId: game.id,
          ply: move.ply,
          uci: move.uci,
          san: move.san,
          chargedMs: move.chargedMs,
          clockAfterMs: move.clockAfterMs,
          lagCompMs: move.lagCompMs,
        },
      }),
      prisma.game.update({
        where: { id: game.id },
        data: {
          fen: game.chess.fen(),
          plyCount: game.moves.length,
          turn: game.chess.turn(),
          whiteMs: game.clocks.w,
          blackMs: game.clocks.b,
        },
      }),
    ]);
  }

  private async persistEnd(live: LiveGame): Promise<void> {
    const game = live.game;
    if (live.timer) {
      clearTimeout(live.timer);
      live.timer = null;
    }

    // One retry: a transient connection drop should not leave a finished game
    // marked STARTED in the database, which recovery would then treat as live.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.commitEnd(game);
        live.endPersisted = true;
        this.finishedHook?.(game);
        this.scheduleEviction(live);
        logger.info(
          { gameId: game.id, result: game.result, reason: game.reason, rated: game.rated },
          'game finished',
        );
        return;
      } catch (error) {
        if (attempt === 1) {
          logger.error(
            { err: error, gameId: game.id },
            'could not persist finished game; keeping it in memory for recovery',
          );
          return;
        }
        logger.warn({ err: error, gameId: game.id }, 'retrying finished-game write');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  /**
   * The game row, both rating rows and both rating-change rows commit together.
   * Either the whole result lands or none of it does.
   */
  private async commitEnd(game: Game): Promise<void> {
    const applied = await prisma.$transaction(async (tx) => {
      const ratings = this.shouldRate(game) ? await this.applyRatings(tx, game) : null;
      await tx.game.update({
        where: { id: game.id },
        data: {
          status: game.status === 'aborted' ? DbGameStatus.ABORTED : DbGameStatus.FINISHED,
          result: game.result ? RESULT_TO_DB[game.result] : null,
          reason: game.reason ? REASON_TO_DB[game.reason] : null,
          endedAt: new Date(game.endedAt ?? this.now()),
          fen: game.chess.fen(),
          plyCount: game.moves.length,
          whiteMs: game.clocks.w,
          blackMs: game.clocks.b,
          pgn: buildPgn(game),
          whiteRatingAfter: ratings?.whiteAfter ?? null,
          blackRatingAfter: ratings?.blackAfter ?? null,
        },
      });
      return ratings;
    }, END_TRANSACTION_OPTIONS);

    if (applied) {
      game.ratingsAfter.whiteBefore = applied.whiteBefore;
      game.ratingsAfter.blackBefore = applied.blackBefore;
      game.ratingsAfter.whiteAfter = applied.whiteAfter;
      game.ratingsAfter.blackAfter = applied.blackAfter;
      if (game.white) {
        game.white.rating = applied.whiteAfter;
        game.white.provisional = applied.whiteRdAfter > 110;
        game.white.rd = applied.whiteRdAfter;
      }
      if (game.black) {
        game.black.rating = applied.blackAfter;
        game.black.provisional = applied.blackRdAfter > 110;
        game.black.rd = applied.blackRdAfter;
      }
    }
  }

  private shouldRate(game: Game): boolean {
    if (!game.rated || !game.white || !game.black || !game.result) return false;
    if (game.status === 'aborted') return false;
    return !game.white.isGuest && !game.black.isGuest;
  }

  private async applyRatings(
    tx: Prisma.TransactionClient,
    game: Game,
  ): Promise<{
    whiteBefore: number;
    blackBefore: number;
    whiteAfter: number;
    blackAfter: number;
    whiteRdAfter: number;
    blackRdAfter: number;
  }> {
    const category = DB_CATEGORY[game.category];
    const whiteId = game.white!.userId;
    const blackId = game.black!.userId;

    // Lock both rows. Two games finishing at the same moment now serialise
    // here instead of both reading the same starting rating and one overwriting
    // the other's result. ORDER BY makes the lock order deterministic, which is
    // what stops two such games from deadlocking on each other's rows.
    const locked = await tx.$queryRaw<
      Array<{ userId: string; rating: number; rd: number; volatility: number }>
    >`
      SELECT "userId", rating, rd, volatility
      FROM "Rating"
      WHERE category = ${category}::"TimeCategory"
        AND ("userId" = ${whiteId} OR "userId" = ${blackId})
      ORDER BY "userId"
      FOR UPDATE
    `;
    const find = (id: string) =>
      locked.find((row) => row.userId === id) ?? {
        userId: id,
        rating: 1500,
        rd: 350,
        volatility: 0.06,
      };

    const whiteBefore = find(whiteId);
    const blackBefore = find(blackId);

    const whiteScore = game.result === 'white' ? 1 : game.result === 'draw' ? 0.5 : 0;
    const blackScore = 1 - whiteScore;

    const nextWhite = updateGlicko2(whiteBefore, [
      { rating: blackBefore.rating, rd: blackBefore.rd, score: whiteScore },
    ]);
    const nextBlack = updateGlicko2(blackBefore, [
      { rating: whiteBefore.rating, rd: whiteBefore.rd, score: blackScore },
    ]);

    const whiteAfter = roundRating(nextWhite.rating);
    const blackAfter = roundRating(nextBlack.rating);

    // Both rating rows move in one statement: one round trip instead of two,
    // and no window where only half a result has landed.
    await tx.$executeRaw`
      INSERT INTO "Rating" ("userId", category, rating, rd, volatility, games, "updatedAt")
      VALUES
        (${whiteId}, ${category}::"TimeCategory", ${whiteAfter}, ${nextWhite.rd}, ${nextWhite.volatility}, 1, now()),
        (${blackId}, ${category}::"TimeCategory", ${blackAfter}, ${nextBlack.rd}, ${nextBlack.volatility}, 1, now())
      ON CONFLICT ("userId", category) DO UPDATE SET
        rating = EXCLUDED.rating,
        rd = EXCLUDED.rd,
        volatility = EXCLUDED.volatility,
        games = "Rating".games + 1,
        "updatedAt" = now()
    `;

    await tx.ratingChange.createMany({
      data: [
        {
          id: randomUUID(),
          userId: whiteId,
          gameId: game.id,
          category,
          before: whiteBefore.rating,
          after: whiteAfter,
          delta: ratingDelta(whiteBefore.rating, whiteAfter),
          rdAfter: nextWhite.rd,
        },
        {
          id: randomUUID(),
          userId: blackId,
          gameId: game.id,
          category,
          before: blackBefore.rating,
          after: blackAfter,
          delta: ratingDelta(blackBefore.rating, blackAfter),
          rdAfter: nextBlack.rd,
        },
      ],
    });

    return {
      whiteBefore: whiteBefore.rating,
      blackBefore: blackBefore.rating,
      whiteAfter,
      blackAfter,
      whiteRdAfter: nextWhite.rd,
      blackRdAfter: nextBlack.rd,
    };
  }

  // -------------------------------------------------------------------- timer

  /** Drops a finished game from memory so the map cannot grow forever. */
  private scheduleEviction(live: LiveGame): void {
    const timer = setTimeout(() => {
      if (this.games.get(live.game.id) === live) this.games.delete(live.game.id);
    }, FINISHED_GAME_TTL_MS);
    timer.unref?.();
  }

  schedule(live: LiveGame): void {
    if (live.timer) {
      clearTimeout(live.timer);
      live.timer = null;
    }
    if (this.disposed) return;
    const delay = live.game.msUntilFlagCheck(this.now());
    if (delay === null) return;

    live.timer = setTimeout(() => {
      live.timer = null;
      try {
        const ended = live.game.checkClock(this.now());
        if (!ended) this.schedule(live);
      } catch (error) {
        logger.error({ err: error, gameId: live.game.id }, 'flag check failed');
      }
    }, Math.min(delay + 15, 2 ** 31 - 1));
    live.timer.unref?.();
  }

  // --------------------------------------------------------------- broadcasting

  private broadcast(live: LiveGame, event: GameEvent): void {
    live.lastSnapshot = this.now();
    try {
      this.broadcaster?.(live.game, event);
    } catch (error) {
      logger.error({ err: error, gameId: live.game.id }, 'broadcast failed');
    }
  }

  snapshotFor(game: Game, viewerId?: string | null): GameSnapshot {
    const viewer = viewerId ? game.colorFor(viewerId) : null;
    return game.snapshot(this.now(), viewer ?? undefined);
  }

  /**
   * Incremental payload for a move: everything except the growing move list,
   * plus the move that was just played. Keeps per-move traffic constant instead
   * of resending the whole game each ply.
   */
  moveSnapshotFor(game: Game, move: MoveRecord): GameMovePayload {
    const { moves: _moves, ...rest } = game.snapshot(this.now());
    return { ...rest, move };
  }

  // ----------------------------------------------------------------- recovery

  /** Loads unfinished games back into memory after a restart. */
  async recover(): Promise<number> {
    const rows = await prisma.game.findMany({
      where: { status: DbGameStatus.STARTED },
      select: { id: true },
    });
    let recovered = 0;
    for (const row of rows) {
      try {
        const game = await this.hydrate(row.id);
        if (game) recovered += 1;
      } catch (error) {
        logger.error({ err: error, gameId: row.id }, 'failed to recover game');
      }
    }
    if (recovered > 0) logger.info({ recovered }, 'recovered unfinished games');
    return recovered;
  }

  /** Synchronous access to a hydrated game (null when not in memory). */
  peek(gameId: string): Game | null {
    return this.games.get(gameId)?.game ?? null;
  }

  /**
   * Waits for queued persistence for one game. Used by shutdown and by
   * integration tests that need the final write to have landed.
   */
  async flush(gameId: string): Promise<void> {
    await this.games.get(gameId)?.chain;
  }

  get liveCount(): number {
    return this.games.size;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const live of this.games.values()) {
      if (live.timer) clearTimeout(live.timer);
    }
    this.games.clear();
    await Promise.resolve();
  }
}

/** Builds a PGN from a game's move list. */
export function buildPgn(game: Game): string {
  const white = game.white?.displayName ?? 'White';
  const black = game.black?.displayName ?? 'Black';
  const resultTag =
    game.result === 'white' ? '1-0' : game.result === 'black' ? '0-1' : game.result === 'draw' ? '1/2-1/2' : '*';
  const headers = [
    `[Event "ChessForge ${formatTimeControl({ baseSec: game.baseSec, incSec: game.incSec })}"]`,
    `[Site "ChessForge"]`,
    `[Date "${new Date(game.startedAt ?? game.createdAt).toISOString().slice(0, 10).replace(/-/g, '.')}"]`,
    `[White "${white}"]`,
    `[Black "${black}"]`,
    `[Result "${resultTag}"]`,
    `[TimeControl "${game.baseSec}+${game.incSec}"]`,
  ];

  const body: string[] = [];
  let line = '';
  game.moves.forEach((move, index) => {
    if (index % 2 === 0) line += `${index / 2 + 1}. `;
    line += `${move.san} `;
    if (line.length >= 76) {
      body.push(line.trim());
      line = '';
    }
  });
  if (line.trim()) body.push(line.trim());
  body.push(resultTag);

  return `${headers.join('\n')}\n\n${body.join('\n')}\n`;
}

