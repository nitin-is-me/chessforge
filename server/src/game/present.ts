/**
 * Presents stored games in the protocol's snapshot shape. Used by the REST API
 * for history, replay and analysis pages (live games are presented by `Game`).
 */
import type { EndReason, GameResult, GameSnapshot, MoveRecord, ChatState } from '@shared/protocol.js';
import { CATEGORY_FROM_DB } from '../rating/service.js';
import type { Game as GameRow, Move as MoveRow } from '@prisma/client';

const RESULT_FROM_DB: Record<string, GameResult> = {
  WHITE: 'white',
  BLACK: 'black',
  DRAW: 'draw',
};

const REASON_FROM_DB: Record<string, EndReason> = {
  CHECKMATE: 'checkmate',
  RESIGNATION: 'resignation',
  TIMEOUT: 'timeout',
  STALEMATE: 'stalemate',
  INSUFFICIENT_MATERIAL: 'insufficient',
  FIFTY_MOVES: 'fifty-moves',
  THREEFOLD_REPETITION: 'threefold',
  FIVEFOLD_REPETITION: 'fivefold',
  AGREEMENT: 'agreement',
  ABORTED: 'aborted',
  DISCONNECT: 'disconnect',
};

export interface StoredGame extends GameRow {
  moves?: MoveRow[];
}

export function storedMoveToRecord(move: MoveRow): MoveRecord {
  return {
    ply: move.ply,
    uci: move.uci,
    san: move.san,
    clockAfterMs: move.clockAfterMs,
    chargedMs: move.chargedMs,
    lagCompMs: move.lagCompMs,
  };
}

export function storedGameSnapshot(
  row: StoredGame,
  options: { viewerId?: string | null; chatState?: ChatState } = {},
): GameSnapshot {
  const moves = (row.moves ?? [])
    .slice()
    .sort((a, b) => a.ply - b.ply)
    .map(storedMoveToRecord);
  const last = moves[moves.length - 1];
  const isComputer = row.opponent === 'COMPUTER';
  const endedAt = row.endedAt ? row.endedAt.getTime() : null;

  return {
    id: row.id,
    status: row.status === 'STARTED' ? 'started' : row.status === 'WAITING' ? 'waiting' : row.status === 'ABORTED' ? 'aborted' : 'finished',
    rated: row.rated,
    category: CATEGORY_FROM_DB[row.category],
    baseSec: row.baseSec,
    incSec: row.incSec,
    opponent: isComputer ? 'computer' : 'human',
    engineLevel: row.engineLevel ?? null,
    white: row.whiteId
      ? {
          id: row.whiteId,
          username: row.whiteName ?? 'Player',
          displayName: row.whiteName ?? 'Player',
          isGuest: false,
          rating: row.whiteRating ?? null,
          provisional: false,
          online: false,
        }
      : null,
    black: row.blackId
      ? {
          id: row.blackId,
          username: row.blackName ?? 'Player',
          displayName: row.blackName ?? 'Player',
          isGuest: false,
          rating: row.blackRating ?? null,
          provisional: false,
          online: false,
        }
      : null,
    fen: row.fen,
    turn: row.turn === 'b' ? 'b' : 'w',
    ply: moves.length,
    lastMove: last ? [last.uci.slice(0, 2), last.uci.slice(2, 4)] : null,
    check: null,
    clocks: {
      whiteMs: row.whiteMs,
      blackMs: row.blackMs,
      running: null,
      turnStartedAt: null,
      compensationMs: 0,
    },
    result: row.result ? RESULT_FROM_DB[row.result] ?? null : null,
    reason: row.reason ? REASON_FROM_DB[row.reason] ?? null : null,
    moves,
    drawOfferBy: null,
    abortable: false,
    chat: { state: options.chatState ?? 'none', messages: [], requestedBy: null },
    canClaim: { threefold: false, fiftyMoves: false, absence: false },
    createdAt: row.createdAt.getTime(),
    startedAt: row.startedAt ? row.startedAt.getTime() : null,
    endedAt,
    ratings: {
      whiteBefore: row.whiteRating ?? null,
      whiteAfter: row.whiteRatingAfter ?? null,
      blackBefore: row.blackRating ?? null,
      blackAfter: row.blackRatingAfter ?? null,
    },
    rematch: null,
  };
}
