import { randomInt } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Rating } from '@prisma/client';
import { prisma } from '../db.js';
import type { TimeCategory } from '@shared/timeControl.js';
import type { RatingSummary, UserProfile } from '@shared/protocol.js';
import { randomToken, sha256 } from './passwords.js';

export const SESSION_COOKIE = 'cf_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_RENEW_MS = 15 * 24 * 60 * 60 * 1000;

const DB_CATEGORY: Record<string, TimeCategory> = {
  BULLET: 'bullet',
  BLITZ: 'blitz',
  RAPID: 'rapid',
  CLASSICAL: 'classical',
};

export function ratingsPayload(rows: Rating[]): Partial<Record<TimeCategory, RatingSummary>> {
  const out: Partial<Record<TimeCategory, RatingSummary>> = {};
  for (const row of rows) {
    const key = DB_CATEGORY[row.category];
    if (!key) continue;
    out[key] = {
      rating: Math.round(row.rating),
      rd: Math.round(row.rd),
      games: row.games,
      provisional: row.rd > 110,
    };
  }
  return out;
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  isGuest: boolean;
  ratings: Partial<Record<TimeCategory, RatingSummary>>;
}

export function toProfile(user: SessionUser & { createdAt?: Date; ratings: Partial<Record<TimeCategory, RatingSummary>> }): UserProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isGuest: user.isGuest,
    createdAt: (user.createdAt ?? new Date()).toISOString(),
    ratings: user.ratings,
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export interface SessionCookieOptions {
  maxAgeMs: number;
  secure: boolean;
}

export function serializeSessionCookie(token: string, options: SessionCookieOptions): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(options.maxAgeMs / 1000)}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  return serializeSessionCookie('', { maxAgeMs: 0, secure });
}

export async function createSession(
  userId: string,
  userAgent: string | undefined,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      id: sha256(token),
      userId,
      expiresAt,
      userAgent: userAgent?.slice(0, 200) ?? null,
    },
  });
  return { token, expiresAt };
}

interface CachedSession {
  user: SessionUser;
  expiresAt: number;
  cachedAt: number;
}

const sessionCache = new Map<string, CachedSession>();
const SESSION_CACHE_TTL_MS = 30_000;

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  sessionCache.delete(token);
  await prisma.session.deleteMany({ where: { id: sha256(token) } });
}

export async function destroyAllSessions(userId: string, exceptToken?: string): Promise<void> {
  for (const [key, entry] of sessionCache.entries()) {
    if (entry.user.id === userId && key !== exceptToken) {
      sessionCache.delete(key);
    }
  }
  await prisma.session.deleteMany({
    where: { userId, ...(exceptToken ? { id: { not: sha256(exceptToken) } } : {}) },
  });
}

/** Resolves a session token to a user, sliding the expiry forward when needed. */
export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const now = Date.now();
  const cached = sessionCache.get(token);
  if (cached && now - cached.cachedAt < SESSION_CACHE_TTL_MS && cached.expiresAt > now) {
    return cached.user;
  }

  const sessionId = sha256(token);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { include: { ratings: true } } },
  });
  if (!session) {
    sessionCache.delete(token);
    return null;
  }

  if (session.expiresAt.getTime() <= now) {
    sessionCache.delete(token);
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
    return null;
  }

  if (session.expiresAt.getTime() - now < SESSION_TTL_MS - SESSION_RENEW_MS) {
    const expiresAt = new Date(now + SESSION_TTL_MS);
    await prisma.session
      .update({ where: { id: sessionId }, data: { expiresAt } })
      .catch(() => undefined);
  }

  if (session.user.deletedAt) {
    sessionCache.delete(token);
    return null;
  }

  const user: SessionUser = {
    id: session.user.id,
    username: session.user.username,
    displayName: session.user.displayName,
    isGuest: session.user.isGuest,
    ratings: ratingsPayload(session.user.ratings),
  };

  sessionCache.set(token, {
    user,
    expiresAt: session.expiresAt.getTime(),
    cachedAt: now,
  });

  return user;
}

const GUEST_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function guestName(): string {
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += GUEST_ALPHABET[randomInt(GUEST_ALPHABET.length)];
  }
  return `Guest-${suffix}`;
}

/** Creates a throwaway account so a first-time visitor can play immediately. */
export async function createGuest(): Promise<SessionUser> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const username = guestName();
    try {
      const user = await prisma.user.create({
        data: {
          username,
          usernameLower: username.toLowerCase(),
          displayName: username,
          isGuest: true,
        },
      });
      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        isGuest: true,
        ratings: {},
      };
    } catch {
      // Username collision: try again with a different suffix.
    }
  }
  throw new Error('Could not allocate a guest name');
}

export function readSessionToken(req: Request | { headers: Record<string, unknown> }): string | undefined {
  const cookies = parseCookies(req.headers.cookie as string | undefined);
  return cookies[SESSION_COOKIE];
}

export function setSessionCookie(res: Response, token: string, isProduction: boolean): void {
  res.setHeader(
    'Set-Cookie',
    serializeSessionCookie(token, { maxAgeMs: SESSION_TTL_MS, secure: isProduction }),
  );
}

export function clearSession(res: Response, isProduction: boolean): void {
  res.setHeader('Set-Cookie', clearSessionCookie(isProduction));
}
