import type { ReactNode } from 'react';

type Tone = 'win' | 'loss' | 'draw' | 'neutral';

interface ResultBannerProps {
  /** Final result, or null for an aborted game. */
  result: 'white' | 'black' | 'draw' | null;
  /** The colour the viewer played; null when spectating. */
  myColor: 'w' | 'b' | null;
  reason?: string | null;
  /** Rating change for the viewer, when the game was rated. */
  delta?: number | null;
  /** Opponent name, used for "The engine won" style wording. */
  opponentLabel?: string;
  children?: ReactNode;
  className?: string;
}

const TONE: Record<Tone, { surface: string; badge: string; title: string; mark: string }> = {
  win: {
    surface: 'border-forge-success/35 bg-forge-success/[0.08]',
    badge: 'bg-forge-success/15 text-forge-success',
    title: 'text-forge-success',
    mark: '✓',
  },
  loss: {
    surface: 'border-forge-danger/35 bg-forge-danger/[0.08]',
    badge: 'bg-forge-danger/15 text-[#e79a94]',
    title: 'text-[#e79a94]',
    mark: '✕',
  },
  draw: {
    surface: 'border-forge-line bg-forge-panel-2',
    badge: 'bg-white/[0.06] text-forge-muted',
    title: 'text-forge-text',
    mark: '½',
  },
  neutral: {
    surface: 'border-forge-line bg-forge-panel-2',
    badge: 'bg-white/[0.06] text-forge-muted',
    title: 'text-forge-text',
    mark: '·',
  },
};

/** `fifty-moves` / `CHECKMATE` -> `fifty moves` / `checkmate`. */
function humanise(reason?: string | null): string | null {
  if (!reason) return null;
  const text = reason.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return text.length > 0 ? text : null;
}

export function ResultBanner({
  result,
  myColor,
  reason,
  delta = null,
  opponentLabel,
  children,
  className = '',
}: ResultBannerProps) {
  let tone: Tone = 'neutral';
  let title = 'Game over';

  if (result === 'draw') {
    tone = 'draw';
    title = 'Draw';
  } else if (result === 'white' || result === 'black') {
    const winner = result === 'white' ? 'w' : 'b';
    if (myColor === null) {
      tone = 'draw';
      title = `${result === 'white' ? 'White' : 'Black'} won`;
    } else if (myColor === winner) {
      tone = 'win';
      title = 'You won';
    } else {
      tone = 'loss';
      title = opponentLabel ? `${opponentLabel} won` : 'You lost';
    }
  }

  const styles = TONE[tone];
  const detail = humanise(reason);
  const showDelta = typeof delta === 'number' && delta !== 0;

  return (
    <div className={`panel border p-4 ${styles.surface} ${className}`} role="status">
      <div className="flex items-start gap-3">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg font-semibold ${styles.badge}`}
          aria-hidden
        >
          {styles.mark}
        </span>
        <div className="min-w-0">
          <h2 className={`font-display text-2xl leading-tight ${styles.title}`}>{title}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-forge-muted">
            <span>{detail ? `by ${detail}` : 'No result recorded'}</span>
            {showDelta ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                  delta > 0
                    ? 'bg-forge-success/15 text-forge-success'
                    : 'bg-forge-danger/15 text-[#e79a94]'
                }`}
              >
                {delta > 0 ? `+${delta}` : delta}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {children ? <div className="mt-3 flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}
