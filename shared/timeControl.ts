/**
 * Time-control maths shared by client and server.
 *
 * ChessForge classifies a time control by its estimated duration
 * (base + 40 * increment), which is the convention lichess uses.
 */
export type TimeCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

export interface TimeControl {
  baseSec: number;
  incSec: number;
}

/** Expected game length in seconds. */
export function estimatedDurationSec(tc: TimeControl): number {
  return tc.baseSec + 40 * tc.incSec;
}

/** Bullet <= 179s, Blitz <= 479s, Rapid <= 1499s, Classical above. */
export function classifyTimeControl(tc: TimeControl): TimeCategory {
  const duration = estimatedDurationSec(tc);
  if (duration <= 179) return 'bullet';
  if (duration <= 479) return 'blitz';
  if (duration <= 1499) return 'rapid';
  return 'classical';
}

export function categoryLabel(category: TimeCategory): string {
  switch (category) {
    case 'bullet':
      return 'Bullet';
    case 'blitz':
      return 'Blitz';
    case 'rapid':
      return 'Rapid';
    case 'classical':
      return 'Classical';
  }
}

export function formatTimeControl(tc: TimeControl): string {
  return `${Math.round(tc.baseSec / 60)}+${tc.incSec}`;
}

export interface Preset extends TimeControl {
  id: string;
  label: string;
  category: TimeCategory;
}

const preset = (baseSec: number, incSec: number): Preset => ({
  id: formatTimeControl({ baseSec, incSec }),
  label: formatTimeControl({ baseSec, incSec }),
  baseSec,
  incSec,
  category: classifyTimeControl({ baseSec, incSec }),
});

/** Curated presets for the lobby. */
export const PRESETS: Preset[] = [
  preset(60, 0),
  preset(120, 1),
  preset(180, 0),
  preset(180, 2),
  preset(300, 0),
  preset(300, 3),
  preset(600, 0),
  preset(600, 5),
  preset(900, 10),
  preset(1800, 0),
];

export const CLASSICAL_NOTE = 'Classical games are casual only.';

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Validation limits for user supplied time controls. */
export const TIME_LIMITS = {
  minBaseSec: 30,
  maxBaseSec: 10800,
  maxIncSec: 180,
};

export function isValidTimeControl(tc: TimeControl): boolean {
  return (
    Number.isInteger(tc.baseSec) &&
    Number.isInteger(tc.incSec) &&
    tc.baseSec >= TIME_LIMITS.minBaseSec &&
    tc.baseSec <= TIME_LIMITS.maxBaseSec &&
    tc.incSec >= 0 &&
    tc.incSec <= TIME_LIMITS.maxIncSec
  );
}

export function isRatedAllowed(tc: TimeControl): boolean {
  return classifyTimeControl(tc) !== 'classical';
}
