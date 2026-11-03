import type { EndReason, GameResult, MoveRecord } from '@shared/protocol';
import type { TimeCategory } from '@shared/timeControl';

/**
 * A finished computer game kept in the browser.
 *
 * Computer games are archived on the server for accounts only, but the engine
 * review runs entirely locally — so a guest can still review the game they just
 * played, without an account and without the server storing anything. The record
 * lives in this tab (sessionStorage) and is dropped when the tab closes.
 */
export interface LocalAnalysisGame {
  id: string;
  moves: MoveRecord[];
  fen: string;
  baseSec: number;
  incSec: number;
  category: TimeCategory;
  engineLevel: number;
  playerColor: 'w' | 'b';
  whiteName: string;
  blackName: string;
  result: GameResult;
  reason: EndReason;
  createdAt: number;
  /** Set once the game has been archived to an account. */
  savedGameId?: string;
}

const STORAGE_KEY = 'chessforge.analysis.local';
const LOCAL_PREFIX = 'local-';
/** Enough for a few games; anything older falls off the end. */
const MAX_KEPT = 6;

// Module memory is what the next route render reads: sessionStorage can be full
// or blocked (private windows), and a game you just finished must still open.
const memory = new Map<string, LocalAnalysisGame>();

export function isLocalAnalysisId(id: string): boolean {
  return id.startsWith(LOCAL_PREFIX);
}

export function saveLocalAnalysisGame(game: Omit<LocalAnalysisGame, 'id' | 'createdAt'>): string {
  const id = `${LOCAL_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const entry: LocalAnalysisGame = { ...game, id, createdAt: Date.now() };
  memory.set(id, entry);
  const kept = [entry, ...readStored().filter((item) => item.id !== id)].slice(0, MAX_KEPT);
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Storage is disabled or full: the in-memory copy still covers this tab.
  }
  return id;
}

export function loadLocalAnalysisGame(id: string): LocalAnalysisGame | null {
  const cached = memory.get(id);
  if (cached) return cached;
  const stored = readStored().find((game) => game.id === id);
  if (stored) memory.set(stored.id, stored);
  return stored ?? null;
}

/**
 * Remembers the archived id so the tab-local copy can hand over to the server
 * copy: revisiting the `local-` URL follows it instead of posting a duplicate.
 */
export function markLocalAnalysisGameSaved(id: string, savedGameId: string): void {
  const entry = loadLocalAnalysisGame(id);
  if (!entry) return;
  const updated: LocalAnalysisGame = { ...entry, savedGameId };
  memory.set(id, updated);
  const kept = readStored().map((game) => (game.id === id ? updated : game));
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // The in-memory entry still carries the id for this tab.
  }
}

function readStored(): LocalAnalysisGame[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is LocalAnalysisGame => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as LocalAnalysisGame;
      return typeof candidate.id === 'string' && Array.isArray(candidate.moves);
    });
  } catch {
    return [];
  }
}
