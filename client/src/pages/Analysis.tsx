import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import { Board } from '../components/Board';
import { api, ApiError } from '../lib/api';
import { engine, type EngineLine } from '../lib/engine';
import { usePreferences } from '../store/preferences';
import { buildPgn } from '../lib/pgn';
import { useSession } from '../store/session';
import {
  isLocalAnalysisId,
  loadLocalAnalysisGame,
  markLocalAnalysisGameSaved,
  type LocalAnalysisGame,
} from '../lib/localAnalysis';
import {
  classifyDrop,
  formatEval,
  moveAccuracy,
  overallAccuracy,
  qualityColor,
  qualityLabel,
  winPercentFromEval,
} from '../lib/analysis';
import type { EndReason, GameResult, GameSnapshot, MoveRecord } from '@shared/protocol';
import { categoryLabel, formatTimeControl, type TimeCategory } from '@shared/timeControl';
import { reasonText, resultHeadline } from '../lib/format';

interface Metrics {
  accuracy: number;
  winBefore: number;
  winAfter: number;
  quality: ReturnType<typeof classifyDrop>;
  line: EngineLine;
}

/**
 * Everything the review needs, whether it came from an archived game on the
 * server or from a guest's finished computer game held in this tab.
 */
interface AnalysisGame {
  id: string;
  status: GameSnapshot['status'];
  moves: MoveRecord[];
  fen: string;
  baseSec: number;
  incSec: number;
  category: TimeCategory;
  white: { displayName: string } | null;
  black: { displayName: string } | null;
  result: GameResult | null;
  reason: EndReason | null;
  createdAt: number;
  /** Kept in this tab only; never archived on the server. */
  local: boolean;
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
      <path d="M14.5 5 8 12l6.5 7" strokeLinecap="round" strokeLinejoin="round" />
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

function NavButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-7 w-8 shrink-0 place-items-center rounded-md border border-forge-line text-forge-muted transition-colors hover:text-forge-text disabled:opacity-30 disabled:hover:text-forge-muted"
    >
      {children}
    </button>
  );
}

export default function AnalysisPage() {
  const { id = '' } = useParams();
  const theme = usePreferences((state) => state.boardTheme);
  const [snapshot, setSnapshot] = useState<AnalysisGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [lines, setLines] = useState<Record<number, EngineLine>>({});
  const [depth, setDepth] = useState(12);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  // A guest's game lives in this tab; an account turns it into an archived game.
  const [localGame, setLocalGame] = useState<LocalAnalysisGame | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [pgnState, setPgnState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const pgnTimer = useRef<number | null>(null);
  const saveAttempted = useRef(false);
  const session = useSession((state) => state.user);
  const navigate = useNavigate();
  const location = useLocation();
  const cancelled = useRef(false);
  // Keeps the highlighted row in view when the arrows step through the game.
  const rowsRef = useRef<Record<number, HTMLTableRowElement | null>>({});

  useEffect(() => {
    let alive = true;

    // A guest's computer game was never archived, so it is read from this tab.
    if (isLocalAnalysisId(id)) {
      const local = loadLocalAnalysisGame(id);
      if (!local) {
        setError('This game was not kept. Finished games live in the tab that played them.');
      } else {
        setLocalGame(local);
        setSnapshot({
          id: local.id,
          status: 'finished',
          moves: local.moves,
          fen: local.fen,
          baseSec: local.baseSec,
          incSec: local.incSec,
          category: local.category,
          white: { displayName: local.whiteName },
          black: { displayName: local.blackName },
          result: local.result,
          reason: local.reason,
          createdAt: local.createdAt,
          local: true,
        });
      }
      return () => {
        alive = false;
      };
    }

    api
      .game(id)
      .then((data) => {
        if (!alive) return;
        // The engine has no player row in an archived computer game, but the
        // archive knows its level, so the review can still name the opponent.
        const engineName =
          data.opponent === 'computer' && data.engineLevel ? `Stockfish level ${data.engineLevel}` : null;
        setSnapshot({
          id: data.id,
          status: data.status,
          moves: data.moves,
          fen: data.fen,
          baseSec: data.baseSec,
          incSec: data.incSec,
          category: data.category,
          white: data.white ?? (engineName ? { displayName: engineName } : null),
          black: data.black ?? (engineName ? { displayName: engineName } : null),
          result: data.result,
          reason: data.reason,
          createdAt: data.createdAt,
          local: false,
        });
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Could not load the game');
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(
    () => () => {
      cancelled.current = true;
      engine.stop();
    },
    [],
  );

  const archiveLocalGame = useCallback(
    async (game: LocalAnalysisGame) => {
      setSaveState('saving');
      try {
        const result = await api.saveComputerGame({
          baseSec: game.baseSec,
          incSec: game.incSec,
          engineLevel: game.engineLevel,
          moves: game.moves.map((move) => move.uci),
          result: game.result,
          reason: game.reason,
          playerColor: game.playerColor === 'w' ? 'white' : 'black',
        });
        markLocalAnalysisGameSaved(game.id, result.id);
        // The archived copy is the durable one, so drop the short local URL.
        navigate(`/analysis/${result.id}`, { replace: true });
      } catch {
        setSaveState('error');
      }
    },
    [navigate],
  );

  // Someone who just made an account should keep the game they were reviewing:
  // archive it, and follow the server copy if it was archived already.
  useEffect(() => {
    if (!localGame) return;
    if (localGame.savedGameId) {
      navigate(`/analysis/${localGame.savedGameId}`, { replace: true });
      return;
    }
    if (!session || session.isGuest || saveAttempted.current) return;
    saveAttempted.current = true;
    void archiveLocalGame(localGame);
  }, [localGame, session, navigate, archiveLocalGame]);

  const positions = useMemo(() => {
    if (!snapshot) return [] as string[];
    const chess = new Chess();
    const list = [chess.fen()];
    for (const move of snapshot.moves) {
      try {
        chess.move({
          from: move.uci.slice(0, 2) as never,
          to: move.uci.slice(2, 4) as never,
          promotion: move.uci.length > 4 ? (move.uci[4] as never) : undefined,
        });
        list.push(chess.fen());
      } catch {
        break;
      }
    }
    return list;
  }, [snapshot]);

  const metrics = useMemo(() => {
    if (!snapshot) return [] as (Metrics | null)[];
    return snapshot.moves.map((move, index) => {
      const before = lines[index];
      const after = lines[index + 1];
      if (!before || !after) return null;
      const mover = index % 2 === 0 ? 'w' : 'b';
      const winBefore = winPercentFromEval(before.cp, before.mate, mover);
      const winAfter = winPercentFromEval(after.cp, after.mate, mover);
      return {
        accuracy: moveAccuracy(winBefore, winAfter),
        winBefore,
        winAfter,
        quality: classifyDrop(winBefore - winAfter),
        line: after,
      };
    });
  }, [snapshot, lines]);

  const accuracy = useMemo(() => {
    const white: number[] = [];
    const black: number[] = [];
    metrics.forEach((metric, index) => {
      if (!metric) return;
      if (index % 2 === 0) white.push(metric.accuracy);
      else black.push(metric.accuracy);
    });
    return { white: overallAccuracy(white), black: overallAccuracy(black) };
  }, [metrics]);

  const totalPlies = snapshot?.moves.length ?? 0;

  // Arrow keys and Home/End step through the game, matching the computer page.
  useEffect(() => {
    if (totalPlies === 0) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setSelected((value) => Math.max(0, value - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setSelected((value) => Math.min(totalPlies, value + 1));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setSelected(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setSelected(totalPlies);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [totalPlies]);

  useEffect(() => {
    if (selected <= 0) return;
    rowsRef.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const runAnalysis = async () => {
    if (!positions.length) return;
    cancelled.current = false;
    setRunning(true);
    setProgress(0);
    setError(null);
    const collected: Record<number, EngineLine> = {};
    for (let index = 0; index < positions.length; index += 1) {
      if (cancelled.current) break;
      try {
        const line = await engine.analyse(positions[index]!, depth);
        collected[index] = line;
        setLines({ ...collected });
      } catch {
        setError('The engine could not analyse this position. Try reloading the page.');
        break;
      }
      setProgress(Math.round(((index + 1) / positions.length) * 100));
    }
    setRunning(false);
  };

  const cancel = () => {
    cancelled.current = true;
    engine.stop();
    setRunning(false);
  };

  const currentFen = positions[selected] ?? snapshot?.fen ?? new Chess().fen();
  const currentMove: MoveRecord | null = snapshot && selected > 0 ? snapshot.moves[selected - 1] ?? null : null;
  const currentMetric: Metrics | null = metrics[selected - 1] ?? null;
  const evalLine = lines[selected] ?? null;

  const evalSeries = useMemo(() => {
    if (!snapshot) return [] as number[];
    const series: number[] = [];
    for (let index = 0; index < positions.length; index += 1) {
      const line = lines[index];
      series.push(line ? winPercentFromEval(line.cp, line.mate, 'w') : 50);
    }
    return series;
  }, [positions.length, lines, snapshot]);

  const chartPoints = useMemo(
    () =>
      evalSeries.map((value, index) => {
        const x = (index / Math.max(1, evalSeries.length - 1)) * 300;
        const y = 80 - (value / 100) * 80;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }),
    [evalSeries],
  );

  if (error && !snapshot) {
    return (
      <div className="page flex h-[70dvh] flex-col items-center justify-center text-center">
        <h1 className="font-display text-4xl">Analysis unavailable</h1>
        <p className="mt-3 text-forge-muted">{error}</p>
        <Link to="/" className="btn btn-primary mt-6">
          Back to the lobby
        </Link>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="analysis-shell px-2 pb-1 pt-1.5 sm:px-4 sm:pt-3">
        <div className="mx-auto grid h-full min-h-0 max-w-[1180px] grid-rows-[auto_minmax(0,1fr)] gap-1.5 md:grid-cols-[minmax(0,1fr)_320px] md:grid-rows-[minmax(0,1fr)] md:gap-3 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-4">
          <div className="analysis-board-col board-shell shimmer" />
          <div className="panel min-h-[120px] shimmer" />
        </div>
      </div>
    );
  }

  const analysisReady = Object.keys(lines).length > 1;
  const whiteName = snapshot.white?.displayName ?? 'White';
  const blackName = snapshot.black?.displayName ?? 'Black';
  const whiteAccuracy = analysisReady ? `${accuracy.white.toFixed(1)}%` : '—';
  const blackAccuracy = analysisReady ? `${accuracy.black.toFixed(1)}%` : '—';

  const copyPgn = async () => {
    try {
      await navigator.clipboard.writeText(
        buildPgn({
          moves: snapshot.moves,
          white: whiteName,
          black: blackName,
          result: snapshot.result,
          baseSec: snapshot.baseSec,
          incSec: snapshot.incSec,
          date: snapshot.createdAt,
        }),
      );
      setPgnState('copied');
    } catch {
      setPgnState('failed');
    }
    if (pgnTimer.current !== null) window.clearTimeout(pgnTimer.current);
    pgnTimer.current = window.setTimeout(() => setPgnState('idle'), 1800);
  };

  return (
    <div className="analysis-shell px-2 pb-1 pt-1.5 sm:px-4 sm:pt-3">
      <div className="mx-auto grid h-full min-h-0 max-w-[1180px] grid-rows-[auto_minmax(0,1fr)] gap-1.5 md:grid-cols-[minmax(0,1fr)_320px] md:grid-rows-[minmax(0,1fr)] md:gap-3 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-4">
        {/* ── Board column: strip, board, navigation, evaluation ── */}
        <div className="flex min-h-0 w-full flex-col">
          <div className="mb-1 flex shrink-0 items-center justify-between gap-2 text-[11px] text-forge-muted">
            <div className="flex min-w-0 items-center gap-1.5">
              <Link
                to={snapshot.local ? '/computer' : '/'}
                aria-label={snapshot.local ? 'Back to the computer game' : 'Back to lobby'}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-forge-line text-forge-muted hover:text-forge-text md:hidden"
              >
                <BackIcon />
              </Link>
              <span className="uppercase tracking-[0.12em]">Analysis</span>
              <span className="text-forge-faint">·</span>
              <span className="tabular-nums">
                {formatTimeControl({ baseSec: snapshot.baseSec, incSec: snapshot.incSec })}
              </span>
              <span className="hidden text-forge-faint sm:inline">·</span>
              <span className="hidden sm:inline">{categoryLabel(snapshot.category)}</span>
            </div>
            <span className="shrink-0 tabular-nums">
              {selected} / {snapshot.moves.length} plies
            </span>
          </div>

          <div className="analysis-board-col shrink-0">
            <Board
              fen={currentFen}
              orientation="white"
              canMove={false}
              lastMove={currentMove ? [currentMove.uci.slice(0, 2), currentMove.uci.slice(2, 4)] : null}
              theme={theme}
              className="board-fit-game"
            />
          </div>

          <div className="mt-1.5 flex shrink-0 items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <NavButton label="First position (Home)" onClick={() => setSelected(0)} disabled={selected === 0}>
                <FirstIcon />
              </NavButton>
              <NavButton
                label="Previous position (←)"
                onClick={() => setSelected((value) => Math.max(0, value - 1))}
                disabled={selected === 0}
              >
                <PrevIcon />
              </NavButton>
              <NavButton
                label="Next position (→)"
                onClick={() => setSelected((value) => Math.min(snapshot.moves.length, value + 1))}
                disabled={selected >= snapshot.moves.length}
              >
                <NextIcon />
              </NavButton>
              <NavButton
                label="Latest position (End)"
                onClick={() => setSelected(snapshot.moves.length)}
                disabled={selected >= snapshot.moves.length}
              >
                <LastIcon />
              </NavButton>
              <span
                className="ml-1 hidden min-w-[52px] text-center font-mono text-[11px] tabular-nums text-forge-faint sm:inline"
                aria-live="polite"
              >
                {selected} / {snapshot.moves.length}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={depth}
                onChange={(event) => setDepth(Number(event.target.value))}
                className="field !w-auto !py-1 !text-[11px] lg:!text-xs"
                aria-label="Engine depth"
                disabled={running}
              >
                <option value={10}>Depth 10</option>
                <option value={12}>Depth 12</option>
                <option value={14}>Depth 14</option>
                <option value={16}>Depth 16</option>
              </select>
              {running ? (
                <button type="button" className="btn btn-secondary !px-2.5 !py-1 !text-[11px] lg:!text-xs" onClick={cancel}>
                  Stop · {progress}%
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary !px-2.5 !py-1 !text-[11px] lg:!text-xs"
                  onClick={() => void runAnalysis()}
                >
                  {analysisReady ? 'Re-analyse' : 'Analyse'}
                </button>
              )}
            </div>
          </div>

          {/* Evaluation graph: shrinks to a strip on phones so the move list keeps its room */}
          <div className="panel mt-1.5 flex h-[64px] shrink-0 flex-col p-2 md:mt-2 md:h-[clamp(96px,15dvh,180px)] md:p-3">
            <div className="flex shrink-0 items-center justify-between text-[10px] md:text-xs">
              <span className="uppercase tracking-[0.12em] text-forge-muted md:normal-case md:tracking-normal">
                Evaluation
              </span>
              <span className="tabular-nums text-forge-text">
                {evalLine ? formatEval(evalLine.cp, evalLine.mate) : '—'}
                {evalLine ? <span className="ml-1 text-forge-faint">depth {evalLine.depth}</span> : null}
              </span>
            </div>
            <div className="relative mt-1 min-h-0 flex-1">
              <svg
                viewBox="0 0 300 80"
                className="h-full w-full"
                preserveAspectRatio="none"
                role="img"
                aria-label="Evaluation graph"
              >
                <rect x="0" y="0" width="300" height="80" fill="#0b0d10" rx="6" />
                <line x1="0" y1="40" x2="300" y2="40" stroke="#22272e" strokeWidth="1" />
                {chartPoints.length > 1 ? (
                  <>
                    <polyline points={chartPoints.join(' ')} fill="none" stroke="#e3a455" strokeWidth="1.8" />
                    <polygon points={`0,80 ${chartPoints.join(' ')} 300,80`} fill="rgba(227,164,85,0.12)" />
                    <line
                      x1={(selected / Math.max(1, chartPoints.length - 1)) * 300}
                      y1="0"
                      x2={(selected / Math.max(1, chartPoints.length - 1)) * 300}
                      y2="80"
                      stroke="rgba(255,255,255,0.35)"
                      strokeWidth="1"
                    />
                  </>
                ) : (
                  <text x="150" y="45" textAnchor="middle" fill="#6b7280" fontSize="10">
                    Run the engine to plot advantage
                  </text>
                )}
              </svg>
            </div>
          </div>
        </div>

        {/* ── Verdict + move list ── */}
        <aside className="flex min-h-0 flex-col gap-1.5 md:gap-2">
          <div className="panel shrink-0 p-2 md:p-3.5">
            <h1 className="truncate font-display text-[13px] leading-tight md:text-lg">
              {whiteName} <span className="text-forge-faint">vs</span> {blackName}
            </h1>
            <p className="truncate text-[10px] text-forge-muted md:mt-1 md:text-sm">
              {resultHeadline(snapshot, null)} {reasonText(snapshot.reason)}
            </p>
            {snapshot.local ? (
              saveState === 'error' ? (
                <p className="truncate text-[10px] text-forge-danger">
                  Could not save this game.{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      saveAttempted.current = false;
                      if (localGame) void archiveLocalGame(localGame);
                    }}
                  >
                    Retry
                  </button>
                </p>
              ) : session && !session.isGuest ? (
                <p className="truncate text-[10px] text-forge-faint">
                  {saveState === 'saving' ? 'Saving to your games…' : 'Archiving this game…'}
                </p>
              ) : (
                <p className="truncate text-[10px] text-forge-faint">
                  Not saved —{' '}
                  <Link
                    to="/signup"
                    state={{ from: location.pathname }}
                    className="text-forge-accent hover:underline"
                  >
                    keep this game with an account
                  </Link>
                </p>
              )
            ) : null}

            {/* Phone: accuracy on one line — the cards below cost room the move list needs. */}
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-forge-faint md:hidden">
              <span className="uppercase tracking-[0.12em]">Accuracy</span>
              <span className="truncate tabular-nums">
                ♔ <span className="text-forge-text">{whiteAccuracy}</span> · ♚{' '}
                <span className="text-forge-text">{blackAccuracy}</span>
              </span>
            </div>

            <div className="mt-2 hidden grid-cols-2 gap-2 md:mt-3 md:grid">
              {(['white', 'black'] as const).map((color) => {
                const value = color === 'white' ? whiteAccuracy : blackAccuracy;
                const label = color === 'white' ? whiteName : blackName;
                return (
                  <div
                    key={color}
                    className="rounded-lg border border-forge-line-soft bg-forge-bg/50 p-2.5 text-center"
                  >
                    <div className="text-[10px] uppercase tracking-wide text-forge-faint">{label}</div>
                    <div className="stat-value mt-1">{value}</div>
                    <div className="text-[10px] text-forge-faint">accuracy</div>
                  </div>
                );
              })}
            </div>

            {currentMetric ? (
              <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-forge-line-soft bg-forge-bg/50 px-2 py-1 md:mt-3 md:gap-2 md:px-2.5 md:py-2">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold lg:text-[11px]"
                  style={{
                    color: qualityColor(currentMetric.quality),
                    backgroundColor: `${qualityColor(currentMetric.quality)}1f`,
                  }}
                >
                  {qualityLabel(currentMetric.quality)}
                </span>
                <span className="shrink-0 font-mono text-[11px] md:text-sm">
                  {selected}. {currentMove?.san}
                </span>
                <span className="truncate text-[10px] text-forge-faint md:text-xs">
                  {currentMetric.accuracy.toFixed(0)}% accurate ·{' '}
                  {formatEval(currentMetric.line.cp, currentMetric.line.mate)}
                </span>
              </div>
            ) : (
              <p className="mt-1.5 truncate text-[10px] text-forge-faint md:mt-3 md:text-xs">
                {analysisReady ? 'Select a move to see its grade.' : 'Run the engine to grade every move.'}
              </p>
            )}
          </div>

          <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-forge-line-soft px-2.5 py-1.5">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-forge-muted">Moves</span>
              {error ? (
                <span className="min-w-0 flex-1 truncate text-right text-[10px] text-forge-danger">{error}</span>
              ) : null}
              <button
                type="button"
                onClick={() => void copyPgn()}
                aria-label="Copy the game as PGN"
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors hover:bg-white/5 ${
                  pgnState === 'failed'
                    ? 'text-forge-danger'
                    : pgnState === 'copied'
                      ? 'text-forge-success'
                      : 'text-forge-faint hover:text-forge-text'
                }`}
              >
                {pgnState === 'copied' ? 'PGN copied' : pgnState === 'failed' ? 'Copy failed' : 'Copy PGN'}
              </button>
            </div>
            {running ? (
              <div className="h-0.5 shrink-0 bg-forge-line" aria-hidden>
                <div
                  className="h-full bg-forge-accent transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <table className="w-full border-collapse font-mono text-[12px] md:text-[13px]">
                <tbody>
                  {snapshot.moves.map((move, index) => {
                    const metric = metrics[index];
                    const isWhite = index % 2 === 0;
                    const selectedRow = selected === index + 1;
                    return (
                      <tr
                        key={move.ply}
                        ref={(node) => {
                          rowsRef.current[index + 1] = node;
                        }}
                        className={selectedRow ? 'bg-forge-accent/10' : 'odd:bg-white/[0.015]'}
                      >
                        {isWhite ? (
                          <td className="w-8 select-none py-0.5 pl-2 text-right text-forge-faint md:py-1 md:pl-2.5">
                            {index / 2 + 1}.
                          </td>
                        ) : (
                          <td className="w-8 md:w-9" />
                        )}
                        <td className="py-0.5 pr-2 md:py-1">
                          <button
                            type="button"
                            onClick={() => setSelected(index + 1)}
                            className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-white/5"
                          >
                            {metric ? (
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: qualityColor(metric.quality) }}
                                title={qualityLabel(metric.quality)}
                              />
                            ) : (
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-forge-line" />
                            )}
                            <span>{move.san}</span>
                            {metric ? (
                              <span className="ml-auto text-[10px] tabular-nums text-forge-faint md:text-[11px]">
                                {formatEval(metric.line.cp, metric.line.mate)}
                              </span>
                            ) : null}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
