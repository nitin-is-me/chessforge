import type { EndReason, GameSnapshot } from '@shared/protocol';
import type { TimeCategory } from '@shared/timeControl';

/** Mirrors the server's authoritative formatter (server/src/game/clock.ts). */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (clamped < 10_000) {
    const tenths = Math.floor((clamped % 1000) / 100);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function reasonText(reason: EndReason | null): string {
  switch (reason) {
    case 'checkmate':
      return 'by checkmate';
    case 'resignation':
      return 'by resignation';
    case 'timeout':
      return 'on time';
    case 'stalemate':
      return 'by stalemate';
    case 'insufficient':
      return 'by insufficient material';
    case 'fifty-moves':
      return 'by fifty-move rule';
    case 'threefold':
      return 'by threefold repetition';
    case 'fivefold':
      return 'by fivefold repetition';
    case 'seventy-five-moves':
      return 'by seventy-five-move rule';
    case 'agreement':
      return 'by agreement';
    case 'aborted':
      return 'aborted';
    case 'disconnect':
      return 'by abandonment';
    default:
      return '';
  }
}

export function resultHeadline(
  game: Pick<GameSnapshot, 'status' | 'result'>,
  myColor: 'w' | 'b' | null,
): string {
  if (game.status === 'aborted') return 'Game aborted';
  if (game.status !== 'finished' || !game.result) return 'Game over';
  if (game.result === 'draw') return 'Draw';
  if (!myColor) return game.result === 'white' ? 'White wins' : 'Black wins';
  const iWon = (game.result === 'white') === (myColor === 'w');
  return iWon ? 'You won' : 'You lost';
}

export function categoryColor(category: TimeCategory): string {
  switch (category) {
    case 'bullet':
      return '#d4635b';
    case 'blitz':
      return '#e3a455';
    case 'rapid':
      return '#6fae8b';
    case 'classical':
      return '#7f9fc7';
  }
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ratingDisplay(rating: number | null | undefined, provisional?: boolean): string {
  if (rating === null || rating === undefined) return 'Unrated';
  return provisional ? `${Math.round(rating)}?` : String(Math.round(rating));
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
