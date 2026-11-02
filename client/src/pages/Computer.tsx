import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chess } from 'chess.js';
import { Board } from '../components/Board';
import { MoveList } from '../components/MoveList';
import { ResultBanner } from '../components/ResultBanner';
import { engine } from '../lib/engine';
import { playSound, type SoundName } from '../lib/sounds';
import { useSession } from '../store/session';
import { usePreferences } from '../store/preferences';
import { api } from '../lib/api';
import type { MoveRecord } from '@shared/protocol';

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

interface Outcome {
  result: 'white' | 'black' | 'draw';
  reason: string;
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
  const chessRef = useRef<Chess>(new Chess());

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
    let reason = 'stalemate';
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
    setEngineError(null);
    setPlayerColor(color);
    setPhase('playing');
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
  };

  const resign = () => {
    if (phase !== 'playing') return;
    setOutcome({ result: playerColor === 'w' ? 'black' : 'white', reason: 'resignation' });
    setPhase('finished');
    playSound('end');
  };

  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null;

  return (
    <div className="page py-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="mx-auto w-full max-w-[620px]">
          <div className="mb-2 flex items-center justify-between text-xs text-forge-muted">
            <span className="uppercase tracking-[0.12em]">Computer · Level {level}</span>
            <span>{phase === 'playing' ? (thinking ? 'Engine thinking…' : 'Your move') : phase === 'finished' ? 'Game over' : 'Ready'}</span>
          </div>

          <Board
            fen={fen}
            orientation={playerColor === 'w' ? 'white' : 'black'}
            canMove={phase === 'playing' && !thinking}
            lastMove={lastMove ? [lastMove.uci.slice(0, 2), lastMove.uci.slice(2, 4)] : null}
            onMove={playMove}
            theme={theme}
            className="board-fit"
          />

          {/* The only place a game starts. It sits under the board so it is
              reachable without scrolling on phones, where the setup card lands
              below the board. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {phase === 'playing' ? (
              <>
                <button type="button" className="btn btn-secondary" onClick={takeback} disabled={moves.length < 2 || thinking}>
                  Takeback
                </button>
                <button type="button" className="btn btn-danger" onClick={resign}>
                  Resign
                </button>
              </>
            ) : phase === 'setup' ? (
              <>
                <span className="text-xs uppercase tracking-[0.12em] text-forge-faint">Play as</span>
                <button type="button" className="btn btn-primary" onClick={() => startGame('w')}>
                  White
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => startGame('b')}>
                  Black
                </button>
              </>
            ) : null}
          </div>

          {engineError ? (
            <p className="mt-3 rounded-lg border border-forge-danger/30 bg-forge-danger/10 px-3 py-2 text-sm text-forge-danger">
              {engineError}
            </p>
          ) : null}

          {outcome ? (
            <ResultBanner
              className="mt-4"
              result={outcome.result}
              myColor={playerColor}
              reason={outcome.reason}
              opponentLabel="The engine"
            >
              {savedGameId ? (
                <Link to={`/analysis/${savedGameId}`} className="btn btn-primary">
                  Analyse with Stockfish
                </Link>
              ) : session?.isGuest ? (
                <Link to="/signup" className="btn btn-secondary">
                  Create an account to save this game
                </Link>
              ) : (
                <span className="self-center text-xs text-forge-faint">Saving game…</span>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => setPhase('setup')}>
                New game
              </button>
            </ResultBanner>
          ) : null}
        </div>

        <aside className="space-y-3">
          <div className="panel p-4">
            <h1 className="font-display text-xl">Play the computer</h1>
            <p className="mt-1 text-sm text-forge-muted">
              Stockfish 19 lite runs in your browser. Nothing leaves your machine and no account is
              needed.
            </p>

            <div className="mt-4">
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
                  >
                    {option.value}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-forge-faint">{LEVELS.find((option) => option.value === level)?.hint}</p>
            </div>

            <p className="mt-4 text-[11px] text-forge-faint">
              Computer games are casual and unclocked. Finished games are archived for analysis.
            </p>
          </div>

          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-forge-line-soft px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-forge-muted">Moves</span>
              <span className="text-[11px] text-forge-faint">{moves.length} played</span>
            </div>
            <MoveList moves={moves} />
          </div>
        </aside>
      </div>
    </div>
  );
}
