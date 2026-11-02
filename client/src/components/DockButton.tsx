import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface DockButtonProps {
  label: string;
  icon: ReactNode;
  badge?: string | number | null;
  danger?: boolean;
  /** Accent tint for the primary post-game action (e.g. accept rematch). */
  emphasis?: boolean;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
  /** Renders the same control as a link (e.g. New game, Analyse). */
  to?: string;
}

/** One control in the phone action dock, shared by the game and computer screens. */
export function DockButton({
  label,
  icon,
  badge,
  danger,
  emphasis,
  disabled,
  active,
  onClick,
  to,
}: DockButtonProps) {
  const classes = `relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 text-[10px] font-semibold leading-none transition-colors active:scale-[0.98] ${
    danger
      ? 'border-forge-danger/35 bg-forge-danger/10 text-[#e79a94]'
      : emphasis
        ? 'border-forge-accent/60 bg-forge-accent/20 text-forge-accent-strong'
        : active
          ? 'border-forge-accent/45 bg-forge-accent/15 text-forge-accent'
          : 'border-forge-line bg-forge-panel-2 text-forge-muted hover:text-forge-text'
  }`;
  const body = (
    <>
      {icon}
      <span className="max-w-full truncate">{label}</span>
      {badge ? (
        <span className="absolute -top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow">
          {badge}
        </span>
      ) : null}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`${classes} disabled:opacity-40`}>
      {body}
    </button>
  );
}
