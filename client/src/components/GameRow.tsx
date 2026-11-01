import { Link } from 'react-router-dom';
import type { GameListItem } from '@shared/api';
import { categoryColor, timeAgo } from '../lib/format';

interface GameRowProps {
  game: GameListItem;
  showPlayer?: boolean;
}

const OUTCOME_STYLES: Record<string, string> = {
  win: 'text-forge-success border-forge-success/30 bg-forge-success/10',
  loss: 'text-forge-danger border-forge-danger/30 bg-forge-danger/10',
  draw: 'text-forge-muted border-forge-line bg-white/[0.03]',
};

export function GameRow({ game, showPlayer = false }: GameRowProps) {
  const opponent =
    game.playerColor === 'white' ? game.blackName : game.playerColor === 'black' ? game.whiteName : game.blackName;
  const rating = game.playerColor === 'white' ? game.whiteRating : game.blackRating;
  const ratingAfter = game.playerColor === 'white' ? game.whiteRatingAfter : game.blackRatingAfter;
  const delta = rating && ratingAfter ? Math.round(ratingAfter - rating) : null;

  return (
    <Link
      to={game.status === 'finished' ? `/analysis/${game.id}` : `/g/${game.id}`}
      className="group flex items-center gap-3 border-b border-forge-line-soft px-3 py-2.5 text-sm transition-colors last:border-0 hover:bg-white/[0.025]"
    >
      <span
        className="h-8 w-1 shrink-0 rounded-full"
        style={{ backgroundColor: categoryColor(game.category) }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-forge-text group-hover:text-forge-accent-strong">
            {showPlayer ? opponent ?? 'Unknown' : `${game.whiteName ?? '?'} vs ${game.blackName ?? '?'}`}
          </span>
          {game.rated ? <span className="chip !px-1.5 !py-0 !text-[9px]">rated</span> : null}
          {game.opponent === 'computer' ? (
            <span className="chip !px-1.5 !py-0 !text-[9px]">engine</span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-forge-muted">
          <span className="uppercase tracking-wide" style={{ color: categoryColor(game.category) }}>
            {game.category}
          </span>
          <span>·</span>
          <span>{game.plyCount} plies</span>
          <span>·</span>
          <span>{timeAgo(game.endedAt ?? game.createdAt)}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {game.outcome ? (
          <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${OUTCOME_STYLES[game.outcome]}`}>
            {game.outcome}
          </span>
        ) : (
          <span className="text-[11px] uppercase tracking-wide text-forge-faint">
            {game.status === 'aborted' ? 'aborted' : game.status}
          </span>
        )}
        {delta !== null && delta !== 0 ? (
          <span className={`text-[11px] tabular-nums ${delta > 0 ? 'text-forge-success' : 'text-forge-danger'}`}>
            {delta > 0 ? '+' : ''}
            {delta}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
