/**
 * Glicko-2 (Mark Glickman, 2013 paper) in its rating-period form.
 *
 * ChessForge applies one rating period per game (the standard "online chess"
 * simplification): each player has exactly one result per update, and the
 * opponent's pre-game rating and RD are used.
 *
 * The implementation follows the paper's worked example, which the unit tests
 * assert against.
 */
export interface GlickoRating {
  rating: number;
  rd: number;
  volatility: number;
}

export interface GlickoConfig {
  /** System constant: constrains volatility change over time. */
  tau: number;
  /** Fixed scale factor from the paper. */
  scale: number;
  initialRating: number;
  initialRd: number;
  initialVolatility: number;
  /** Ratings never become more precise than this. */
  minRd: number;
}

export const DEFAULT_GLICKO_CONFIG: GlickoConfig = {
  tau: 0.5,
  scale: 173.7178,
  initialRating: 1500,
  initialRd: 350,
  initialVolatility: 0.06,
  minRd: 30,
};

/** A rating is provisional while its RD is above this threshold. */
export const PROVISIONAL_RD = 110;

export function isProvisional(rd: number): boolean {
  return rd > PROVISIONAL_RD;
}

export function initialRating(config: GlickoConfig = DEFAULT_GLICKO_CONFIG): GlickoRating {
  return {
    rating: config.initialRating,
    rd: config.initialRd,
    volatility: config.initialVolatility,
  };
}

export interface GlickoResult {
  /** Opponent's rating before the game. */
  rating: number;
  /** Opponent's rating deviation before the game. */
  rd: number;
  /** 1 win, 0.5 draw, 0 loss. */
  score: number;
}

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

const expectedScore = (mu: number, muJ: number, phiJ: number): number =>
  1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** Applies a rating period with zero or more results. */
export function updateGlicko2(
  player: GlickoRating,
  results: GlickoResult[],
  config: GlickoConfig = DEFAULT_GLICKO_CONFIG,
): GlickoRating {
  const { tau, scale, minRd } = config;
  const mu = (player.rating - 1500) / scale;
  const phi = player.rd / scale;
  const sigma = player.volatility;

  if (results.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return {
      rating: player.rating,
      rd: Math.min(Math.max(phiStar * scale, minRd), 350),
      volatility: sigma,
    };
  }

  let vInv = 0;
  let deltaSum = 0;
  for (const result of results) {
    const muJ = (result.rating - 1500) / scale;
    const phiJ = result.rd / scale;
    const gPhi = g(phiJ);
    const e = expectedScore(mu, muJ, phiJ);
    vInv += gPhi * gPhi * e * (1 - e);
    deltaSum += gPhi * (result.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Solve for the new volatility with the Illinois algorithm (step 5).
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const denom = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * denom * denom) - (x - a) / (tau * tau);
  };

  const epsilon = 1e-6;
  let A: number;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0 && k < 100) k += 1;
    B = a - k * tau;
  }
  A = a;
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > epsilon) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const newSigma = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  return {
    rating: newMu * scale + 1500,
    rd: Math.min(Math.max(newPhi * scale, minRd), 350),
    volatility: newSigma,
  };
}

/** Converts a game result to a Glicko score from one player's perspective. */
export function scoreFor(result: 'win' | 'draw' | 'loss'): number {
  return result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
}

/** Rounds ratings for display and storage consistency. */
export function roundRating(value: number): number {
  return Math.round(value * 100) / 100;
}

export function ratingDelta(before: number, after: number): number {
  return Math.round(after - before);
}
