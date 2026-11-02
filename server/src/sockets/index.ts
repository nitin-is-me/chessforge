/**
 * Socket.IO layer: the only place where client input reaches the game rules.
 * Every payload is validated with zod, every game action is authorised against
 * the socket's session, and all state the client sees comes from the server.
 */
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { prisma } from '../db.js';
import { logger } from '../log.js';
import { readSessionToken, resolveSession, ratingsPayload, type SessionUser } from '../auth/session.js';
import { loadConfig } from '../env.js';
import type { GameManager, PlayerIdentity } from '../game/manager.js';
import { GameError, type Game } from '../game/Game.js';
import type { PresenceService } from '../presence.js';
import type { Matchmaker } from '../matchmaking/pools.js';
import { DB_CATEGORY, loadRating } from '../rating/service.js';
import { classifyTimeControl } from '@shared/timeControl.js';
import { gamesFinished, movesPlayed } from '../metrics.js';
import {
  challengeSchema,
  chatSendSchema,
  claimSchema,
  gameMoveSchema,
  joinGameSchema,
  poolJoinSchema,
  type ChallengeView,
  type ClientToServerEvents,
  type FriendsPayload,
  type ServerToClientEvents,
  type ServerError,
} from '@shared/protocol.js';
import { RateLimiter } from '../http/rate-limit.js';

export interface SocketData {
  userId: string;
  user: SessionUser;
  games: Set<string>;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface SocketDeps {
  manager: GameManager;
  presence: PresenceService;
  matchmaker: Matchmaker;
}

interface PendingChallenge {
  id: string;
  fromId: string;
  fromName: string;
  fromDisplay: string;
  fromRating: number | null;
  fromProvisional: boolean;
  toId: string;
  baseSec: number;
  incSec: number;
  rated: boolean;
  createdAt: number;
}

const challenges = new Map<string, PendingChallenge>();

function identityOf(user: SessionUser): PlayerIdentity {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isGuest: user.isGuest,
  };
}

function serverError(error: unknown): ServerError {
  if (error instanceof GameError) return { code: error.code, message: error.message };
  if (error instanceof z.ZodError) {
    return { code: 'invalid-payload', message: error.issues[0]?.message ?? 'Invalid request' };
  }
  logger.error({ err: error }, 'socket handler failed');
  return { code: 'internal', message: 'Something went wrong' };
}

async function ensureChatLink(gameId: string): Promise<string> {
  const existing = await prisma.chatLink.findUnique({ where: { gameId } });
  if (existing) return existing.id;
  const created = await prisma.chatLink.create({ data: { gameId } });
  return created.id;
}

/** Sends a friend state refresh to both sides of a friendship change. */
export async function pushFriendsUpdate(
  io: IO,
  userIds: string[],
  presence: PresenceService,
): Promise<void> {
  for (const userId of new Set(userIds)) {
    const payload = await buildFriendsPayload(userId, presence);
    io.to(`user:${userId}`).emit('friends:update', payload);
  }
}

async function buildFriendsPayload(
  userId: string,
  presence: PresenceService,
): Promise<FriendsPayload> {
  // Fetch blocks so we can filter them out of all lists.
  const [blocks, rows] = await Promise.all([
    prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }),
    prisma.friendship.findMany({
      where: {
        status: { in: ['ACCEPTED', 'PENDING'] },
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: { requester: { include: { ratings: true } }, addressee: { include: { ratings: true } } },
    }),
  ]);

  const blockedIds = new Set<string>();
  for (const block of blocks) {
    blockedIds.add(block.blockerId === userId ? block.blockedId : block.blockerId);
  }

  const friends: FriendsPayload['friends'] = [];
  const incoming: FriendsPayload['friends'] = [];
  const outgoing: FriendsPayload['friends'] = [];

  for (const row of rows) {
    const isRequester = row.requesterId === userId;
    const other = isRequester ? row.addressee : row.requester;
    if (blockedIds.has(other.id)) continue;
    const view = {
      id: other.id,
      username: other.username,
      displayName: other.displayName,
      online: presence.online(other.id),
      playing: presence.playing(other.id),
      ratings: ratingsPayload(other.ratings),
    };
    if (row.status === 'ACCEPTED') friends.push(view);
    else if (isRequester) outgoing.push(view);
    else incoming.push(view);
  }

  // Build the blocked list.
  const blocked: typeof friends = [];
  for (const block of blocks) {
    const blockedId = block.blockerId === userId ? block.blockedId : block.blockerId;
    const blockedUser = await prisma.user.findUnique({
      where: { id: blockedId, deletedAt: null },
      include: { ratings: true },
    });
    if (!blockedUser) continue;
    blocked.push({
      id: blockedUser.id,
      username: blockedUser.username,
      displayName: blockedUser.displayName,
      online: presence.online(blockedUser.id),
      playing: presence.playing(blockedUser.id),
      ratings: ratingsPayload(blockedUser.ratings),
    });
  }

  return { friends, incoming, outgoing, blocked };
}

async function notifyPresence(io: IO, userId: string, online: boolean, playing: boolean): Promise<void> {
  const rows = await prisma.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { requesterId: true, addresseeId: true },
  });
  for (const row of rows) {
    const other = row.requesterId === userId ? row.addresseeId : row.requesterId;
    io.to(`user:${other}`).emit('presence:update', { userId, online, playing });
  }
}

/** Wires game events to the sockets watching that game. */
export function bindBroadcaster(io: IO, manager: GameManager): void {
  manager.setBroadcaster((game, event) => {
    const room = `game:${game.id}`;

    if (event.type === 'move') {
      movesPlayed.inc();
      // Incremental payload: constant size per ply, no full move list.
      io.to(room).emit('game:move', manager.moveSnapshotFor(game, event.move));
      return;
    }

    if (event.type === 'ended') {
      gamesFinished.inc({ reason: event.reason });
      // The manager only broadcasts this after the result and both ratings are
      // committed, so these deltas are the real ones.
      io.to(room).emit('game:state', manager.snapshotFor(game));
      io.to(room).emit('game:ended', {
        result: event.result,
        reason: event.reason,
        ratings: game.ratingsAfter,
        serverNow: Date.now(),
      });
      return;
    }

    if (event.type === 'chat') {
      io.to(room).emit('game:chat', { state: event.state, message: event.message });
      // Chat state lives in the snapshot, so refresh it for consent UI.
      io.to(room).emit('game:state', manager.snapshotFor(game));
      return;
    }

    if (event.type === 'event') {
      io.to(room).emit('game:event', { type: event.kind, by: event.by });
    }

    io.to(room).emit('game:state', manager.snapshotFor(game));
  });
}

export function attachSockets(io: IO, deps: SocketDeps): { dispose: () => void } {
  const config = loadConfig();

  // When a player drops, the opponent's absence claim unlocks `absenceClaimSec`
  // later, and nothing else triggers a snapshot at that instant. Push one at
  // the deadline so the claim button actually appears.
  const absenceTimers = new Map<string, NodeJS.Timeout>();
  const refreshAbsenceState = (game: Game): void => {
    const existing = absenceTimers.get(game.id);
    if (existing) {
      clearTimeout(existing);
      absenceTimers.delete(game.id);
    }
    const due = game.absenceClaimDueIn(Date.now());
    if (due === null) return;
    const timer = setTimeout(() => {
      absenceTimers.delete(game.id);
      if (!deps.manager.peek(game.id)) return;
      io.to(`game:${game.id}`).emit('game:state', deps.manager.snapshotFor(game));
    }, Math.min(due + 50, 2 ** 31 - 1));
    timer.unref?.();
    absenceTimers.set(game.id, timer);
  };
  const allowedOrigins = new Set([config.appOrigin, config.clientDevOrigin]);
  if (!config.isProduction) {
    for (const host of ['localhost', '127.0.0.1']) {
      allowedOrigins.add(`http://${host}:5173`);
      allowedOrigins.add(`http://${host}:${config.port}`);
    }
  }

  io.use(async (socket, next) => {
    try {
      // Browsers send Origin on the WebSocket handshake. Rejecting a foreign
      // one blocks cross-site socket hijacking; non-browser clients that omit
      // it still have to present the session cookie below.
      const origin = socket.handshake.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        logger.warn({ origin }, 'socket rejected: origin not allowed');
        next(new Error('unauthorized'));
        return;
      }
      const headers = socket.handshake.headers as unknown as Record<string, unknown>;
      const token = readSessionToken({ headers });
      const user = await resolveSession(token);
      if (!user) {
        next(new Error('unauthorized'));
        return;
      }
      socket.data.user = user;
      socket.data.userId = user.id;
      socket.data.games = new Set();
      next();
    } catch (error) {
      logger.warn({ err: error }, 'socket auth failed');
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: GameSocket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    deps.presence.add(user.id, socket.id);
    void notifyPresence(io, user.id, true, deps.presence.playing(user.id));

    const moveLimiter = new RateLimiter(30, 5_000);
    const chatLimiter = new RateLimiter(6, 10_000);
    const actionLimiter = new RateLimiter(30, 10_000);

    // -------------------------------------------------------------- clock sync
    socket.on('time:sync', (payload) => {
      const sentAt = typeof payload?.sentAt === 'number' ? payload.sentAt : Date.now();
      socket.emit('time:sync', { sentAt, serverNow: Date.now() });
    });

    // ------------------------------------------------------------------- games
    socket.on('game:join', async (payload, ack) => {
      try {
        const { gameId } = joinGameSchema.parse(payload);
        let game: Game | null = await deps.manager.get(gameId);
        if (!game) {
          socket.emit('game:error', { code: 'not-found', message: 'Game not found' });
          ack?.({ ok: false, error: { code: 'not-found', message: 'Game not found' } });
          return;
        }

        if (!game.colorFor(user.id) && game.status === 'waiting') {
          // Block check: a player who blocks (or is blocked by) the room creator
          // cannot join. This also prevents a blocked user from being matched
          // into a room they created via a direct link.
          const opponentId = game.white?.userId ?? game.black?.userId;
          if (opponentId) {
            const block = await prisma.block.findFirst({
              where: { OR: [{ blockerId: user.id, blockedId: opponentId }, { blockerId: opponentId, blockedId: user.id }] },
            });
            if (block) {
              socket.emit('game:error', { code: 'blocked', message: 'You cannot join this game' });
              ack?.({ ok: false, error: { code: 'blocked', message: 'You cannot join this game' } });
              return;
            }
          }
          const seated = await deps.manager.joinSeat(gameId, identityOf(user));
          if (seated) game = seated.game;
        }

        socket.join(`game:${gameId}`);
        socket.data.games.add(gameId);
        const color = game.attach(user.id, socket.id, Date.now());
        if (color && game.status === 'started') deps.presence.setPlaying(user.id, gameId);
        // Coming back cancels any pending absence unlock.
        refreshAbsenceState(game);

        socket.emit('game:state', deps.manager.snapshotFor(game, user.id));
        if (color && game.status === 'started') {
          io.to(`game:${gameId}`).emit('game:state', deps.manager.snapshotFor(game));
        }
        ack?.({ ok: true });
      } catch (error) {
        const err = serverError(error);
        socket.emit('game:error', err);
        ack?.({ ok: false, error: err });
      }
    });

    socket.on('game:leave', (payload) => {
      const gameId = String(payload?.gameId ?? '');
      const game = deps.manager.peek(gameId);
      socket.leave(`game:${gameId}`);
      socket.data.games.delete(gameId);
      if (game) {
        game.detach(user.id, socket.id, Date.now());
        io.to(`game:${gameId}`).emit('game:state', deps.manager.snapshotFor(game));
        refreshAbsenceState(game);
      }
      deps.presence.setPlaying(user.id, null);
    });

    socket.on('game:move', (payload) => {
      try {
        if (!moveLimiter.take(socket.id)) {
          socket.emit('game:error', { code: 'too-fast', message: 'Slow down' });
          return;
        }
        const { gameId, uci, ply } = gameMoveSchema.parse(payload);
        const game = deps.manager.peek(gameId);
        if (!game) {
          socket.emit('game:error', { code: 'not-found', message: 'Game not found' });
          return;
        }
        game.move(user.id, uci, ply, Date.now());
      } catch (error) {
        socket.emit('game:error', serverError(error));
      }
    });

    const withGame =
      (handler: (game: Game, payload: Record<string, unknown>) => void | Promise<void>) =>
      async (payload: { gameId?: string }) => {
      try {
        if (!actionLimiter.take(socket.id)) {
          socket.emit('game:error', { code: 'too-fast', message: 'Slow down' });
          return;
        }
        const gameId = String(payload?.gameId ?? '');
        const game = deps.manager.peek(gameId);
        if (!game || !game.colorFor(user.id)) {
          socket.emit('game:error', { code: 'not-a-player', message: 'You are not playing this game' });
          return;
        }
        await handler(game, (payload ?? {}) as Record<string, unknown>);
      } catch (error) {
        socket.emit('game:error', serverError(error));
      }
    };

    socket.on(
      'game:resign',
      withGame((game) => game.resign(user.id, Date.now())),
    );
    socket.on(
      'game:abort',
      withGame((game) => game.abort(user.id, Date.now())),
    );
    socket.on(
      'game:draw-offer',
      withGame((game) => game.offerDraw(user.id)),
    );
    socket.on(
      'game:draw-accept',
      withGame((game) => game.respondDraw(user.id, true, Date.now())),
    );
    socket.on(
      'game:draw-decline',
      withGame((game) => game.respondDraw(user.id, false, Date.now())),
    );
    socket.on(
      'game:claim',
      withGame((game, payload) => {
        const parsed = claimSchema.safeParse({ gameId: game.id, kind: payload.kind });
        if (!parsed.success) throw new GameError('invalid', 'Unknown claim');
        game.claim(user.id, parsed.data.kind, Date.now());
      }),
    );

    socket.on(
      'game:rematch',
      withGame((game) => {
        game.offerRematch(user.id);
      }),
    );

    socket.on(
      'game:rematch-accept',
      withGame(async (game) => {
        if (game.status === 'started' || game.status === 'waiting') {
          throw new GameError('not-finished', 'Game is still running');
        }
        const color = game.colorFor(user.id);
        if (!color || game.rematchOfferBy !== (color === 'w' ? 'b' : 'w')) {
          throw new GameError('no-offer', 'Your opponent has not offered a rematch');
        }
        const white = game.white!;
        const black = game.black!;
        const next = await deps.manager.create({
          // Colours swap for the rematch.
          white: { id: black.userId, username: black.username, displayName: black.displayName, isGuest: black.isGuest },
          black: { id: white.userId, username: white.username, displayName: white.displayName, isGuest: white.isGuest },
          rated: game.rated,
          baseSec: game.baseSec,
          incSec: game.incSec,
        });
        io.to(`game:${game.id}`).emit('game:rematch-started', { gameId: next.id });
      }),
    );

    // -------------------------------------------------------------------- chat
    socket.on(
      'game:chat-request',
      withGame(async (game) => {
        if (game.chatState === 'open') return;
        game.requestChat(user.id);
        const linkId = await ensureChatLink(game.id);
        await prisma.chatLink.update({
          where: { id: linkId },
          data: { state: 'REQUESTED', requestedBy: user.id },
        });
      }),
    );

    socket.on(
      'game:chat-accept',
      withGame(async (game) => {
        if (game.chatState !== 'requested') return;
        const color = game.colorFor(user.id);
        // Only the player who did not ask may accept.
        if (!color || game.chatRequestedBy === color) {
          throw new GameError('not-requested', 'You cannot answer your own chat request');
        }
        const linkId = await ensureChatLink(game.id);
        game.setChatState('open');
        await prisma.chatLink.update({ where: { id: linkId }, data: { state: 'OPEN', requestedBy: null } });
      }),
    );

    socket.on(
      'game:chat-decline',
      withGame(async (game) => {
        if (game.chatState !== 'requested') return;
        const color = game.colorFor(user.id);
        if (!color || game.chatRequestedBy === color) {
          throw new GameError('not-requested', 'You cannot answer your own chat request');
        }
        const linkId = await ensureChatLink(game.id);
        game.setChatState('declined');
        await prisma.chatLink.update({ where: { id: linkId }, data: { state: 'DECLINED', requestedBy: null } });
      }),
    );

    socket.on('game:chat-send', async (payload) => {
      try {
        if (!chatLimiter.take(socket.id)) throw new GameError('too-fast', 'You are sending too fast');
        const parsed = chatSendSchema.parse(payload);
        const game = deps.manager.peek(parsed.gameId);
        if (!game || !game.colorFor(user.id)) {
          throw new GameError('not-a-player', 'You are not playing this game');
        }
        if (game.chatState !== 'open') throw new GameError('chat-closed', 'Chat is not open');

        const messageId = randomUUID();
        const now = Date.now();
        game.addChatMessage({
          id: messageId,
          senderId: user.id,
          senderName: user.username,
          body: parsed.body,
          at: now,
        });

        void (async () => {
          try {
            const linkId = await ensureChatLink(game.id);
            await prisma.message.create({
              data: { id: messageId, chatLinkId: linkId, senderId: user.id, body: parsed.body },
            });
          } catch (err) {
            logger.error({ err, gameId: game.id }, 'failed to persist chat message');
          }
        })();
      } catch (error) {
        socket.emit('game:error', serverError(error));
      }
    });

    // -------------------------------------------------------------------- pool
    socket.on('pool:join', async (payload) => {
      try {
        const parsed = poolJoinSchema.safeParse(payload);
        if (!parsed.success) throw new GameError('invalid', 'Invalid time control');
        const { baseSec, incSec } = parsed.data;
        const rated = parsed.data.rated && !user.isGuest;
        const category = classifyTimeControl({ baseSec, incSec });
        const rating = await loadRating(user.id, DB_CATEGORY[category]);

        deps.matchmaker.join({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          isGuest: user.isGuest,
          socketId: socket.id,
          rating: rating.rating,
          baseSec,
          incSec,
          rated,
        });
      } catch (error) {
        socket.emit('game:error', serverError(error));
      }
    });

    socket.on('pool:leave', () => {
      deps.matchmaker.leave(user.id);
      socket.emit('pool:status', null);
    });

    // --------------------------------------------------------------- challenges
    socket.on('challenge:send', async (payload) => {
      try {
        if (user.isGuest) throw new GameError('guest', 'Create an account to challenge friends');
        const parsed = challengeSchema.safeParse(payload);
        if (!parsed.success) throw new GameError('invalid', 'Invalid challenge');
        const target = await prisma.user.findFirst({
          where: { usernameLower: parsed.data.username.toLowerCase(), deletedAt: null },
        });
        if (!target) throw new GameError('not-found', 'No such player');
        if (target.id === user.id) throw new GameError('self', 'You cannot challenge yourself');

        const block = await prisma.block.findFirst({
          where: { OR: [{ blockerId: user.id, blockedId: target.id }, { blockerId: target.id, blockedId: user.id }] },
        });
        if (block) throw new GameError('blocked', 'You cannot challenge this player');

        const friendship = await prisma.friendship.findFirst({
          where: {
            status: 'ACCEPTED',
            OR: [
              { requesterId: user.id, addresseeId: target.id },
              { requesterId: target.id, addresseeId: user.id },
            ],
          },
        });
        if (!friendship) throw new GameError('not-friend', 'You can only challenge friends');

        const category = classifyTimeControl(parsed.data);
        const rating = await loadRating(user.id, DB_CATEGORY[category]);
        const challenge: PendingChallenge = {
          id: randomUUID(),
          fromId: user.id,
          fromName: user.username,
          fromDisplay: user.displayName,
          fromRating: rating.rating,
          fromProvisional: rating.rd > 110,
          toId: target.id,
          baseSec: parsed.data.baseSec,
          incSec: parsed.data.incSec,
          rated: parsed.data.rated && isRated(parsed.data.rated, user.isGuest, target.isGuest),
          createdAt: Date.now(),
        };
        challenges.set(challenge.id, challenge);

        const view: ChallengeView = {
          id: challenge.id,
          from: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            isGuest: user.isGuest,
            rating: Math.round(rating.rating),
            provisional: rating.rd > 110,
            online: true,
          },
          baseSec: challenge.baseSec,
          incSec: challenge.incSec,
          category,
          rated: challenge.rated,
        };
        io.to(`user:${target.id}`).emit('challenge:received', view);
      } catch (error) {
        socket.emit('game:error', serverError(error));
      }
    });

    socket.on('challenge:accept', async (payload) => {
      try {
        const id = String((payload as { id?: string })?.id ?? '');
        const challenge = challenges.get(id);
        if (!challenge || challenge.toId !== user.id) {
          throw new GameError('not-found', 'Challenge expired');
        }
        challenges.delete(id);
        const from = await prisma.user.findUnique({ where: { id: challenge.fromId } });
        if (!from) throw new GameError('not-found', 'Player is gone');

        const whiteIsChallenger = Math.random() < 0.5;
        const challenger: PlayerIdentity = {
          id: from.id,
          username: from.username,
          displayName: from.displayName,
          isGuest: from.isGuest,
        };
        const defender: PlayerIdentity = identityOf(user);
        const game = await deps.manager.create({
          white: whiteIsChallenger ? challenger : defender,
          black: whiteIsChallenger ? defender : challenger,
          rated: challenge.rated,
          baseSec: challenge.baseSec,
          incSec: challenge.incSec,
        });
        io.to(`user:${challenge.fromId}`).emit('challenge:accepted', { gameId: game.id });
        socket.emit('challenge:accepted', { gameId: game.id });
      } catch (error) {
        socket.emit('game:error', serverError(error));
      }
    });

    socket.on('challenge:decline', (payload) => {
      const id = String((payload as { id?: string })?.id ?? '');
      const challenge = challenges.get(id);
      if (!challenge || challenge.toId !== user.id) return;
      challenges.delete(id);
      // The addressee declined: tell the challenger explicitly so their pending
      // "Sent" state clears instead of looking unanswered.
      io.to(`user:${challenge.fromId}`).emit('challenge:declined', { id, by: user.displayName });
    });

    socket.on('presence:ping', () => {
      void notifyPresence(io, user.id, true, deps.presence.playing(user.id));
    });

    // --------------------------------------------------------------- disconnects
    socket.on('disconnect', () => {
      for (const gameId of socket.data.games) {
        const game = deps.manager.peek(gameId);
        if (!game) continue;
        game.detach(user.id, socket.id, Date.now());
        io.to(`game:${gameId}`).emit('game:state', deps.manager.snapshotFor(game));
        refreshAbsenceState(game);
      }
      const wentOffline = deps.presence.remove(user.id, socket.id);
      if (wentOffline) {
        deps.presence.setPlaying(user.id, null);
        // Remove from matchmaking pool when fully offline.
        deps.matchmaker.leave(user.id);
        void notifyPresence(io, user.id, false, false);
      }
    });
  });

  // Expire stale challenges and keep matchmaking ticking.
  const challengeTimer = setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [id, challenge] of challenges) {
      if (challenge.createdAt < cutoff) {
        challenges.delete(id);
        io.to(`user:${challenge.toId}`).emit('challenge:cancelled', { id });
        io.to(`user:${challenge.fromId}`).emit('challenge:expired', { id });
      }
    }
  }, 30_000);
  challengeTimer.unref?.();

  return {
    dispose: () => {
      clearInterval(challengeTimer);
      for (const timer of absenceTimers.values()) clearTimeout(timer);
      absenceTimers.clear();
    },
  };
}

function isRated(requested: boolean, aGuest: boolean, bGuest: boolean): boolean {
  return requested && !aGuest && !bGuest;
}

