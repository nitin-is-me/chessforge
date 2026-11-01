/**
 * A live game. This class owns the authoritative board, clocks and rules.
 *
 * It is deliberately free of I/O: it never touches the database, timers or
 * sockets. It emits events through `on()` and the manager decides how to
 * persist and broadcast them. That split is what makes the rules unit-testable
 * and what keeps restart recovery honest (state is rebuilt from persisted moves).
 */
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import type {
  ChatMessageView,
  ChatState,
  ClaimKind,
  Color,
  EndReason,
  GameResult,
  GameSnapshot,
  GameStatus,
  MoveRecord,
  PlayerView,
} from '@shared/protocol.js';
import type { TimeCategory } from '@shared/timeControl.js';
import {
  compensationFor,
  FLAG_GRACE_MS,
  hasFlagged,
  LAG_POLICY,
  settleMove,
  type LagPolicy,
} from './clock.js';
import { formatTimeControl } from '@shared/timeControl.js';

export interface PlayerState {
  userId: string;
  username: string;
  displayName: string;
  isGuest: boolean;
  rating: number | null;
  rd: number | null;
  provisional: boolean;
  quotaMs: number;
  connected: boolean;
  sockets: Set<string>;
  disconnectedSince: number | null;
  lastSeenAt: number;
}

export type GameEvent =
  | { type: 'state' }
  | { type: 'move'; move: MoveRecord }
  | { type: 'ended'; result: GameResult; reason: EndReason }
  | {
      type: 'event';
      kind:
        | 'draw-offer'
        | 'draw-declined'
        | 'draw-accepted'
        | 'rematch-offer'
        | 'rematch-declined'
        | 'opponent-joined'
        | 'opponent-left';
      by?: Color;
    }
  | { type: 'chat'; state: ChatState; message?: ChatMessageView };

export class GameError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export interface GameInit {
  id: string;
  rated: boolean;
  category: TimeCategory;
  baseSec: number;
  incSec: number;
  white: PlayerState | null;
  black: PlayerState | null;
  now: number;
  status?: GameStatus;
  startedAt?: number | null;
  createdAt?: number;
  chatState?: ChatState;
  chatMessages?: ChatMessageView[];
}

export function createPlayerState(input: {
  userId: string;
  username: string;
  displayName: string;
  isGuest: boolean;
  rating?: number | null;
  rd?: number | null;
  category: TimeCategory;
}): PlayerState {
  return {
    userId: input.userId,
    username: input.username,
    displayName: input.displayName,
    isGuest: input.isGuest,
    rating: input.rating ?? null,
    rd: input.rd ?? null,
    provisional: (input.rd ?? 350) > 110,
    quotaMs: LAG_POLICY[input.category].quotaMaxMs,
    connected: false,
    sockets: new Set(),
    disconnectedSince: null,
    lastSeenAt: 0,
  };
}

export class Game {
  readonly id: string;
  /** Mutable so a room can be downgraded to casual at start time. */
  rated: boolean;
  readonly category: TimeCategory;
  readonly baseSec: number;
  readonly incSec: number;
  readonly policy: LagPolicy;
  readonly chess = new Chess();

  white: PlayerState | null;
  black: PlayerState | null;

  status: GameStatus;
  result: GameResult | null = null;
  reason: EndReason | null = null;

  moves: MoveRecord[] = [];
  clocks: Record<Color, number>;
  turnStartedAt: number | null = null;
  drawOfferBy: Color | null = null;
  rematchOfferBy: Color | null = null;

  chatState: ChatState;
  chatRequestedBy: Color | null = null;
  chatMessages: ChatMessageView[];

  createdAt: number;
  startedAt: number | null;
  endedAt: number | null = null;

  ratingsAfter: {
    whiteBefore: number | null;
    whiteAfter: number | null;
    blackBefore: number | null;
    blackAfter: number | null;
  };

  private readonly positionCounts = new Map<string, number>();
  private readonly listeners = new Set<(event: GameEvent) => void>();

  constructor(init: GameInit) {
    this.id = init.id;
    this.rated = init.rated;
    this.category = init.category;
    this.baseSec = init.baseSec;
    this.incSec = init.incSec;
    this.policy = LAG_POLICY[init.category];
    this.white = init.white;
    this.black = init.black;
    this.status = init.status ?? 'waiting';
    this.createdAt = init.createdAt ?? init.now;
    this.startedAt = init.startedAt ?? null;
    this.chatState = init.chatState ?? 'none';
    this.chatMessages = init.chatMessages ?? [];
    this.clocks = {
      w: Math.round(init.baseSec * 1000),
      b: Math.round(init.baseSec * 1000),
    };
    this.ratingsAfter = {
      whiteBefore: init.white?.rating ?? null,
      whiteAfter: null,
      blackBefore: init.black?.rating ?? null,
      blackAfter: null,
    };
    this.bumpPosition();
  }

  // ---------------------------------------------------------------- listeners

  on(listener: (event: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: GameEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  // ------------------------------------------------------------------ players

  colorFor(userId: string): Color | null {
    if (this.white && this.white.userId === userId) return 'w';
    if (this.black && this.black.userId === userId) return 'b';
    return null;
  }

  playerFor(color: Color): PlayerState | null {
    return color === 'w' ? this.white : this.black;
  }

  opponentOf(color: Color): PlayerState | null {
    return color === 'w' ? this.black : this.white;
  }

  other(color: Color): Color {
    return color === 'w' ? 'b' : 'w';
  }

  seat(color: Color, player: PlayerState): void {
    const existing = this.playerFor(color);
    if (existing) {
      if (existing.userId === player.userId) return;
      throw new GameError('seat-taken', 'That seat is taken');
    }
    if (color === 'w') {
      this.white = player;
      this.ratingsAfter.whiteBefore = player.rating;
    } else {
      this.black = player;
      this.ratingsAfter.blackBefore = player.rating;
    }
    this.emit({ type: 'state' });
  }

  get seated(): boolean {
    return Boolean(this.white && this.black);
  }

  get bothConnected(): boolean {
    return Boolean(this.white?.connected && this.black?.connected);
  }

  /** Attaches a socket for a seated player and returns their colour. */
  attach(userId: string, socketId: string, now: number): Color | null {
    const color = this.colorFor(userId);
    if (!color) return null;
    const player = this.playerFor(color)!;
    player.sockets.add(socketId);
    player.connected = true;
    player.disconnectedSince = null;
    player.lastSeenAt = now;
    this.emit({ type: 'state' });
    return color;
  }

  detach(userId: string, socketId: string, now: number): Color | null {
    const color = this.colorFor(userId);
    if (!color) return null;
    const player = this.playerFor(color)!;
    player.sockets.delete(socketId);
    if (player.sockets.size === 0) {
      player.connected = false;
      player.disconnectedSince = now;
      this.emit({ type: 'event', kind: 'opponent-left', by: color });
    }
    return color;
  }

  // -------------------------------------------------------------------- start

  /** Downgrades a game to casual when the rated invariants are not met. */
  setRated(rated: boolean): void {
    this.rated = rated;
  }

  /** Starts the clock for the side to move once both seats are filled. */
  start(now: number): boolean {
    if (this.status === 'started' || !this.seated) return false;
    this.status = 'started';
    this.startedAt = now;
    this.turnStartedAt = now;
    this.emit({ type: 'state' });
    return true;
  }

  private stopClock(): void {
    this.turnStartedAt = null;
  }

  // --------------------------------------------------------------------- move

  move(
    userId: string,
    uci: string,
    clientPly: number,
    now: number,
  ): MoveRecord {
    if (this.status !== 'started') throw new GameError('not-started', 'Game is not running');
    const color = this.colorFor(userId);
    if (!color) throw new GameError('not-a-player', 'You are not playing this game');
    if (this.chess.turn() !== color) throw new GameError('not-your-turn', 'It is not your turn');
    if (clientPly !== this.moves.length) {
      throw new GameError('stale-ply', 'Board is out of sync');
    }

    const player = this.playerFor(color)!;
    const elapsed = this.turnStartedAt === null ? 0 : Math.max(0, now - this.turnStartedAt);

    // Timeout is checked before the move is applied: a flag falls even if the
    // player had a legal move ready.
    if (hasFlagged(this.clocks[color], player.quotaMs, elapsed, this.policy)) {
      this.flag(color, now);
      throw new GameError('flagged', 'Your time ran out');
    }

    const charge = settleMove({
      remainingMs: this.clocks[color],
      quotaMs: player.quotaMs,
      elapsedMs: elapsed,
      incrementMs: this.incSec * 1000,
      policy: this.policy,
    });

    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promotion = uci.length > 4 ? (uci[4] as PieceSymbol) : undefined;

    let san: string;
    try {
      const applied = this.chess.move({ from, to, promotion });
      san = applied.san;
    } catch {
      throw new GameError('illegal-move', 'That move is not legal');
    }

    this.clocks[color] = charge.remainingMs;
    player.quotaMs = charge.quotaMs;
    this.turnStartedAt = now;
    this.drawOfferBy = null;

    const record: MoveRecord = {
      ply: this.moves.length + 1,
      uci,
      san,
      clockAfterMs: charge.remainingMs,
      chargedMs: charge.chargedMs,
      lagCompMs: charge.compensationMs,
    };
    this.moves.push(record);
    this.bumpPosition();
    // The manager broadcasts the incremental move payload; emitting a full
    // state here would double the traffic for every ply.
    this.emit({ type: 'move', move: record });

    this.checkGameOver();
    return record;
  }

  /** Applies a move without clock handling (used only by restart recovery). */
  replayMove(uci: string): void {
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promotion = uci.length > 4 ? (uci[4] as PieceSymbol) : undefined;
    const applied = this.chess.move({ from, to, promotion });
    this.moves.push({
      ply: this.moves.length + 1,
      uci,
      san: applied.san,
      clockAfterMs: 0,
      chargedMs: 0,
      lagCompMs: 0,
    });
    this.bumpPosition();
  }

  private bumpPosition(): void {
    const key = this.chess.fen().split(' ').slice(0, 4).join(' ');
    this.positionCounts.set(key, (this.positionCounts.get(key) ?? 0) + 1);
  }

  positionRepetitions(): number {
    const key = this.chess.fen().split(' ').slice(0, 4).join(' ');
    return this.positionCounts.get(key) ?? 1;
  }

  private halfmoveClock(): number {
    const parts = this.chess.fen().split(' ');
    return Number.parseInt(parts[4] ?? '0', 10) || 0;
  }

  private checkGameOver(): void {
    if (this.status !== 'started') return;

    if (this.chess.isCheckmate()) {
      this.finish(this.chess.turn() === 'w' ? 'black' : 'white', 'checkmate');
      return;
    }
    if (this.chess.isStalemate()) {
      this.finish('draw', 'stalemate');
      return;
    }
    if (this.chess.isInsufficientMaterial()) {
      this.finish('draw', 'insufficient');
      return;
    }
    if (this.positionRepetitions() >= 5) {
      this.finish('draw', 'fivefold');
      return;
    }
    if (this.halfmoveClock() >= 150) {
      this.finish('draw', 'seventy-five-moves');
      return;
    }
  }

  // ----------------------------------------------------------------- outcomes

  private flag(color: Color, now: number): void {
    this.clocks[color] = 0;
    // A game that ends before both players moved is cancelled, not rated.
    if (this.moves.length < 2) {
      this.finish(null, 'aborted', now);
      return;
    }
    this.finish(color === 'w' ? 'black' : 'white', 'timeout', now);
  }

  /** Ends the game. `result` is the winner, or null for an abort/draw. */
  finish(result: GameResult | null, reason: EndReason, now = Date.now()): void {
    if (this.status === 'finished' || this.status === 'aborted') return;
    this.status = reason === 'aborted' ? 'aborted' : 'finished';
    this.result = result ?? (reason === 'aborted' ? null : 'draw');
    this.reason = reason;
    this.endedAt = now;
    this.drawOfferBy = null;
    this.stopClock();
    this.emit({ type: 'ended', result: this.result ?? 'draw', reason });
  }

  /** Ends the game on time, called by the scheduler. Returns true if it ended. */
  checkClock(now: number): boolean {
    if (this.status !== 'started' || this.turnStartedAt === null) return false;
    const color = this.chess.turn() as Color;
    const player = this.playerFor(color);
    if (!player) return false;
    const elapsed = now - this.turnStartedAt;
    if (!hasFlagged(this.clocks[color], player.quotaMs, elapsed, this.policy)) return false;
    this.flag(color, now);
    return true;
  }

  /** Milliseconds until this game must be re-checked for a flag. */
  msUntilFlagCheck(now: number): number | null {
    if (this.status !== 'started' || this.turnStartedAt === null) return null;
    const color = this.chess.turn() as Color;
    const player = this.playerFor(color);
    if (!player) return null;
    const compensation = compensationFor(player.quotaMs, this.policy);
    const deadline = this.turnStartedAt + this.clocks[color] + compensation + FLAG_GRACE_MS;
    return Math.max(0, deadline - now);
  }

  resign(userId: string, now: number): void {
    if (this.status !== 'started') return;
    const color = this.colorFor(userId);
    if (!color) throw new GameError('not-a-player', 'You are not playing this game');
    // Resigning before both players have moved cancels the game instead of
    // counting as a rated loss, matching the abort rule.
    if (this.moves.length < 2) {
      this.finish(null, 'aborted', now);
      return;
    }
    this.finish(color === 'w' ? 'black' : 'white', 'resignation', now);
  }

  /** Aborts are only allowed until both players have moved. */
  canAbort(): boolean {
    return this.status === 'started' && this.moves.length < 2;
  }

  abort(userId: string, now: number): void {
    const color = this.colorFor(userId);
    if (!color) throw new GameError('not-a-player', 'You are not playing this game');
    if (!this.canAbort()) throw new GameError('cannot-abort', 'Too late to abort');
    this.finish(null, 'aborted', now);
  }

  offerDraw(userId: string): void {
    if (this.status !== 'started') throw new GameError('not-started', 'Game is not running');
    if (this.moves.length < 2) throw new GameError('too-early', 'Play a move first');
    const color = this.colorFor(userId);
    if (!color) throw new GameError('not-a-player', 'You are not playing this game');
    if (this.drawOfferBy === color) throw new GameError('already-offered', 'Draw already offered');
    this.drawOfferBy = color;
    this.emit({ type: 'event', kind: 'draw-offer', by: color });
    this.emit({ type: 'state' });
  }

  respondDraw(userId: string, accept: boolean, now: number): void {
    const color = this.colorFor(userId);
    if (!color) throw new GameError('not-a-player', 'You are not playing this game');
    if (!this.drawOfferBy || this.drawOfferBy === color) {
      throw new GameError('no-offer', 'No draw offer to answer');
    }
    const offerer = this.drawOfferBy;
    this.drawOfferBy = null;
    if (accept) {
      this.finish('draw', 'agreement', now);
      this.emit({ type: 'event', kind: 'draw-accepted', by: offerer });
    } else {
      this.emit({ type: 'event', kind: 'draw-declined', by: color });
    }
    this.emit({ type: 'state' });
  }

  // ------------------------------------------------------------------- claims

  canClaim(kind: ClaimKind, now: number, claimant?: Color): boolean {
    if (this.status !== 'started') return false;
    const sideToMove = this.chess.turn() as Color;
    const side = claimant ?? sideToMove;
    switch (kind) {
      case 'threefold':
        return side === sideToMove && this.chess.isThreefoldRepetition();
      case 'fifty-moves':
        return side === sideToMove && this.halfmoveClock() >= 100;
      case 'absence': {
        const opponent = this.opponentOf(side);
        if (!opponent || opponent.connected) return false;
        if (this.moves.length < 1) return false;
        const since = opponent.disconnectedSince ?? now;
        return now - since >= this.policy.absenceClaimSec * 1000;
      }
    }
  }

  /**
   * Milliseconds until an absence claim becomes available, or null when none is
   * pending. `canClaim('absence')` only becomes true once the grace period has
   * elapsed, and no event fires at that moment, so the socket layer schedules a
   * snapshot using this instead of leaving the client to poll.
   */
  absenceClaimDueIn(now: number): number | null {
    if (this.status !== 'started' || this.moves.length < 1) return null;
    let soonest: number | null = null;
    for (const color of ['w', 'b'] as Color[]) {
      const claimant = this.playerFor(color);
      const opponent = this.opponentOf(color);
      if (!claimant || !opponent) continue;
      if (!claimant.connected || opponent.connected) continue;
      if (opponent.disconnectedSince === null) continue;
      const due = Math.max(0, opponent.disconnectedSince + this.policy.absenceClaimSec * 1000 - now);
      soonest = soonest === null ? due : Math.min(soonest, due);
    }
    return soonest;
  }

  claim(userId: string, kind: ClaimKind, now: number): void {
    const color = this.colorFor(userId);
    if (!color) throw new GameError('not-a-player', 'You are not playing this game');
    if (kind !== 'absence' && this.chess.turn() !== color) {
      throw new GameError('not-your-turn', 'Only the side to move may claim');
    }
    if (!this.canClaim(kind, now, color)) throw new GameError('claim-not-available', 'Claim not available');
    if (kind === 'absence') {
      this.finish(color === 'w' ? 'white' : 'black', 'disconnect', now);
      return;
    }
    this.finish('draw', kind, now);
  }

  // ------------------------------------------------------------------ rematch

  offerRematch(userId: string): Color {
    if (this.status === 'started' || this.status === 'waiting') {
      throw new GameError('not-finished', 'Game is still running');
    }
    const color = this.colorFor(userId);
    if (!color) throw new GameError('not-a-player', 'You are not playing this game');
    this.rematchOfferBy = color;
    this.emit({ type: 'event', kind: 'rematch-offer', by: color });
    this.emit({ type: 'state' });
    return color;
  }

  // --------------------------------------------------------------------- chat

  requestChat(userId: string): void {
    const color = this.colorFor(userId);
    if (!color) throw new GameError('not-a-player', 'You are not playing this game');
    // A pending request belongs to one player; the other must answer it.
    if (this.chatState === 'open' || this.chatState === 'requested') return;
    this.chatState = 'requested';
    this.chatRequestedBy = color;
    this.emit({ type: 'chat', state: this.chatState });
  }

  setChatState(state: ChatState): void {
    this.chatState = state;
    if (state !== 'requested') this.chatRequestedBy = null;
    this.emit({ type: 'chat', state });
  }

  addChatMessage(message: ChatMessageView): void {
    this.chatMessages.push(message);
    if (this.chatMessages.length > 200) this.chatMessages.shift();
    this.emit({ type: 'chat', state: this.chatState, message });
  }

  // ----------------------------------------------------------------- snapshot

  private static playerView(player: PlayerState | null): PlayerView | null {
    if (!player) return null;
    return {
      id: player.userId,
      username: player.username,
      displayName: player.displayName,
      isGuest: player.isGuest,
      rating: player.rating === null ? null : Math.round(player.rating),
      provisional: player.provisional,
      online: player.connected,
    };
  }

  private clockCompensation(): number {
    if (this.status !== 'started') return 0;
    const color = this.chess.turn() as Color;
    const player = this.playerFor(color);
    return player ? compensationFor(player.quotaMs, this.policy) : 0;
  }

  snapshot(now: number, viewer?: Color): GameSnapshot {
    const last = this.moves[this.moves.length - 1];
    return {
      id: this.id,
      status: this.status,
      rated: this.rated,
      category: this.category,
      baseSec: this.baseSec,
      incSec: this.incSec,
      opponent: 'human',
      engineLevel: null,
      white: Game.playerView(this.white),
      black: Game.playerView(this.black),
      fen: this.chess.fen(),
      turn: this.chess.turn() as Color,
      ply: this.moves.length,
      lastMove: last ? [last.uci.slice(0, 2), last.uci.slice(2, 4)] : null,
      check: this.chess.inCheck() ? (this.chess.turn() as Color) : null,
      clocks: {
        whiteMs: this.clocks.w,
        blackMs: this.clocks.b,
        running: this.status === 'started' ? (this.chess.turn() as Color) : null,
        turnStartedAt: this.turnStartedAt,
        compensationMs: this.clockCompensation(),
      },
      result: this.result,
      reason: this.reason,
      moves: this.moves,
      drawOfferBy: this.drawOfferBy,
      abortable: this.canAbort(),
      chat: { state: this.chatState, messages: this.chatMessages, requestedBy: this.chatRequestedBy },
      canClaim: {
        threefold: this.canClaim('threefold', now, viewer),
        fiftyMoves: this.canClaim('fifty-moves', now, viewer),
        absence: this.canClaim('absence', now, viewer),
      },
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      ratings: this.ratingsAfter,
      rematch: this.rematchOfferBy ? { offerBy: this.rematchOfferBy } : null,
    };
  }

  get title(): string {
    return `${formatTimeControl({ baseSec: this.baseSec, incSec: this.incSec })} ${this.category}`;
  }
}
