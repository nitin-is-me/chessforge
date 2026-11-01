import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GLICKO_CONFIG,
  initialRating,
  isProvisional,
  updateGlicko2,
} from '../server/src/rating/glicko2.js';

// Reference values from Mark Glickman's "Example calculation" (glicko2.pdf).
describe('Glicko-2', () => {
  it('matches the single-opponent worked example', () => {
    const updated = updateGlicko2(
      { rating: 1500, rd: 200, volatility: 0.06 },
      [{ rating: 1400, rd: 30, score: 1 }],
      DEFAULT_GLICKO_CONFIG,
    );

    expect(updated.rating).toBeCloseTo(1563.564, 2);
    expect(updated.rd).toBeCloseTo(175.403, 2);
    expect(updated.volatility).toBeCloseTo(0.06, 5);
  });

  it('matches the three-opponent worked example', () => {
    const updated = updateGlicko2(
      { rating: 1500, rd: 200, volatility: 0.06 },
      [
        { rating: 1400, rd: 30, score: 1 },
        { rating: 1550, rd: 100, score: 0 },
        { rating: 1700, rd: 300, score: 0 },
      ],
      DEFAULT_GLICKO_CONFIG,
    );

    expect(updated.rating).toBeCloseTo(1464.06, 1);
    expect(updated.rd).toBeCloseTo(151.52, 1);
    expect(updated.volatility).toBeCloseTo(0.05999, 4);
  });

  it('raises RD when a player is inactive for a period', () => {
    const updated = updateGlicko2({ rating: 1500, rd: 80, volatility: 0.06 }, []);
    expect(updated.rating).toBe(1500);
    expect(updated.rd).toBeGreaterThan(80);
  });

  it('moves a winner up and a loser down', () => {
    const winner = updateGlicko2({ rating: 1500, rd: 80, volatility: 0.06 }, [
      { rating: 1500, rd: 80, score: 1 },
    ]);
    const loser = updateGlicko2({ rating: 1500, rd: 80, volatility: 0.06 }, [
      { rating: 1500, rd: 80, score: 0 },
    ]);
    expect(winner.rating).toBeGreaterThan(1500);
    expect(loser.rating).toBeLessThan(1500);
    expect(winner.rd).toBeLessThan(80);
    expect(loser.rd).toBeLessThan(80);
  });

  it('never lets a rating be lost to a draw between equals', () => {
    const updated = updateGlicko2({ rating: 1500, rd: 100, volatility: 0.06 }, [
      { rating: 1500, rd: 100, score: 0.5 },
    ]);
    expect(updated.rating).toBeCloseTo(1500, 6);
    expect(updated.rd).toBeLessThan(100);
  });

  it('keeps RD bounded', () => {
    let rating = initialRating();
    for (let i = 0; i < 60; i++) {
      rating = updateGlicko2(rating, [{ rating: 1500, rd: 40, score: 1 }]);
    }
    expect(rating.rating).toBeLessThan(2900);
    expect(rating.rd).toBeGreaterThanOrEqual(DEFAULT_GLICKO_CONFIG.minRd);
    expect(rating.rd).toBeLessThanOrEqual(350);
  });

  it('treats RD > 110 as provisional', () => {
    expect(isProvisional(350)).toBe(true);
    expect(isProvisional(110)).toBe(false);
    expect(isProvisional(90)).toBe(false);
  });
});
