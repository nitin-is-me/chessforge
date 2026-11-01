/**
 * Lichess' published win-probability and accuracy formulas.
 *
 * Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 * Accuracy% = 103.1668 * exp(-0.04354 * (winBefore - winAfter)) - 3.1669
 *
 * Centipawn scores are clamped to +/-1000 to keep decisive positions from
 * dominating the accuracy score, matching how the formulas are used in practice.
 */
export const CP_CLAMP = 1000;

export function clampCp(cp: number): number {
  if (!Number.isFinite(cp)) return 0;
  return Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp));
}

/** Converts a centipawn evaluation (white's perspective) into white's win chance. */
export function winPercent(cp: number): number {
  const clamped = clampCp(cp);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** Mate scores become 100% / 0% depending on who is mating. */
export function winPercentFromEval(cp: number | null, mate: number | null, side: 'w' | 'b'): number {
  if (mate !== null && mate !== undefined) {
    const whiteMates = mate > 0;
    if (side === 'w') return whiteMates ? 100 : 0;
    return whiteMates ? 0 : 100;
  }
  const whiteWin = winPercent(cp ?? 0);
  return side === 'w' ? whiteWin : 100 - whiteWin;
}

/** Accuracy for one move, from the mover's perspective. */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const drop = Math.max(0, winBefore - winAfter);
  const accuracy = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, accuracy));
}

export type MoveQuality = 'brilliant' | 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export function classifyDrop(winDrop: number): MoveQuality {
  if (winDrop >= 30) return 'blunder';
  if (winDrop >= 20) return 'mistake';
  if (winDrop >= 10) return 'inaccuracy';
  if (winDrop >= 3) return 'good';
  return 'best';
}

export function qualityLabel(quality: MoveQuality): string {
  switch (quality) {
    case 'brilliant':
      return 'Brilliant';
    case 'best':
      return 'Best';
    case 'good':
      return 'Good';
    case 'inaccuracy':
      return 'Inaccuracy';
    case 'mistake':
      return 'Mistake';
    case 'blunder':
      return 'Blunder';
  }
}

export function qualityColor(quality: MoveQuality): string {
  switch (quality) {
    case 'brilliant':
      return '#7fd1c1';
    case 'best':
      return '#6fae8b';
    case 'good':
      return '#9aa5b1';
    case 'inaccuracy':
      return '#e3c05a';
    case 'mistake':
      return '#e39a55';
    case 'blunder':
      return '#d4635b';
  }
}

/** Harmonic-style mean used by lichess for per-player accuracy. */
export function overallAccuracy(moveAccuracies: number[]): number {
  if (moveAccuracies.length === 0) return 0;
  const mean = moveAccuracies.reduce((sum, value) => sum + value, 0) / moveAccuracies.length;
  const harmonic =
    moveAccuracies.length / moveAccuracies.reduce((sum, value) => sum + 1 / Math.max(1, value), 0);
  const weighted = (mean + harmonic) / 2;
  return Math.round(weighted * 10) / 10;
}

export function formatEval(cp: number | null, mate: number | null): string {
  if (mate !== null && mate !== undefined) return `M${Math.abs(mate)}`;
  if (cp === null || cp === undefined) return '—';
  const pawns = cp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}
