import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chess } from 'chess.js';
import { Board } from '../components/Board';
import { MoveList } from '../components/MoveList';
import { ResultBanner } from '../components/ResultBanner';
import { DockButton } from '../components/DockButton';
import { engine } from '../lib/engine';
import { playSound, type SoundName } from '../lib/sounds';
import { useSession } from '../store/session';
import { usePreferences } from '../store/preferences';
import { api } from '../lib/api';
import { saveLocalAnalysisGame } from '../lib/localAnalysis';
import type { EndReason, GameResult, MoveRecord } from '@shared/protocol';
import { classifyTimeControl } from '@shared/timeControl';

const LEVELS = [
  { value: 1, label: 'Level 1', hint: 'Learning the pieces' },
  { value: 2, label: 'Level 2', hint: 'Beginner' },
  { value: 3, label: 'Level 3', hint: 'Casual' },
  { value: 4, label: 'Level 4', hint: 'Improving' },
  { value: 5, label: 'Level 5', hint: 'Club player' },
  { value: 6, label: 'Level 6', hint: 'Strong club' },
  { value: 7, label: 'Level 7', hint: 'Expert' },
  { value: 8, label: 'Level 8', hint: 'Maximum' },
];

type Phase = 'setup' | 'playing' | 'finished';
type Sheet = 'level' | 'moves' | null;

/**
 * How long the engine appears to think before it replies, in milliseconds.
 *
 * The search itself takes a few milliseconds at low levels, so without a floor
 * the reply lands on the same frame as your move and it stops feeling like a
 * game of chess. This only delays the reply — it does not weaken the engine.
 * Edit these numbers to change the pace; the jitter keeps it from feeling like
 * a metronome.
 */
const THINK_TIME_MS: Record<number, number> = {
  1: 1000,
  2: 950,
  3: 900,
  4: 850,
  5: 800,
  6: 750,
  7: 700,
  8: 650,
};

/** Extra random delay on top of THINK_TIME_MS[level], in milliseconds. */
const THINK_JITTER_MS = 300;

function soundFor(chess: Chess, san: string): SoundName {
  if (chess.isCheck()) return 'check';
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('x')) return 'capture';
  return 'move';
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
      <path d="M14.5 5 8 12l6.5 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
      <path d="M4 10h9a5 5 0 0 1 0 10H8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 6l-4 4 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
      <path d="M6 21V4M6 4h11l-1.2 3.2L17 11H6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LevelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" strokeLinecap="round" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </svg>
  );
}

function NewGameIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" strokeLinecap="round" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4" aria-hidden>
      <path d="M4 9V4h5M20 15v5h-5M4 15v5h5M20 9V4h-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4" aria-hidden>
      <path d="M9 4v5H4M15 20v-5h5M15 4v5h5M9 20v-5H4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FirstIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
      <path d="M17 6 11 12l6 6M7 6v12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LastIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
      <path d="M7 6l6 6-6 6M17 6v12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-3.5 w-3.5" aria-hidden>
      <path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Compact opponent/player strip, matching the clock bars on the game screen. */
function PlayerRow({
  name,
  detail,
  color,
  active,
  isMe,
}: {
  name: string;
  detail: string;
  color: 'w' | 'b';
  active: boolean;
  isMe?: boolean;
}) {
  return (
    <div
      className={`flex shrink-0 items-center gap-2 rounded-lg border px-2 py-1 transition-colors ${
        active ? 'border-forge-accent/35 bg-forge-panel-2' : 'border-forge-line-soft bg-forge-panel/60'
      }`}
    >
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold ${
          color === 'w'
            ? 'bg-[#e7e1d6] text-[#1a1a1a]'
            : 'bg-[#20242a] text-[#e7e1d6] ring-1 ring-inset ring-white/10'
        }`}
        aria-hidden
      >
        {color === 'w' ? '♔' : '♚'}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-[13px] font-medium leading-tight text-forge-text">{name}</span>
        {isMe ? <span className="chip chip-accent shrink-0 !px-1.5 !py-0 !text-[9px]">you</span> : null}
        <span className="shrink-0 truncate text-[10px] text-forge-faint">{detail}</span>
      </div>
    </div>
  );
}

interface Outcome {
  result: GameResult;
  reason: EndReason;
}

export default function ComputerPage() {
  const session = useSession((state) => state.user);
  const theme = usePreferences((state) => state.boardTheme);
  const [phase, setPhase] = useState<Phase>('setup');
  const [level, setLevel] = useState(3);
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w');
  const [fen, setFen] = useState(() => new Chess().fen());
  const [moves, setMoves] = useState<MoveRecord[]>([]);
  const [thinking, setThinking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [savedGameId, setSavedGameId] = useState<string | null>(null);
  // Guests have no server archive, so their finished game is kept in this tab instead.
  const [localGameId, setLocalGameId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // null follows the game; a number pins the board to an earlier ply. Taking
  // back or starting again clears it so the board snaps back to the action.
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const chessRef = useRef<Chess>(new Chess());

  // Every position in the game, rebuilt from the move list so the review arrows
  // can step through them without touching the live game state.
  const positions = useMemo(() => {
    const replay = new Chess();
    const fens = [replay.fen()];
    for (const move of moves) {
      try {
        replay.move({
          from: move.uci.slice(0, 2) as never,
          to: move.uci.slice(2, 4) as never,
          promotion: move.uci.length > 4 ? (move.uci[4] as never) : undefined,
        });
        fens.push(replay.fen());
      } catch {
        fens.push(fens[fens.length - 1]);
      }
    }
    return fens;
  }, [moves]);

  const viewPly = reviewPly === null ? moves.length : Math.min(reviewPly, moves.length);
  const viewFen = positions[viewPly] ?? positions[0];
  const viewMove = viewPly > 0 ? moves[viewPly - 1] : null;

  const goToPly = (ply: number) => {
    const clamped = Math.max(0, Math.min(moves.length, ply));
    // Landing on the latest position resumes the live game.
    setReviewPly(clamped === moves.length ? null : clamped);
  };

  useEffect(() => {
    if (moves.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToPly(viewPly - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToPly(viewPly + 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        goToPly(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        goToPly(moves.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPly, moves.length]);

  // Fullscreen belongs to the browser tab, so mirror the real state instead of
  // toggling a flag — Esc and the browser's own controls also end it.
  useEffect(() => {
    const syncFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const canFullscreen = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (!document.fullscreenEnabled) return;
    void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  const record = (uci: string, san: string) => {
    setMoves((previous) => [
      ...previous,
      {
        ply: previous.length + 1,
        uci,
        san,
        clockAfterMs: 0,
        chargedMs: 0,
        lagCompMs: 0,
      },
    ]);
  };

  const finishIfOver = (chess: Chess): boolean => {
    if (!chess.isGameOver()) return false;
    let result: Outcome['result'] = 'draw';
    let reason: EndReason = 'stalemate';
    if (chess.isCheckmate()) {
      result = chess.turn() === 'w' ? 'black' : 'white';
      reason = 'checkmate';
    } else if (chess.isInsufficientMaterial()) {
      reason = 'insufficient';
    } else if (chess.isThreefoldRepetition()) {
      reason = 'threefold';
    } else if (chess.isDrawByFiftyMoves()) {
      reason = 'fifty-moves';
    }
    setOutcome({ result, reason });
    setPhase('finished');
    setThinking(false);
    playSound('end');
    return true;
  };

  const startGame = (color: 'w' | 'b') => {
    const chess = new Chess();
    chessRef.current = chess;
    setFen(chess.fen());
    setMoves([]);
    setOutcome(null);
    setSavedGameId(null);
    setLocalGameId(null);
    setEngineError(null);
    setPlayerColor(color);
    setPhase('playing');
    setSheet(null);
    setReviewPly(null);
    playSound('start');
  };

  // Engine plays its own turn.
  useEffect(() => {
    if (phase !== 'playing') return;
    const chess = chessRef.current;
    if (chess.turn() === playerColor) return;

    let cancelled = false;
    setThinking(true);
    const thinkMs = (THINK_TIME_MS[level] ?? 800) + Math.random() * THINK_JITTER_MS;
    const timer = window.setTimeout(() => {
      engine
        .bestMove(chess.fen(), level)
        .then((uci) => {
          if (cancelled || !uci) return;
          try {
            const move = chess.move({
              from: uci.slice(0, 2) as never,
              to: uci.slice(2, 4) as never,
              promotion: uci.length > 4 ? (uci[4] as never) : undefined,
            });
            record(uci, move.san);
            setFen(chess.fen());
            playSound(soundFor(chess, move.san));
            finishIfOver(chess);
          } catch {
            setEngineError('The engine returned an illegal move.');
          }
        })
        .catch(() => {
          if (!cancelled) setEngineError('The engine could not start in this browser.');
        })
        .finally(() => {
          if (!cancelled) setThinking(false);
        });
    }, thinkMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      engine.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, fen, playerColor, level]);

  // Archive finished games so they can be analysed later.
  useEffect(() => {
    if (phase !== 'finished' || !outcome || savedGameId) return;
    if (!session || session.isGuest) return;
    api
      .saveComputerGame({
        baseSec: 600,
        incSec: 0,
        engineLevel: level,
        moves: moves.map((move) => move.uci),
        result: outcome.result,
        reason: outcome.reason,
        playerColor: playerColor === 'w' ? 'white' : 'black',
      })
      .then((result) => setSavedGameId(result.id))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, outcome, moves, level, playerColor, session, savedGameId]);

  // Guests get no server archive: keep the finished game in this tab so the
  // analysis page can review it without asking them to make an account.
  useEffect(() => {
    if (phase !== 'finished' || !outcome || localGameId) return;
    if (session && !session.isGuest) return;
    const playerName = session?.displayName ?? 'You';
    const engineName = `Stockfish level ${level}`;
    const baseSec = 600;
    setLocalGameId(
      saveLocalAnalysisGame({
        moves,
        fen: positions[positions.length - 1] ?? new Chess().fen(),
        baseSec,
        incSec: 0,
        category: classifyTimeControl({ baseSec, incSec: 0 }),
        engineLevel: level,
        playerColor,
        whiteName: playerColor === 'w' ? playerName : engineName,
        blackName: playerColor === 'w' ? engineName : playerName,
        result: outcome.result,
        reason: outcome.reason,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, outcome, moves, level, playerColor, session, localGameId]);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheet(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  const playMove = (uci: string) => {
    const chess = chessRef.current;
    if (phase !== 'playing' || chess.turn() !== playerColor) return;
    try {
      const move = chess.move({
        from: uci.slice(0, 2) as never,
        to: uci.slice(2, 4) as never,
        promotion: uci.length > 4 ? (uci[4] as never) : undefined,
      });
      record(uci, move.san);
      setFen(chess.fen());
      playSound(soundFor(chess, move.san));
      finishIfOver(chess);
    } catch {
      playSound('illegal');
      // Ignore illegal client-side attempts; the board resets from fen.
    }
  };

  const takeback = () => {
    const chess = chessRef.current;
    if (phase !== 'playing') return;
    chess.undo();
    if (chess.turn() !== playerColor) chess.undo();
    setMoves((previous) => previous.slice(0, -2));
    setFen(chess.fen());
    setOutcome(null);
    setReviewPly(null);
  };

  const resign = () => {
    if (phase !== 'playing') return;
    setOutcome({ result: playerColor === 'w' ? 'black' : 'white', reason: 'resignation' });
    setPhase('finished');
    playSound('end');
  };

  const topColor = playerColor === 'w' ? 'b' : 'w';
  const thinkingNow = phase === 'playing' && thinking;
  const statusText =
    phase === 'playing'
      ? thinking
        ? 'Engine thinking…'
        : 'Your move'
      : phase === 'finished'
        ? 'Game over'
        : 'Ready to start';
  const levelHint = LEVELS.find((option) => option.value === level)?.hint ?? '';
  // Archived games for accounts, the tab-local copy for guests.
  const analysisHref = localGameId
    ? `/analysis/${localGameId}`
    : savedGameId
      ? `/analysis/${savedGameId}`
      : null;

  const levelPicker = (
    <>
      <span className="label">Strength</span>
      <div className="grid grid-cols-4 gap-1.5">
        {LEVELS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setLevel(option.value)}
            className={`rounded-lg border px-1 py-1.5 text-xs transition-colors ${
              level === option.value
                ? 'border-forge-accent/60 bg-forge-accent/10 text-forge-accent'
                : 'border-forge-line text-forge-muted hover:text-forge-text'
            }`}
            title={option.hint}
            aria-pressed={level === option.value}
          >
            {option.value}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-forge-faint">{levelHint}</p>
      <p className="mt-2 text-[11px] text-forge-faint">
        You can change this mid-game — the engine uses the new strength from its next move.
      </p>
    </>
  );

  return (
    <div className="game-shell px-2 pb-1 pt-1.5 sm:px-4 sm:pt-2">
      <div className="mx-auto grid h-full min-h-0 max-w-[1180px] gap-2 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-4">
        {/* ── Board column ── */}
        <div className="flex min-h-0 w-full flex-col">
          <div className="mb-1 flex shrink-0 items-center justify-between gap-2 text-[11px] text-forge-muted">
            <div className="flex min-w-0 items-center gap-1.5">
              <Link
                to="/"
                aria-label="Back to lobby"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-forge-line text-forge-muted hover:text-forge-text lg:hidden"
              >
                <BackIcon />
              </Link>
              <span className="uppercase tracking-[0.12em]">Computer</span>
              <span className="text-forge-faint">·</span>
              <span className="tabular-nums">Level {level}</span>
              <span className="truncate text-forge-faint">· {statusText}</span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {canFullscreen || fullscreen ? (
                <button
                  type="button"
                  className="btn btn-ghost !px-1.5 !py-1 text-[11px]"
                  onClick={toggleFullscreen}
                  title={fullscreen ? 'Exit full screen' : 'Full screen'}
                  aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
                  aria-pressed={fullscreen}
                >
                  {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
                  <span className="hidden sm:inline">{fullscreen ? 'Exit' : 'Full screen'}</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
            <div className="game-board-col has-move-nav flex w-full flex-col gap-1">
              <PlayerRow
                name="Stockfish"
                detail={thinkingNow ? 'thinking…' : `Level ${level}`}
                color={topColor}
                active={thinkingNow}
              />
              <Board
                fen={viewFen}
                orientation={playerColor === 'w' ? 'white' : 'black'}
                canMove={phase === 'playing' && !thinking && reviewPly === null}
                lastMove={viewMove ? [viewMove.uci.slice(0, 2), viewMove.uci.slice(2, 4)] : null}
                onMove={playMove}
                theme={theme}
                className="board-fit-game"
              />
              <PlayerRow
                name={session?.displayName ?? 'You'}
                detail={session?.isGuest ? 'guest' : 'you'}
                color={playerColor}
                active={phase === 'playing' && !thinking}
                isMe
              />

              {/* Move navigation — under the board so it never covers a square */}
              <div className="mt-0.5 flex shrink-0 items-center justify-center gap-1">
                <button
                  type="button"
                  onClick={() => goToPly(0)}
                  disabled={viewPly === 0}
                  aria-label="First move"
                  title="First move (Home)"
                  className="grid h-7 w-8 place-items-center rounded-md border border-forge-line text-forge-muted transition-colors hover:text-forge-text disabled:opacity-30 disabled:hover:text-forge-muted"
                >
                  <FirstIcon />
                </button>
                <button
                  type="button"
                  onClick={() => goToPly(viewPly - 1)}
                  disabled={viewPly === 0}
                  aria-label="Previous move"
                  title="Previous move (←)"
                  className="grid h-7 w-8 place-items-center rounded-md border border-forge-line text-forge-muted transition-colors hover:text-forge-text disabled:opacity-30 disabled:hover:text-forge-muted"
                >
                  <PrevIcon />
                </button>
                <button
                  type="button"
                  onClick={() => goToPly(viewPly + 1)}
                  disabled={viewPly >= moves.length}
                  aria-label="Next move"
                  title="Next move (→)"
                  className="grid h-7 w-8 place-items-center rounded-md border border-forge-line text-forge-muted transition-colors hover:text-forge-text disabled:opacity-30 disabled:hover:text-forge-muted"
                >
                  <NextIcon />
                </button>
                <button
                  type="button"
                  onClick={() => goToPly(moves.length)}
                  disabled={viewPly >= moves.length}
                  aria-label="Latest move"
                  title="Latest move (End)"
                  className="grid h-7 w-8 place-items-center rounded-md border border-forge-line text-forge-muted transition-colors hover:text-forge-text disabled:opacity-30 disabled:hover:text-forge-muted"
                >
                  <LastIcon />
                </button>
                <span
                  className={`ml-1 min-w-[54px] text-center font-mono text-[11px] tabular-nums ${
                    reviewPly === null ? 'text-forge-faint' : 'text-forge-accent'
                  }`}
                  aria-live="polite"
                >
                  {viewPly} / {moves.length}
                </span>
              </div>
            </div>
          </div>

          {engineError ? (
            <p className="mt-1 shrink-0 rounded-lg border border-forge-danger/30 bg-forge-danger/10 px-3 py-2 text-xs text-forge-danger">
              {engineError}
            </p>
          ) : null}

          {/* Mobile: move strip — the header opens the full list, like the game screen */}
          <div className="mt-1 flex h-[clamp(72px,12dvh,104px)] shrink-0 flex-col overflow-hidden lg:hidden">
            <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
              <button
                type="button"
                onClick={() => setSheet('moves')}
                aria-label="Expand moves"
                title="Expand moves"
                className="flex shrink-0 items-center justify-between gap-2 border-b border-forge-line/70 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-forge-faint transition-colors hover:text-forge-text"
              >
                <span>Moves ({moves.length})</span>
                <ExpandIcon />
              </button>
              <MoveList moves={moves} fill />
            </div>
          </div>

          {/* Mobile action dock */}
          <div className="mt-1 flex shrink-0 items-stretch gap-1 pb-[max(2px,env(safe-area-inset-bottom))] lg:hidden">
            {phase === 'setup' ? (
              <>
                <DockButton label="Play white" icon={<span className="text-[13px] leading-none">♔</span>} onClick={() => startGame('w')} />
                <DockButton label="Play black" icon={<span className="text-[13px] leading-none">♚</span>} onClick={() => startGame('b')} />
              </>
            ) : phase === 'playing' ? (
              <>
                <DockButton
                  label="Takeback"
                  icon={<UndoIcon />}
                  disabled={moves.length < 2 || thinking}
                  onClick={takeback}
                />
                <DockButton label="Resign" icon={<FlagIcon />} danger onClick={resign} />
              </>
            ) : (
              <>
                <DockButton
                  label="New game"
                  icon={<NewGameIcon />}
                  emphasis
                  onClick={() => {
                    setPhase('setup');
                    setOutcome(null);
                  }}
                />
                {analysisHref ? (
                  <DockButton to={analysisHref} label="Analyse" icon={<span className="font-display text-[13px] leading-none">⤢</span>} />
                ) : null}
              </>
            )}
            <DockButton label="Level" icon={<LevelIcon />} active={sheet === 'level'} onClick={() => setSheet('level')} />
          </div>
        </div>

        {/* ── Desktop sidebar ── */}
        <aside className="hidden min-h-0 flex-col gap-2 lg:flex">
          <div className="panel shrink-0 p-3">
            <h1 className="font-display text-base leading-tight">Play the computer</h1>
            <p className="mt-0.5 text-[11px] leading-snug text-forge-muted">
              Stockfish 19 lite runs in your browser. Nothing leaves your machine.
            </p>
            <div className="mt-3">{levelPicker}</div>
          </div>

          <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-forge-line-soft px-2.5 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-forge-muted">Moves</span>
              <span className="text-[10px] text-forge-faint">{moves.length} played</span>
            </div>
            <MoveList moves={moves} currentPly={viewPly || null} onSelect={goToPly} fill />
          </div>

          {outcome ? (
            <div className="shrink-0">
              <ResultBanner
                compact
                result={outcome.result}
                myColor={playerColor}
                reason={outcome.reason}
                opponentLabel="The engine"
              >
                {analysisHref ? (
                  <Link to={analysisHref} className="btn btn-secondary !py-1.5 !text-xs">
                    Analyse with Stockfish
                  </Link>
                ) : !session || session.isGuest ? null : (
                  <span className="self-center text-[11px] text-forge-faint">Saving game…</span>
                )}
                {session?.isGuest ? (
                  <Link
                    to="/signup"
                    state={{ from: analysisHref ?? '/computer' }}
                    className="btn btn-ghost !py-1.5 !text-xs"
                  >
                    Save this game
                  </Link>
                ) : null}
              </ResultBanner>
            </div>
          ) : null}

          <div className="flex shrink-0 flex-wrap gap-2">
            {phase === 'playing' ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary flex-1 !py-2 !text-xs"
                  onClick={takeback}
                  disabled={moves.length < 2 || thinking}
                >
                  Takeback
                </button>
                <button type="button" className="btn btn-danger flex-1 !py-2 !text-xs" onClick={resign}>
                  Resign
                </button>
              </>
            ) : phase === 'setup' ? (
              <>
                <button type="button" className="btn btn-primary flex-1 !py-2 !text-xs" onClick={() => startGame('w')}>
                  Play as white
                </button>
                <button type="button" className="btn btn-secondary flex-1 !py-2 !text-xs" onClick={() => startGame('b')}>
                  Play as black
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary w-full !py-2 !text-xs"
                onClick={() => {
                  setPhase('setup');
                  setOutcome(null);
                }}
              >
                New game
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* ── Mobile sheet: strength / moves ── */}
      {sheet ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-end bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSheet(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={sheet === 'level' ? 'Strength' : 'Move list'}
            className="flex max-h-[85dvh] w-full max-w-[560px] flex-col rounded-t-2xl border-t border-forge-line bg-forge-panel-2 shadow-[0_-18px_50px_-10px_rgba(0,0,0,0.9)]"
            style={sheet === 'moves' ? { height: '62dvh' } : undefined}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 justify-center pt-2" aria-hidden>
              <span className="h-1 w-10 rounded-full bg-forge-line" />
            </div>
            <div className="flex shrink-0 items-center justify-between border-b border-forge-line px-3 py-2">
              <span className="truncate text-sm font-semibold">
                {sheet === 'level' ? 'Strength' : `Moves (${moves.length})`}
              </span>
              <button
                type="button"
                aria-label="Close panel"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-forge-muted hover:bg-white/5 hover:text-forge-text"
                onClick={() => setSheet(null)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-3">
              {sheet === 'level' ? (
                levelPicker
              ) : (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <MoveList moves={moves} currentPly={viewPly || null} onSelect={goToPly} fill />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
