/**
 * Integration tests that exercise the parts only Postgres can prove: that a
 * game created with both players already seated actually starts, and that the
 * rating rows are committed before the final state is broadcast.
 *
 * These are gated because they need a real database:
 *   RUN_DB_TESTS=1 npx vitest run tests/manager.integration.test.ts
 *
 * Every row they create is deleted again in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { GameManager } from '../server/src/game/manager.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const suite = RUN ? describe : describe.skip;

suite('GameManager (database)', () => {
  const prisma = new PrismaClient();
  const manager = new GameManager();
  const suffix = Math.random().toString(36).slice(2, 8);
  const whiteName = `itw-${suffix}`;
  const blackName = `itb-${suffix}`;
  let whiteId = '';
  let blackId = '';

  // The pooled development database is a few hundred milliseconds away, and
  // the pooler (pgbouncer mode) costs several round trips per statement, so
  // these write-heavy tests need more than the default 15s budget.
  const DB_TEST_TIMEOUT = 120_000;

  beforeAll(async () => {
    const white = await prisma.user.create({
      data: { username: whiteName, usernameLower: whiteName, displayName: 'IT White', passwordHash: 'x' },
    });
    const black = await prisma.user.create({
      data: { username: blackName, usernameLower: blackName, displayName: 'IT Black', passwordHash: 'x' },
    });
    whiteId = white.id;
    blackId = black.id;
  }, DB_TEST_TIMEOUT);

  afterAll(async () => {
    await prisma.game.deleteMany({ where: { OR: [{ whiteId }, { blackId }] } });
    await prisma.user.deleteMany({ where: { id: { in: [whiteId, blackId] } } });
    await manager.dispose();
    await prisma.$disconnect();
  }, DB_TEST_TIMEOUT);

  const identity = (id: string, username: string) => ({
    id,
    username,
    displayName: username,
    isGuest: false,
  });

  it('starts a game that is created with both players seated', async () => {
    const game = await manager.create({
      white: identity(whiteId, whiteName),
      black: identity(blackId, blackName),
      rated: false,
      baseSec: 300,
      incSec: 0,
    });

    // Quick pairing, challenges and rematches all take this path.
    expect(game.status).toBe('started');
    const move = game.move(whiteId, 'e2e4', 0, Date.now());
    expect(move.san).toBe('e4');
    await manager.flush(game.id);
  }, DB_TEST_TIMEOUT);

  it('commits both ratings before the game reaches its final state', async () => {
    const before = await prisma.rating.findMany({
      where: { userId: { in: [whiteId, blackId] }, category: 'BLITZ' },
    });
    const beforeWhite = before.find((row) => row.userId === whiteId)?.rating ?? 1500;

    const game = await manager.create({
      white: identity(whiteId, whiteName),
      black: identity(blackId, blackName),
      rated: true,
      baseSec: 300,
      incSec: 0,
    });

    // Fool's mate: white loses in four plies.
    const now = Date.now();
    game.move(whiteId, 'f2f3', 0, now);
    game.move(blackId, 'e7e5', 1, now);
    game.move(whiteId, 'g2g4', 2, now);
    game.move(blackId, 'd8h4', 3, now);

    expect(game.status).toBe('finished');
    expect(game.reason).toBe('checkmate');

    await manager.flush(game.id);

    const row = await prisma.game.findUnique({ where: { id: game.id } });
    expect(row?.status).toBe('FINISHED');
    expect(row?.whiteRatingAfter).not.toBeNull();
    expect(row?.blackRatingAfter).not.toBeNull();

    // The in-memory snapshot the client receives carries the same numbers.
    expect(game.ratingsAfter.whiteAfter).toBe(row?.whiteRatingAfter);
    expect(game.ratingsAfter.whiteBefore).toBe(beforeWhite);
    expect(game.ratingsAfter.whiteAfter).not.toBe(beforeWhite);
    expect(game.ratingsAfter.blackAfter).not.toBeNull();
  }, DB_TEST_TIMEOUT);
});
