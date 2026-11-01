/**
 * Server-authoritative clock arithmetic with quota-based lag compensation.
 *
 * A crude "subtract the round-trip time" scheme is exploitable: a player can
 * inflate their round trip and get free thinking time. ChessForge instead
 * grants each side a fixed lag quota. Compensation per move is capped, and the
 * quota refills slowly, so a cheater gains at most a few seconds per game.
 *
 * All functions are pure: they take `elapsedMs` rather than reading a clock,
 * which keeps them deterministic and unit-testable.
 */
import type { TimeCategory } from '@shared/timeControl.js';

export interface LagPolicy {
  /** Maximum compensation granted for a single move. */
  perMoveCapMs: number;
  /** Total compensation available across a game. */
  quotaMaxMs: number;
  /** Quota regained after each completed move. */
  regainPerMoveMs: number;
  /** How long an opponent may be absent before an abandonment claim works. */
  absenceClaimSec: number;
}

export const LAG_POLICY: Record<TimeCategory, LagPolicy> = {
  bullet: { perMoveCapMs: 200, quotaMaxMs: 800, regainPerMoveMs: 50, absenceClaimSec: 20 },
  blitz: { perMoveCapMs: 400, quotaMaxMs: 1500, regainPerMoveMs: 100, absenceClaimSec: 30 },
  rapid: { perMoveCapMs: 1000, quotaMaxMs: 4000, regainPerMoveMs: 200, absenceClaimSec: 60 },
  classical: { perMoveCapMs: 1000, quotaMaxMs: 4000, regainPerMoveMs: 200, absenceClaimSec: 60 },
};

/** Every completed move costs at least this much clock time (anti-free-move). */
export const MIN_CHARGED_MS = 10;

/** Extra grace before flagging so an in-flight move can still land. */
export const FLAG_GRACE_MS = 120;

/**
 * Grace applied to the side to move when a game resumes after a server
 * restart. Downtime is never adjudicated as a loss.
 */
export const RESUME_GRACE_MS = 30_000;

export function compensationFor(quotaMs: number, policy: LagPolicy): number {
  return Math.max(0, Math.min(quotaMs, policy.perMoveCapMs));
}

export interface MoveChargeInput {
  /** Clock remaining before the move, in ms. */
  remainingMs: number;
  /** Lag quota left for this side. */
  quotaMs: number;
  /** Wall time between the opponent's move landing and this move being applied. */
  elapsedMs: number;
  /** Increment for this time control, in ms. */
  incrementMs: number;
  policy: LagPolicy;
}

export interface MoveCharge {
  chargedMs: number;
  compensationMs: number;
  remainingMs: number;
  quotaMs: number;
}

/** Settles one completed move: charges the clock, applies increment, refills quota. */
export function settleMove(input: MoveChargeInput): MoveCharge {
  const { policy, incrementMs } = input;
  const elapsedMs = Math.max(0, Math.round(input.elapsedMs));
  const compensationMs = Math.min(compensationFor(input.quotaMs, policy), elapsedMs);
  const usableMs = elapsedMs - compensationMs;

  // Filter out physically impossible move times (client clock skew, replays).
  const chargedMs = Math.max(MIN_CHARGED_MS, usableMs);

  const quotaAfterUse = Math.max(0, input.quotaMs - compensationMs);
  const quotaMs = Math.min(policy.quotaMaxMs, quotaAfterUse + policy.regainPerMoveMs);

  return {
    chargedMs,
    compensationMs,
    remainingMs: Math.max(0, input.remainingMs - chargedMs + incrementMs),
    quotaMs,
  };
}

/** Clock value shown to players: the running clock minus any compensation. */
export function displayedRemainingMs(
  remainingMs: number,
  quotaMs: number,
  elapsedMs: number,
  policy: LagPolicy,
): number {
  const compensation = compensationFor(quotaMs, policy);
  const charged = Math.max(0, elapsedMs - compensation);
  return Math.max(0, remainingMs - charged);
}

/**
 * True when the side to move has run out of time. Uses the same compensation
 * as `displayedRemainingMs`, so what a player sees is what is enforced.
 */
export function hasFlagged(
  remainingMs: number,
  quotaMs: number,
  elapsedMs: number,
  policy: LagPolicy,
): boolean {
  return displayedRemainingMs(remainingMs, quotaMs, elapsedMs, policy) <= 0;
}

/** Formats a millisecond clock as m:ss, or m:ss.d under ten seconds. */
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
