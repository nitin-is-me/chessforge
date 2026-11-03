import { describe, expect, it } from 'vitest';
import {
  compensationFor,
  displayedRemainingMs,
  FLAG_GRACE_MS,
  formatClock,
  hasFlagged,
  LAG_POLICY,
  MIN_CHARGED_MS,
  settleMove,
} from '../server/src/game/clock.js';

const blitz = LAG_POLICY.blitz;

describe('lag compensation', () => {
  it('caps compensation per move', () => {
    expect(compensationFor(1500, blitz)).toBe(400);
    expect(compensationFor(100, blitz)).toBe(100);
    expect(compensationFor(0, blitz)).toBe(0);
  });

  it('charges elapsed time minus compensation and adds increment', () => {
    const result = settleMove({
      remainingMs: 300_000,
      quotaMs: 1500,
      elapsedMs: 500,
      incrementMs: 3000,
      policy: blitz,
    });

    expect(result.compensationMs).toBe(400);
    expect(result.chargedMs).toBe(100);
    expect(result.remainingMs).toBe(300_000 - 100 + 3000);
    expect(result.quotaMs).toBe(1200);
  });

  it('only consumes the compensation actually used', () => {
    const result = settleMove({
      remainingMs: 300_000,
      quotaMs: 1500,
      elapsedMs: 100,
      incrementMs: 0,
      policy: blitz,
    });

    expect(result.compensationMs).toBe(100);
    expect(result.chargedMs).toBe(MIN_CHARGED_MS);
    expect(result.quotaMs).toBe(1500); // 1500 - 100 used, then +100 regained
  });

  it('refills the quota but never above the maximum', () => {
    const result = settleMove({
      remainingMs: 300_000,
      quotaMs: 0,
      elapsedMs: 2000,
      incrementMs: 0,
      policy: blitz,
    });

    expect(result.compensationMs).toBe(0);
    expect(result.chargedMs).toBe(2000);
    expect(result.quotaMs).toBe(100);
  });

  it('never lets the clock go negative', () => {
    const result = settleMove({
      remainingMs: 500,
      quotaMs: 0,
      elapsedMs: 9000,
      incrementMs: 0,
      policy: blitz,
    });
    expect(result.remainingMs).toBe(0);
  });

  it('bounds compensation per move even when every move is slow', () => {
    let remaining = 60_000;
    let quota = blitz.quotaMaxMs;
    let compensated = 0;
    for (let i = 0; i < 10; i++) {
      const charge = settleMove({
        remainingMs: remaining,
        quotaMs: quota,
        elapsedMs: 3000,
        incrementMs: 0,
        policy: blitz,
      });
      // No single move may ever hand out more than the per-move cap.
      expect(charge.compensationMs).toBeLessThanOrEqual(blitz.perMoveCapMs);
      remaining = charge.remainingMs;
      quota = charge.quotaMs;
      compensated += charge.compensationMs;
    }
    // 10 moves of wall time were charged, minus a bounded lag allowance.
    expect(remaining).toBeGreaterThan(30_000);
    expect(compensated).toBeLessThanOrEqual(10 * blitz.perMoveCapMs);
  });

  it('caps total compensation across a whole game', () => {
    const bullet = LAG_POLICY.bullet;
    let remaining = 600_000;
    let quota = bullet.quotaMaxMs;
    let compensated = 0;

    // 200 deliberate 5-second moves: the most a farmer could try to extract.
    for (let i = 0; i < 200; i++) {
      const charge = settleMove({
        remainingMs: remaining,
        quotaMs: quota,
        elapsedMs: 5000,
        incrementMs: 0,
        policy: bullet,
      });
      remaining = charge.remainingMs;
      quota = charge.quotaMs;
      compensated += charge.compensationMs;
    }

    expect(compensated).toBeLessThanOrEqual(bullet.quotaMaxMs + 200 * bullet.regainPerMoveMs);
  });
});

describe('sustained latency', () => {
  it('does not bleed clock for instant replies at 150ms RTT in bullet', () => {
    const bullet = LAG_POLICY.bullet;
    let remaining = 60_000;
    let quota = bullet.quotaMaxMs;

    // 40 instant replies: wall time is all network, so nothing should be billed.
    for (let i = 0; i < 40; i++) {
      const charge = settleMove({
        remainingMs: remaining,
        quotaMs: quota,
        elapsedMs: 150,
        incrementMs: 0,
        policy: bullet,
      });
      remaining = charge.remainingMs;
      quota = charge.quotaMs;
    }

    // Only the anti-free-move floor per move, never a round trip.
    expect(60_000 - remaining).toBe(40 * MIN_CHARGED_MS);
    expect(quota).toBeGreaterThan(0);
    expect(hasFlagged(remaining, quota, 150, bullet)).toBe(false);
  });
});

describe('flag detection', () => {
  it('flags only once the charged time exceeds the clock', () => {
    expect(hasFlagged(1000, 0, 999, blitz)).toBe(false);
    expect(hasFlagged(1000, 0, 1000, blitz)).toBe(true);
    expect(hasFlagged(1000, 0, 1200, blitz)).toBe(true);
  });

  it('respects the compensation window on the display clock', () => {
    expect(displayedRemainingMs(1000, 400, 300, blitz)).toBe(1000);
    expect(displayedRemainingMs(1000, 400, 600, blitz)).toBe(800);
    expect(hasFlagged(1000, 400, 1300, blitz)).toBe(false);
    expect(hasFlagged(1000, 400, 1400, blitz)).toBe(true);
  });

  it('keeps a positive flag grace', () => {
    expect(FLAG_GRACE_MS).toBeGreaterThan(0);
  });
});

describe('clock formatting', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(300_000)).toBe('5:00');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(-500)).toBe('0:00.0');
  });

  it('shows tenths under ten seconds', () => {
    expect(formatClock(9_400)).toBe('0:09.4');
    expect(formatClock(1_050)).toBe('0:01.0');
  });
});
