/**
 * Single-use email tokens.
 *
 * Only the SHA-256 of a token is stored, so a database leak cannot be replayed
 * against the site. Tokens are consumed with a conditional update, which makes
 * two simultaneous clicks race safely: exactly one wins.
 */
import { EmailTokenKind } from '@prisma/client';
import { prisma } from '../db.js';
import { randomToken, sha256 } from './passwords.js';

/** Reset links are deliberately short-lived; verification is not time-critical. */
export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenKind, number> = {
  [EmailTokenKind.VERIFY]: 24 * 60 * 60_000,
  [EmailTokenKind.RESET]: 30 * 60_000,
};

/**
 * Issues a fresh token and invalidates any earlier unused one of the same kind,
 * so the newest email is always the only working one.
 */
export async function issueEmailToken(userId: string, kind: EmailTokenKind): Promise<string> {
  const token = randomToken();
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS[kind]);

  await prisma.$transaction([
    prisma.emailToken.deleteMany({ where: { userId, kind, usedAt: null } }),
    prisma.emailToken.create({ data: { userId, kind, tokenHash, expiresAt } }),
  ]);

  return token;
}

/** Returns the owning user id, or null when the token is invalid, spent or stale. */
export async function consumeEmailToken(token: string, kind: EmailTokenKind): Promise<string | null> {
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = await prisma.emailToken.findUnique({ where: { tokenHash } });
  if (!row || row.kind !== kind || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  // Conditional claim: the second concurrent click updates zero rows.
  const claimed = await prisma.emailToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1 ? row.userId : null;
}
