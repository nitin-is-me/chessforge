import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PlayerView } from '@shared/protocol';
import { formatClock } from '../lib/format';

interface PlayerBarProps {
  player: PlayerView | null;
  color: 'w' | 'b';
  active: boolean;
  remainingMs: number;
  turnStartedAt: number | null;
  compensationMs: number;
  offset: number;
  running: boolean;
  isMe?: boolean;
  thinking?: boolean;
  label?: string;
  /** Single-line bar for the game screen — keeps the board as large as possible. */
  compact?: boolean;
}

function useTicker(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setTick((value) => value + 1), 100);
    return () => window.clearInterval(interval);
  }, [active]);
}

export function PlayerBar({
  player,
  color,
  active,
  remainingMs,
  turnStartedAt,
  compensationMs,
  offset,
  running,
  isMe,
  thinking,
  label,
  compact = false,
}: PlayerBarProps) {
  useTicker(active && running);

  let shown = remainingMs;
  // Only the side to move accrues elapsed time. Without the `active` check an
  // idle clock jumps backwards whenever the parent re-renders (chat, offers).
  if (active && running && turnStartedAt !== null) {
    const serverNow = Date.now() + offset;
    const elapsed = Math.max(0, serverNow - turnStartedAt);
    shown = Math.max(0, remainingMs - Math.max(0, elapsed - compensationMs));
  }

  const low = shown <= 20_000;
  const critical = shown <= 10_000;

  if (compact) {
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
          {player ? (
            <Link
              to={`/u/${player.username}`}
              className="truncate text-[13px] font-medium leading-tight text-forge-text hover:text-forge-accent-strong"
            >
              {player.displayName}
            </Link>
          ) : (
            <span className="truncate text-[13px] text-forge-muted">{label ?? 'Waiting for opponent'}</span>
          )}
          {isMe ? (
            <span className="chip chip-accent shrink-0 !px-1.5 !py-0 !text-[9px]">you</span>
          ) : null}
          {player?.rating ? (
            <span className="shrink-0 text-[10px] tabular-nums text-forge-faint">{player.rating}</span>
          ) : null}
          {player?.provisional ? (
            <span className="hidden shrink-0 text-[10px] text-forge-faint sm:inline">prov.</span>
          ) : null}
          {thinking ? (
            <span className="hidden shrink-0 items-center gap-1 text-[10px] text-forge-accent sm:flex">
              <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-forge-accent" />
              thinking
            </span>
          ) : null}
          {player && !player.online ? (
            <span className="shrink-0 text-[10px] text-forge-faint">offline</span>
          ) : null}
        </div>

        <div
          className={`clock shrink-0 rounded-md px-2 py-0.5 text-lg font-semibold leading-tight ${
            active ? 'bg-forge-bg/70' : 'bg-transparent'
          } ${active ? (low ? 'clock-low' : 'clock-active') : 'clock-idle'} ${
            critical && active ? 'animate-pulse' : ''
          }`}
          aria-live={active ? 'off' : 'polite'}
        >
          {formatClock(shown)}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        active
          ? 'border-forge-accent/30 bg-forge-panel-2'
          : 'border-forge-line-soft bg-forge-panel/60'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-2.5 flex-1">
        <span
          className={`grid h-7 w-7 sm:h-8 sm:w-8 shrink-0 place-items-center rounded-lg text-xs sm:text-sm font-semibold ${
            color === 'w'
              ? 'bg-[#e7e1d6] text-[#1a1a1a]'
              : 'bg-[#20242a] text-[#e7e1d6] ring-1 ring-inset ring-white/10'
          }`}
          aria-hidden
        >
          {color === 'w' ? '♔' : '♚'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {player ? (
              <Link
                to={`/u/${player.username}`}
                className="truncate text-xs sm:text-sm font-medium text-forge-text hover:text-forge-accent-strong"
              >
                {player.displayName}
              </Link>
            ) : (
              <span className="truncate text-xs sm:text-sm text-forge-muted">{label ?? 'Waiting for opponent'}</span>
            )}
            {isMe ? <span className="chip chip-accent shrink-0 !text-[10px] !py-0 !px-1.5">you</span> : null}
            {player?.provisional ? <span className="hidden sm:inline text-[11px] text-forge-faint shrink-0">provisional</span> : null}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-forge-muted truncate">
            {player?.rating ? <span className="tabular-nums">{player.rating}</span> : <span>Unrated</span>}
            {thinking ? (
              <span className="flex items-center gap-1 text-forge-accent shrink-0">
                <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-forge-accent" />
                thinking
              </span>
            ) : null}
            {player && !player.online ? <span className="text-forge-faint shrink-0">offline</span> : null}
          </div>
        </div>
      </div>

      <div
        className={`clock shrink-0 rounded-lg px-2.5 sm:px-3 py-1 sm:py-1.5 text-xl sm:text-2xl font-semibold tabular-nums ${
          active ? 'bg-forge-bg/70' : 'bg-transparent'
        } ${active ? (low ? 'clock-low' : 'clock-active') : 'clock-idle'} ${
          critical && active ? 'animate-pulse' : ''
        }`}
        aria-live={active ? 'off' : 'polite'}
      >
        {formatClock(shown)}
      </div>
    </div>
  );
}
