import { TimeCategory as DbTimeCategory, type Rating } from '@prisma/client';
import type { TimeCategory } from '@shared/timeControl.js';
import { prisma } from '../db.js';
import { initialRating, isProvisional, roundRating } from './glicko2.js';

export const DB_CATEGORY: Record<TimeCategory, DbTimeCategory> = {
  bullet: DbTimeCategory.BULLET,
  blitz: DbTimeCategory.BLITZ,
  rapid: DbTimeCategory.RAPID,
  classical: DbTimeCategory.CLASSICAL,
};

export const CATEGORY_FROM_DB: Record<DbTimeCategory, TimeCategory> = {
  [DbTimeCategory.BULLET]: 'bullet',
  [DbTimeCategory.BLITZ]: 'blitz',
  [DbTimeCategory.RAPID]: 'rapid',
  [DbTimeCategory.CLASSICAL]: 'classical',
};

export function defaultRating(userId: string, category: DbTimeCategory): Rating {
  const base = initialRating();
  return {
    userId,
    category,
    rating: base.rating,
    rd: base.rd,
    volatility: base.volatility,
    games: 0,
    updatedAt: new Date(),
  };
}

/** Loads a player's rating for a category, creating the default if needed. */
export async function loadRating(userId: string, category: DbTimeCategory): Promise<Rating> {
  const existing = await prisma.rating.findUnique({
    where: { userId_category: { userId, category } },
  });
  if (existing) return existing;
  try {
    return await prisma.rating.create({
      data: {
        userId,
        category,
        rating: initialRating().rating,
        rd: initialRating().rd,
        volatility: initialRating().volatility,
      },
    });
  } catch {
    // Raced with another insert: read it back.
    const row = await prisma.rating.findUnique({
      where: { userId_category: { userId, category } },
    });
    return row ?? defaultRating(userId, category);
  }
}

export function ratingSummary(row: Rating) {
  return {
    rating: Math.round(row.rating),
    rd: Math.round(row.rd),
    games: row.games,
    provisional: isProvisional(row.rd),
  };
}

export { roundRating };
