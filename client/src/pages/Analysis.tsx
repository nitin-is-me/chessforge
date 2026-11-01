import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import { Board } from '../components/Board';
import { api, ApiError } from '../lib/api';
import { engine, type EngineLine } from '../lib/engine';
import { usePreferences } from '../store/preferences';
import {
  classifyDrop,
  formatEval,
  moveAccuracy,
  overallAccuracy,
  qualityColor,
  qualityLabel,
  winPercentFromEval,
} from '../lib/analysis';
import type { GameSnapshot, MoveRecord } from '@shared/protocol';
import { categoryLabel, formatTimeControl } from '@shared/timeControl';
import { reasonText, resultHeadline } from '../lib/format';

interface Metrics {
  accuracy: number;
  winBefore: number;
  winAfter: number;
  quality: ReturnType<typeof classifyDrop>;
  line: EngineLine;
}

export default function AnalysisPage() {
  const { id = '' } = useParams();
  const theme = usePreferences((state) => state.boardTheme);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [lines, setLines] = useState<Record<number, EngineLine>>({});
  const [depth, setDepth] = useState(12);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    let alive = true;
    api
      .game(id)
      .then((data) => {
        if (alive) setSnapshot(data);
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

  if (error && !snapshot) {
    return (
      <div className="page py-24 text-center">
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
      <div className="page py-10">
        <div className="panel h-64 shimmer" />
      </div>
    );
  }

  const analysisReady = Object.keys(lines).length > 1;

  return (
    <div className="page py-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="mx-auto w-full max-w-[600px]">
          <div className="mb-2 flex items-center justify-between text-xs text-forge-muted">
            <span className="uppercase tracking-[0.12em]">
              Analysis · {formatTimeControl({ baseSec: snapshot.baseSec, incSec: snapshot.incSec })} ·{' '}
              {categoryLabel(snapshot.category)}
            </span>
            <span>{selected} / {snapshot.moves.length} plies</span>
          </div>

          <Board
            fen={currentFen}
            orientation="white"
            canMove={false}
            lastMove={currentMove ? [currentMove.uci.slice(0, 2), currentMove.uci.slice(2, 4)] : null}
            theme={theme}
            className="board-fit board-fit-game"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1.5">
              <button
                type="button"
                className="btn btn-secondary !px-3"
                onClick={() => setSelected((value) => Math.max(0, value - 1))}
                disabled={selected === 0}
                aria-label="Previous position"
              >
                ←
              </button>
              <button
                type="button"
                className="btn btn-secondary !px-3"
                onClick={() => setSelected((value) => Math.min(snapshot.moves.length, value + 1))}
                disabled={selected >= snapshot.moves.length}
                aria-label="Next position"
              >
                →
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setSelected(0)}>
                Start
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setSelected(snapshot.moves.length)}>
                End
              </button>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={depth}
                onChange={(event) => setDepth(Number(event.target.value))}
                className="field !w-auto !py-1.5 !text-xs"
                aria-label="Engine depth"
                disabled={running}
              >
                <option value={10}>Depth 10</option>
                <option value={12}>Depth 12</option>
                <option value={14}>Depth 14</option>
                <option value={16}>Depth 16</option>
              </select>
              {running ? (
                <button type="button" className="btn btn-secondary" onClick={cancel}>
                  Stop
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => void runAnalysis()}>
                  {analysisReady ? 'Re-analyse' : 'Analyse'}
                </button>
              )}
            </div>
          </div>

          {running ? (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-forge-line">
                <div className="h-full bg-forge-accent transition-[width] duration-200" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-forge-faint">
                Stockfish is running locally — {progress}% of positions
              </p>
            </div>
          ) : null}

          <div className="panel mt-3 p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-forge-muted">Evaluation</span>
              <span className="tabular-nums text-forge-text">
                {evalLine ? formatEval(evalLine.cp, evalLine.mate) : '—'}
                {evalLine ? <span className="ml-1 text-forge-faint">depth {evalLine.depth}</span> : null}
              </span>
            </div>
            <svg viewBox="0 0 300 80" className="h-20 w-full" preserveAspectRatio="none" role="img" aria-label="Evaluation graph">
              <rect x="0" y="0" width="300" height="80" fill="#0b0d10" rx="6" />
              <line x1="0" y1="40" x2="300" y2="40" stroke="#22272e" strokeWidth="1" />
              {evalSeries.length > 1 ? (
                <>
                  <polyline
                    points={evalSeries
                      .map((value, index) => {
                        const x = (index / Math.max(1, evalSeries.length - 1)) * 300;
                        const y = 80 - (value / 100) * 80;
                        return `${x.toFixed(1)},${y.toFixed(1)}`;
                      })
                      .join(' ')}
                    fill="none"
                    stroke="#e3a455"
                    strokeWidth="1.8"
                  />
                  <polygon
                    points={`0,80 ${evalSeries
                      .map((value, index) => {
                        const x = (index / Math.max(1, evalSeries.length - 1)) * 300;
                        const y = 80 - (value / 100) * 80;
                        return `${x.toFixed(1)},${y.toFixed(1)}`;
                      })
                      .join(' ')} 300,80`}
                    fill="rgba(227,164,85,0.12)"
                  />
                  <line
                    x1={(selected / Math.max(1, evalSeries.length - 1)) * 300}
                    y1="0"
                    x2={(selected / Math.max(1, evalSeries.length - 1)) * 300}
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

        <aside className="space-y-3">
          <div className="panel p-4">
            <h1 className="font-display text-xl">
              {snapshot.white?.displayName ?? 'White'} <span className="text-forge-faint">vs</span>{' '}
              {snapshot.black?.displayName ?? 'Black'}
            </h1>
            <p className="mt-1 text-sm text-forge-muted">
              {resultHeadline(snapshot, null)} {reasonText(snapshot.reason)}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {(['white', 'black'] as const).map((color) => {
                const value = color === 'white' ? accuracy.white : accuracy.black;
                const label = color === 'white' ? snapshot.white?.displayName ?? 'White' : snapshot.black?.displayName ?? 'Black';
                return (
                  <div key={color} className="rounded-lg border border-forge-line-soft bg-forge-bg/50 p-2.5 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-forge-faint">{label}</div>
                    <div className="stat-value mt-1">{analysisReady ? `${value.toFixed(1)}%` : '—'}</div>
                    <div className="text-[10px] text-forge-faint">accuracy</div>
                  </div>
                );
              })}
            </div>

            {currentMetric ? (
              <div className="mt-3 rounded-lg border border-forge-line-soft bg-forge-bg/50 p-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-forge-muted">Move {selected}</span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                    style={{ color: qualityColor(currentMetric.quality), backgroundColor: `${qualityColor(currentMetric.quality)}1f` }}
                  >
                    {qualityLabel(currentMetric.quality)}
                  </span>
                </div>
                <div className="mt-1 text-sm">
                  {currentMove?.san}{' '}
                  <span className="text-xs text-forge-muted">
                    · {currentMetric.accuracy.toFixed(0)}% accurate ·{' '}
                    {formatEval(currentMetric.line.cp, currentMetric.line.mate)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-forge-line-soft px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-forge-muted">Moves</span>
              {error ? <span className="text-[11px] text-forge-danger">{error}</span> : null}
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full border-collapse font-mono text-[13px]">
                <tbody>
                  {snapshot.moves.map((move, index) => {
                    const metric = metrics[index];
                    const isWhite = index % 2 === 0;
                    return (
                      <tr key={move.ply} className={selected === index + 1 ? 'bg-forge-accent/10' : 'odd:bg-white/[0.015]'}>
                        {isWhite ? (
                          <td className="w-9 select-none py-1 pl-2 text-right text-forge-faint">{index / 2 + 1}.</td>
                        ) : (
                          <td className="w-9" />
                        )}
                        <td className="py-1 pr-2" colSpan={1}>
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
                              <span className="ml-auto text-[11px] tabular-nums text-forge-faint">
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
