/**
 * Socket + REST protocol shared by client and server.
 *
 * Wire format rule: every timestamp is a server-clock epoch in milliseconds.
 * The client measures its offset from the server and interpolates clocks
 * locally, so no clock state is ever trusted from the client.
 */
import { z } from 'zod';
import type { TimeCategory } from './timeControl.js';

export type Color = 'w' | 'b';
export type GameStatus = 'waiting' | 'started' | 'finished' | 'aborted';
export type GameResult = 'white' | 'black' | 'draw';
export type EndReason =
  | 'checkmate'
  | 'resignation'
  | 'timeout'
  | 'stalemate'
  | 'insufficient'
  | 'fifty-moves'
  | 'threefold'
  | 'fivefold'
  | 'seventy-five-moves'
  | 'agreement'
  | 'aborted'
  | 'disconnect';

export type ChatState = 'none' | 'requested' | 'open' | 'declined';

export interface RatingSummary {
  rating: number;
  rd: number;
  games: number;
  provisional: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  isGuest: boolean;
  createdAt: string;
  ratings: Partial<Record<TimeCategory, RatingSummary>>;
  online?: boolean;
  friendState?: 'none' | 'friends' | 'requested' | 'incoming' | 'blocked';
}

export interface PlayerView {
  id: string;
  username: string;
  displayName: string;
  isGuest: boolean;
  rating: number | null;
  provisional: boolean;
  online: boolean;
}

export interface MoveRecord {
  ply: number;
  uci: string;
  san: string;
  clockAfterMs: number;
  chargedMs: number;
  lagCompMs: number;
}

export interface ClockView {
  whiteMs: number;
  blackMs: number;
  /** Side whose clock is running, or null when the game is not ticking. */
  running: Color | null;
  /** Server timestamp when the running clock started. */
  turnStartedAt: number | null;
  /** Lag compensation applied to the running clock, in ms. */
  compensationMs: number;
}

export interface ChatMessageView {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  at: number;
}

export interface GameSnapshot {
  id: string;
  status: GameStatus;
  rated: boolean;
  category: TimeCategory;
  baseSec: number;
  incSec: number;
  opponent: 'human' | 'computer';
  engineLevel: number | null;
  white: PlayerView | null;
  black: PlayerView | null;
  fen: string;
  turn: Color;
  ply: number;
  lastMove: [string, string] | null;
  check: Color | null;
  clocks: ClockView;
  result: GameResult | null;
  reason: EndReason | null;
  moves: MoveRecord[];
  drawOfferBy: Color | null;
  abortable: boolean;
  chat: { state: ChatState; messages: ChatMessageView[]; requestedBy: Color | null };
  canClaim: { threefold: boolean; fiftyMoves: boolean; absence: boolean };
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  ratings: {
    whiteBefore: number | null;
    whiteAfter: number | null;
    blackBefore: number | null;
    blackAfter: number | null;
  };
  rematch: { offerBy: Color } | null;
}

export interface PoolStatus {
  presetId: string;
  category: TimeCategory;
  waiting: number;
  since: number;
}

export interface ChallengeView {
  id: string;
  from: PlayerView;
  baseSec: number;
  incSec: number;
  category: TimeCategory;
  rated: boolean;
}

export interface FriendView {
  id: string;
  username: string;
  displayName: string;
  online: boolean;
  playing: boolean;
  ratings: Partial<Record<TimeCategory, RatingSummary>>;
}

export interface FriendsPayload {
  friends: FriendView[];
  incoming: FriendView[];
  outgoing: FriendView[];
  blocked: FriendView[];
}

export interface ServerError {
  code: string;
  message: string;
}

/**
 * A move is broadcast as the constant-size part of the snapshot plus the move
 * itself, so the wire cost per ply does not grow with the game length.
 */
export type GameMovePayload = Omit<GameSnapshot, 'moves'> & { move: MoveRecord };

/** Events the server emits. */
export interface ServerToClientEvents {
  'session:ready': (payload: { user: UserProfile; serverNow: number }) => void;
  'game:state': (snapshot: GameSnapshot) => void;
  'game:move': (payload: GameMovePayload) => void;
  'time:sync': (payload: { sentAt: number; serverNow: number }) => void;
  'game:rematch-started': (payload: { gameId: string }) => void;
  'game:ended': (payload: {
    result: GameResult;
    reason: EndReason;
    ratings: GameSnapshot['ratings'];
    serverNow: number;
  }) => void;
  'game:event': (payload: {
    type: 'draw-offer' | 'draw-declined' | 'draw-accepted' | 'rematch-offer' | 'rematch-declined' | 'opponent-joined' | 'opponent-left';
    by?: Color;
  }) => void;
  'game:chat': (payload: { state: ChatState; message?: ChatMessageView }) => void;
  'game:error': (error: ServerError) => void;
  'pool:status': (status: PoolStatus | null) => void;
  'pool:paired': (payload: { gameId: string }) => void;
  'challenge:received': (challenge: ChallengeView) => void;
  'challenge:cancelled': (payload: { id: string }) => void;
  /** Sent to the challenger when the other player declines. */
  'challenge:declined': (payload: { id: string; by: string }) => void;
  /** Sent to the challenger when nobody answered within the challenge window. */
  'challenge:expired': (payload: { id: string }) => void;
  'challenge:accepted': (payload: { gameId: string }) => void;
  'friends:update': (payload: FriendsPayload) => void;
  'presence:update': (payload: { userId: string; online: boolean; playing: boolean }) => void;
}

/** Events the client sends. */
export interface ClientToServerEvents {
  'time:sync': (payload: { sentAt: number }) => void;
  'game:join': (payload: { gameId: string }, ack?: (result: { ok: boolean; error?: ServerError }) => void) => void;
  'game:leave': (payload: { gameId: string }) => void;
  'game:move': (payload: { gameId: string; uci: string; ply: number; rttMs?: number }) => void;
  'game:resign': (payload: { gameId: string }) => void;
  'game:abort': (payload: { gameId: string }) => void;
  'game:draw-offer': (payload: { gameId: string }) => void;
  'game:draw-accept': (payload: { gameId: string }) => void;
  'game:draw-decline': (payload: { gameId: string }) => void;
  'game:claim': (payload: { gameId: string; kind: ClaimKind }) => void;
  'game:rematch': (payload: { gameId: string }) => void;
  'game:rematch-accept': (payload: { gameId: string }) => void;
  'game:chat-request': (payload: { gameId: string }) => void;
  'game:chat-accept': (payload: { gameId: string }) => void;
  'game:chat-decline': (payload: { gameId: string }) => void;
  'game:chat-send': (payload: { gameId: string; body: string }) => void;
  'pool:join': (payload: { baseSec: number; incSec: number; rated: boolean }) => void;
  'pool:leave': () => void;
  'challenge:send': (payload: { username: string; baseSec: number; incSec: number; rated: boolean }) => void;
  'challenge:accept': (payload: { id: string }) => void;
  'challenge:decline': (payload: { id: string }) => void;
  'presence:ping': () => void;
}

export type ClaimKind = 'threefold' | 'fifty-moves' | 'absence';

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export const joinGameSchema = z.object({
  gameId: z.string().min(6).max(12),
});

export const gameMoveSchema = z.object({
  gameId: z.string().min(6).max(12),
  uci: z.string().regex(UCI_RE),
  ply: z.number().int().min(0).max(2000),
  rttMs: z.number().int().min(0).max(60000).optional(),
});

export const claimSchema = z.object({
  gameId: z.string().min(6).max(12),
  kind: z.enum(['threefold', 'fifty-moves', 'absence']),
});

export const chatSendSchema = z.object({
  gameId: z.string().min(6).max(12),
  body: z.string().trim().min(1).max(300),
});

export const poolJoinSchema = z.object({
  baseSec: z.number().int().min(30).max(10800),
  incSec: z.number().int().min(0).max(180),
  rated: z.boolean(),
});

export const challengeSchema = z.object({
  username: z.string().min(1).max(40),
  baseSec: z.number().int().min(30).max(10800),
  incSec: z.number().int().min(0).max(180),
  rated: z.boolean(),
});

export const signupSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username must be at most 20 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, numbers, dashes and underscores only'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  email: z.string().email('Enter a valid email').max(200).optional().or(z.literal('')),
});

export const loginSchema = z.object({
  username: z.string().min(1).max(40),
  password: z.string().min(1).max(200),
});

/** Password reset requests are keyed by the address on the account. */
export const emailRequestSchema = z.object({
  email: z.string().email('Enter a valid email').max(200),
});

export const emailTokenSchema = z.object({
  token: z.string().min(10).max(200),
});

export const passwordResetSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

export const roomSchema = z.object({
  baseSec: z.number().int().min(30).max(10800),
  incSec: z.number().int().min(0).max(180),
  rated: z.boolean().default(false),
  color: z.enum(['white', 'black', 'random']).default('random'),
});

export const saveComputerGameSchema = z.object({
  baseSec: z.number().int().min(30).max(10800),
  incSec: z.number().int().min(0).max(180),
  engineLevel: z.number().int().min(1).max(8),
  moves: z.array(z.string().regex(UCI_RE)).max(1000),
  result: z.enum(['white', 'black', 'draw']).nullable(),
  reason: z.enum(['checkmate', 'resignation', 'timeout', 'stalemate', 'insufficient', 'fifty-moves', 'threefold', 'fivefold', 'seventy-five-moves', 'agreement', 'aborted', 'disconnect']).nullable(),
  playerColor: z.enum(['white', 'black']),
  fen: z.string().max(120).optional(),
});

export const chatRequestSchema = z.object({ gameId: z.string().min(6).max(12) });

export type RoomRequest = z.infer<typeof roomSchema>;
export type SaveComputerGameRequest = z.infer<typeof saveComputerGameSchema>;
