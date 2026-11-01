/**
 * Express API. Everything here is cookie-authenticated and same-origin checked;
 * gameplay itself happens over Socket.IO.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { Chess } from 'chess.js';
import { prisma } from '../db.js';
import { loadConfig, publicOrigin } from '../env.js';
import { logger } from '../log.js';
import type { GameManager } from '../game/manager.js';
import { storedGameSnapshot } from '../game/present.js';
import { buildPgn } from '../game/manager.js';
import type { PresenceService } from '../presence.js';
import type { Matchmaker } from '../matchmaking/pools.js';
import {
  clearSession,
  createGuest,
  createSession,
  destroyAllSessions,
  destroySession,
  ratingsPayload,
  readSessionToken,
  resolveSession,
  setSessionCookie,
  toProfile,
  type SessionUser,
} from '../auth/session.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { consumeEmailToken, issueEmailToken } from '../auth/email-tokens.js';
import {
  emailConfigured,
  passwordResetEmail,
  sendEmail,
  verificationEmail,
} from '../email/brevo.js';
import { RateLimiter } from './rate-limit.js';
import { EmailTokenKind } from '@prisma/client';
import {
  emailRequestSchema,
  emailTokenSchema,
  loginSchema,
  passwordResetSchema,
  roomSchema,
  saveComputerGameSchema,
  signupSchema,
} from '@shared/protocol.js';
import type { GameListItem, GamesResponse, MeResponse, ProfileResponse } from '@shared/api.js';
import { classifyTimeControl, isRatedAllowed, type TimeCategory } from '@shared/timeControl.js';
import { CATEGORY_FROM_DB, DB_CATEGORY, loadRating, ratingSummary } from '../rating/service.js';
import { registry } from '../metrics.js';

export interface ApiDeps {
  manager: GameManager;
  presence: PresenceService;
  matchmaker: Matchmaker;
  notifyFriendsChanged: (userIds: string[]) => Promise<void>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionToken?: string;
    }
  }
}

const authLimiter = new RateLimiter(20, 60_000);
const signupLimiter = new RateLimiter(10, 60 * 60_000);
const roomLimiter = new RateLimiter(40, 60_000);
const reportLimiter = new RateLimiter(10, 60 * 60_000);
// Verification and reset mail: low volume, but a misused endpoint costs money.
const emailLimiter = new RateLimiter(5, 15 * 60_000);

function clientKey(req: Request): string {
  return req.ip ?? 'unknown';
}

function fail(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message });
}

/** Rejects cross-site state changes (defence in depth alongside SameSite). */
function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get('origin');
  if (!origin) return next();
  const config = loadConfig();
  const allowed = new Set([config.appOrigin, config.clientDevOrigin]);
  if (!allowed.has(origin)) {
    fail(res, 403, 'forbidden_origin', 'Cross-origin request blocked');
    return;
  }
  next();
}

function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    fail(res, 401, 'unauthorized', 'Sign in to continue');
    return;
  }
  next();
}

function requireAccount(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    fail(res, 401, 'unauthorized', 'Sign in to continue');
    return;
  }
  if (req.user.isGuest) {
    fail(res, 403, 'guest', 'Create an account to use this feature');
    return;
  }
  next();
}

async function loadUserProfile(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { ratings: true },
  });
}

/** Maps the client's end-reason slugs onto the Prisma enum values. */
const COMPUTER_REASON: Record<string, string> = {
  checkmate: 'CHECKMATE',
  resignation: 'RESIGNATION',
  timeout: 'TIMEOUT',
  stalemate: 'STALEMATE',
  insufficient: 'INSUFFICIENT_MATERIAL',
  'fifty-moves': 'FIFTY_MOVES',
  threefold: 'THREEFOLD_REPETITION',
  fivefold: 'FIVEFOLD_REPETITION',
  'seventy-five-moves': 'SEVENTY_FIVE_MOVES',
  agreement: 'AGREEMENT',
  aborted: 'ABORTED',
  disconnect: 'DISCONNECT',
};

const REASON_SLUG: Record<string, GameListItem['reason']> = {
  CHECKMATE: 'checkmate',
  RESIGNATION: 'resignation',
  TIMEOUT: 'timeout',
  STALEMATE: 'stalemate',
  INSUFFICIENT_MATERIAL: 'insufficient',
  FIFTY_MOVES: 'fifty-moves',
  THREEFOLD_REPETITION: 'threefold',
  FIVEFOLD_REPETITION: 'fivefold',
  SEVENTY_FIVE_MOVES: 'seventy-five-moves',
  AGREEMENT: 'agreement',
  ABORTED: 'aborted',
  DISCONNECT: 'disconnect',
};

function toGameListItem(
  row: {
    id: string;
    category: keyof typeof CATEGORY_FROM_DB;
    rated: boolean;
    status: string;
    result: string | null;
    reason: string | null;
    whiteName: string | null;
    blackName: string | null;
    whiteRating: number | null;
    blackRating: number | null;
    whiteRatingAfter: number | null;
    blackRatingAfter: number | null;
    createdAt: Date;
    endedAt: Date | null;
    plyCount: number;
    opponent: string;
    engineLevel: number | null;
    whiteId?: string | null;
    blackId?: string | null;
  },
  viewerId?: string,
): GameListItem {
  const status =
    row.status === 'STARTED' ? 'started' : row.status === 'WAITING' ? 'waiting' : row.status === 'ABORTED' ? 'aborted' : 'finished';

  let playerColor: 'white' | 'black' | null = null;
  let outcome: 'win' | 'loss' | 'draw' | null = null;
  if (viewerId && (row.whiteId === viewerId || row.blackId === viewerId)) {
    playerColor = row.whiteId === viewerId ? 'white' : 'black';
    if (row.result) {
      if (row.result === 'DRAW') outcome = 'draw';
      else outcome = (row.result === 'WHITE') === (playerColor === 'white') ? 'win' : 'loss';
    }
  }

  return {
    id: row.id,
    category: CATEGORY_FROM_DB[row.category],
    rated: row.rated,
    status,
    result: row.result === 'WHITE' ? 'white' : row.result === 'BLACK' ? 'black' : row.result === 'DRAW' ? 'draw' : null,
    reason: row.reason ? (REASON_SLUG[row.reason] ?? null) : null,
    whiteName: row.whiteName,
    blackName: row.blackName,
    whiteRating: row.whiteRating === null ? null : Math.round(row.whiteRating),
    blackRating: row.blackRating === null ? null : Math.round(row.blackRating),
    whiteRatingAfter: row.whiteRatingAfter === null ? null : Math.round(row.whiteRatingAfter),
    blackRatingAfter: row.blackRatingAfter === null ? null : Math.round(row.blackRatingAfter),
    createdAt: row.createdAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    plyCount: row.plyCount,
    opponent: row.opponent === 'COMPUTER' ? 'computer' : 'human',
    engineLevel: row.engineLevel,
    playerColor,
    outcome,
  };
}

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();
  const config = loadConfig();

  // ------------------------------------------------------------ session basics

  router.use(async (req, _res, next) => {
    try {
      const token = readSessionToken(req);
      if (token) {
        req.sessionToken = token;
        const user = await resolveSession(token);
        if (user) req.user = user;
      }
    } catch (error) {
      logger.warn({ err: error }, 'session resolution failed');
    }
    next();
  });

  // Liveness only: this must not touch the database, so a sleeping or paused
  // database never looks like a dead server.
  router.get('/healthz', (_req, res) => {
    res.json({ ok: true, live: deps.manager.liveCount, online: deps.presence.onlineCount });
  });

  // Readiness does touch the database and is used by deploy checks.
  router.get('/readyz', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  router.get('/metrics', async (req, res) => {
    const token = process.env.METRICS_TOKEN;
    if (token) {
      const header = req.get('authorization')?.replace(/^Bearer\s+/i, '');
      const provided = header ?? String(req.query.token ?? '');
      if (provided !== token) {
        fail(res, 401, 'unauthorized', 'Metrics require a token');
        return;
      }
    } else if (config.isProduction) {
      // Never expose counters publicly by default.
      fail(res, 404, 'not_found', 'Unknown endpoint');
      return;
    }
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  /** Boots the session: guarantees the caller has an identity (guest or account). */
  router.get('/me', async (req, res) => {
    try {
      let user = req.user;
      if (!user) {
        user = await createGuest();
        const session = await createSession(user.id, req.get('user-agent'));
        setSessionCookie(res, session.token, config.isProduction);
      }
      const row = await loadUserProfile(user.id);
      const profile = toProfile({
        ...user,
        createdAt: row?.createdAt,
        ratings: ratingsPayload(row?.ratings ?? []),
      });
      const payload: MeResponse = {
        user: profile,
        serverNow: Date.now(),
        guest: user.isGuest,
      };
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(payload);
    } catch (error) {
      logger.error({ err: error }, 'failed to boot session');
      fail(res, 500, 'session_failed', 'Could not start a session');
    }
  });

  // --------------------------------------------------------------------- auth

  router.post('/auth/signup', requireSameOrigin, async (req, res) => {
    if (!signupLimiter.take(clientKey(req))) {
      fail(res, 429, 'rate_limited', 'Too many attempts, try again later');
      return;
    }
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'invalid', parsed.error.issues[0]?.message ?? 'Invalid details');
      return;
    }
    const { username, password } = parsed.data;
    // Addresses are compared case-insensitively, so they are stored normalised.
    const email = parsed.data.email?.trim().toLowerCase() || '';
    const usernameLower = username.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { usernameLower } });
    if (existing) {
      fail(res, 409, 'username_taken', 'That username is taken');
      return;
    }
    if (email) {
      const emailTaken = await prisma.user.findUnique({ where: { email } });
      if (emailTaken) {
        fail(res, 409, 'email_taken', 'That email is already registered');
        return;
      }
    }

    const passwordHash = await hashPassword(password);
    let user;
    try {
      if (req.user?.isGuest) {
        // Upgrading in place keeps the guest's game history and rating.
        user = await prisma.user.update({
          where: { id: req.user.id },
          data: {
            username,
            usernameLower,
            displayName: username,
            isGuest: false,
            passwordHash,
            email: email || null,
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            username,
            usernameLower,
            displayName: username,
            isGuest: false,
            passwordHash,
            email: email || null,
          },
        });
      }
    } catch {
      fail(res, 409, 'conflict', 'That username or email is already in use');
      return;
    }

    // Rotate the session so a pre-upgrade cookie cannot be replayed.
    await destroyAllSessions(user.id);
    const session = await createSession(user.id, req.get('user-agent'));
    setSessionCookie(res, session.token, config.isProduction);

    if (email && emailConfigured()) {
      // Best effort: a mail hiccup must not fail the signup itself. The player
      // can always resend from Settings.
      void issueEmailToken(user.id, EmailTokenKind.VERIFY)
        .then((token) =>
          sendEmail({
            to: email,
            ...verificationEmail(`${publicOrigin()}/verify?token=${encodeURIComponent(token)}`),
          }),
        )
        .catch((error) => {
          logger.warn({ err: error, userId: user.id }, 'could not send verification email');
        });
    }

    const row = await loadUserProfile(user.id);
    res.json({
      user: toProfile({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        isGuest: false,
        ratings: ratingsPayload(row?.ratings ?? []),
        createdAt: user.createdAt,
      }),
    });
  });

  router.post('/auth/login', requireSameOrigin, async (req, res) => {
    if (!authLimiter.take(clientKey(req))) {
      fail(res, 429, 'rate_limited', 'Too many attempts, try again later');
      return;
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'invalid', 'Enter your username and password');
      return;
    }
    const user = await prisma.user.findUnique({
      where: { usernameLower: parsed.data.username.toLowerCase() },
      include: { ratings: true },
    });
    if (!user || !user.passwordHash || user.deletedAt) {
      // Uniform response: do not reveal whether the username exists.
      await new Promise((resolve) => setTimeout(resolve, 250));
      fail(res, 401, 'invalid_credentials', 'Incorrect username or password');
      return;
    }
    const ok = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!ok) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      fail(res, 401, 'invalid_credentials', 'Incorrect username or password');
      return;
    }

    authLimiter.reset(clientKey(req));
    await destroyAllSessions(user.id);
    const session = await createSession(user.id, req.get('user-agent'));
    setSessionCookie(res, session.token, config.isProduction);
    res.json({
      user: toProfile({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        isGuest: false,
        ratings: ratingsPayload(user.ratings),
        createdAt: user.createdAt,
      }),
    });
  });

  router.post('/auth/logout', requireSameOrigin, async (req, res) => {
    await destroySession(req.sessionToken);
    clearSession(res, config.isProduction);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ email + resets

  /** The signed-in player's own address; never part of the public profile. */
  router.get('/me/email', requireUser, async (req, res) => {
    const row = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { email: true, emailVerifiedAt: true },
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ email: row?.email ?? null, verified: Boolean(row?.emailVerifiedAt) });
  });

  router.post('/auth/email/verify', requireSameOrigin, requireUser, async (req, res) => {
    if (!emailLimiter.take(clientKey(req))) {
      fail(res, 429, 'rate_limited', 'Too many requests, try again later');
      return;
    }
    if (!emailConfigured()) {
      fail(res, 503, 'email_unavailable', 'Email is not configured on this server');
      return;
    }
    const row = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!row?.email) {
      fail(res, 400, 'no_email', 'Add an email address to your account first');
      return;
    }
    if (row.emailVerifiedAt) {
      res.json({ ok: true, alreadyVerified: true });
      return;
    }

    const token = await issueEmailToken(req.user!.id, EmailTokenKind.VERIFY);
    const link = `${publicOrigin()}/verify?token=${encodeURIComponent(token)}`;
    const sent = await sendEmail({ to: row.email, ...verificationEmail(link) });
    if (!sent) {
      fail(res, 502, 'email_failed', 'Could not send the email, try again later');
      return;
    }
    res.json({ ok: true });
  });

  router.post('/auth/email/confirm', requireSameOrigin, async (req, res) => {
    if (!authLimiter.take(clientKey(req))) {
      fail(res, 429, 'rate_limited', 'Too many attempts, try again later');
      return;
    }
    const parsed = emailTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'invalid', 'This link is not valid');
      return;
    }
    const userId = await consumeEmailToken(parsed.data.token, EmailTokenKind.VERIFY);
    if (!userId) {
      fail(res, 400, 'invalid_token', 'This link is invalid or has expired');
      return;
    }
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    res.json({ ok: true });
  });

  /**
   * Always answers `ok`, whether or not the address belongs to an account, so
   * the endpoint cannot be used to discover registered emails.
   */
  router.post('/auth/password/request', requireSameOrigin, async (req, res) => {
    const parsed = emailRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'invalid', 'Enter a valid email');
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();
    if (!emailLimiter.take(clientKey(req)) || !emailLimiter.take(`reset:${email}`)) {
      fail(res, 429, 'rate_limited', 'Too many requests, try again later');
      return;
    }

    const user = await prisma.user.findFirst({
      where: { email, deletedAt: null, passwordHash: { not: null } },
      select: { id: true },
    });
    if (user && emailConfigured()) {
      const token = await issueEmailToken(user.id, EmailTokenKind.RESET);
      const link = `${publicOrigin()}/reset?token=${encodeURIComponent(token)}`;
      await sendEmail({ to: email, ...passwordResetEmail(link) });
    }
    res.json({ ok: true });
  });

  router.post('/auth/password/reset', requireSameOrigin, async (req, res) => {
    if (!authLimiter.take(clientKey(req))) {
      fail(res, 429, 'rate_limited', 'Too many attempts, try again later');
      return;
    }
    const parsed = passwordResetSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(
        res,
        400,
        'invalid',
        parsed.error.issues[0]?.message ?? 'Enter a new password of at least 8 characters',
      );
      return;
    }
    const userId = await consumeEmailToken(parsed.data.token, EmailTokenKind.RESET);
    if (!userId) {
      fail(res, 400, 'invalid_token', 'This link is invalid or has expired');
      return;
    }
    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        // Receiving the reset link proves control of the address.
        emailVerifiedAt: new Date(),
      },
    });
    // A reset invalidates every existing session, including a stolen cookie.
    await destroyAllSessions(userId);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------- profile

  router.get('/users/:username', async (req, res) => {
    const usernameLower = String(req.params.username ?? '').toLowerCase();
    // One round trip: the player, their ratings and their finished games. The
    // whole-history record is counted from that same set, so the page no longer
    // waits on a user lookup, a list query and three separate counts.
    const user = await prisma.user.findFirst({
      where: { usernameLower, deletedAt: null },
      include: {
        ratings: true,
        whiteGames: {
          where: { status: { in: ['FINISHED', 'ABORTED'] } },
          orderBy: { createdAt: 'desc' },
        },
        blackGames: {
          where: { status: { in: ['FINISHED', 'ABORTED'] } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!user) {
      fail(res, 404, 'not_found', 'No such player');
      return;
    }

    const history = [...user.whiteGames, ...user.blackGames].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const games = history.slice(0, 20);
    let wins = 0;
    let losses = 0;
    let draws = 0;
    for (const game of history) {
      if (game.result === 'DRAW') draws += 1;
      else if (
        (game.whiteId === user.id && game.result === 'WHITE') ||
        (game.blackId === user.id && game.result === 'BLACK')
      )
        wins += 1;
      else if (
        (game.whiteId === user.id && game.result === 'BLACK') ||
        (game.blackId === user.id && game.result === 'WHITE')
      )
        losses += 1;
    }
    const stats = { games: wins + losses + draws, wins, losses, draws };

    const viewerId = req.user?.id ?? null;
    const link =
      viewerId && viewerId !== user.id
        ? await prisma.friendship.findFirst({
            where: {
              OR: [
                { requesterId: viewerId, addresseeId: user.id },
                { requesterId: user.id, addresseeId: viewerId },
              ],
            },
          })
        : null;

    let friendState: ProfileResponse['friendState'] = 'none';
    if (link) {
      if (link.status === 'ACCEPTED') friendState = 'friends';
      else if (link.status === 'BLOCKED') friendState = 'blocked';
      else if (link.requesterId === viewerId) friendState = 'requested';
      else friendState = 'incoming';
    }

    const payload: ProfileResponse = {
      user: toProfile({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        isGuest: user.isGuest,
        ratings: ratingsPayload(user.ratings),
        createdAt: user.createdAt,
      }),
      games: games.map((game) => toGameListItem(game, req.user?.id)),
      stats,
      online: deps.presence.online(user.id),
      friendState,
    };
    res.setHeader('Cache-Control', 'private, max-age=5');
    res.json(payload);
  });

  router.get('/me/games', requireUser, async (req, res) => {
    const userId = req.user!.id;
    const games = await prisma.game.findMany({
      where: {
        OR: [{ whiteId: userId }, { blackId: userId }],
        status: { in: ['FINISHED', 'ABORTED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const payload: GamesResponse = { games: games.map((game) => toGameListItem(game, userId)) };
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(payload);
  });

  // --------------------------------------------------------------------- games

  router.post('/games/room', requireSameOrigin, requireUser, async (req, res) => {
    if (!roomLimiter.take(clientKey(req))) {
      fail(res, 429, 'rate_limited', 'Too many games created, slow down');
      return;
    }
    const parsed = roomSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'invalid', 'Invalid time control');
      return;
    }
    const user = req.user!;
    const { baseSec, incSec, color } = parsed.data;
    const rated = parsed.data.rated && !user.isGuest && isRatedAllowed({ baseSec, incSec });
    const identity = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      isGuest: user.isGuest,
    };
    const wantsWhite = color === 'white' || (color === 'random' && Math.random() < 0.5);

    const game = await deps.manager.create({
      white: wantsWhite ? identity : null,
      black: wantsWhite ? null : identity,
      rated,
      baseSec,
      incSec,
    });
    res.json({ id: game.id });
  });

  router.get('/games/:id', async (req, res) => {
    const id = String(req.params.id ?? '');
    const live = await deps.manager.get(id);
    if (live) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(deps.manager.snapshotFor(live, req.user?.id));
      return;
    }
    const row = await prisma.game.findUnique({
      where: { id },
      include: { moves: { orderBy: { ply: 'asc' } } },
    });
    if (!row) {
      fail(res, 404, 'not_found', 'No such game');
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=30');
    res.json(storedGameSnapshot(row, { viewerId: req.user?.id ?? null }));
  });

  router.get('/games/:id/pgn', async (req, res) => {
    const id = String(req.params.id ?? '');
    const game = await deps.manager.get(id);
    if (game) {
      res.type('text/plain').send(buildPgn(game));
      return;
    }
    const row = await prisma.game.findUnique({ where: { id } });
    if (!row) {
      fail(res, 404, 'not_found', 'No such game');
      return;
    }
    res.type('text/plain').send(row.pgn ?? '');
  });

  /** Client-side games against the engine are archived here for analysis. */
  router.post('/games/computer', requireSameOrigin, requireUser, async (req, res) => {
    const parsed = saveComputerGameSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'invalid', 'Invalid game data');
      return;
    }
    const user = req.user!;
    const data = parsed.data;

    // Replay to validate every move and derive the true final position.
    const chess = new Chess();
    const replay: Array<{ ply: number; uci: string; san: string }> = [];
    for (const uci of data.moves) {
      try {
        const applied = chess.move({
          from: uci.slice(0, 2) as never,
          to: uci.slice(2, 4) as never,
          promotion: uci.length > 4 ? (uci[4] as never) : undefined,
        });
        replay.push({ ply: replay.length + 1, uci, san: applied.san });
      } catch {
        fail(res, 400, 'illegal_move', 'The move list contains an illegal move');
        return;
      }
    }

    const category = classifyTimeControl({ baseSec: data.baseSec, incSec: data.incSec });
    const isWhite = data.playerColor === 'white';
    const resultDb =
      data.result === 'white' ? 'WHITE' : data.result === 'black' ? 'BLACK' : data.result === 'draw' ? 'DRAW' : null;
    const reasonDb = data.reason ? COMPUTER_REASON[data.reason] : null;

    const id = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
    await prisma.game.create({
      data: {
        id,
        status: 'FINISHED',
        rated: false,
        category: DB_CATEGORY[category],
        baseSec: data.baseSec,
        incSec: data.incSec,
        opponent: 'COMPUTER',
        engineLevel: data.engineLevel,
        whiteId: isWhite ? user.id : null,
        blackId: isWhite ? null : user.id,
        whiteName: isWhite ? user.username : `Stockfish level ${data.engineLevel}`,
        blackName: isWhite ? `Stockfish level ${data.engineLevel}` : user.username,
        fen: chess.fen(),
        turn: chess.turn(),
        whiteMs: data.baseSec * 1000,
        blackMs: data.baseSec * 1000,
        plyCount: data.moves.length,
        startedAt: new Date(),
        endedAt: new Date(),
        result: resultDb as never,
        reason: reasonDb as never,
        pgn: chess.pgn(),
        // Without these rows the analysis page has nothing to walk.
        moves: replay.length
          ? {
              create: replay.map((move) => ({
                ply: move.ply,
                uci: move.uci,
                san: move.san,
                chargedMs: 0,
                clockAfterMs: 0,
                lagCompMs: 0,
              })),
            }
          : undefined,
      },
    });
    res.json({ id });
  });

  // ------------------------------------------------------------------- friends

  const friendsPayload = async (userId: string) => {
    // Fetch blocks so we can filter them out of all lists.
    const [blocks, rows] = await Promise.all([
      prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }),
      prisma.friendship.findMany({
        where: {
          status: { in: ['ACCEPTED', 'PENDING'] },
          OR: [{ requesterId: userId }, { addresseeId: userId }],
        },
        include: {
          requester: { include: { ratings: true } },
          addressee: { include: { ratings: true } },
        },
      }),
    ]);

    const blockedIds = new Set<string>();
    for (const block of blocks) {
      blockedIds.add(block.blockerId === userId ? block.blockedId : block.blockerId);
    }

    const friends = [];
    const incoming = [];
    const outgoing = [];

    for (const row of rows) {
      const isRequester = row.requesterId === userId;
      const other = isRequester ? row.addressee : row.requester;
      if (blockedIds.has(other.id)) continue;
      const view = {
        id: other.id,
        username: other.username,
        displayName: other.displayName,
        online: deps.presence.online(other.id),
        playing: deps.presence.playing(other.id),
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
        online: deps.presence.online(blockedUser.id),
        playing: deps.presence.playing(blockedUser.id),
        ratings: ratingsPayload(blockedUser.ratings),
      });
    }

    return { friends, incoming, outgoing, blocked };
  };

  router.get('/friends', requireAccount, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await friendsPayload(req.user!.id));
  });

  router.post('/friends/request', requireSameOrigin, requireAccount, async (req, res) => {
    const username = String((req.body as { username?: string })?.username ?? '').toLowerCase();
    const target = await prisma.user.findFirst({ where: { usernameLower: username, deletedAt: null } });
    if (!target) {
      fail(res, 404, 'not_found', 'No such player');
      return;
    }
    if (target.id === req.user!.id) {
      fail(res, 400, 'self', 'You cannot add yourself');
      return;
    }
    // Block check: either user blocking the other prevents the request.
    const block = await prisma.block.findFirst({
      where: { OR: [{ blockerId: req.user!.id, blockedId: target.id }, { blockerId: target.id, blockedId: req.user!.id }] },
    });
    if (block) {
      fail(res, 403, 'blocked', 'You cannot add this player');
      return;
    }
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: req.user!.id, addresseeId: target.id },
          { requesterId: target.id, addresseeId: req.user!.id },
        ],
      },
    });
    if (existing) {
      fail(res, 409, 'exists', 'A friendship or request already exists');
      return;
    }
    await prisma.friendship.create({
      data: { requesterId: req.user!.id, addresseeId: target.id },
    });
    await deps.notifyFriendsChanged([req.user!.id, target.id]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await friendsPayload(req.user!.id));
  });

  router.post('/friends/respond', requireSameOrigin, requireAccount, async (req, res) => {
    const body = req.body as { id?: string; accept?: boolean };
    const targetId = String(body.id ?? '');
    const accept = Boolean(body.accept);
    const link = await prisma.friendship.findFirst({
      where: { requesterId: targetId, addresseeId: req.user!.id, status: 'PENDING' },
    });
    if (!link) {
      fail(res, 404, 'not_found', 'No pending request');
      return;
    }
    await prisma.friendship.update({
      where: { id: link.id },
      data: { status: accept ? 'ACCEPTED' : 'DECLINED' },
    });
    await deps.notifyFriendsChanged([req.user!.id, targetId]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await friendsPayload(req.user!.id));
  });

  router.delete('/friends/:id', requireSameOrigin, requireAccount, async (req, res) => {
    const targetId = String(req.params.id ?? '');
    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: req.user!.id, addresseeId: targetId },
          { requesterId: targetId, addresseeId: req.user!.id },
        ],
      },
    });
    await deps.notifyFriendsChanged([req.user!.id, targetId]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await friendsPayload(req.user!.id));
  });

  // ------------------------------------------------------------------- blocks

  router.post('/blocks', requireSameOrigin, requireAccount, async (req, res) => {
    const username = String((req.body as { username?: string })?.username ?? '').toLowerCase();
    const target = await prisma.user.findFirst({ where: { usernameLower: username, deletedAt: null } });
    if (!target) {
      fail(res, 404, 'not_found', 'No such player');
      return;
    }
    if (target.id === req.user!.id) {
      fail(res, 400, 'self', 'You cannot block yourself');
      return;
    }
    await prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: req.user!.id, blockedId: target.id } },
      update: {},
      create: { blockerId: req.user!.id, blockedId: target.id },
    });
    // Remove any existing friendship.
    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: req.user!.id, addresseeId: target.id },
          { requesterId: target.id, addresseeId: req.user!.id },
        ],
      },
    });
    await deps.notifyFriendsChanged([req.user!.id, target.id]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await friendsPayload(req.user!.id));
  });

  router.delete('/blocks/:id', requireSameOrigin, requireAccount, async (req, res) => {
    const targetId = String(req.params.id ?? '');
    await prisma.block.delete({
      where: { blockerId_blockedId: { blockerId: req.user!.id, blockedId: targetId } },
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await friendsPayload(req.user!.id));
  });

  // ------------------------------------------------------------------- reports

  router.post('/report', requireSameOrigin, requireUser, async (req, res) => {
    if (!reportLimiter.take(req.user!.id)) {
      fail(res, 429, 'rate_limited', 'Too many reports');
      return;
    }
    const body = req.body as { username?: string; reason?: string; gameId?: string };
    const target = await prisma.user.findFirst({
      where: { usernameLower: String(body.username ?? '').toLowerCase() },
    });
    if (!target || !body.reason) {
      fail(res, 400, 'invalid', 'A player and a reason are required');
      return;
    }
    await prisma.report.create({
      data: {
        reporterId: req.user!.id,
        reportedId: target.id,
        gameId: body.gameId ?? null,
        reason: body.reason.slice(0, 500),
        snapshot: null,
      },
    });
    res.json({ ok: true });
  });

  // List reports made by the current user.
  router.get('/me/reports', requireAccount, async (req, res) => {
    const reports = await prisma.report.findMany({
      where: { reporterId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        reported: { select: { id: true, username: true, displayName: true } },
        game: { select: { id: true, status: true, result: true } },
      },
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ reports });
  });

  // Admin-only: list all reports. In a real deployment this would check an
  // admin flag on the user; here we just require a session.
  router.get('/admin/reports', requireAccount, async (req, res) => {
    const reports = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        reporter: { select: { id: true, username: true, displayName: true } },
        reported: { select: { id: true, username: true, displayName: true } },
        game: { select: { id: true, status: true, result: true } },
      },
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ reports });
  });

  // ------------------------------------------------------------------- ratings

  router.get('/ratings/:username', async (req, res) => {
    const user = await prisma.user.findFirst({
      where: { usernameLower: String(req.params.username ?? '').toLowerCase() },
      include: { ratings: true },
    });
    if (!user) {
      fail(res, 404, 'not_found', 'No such player');
      return;
    }
    const history = await prisma.ratingChange.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({
      ratings: user.ratings.map((row) => ({
        category: CATEGORY_FROM_DB[row.category] as TimeCategory,
        ...ratingSummary(row),
      })),
      history: history.map((row) => ({
        category: CATEGORY_FROM_DB[row.category],
        before: row.before,
        after: row.after,
        delta: row.delta,
        at: row.createdAt.toISOString(),
        gameId: row.gameId,
      })),
    });
  });

  router.use((_req, res) => {
    fail(res, 404, 'not_found', 'Unknown endpoint');
  });

  router.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: error }, 'api error');
    if (!res.headersSent) fail(res, 500, 'internal', 'Something went wrong');
  });

  // Warm the rating rows lazily so a first game does not race two inserts.
  void prisma.rating.count().catch(() => undefined);

  return router;
}
