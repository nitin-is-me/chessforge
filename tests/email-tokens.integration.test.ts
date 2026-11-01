/**
 * The parts of the email flows that are easy to get wrong: tokens must be
 * single-use, must expire, and issuing a new one must retire the old one.
 *
 * Gated like the other database tests:
 *   RUN_DB_TESTS=1 npx vitest run tests/email-tokens.integration.test.ts
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmailTokenKind } from '@prisma/client';
import { consumeEmailToken, issueEmailToken } from '../server/src/auth/email-tokens.js';
import { prisma } from '../server/src/db.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const suite = RUN ? describe : describe.skip;
const TIMEOUT = 120_000;

suite('email tokens (database)', () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  let userId = '';

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `itt-${suffix}`,
        usernameLower: `itt-${suffix}`,
        displayName: 'IT Token',
        passwordHash: 'x',
      },
    });
    userId = user.id;
  }, TIMEOUT);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }, TIMEOUT);

  it(
    'accepts a token once and refuses the second use',
    async () => {
      const token = await issueEmailToken(userId, EmailTokenKind.VERIFY);
      expect(await consumeEmailToken(token, EmailTokenKind.VERIFY)).toBe(userId);
      expect(await consumeEmailToken(token, EmailTokenKind.VERIFY)).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'retires an older token when a new one is issued',
    async () => {
      const first = await issueEmailToken(userId, EmailTokenKind.RESET);
      const second = await issueEmailToken(userId, EmailTokenKind.RESET);
      expect(await consumeEmailToken(first, EmailTokenKind.RESET)).toBeNull();
      expect(await consumeEmailToken(second, EmailTokenKind.RESET)).toBe(userId);
    },
    TIMEOUT,
  );

  it(
    'rejects an expired token',
    async () => {
      const token = 'expired-test-token-value';
      await prisma.emailToken.create({
        data: {
          userId,
          kind: EmailTokenKind.RESET,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() - 1_000),
        },
      });
      expect(await consumeEmailToken(token, EmailTokenKind.RESET)).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'does not accept a verification token for a password reset',
    async () => {
      const token = await issueEmailToken(userId, EmailTokenKind.VERIFY);
      expect(await consumeEmailToken(token, EmailTokenKind.RESET)).toBeNull();
    },
    TIMEOUT,
  );
});
