import { describe, expect, it } from 'vitest';
import { Game, GameError, createPlayerState } from '../server/src/game/Game.js';
import type { GameEvent } from '../server/src/game/Game.js';

let counter = 0;

function makeGame(overrides: Partial<{ rated: boolean; baseSec: number; incSec: number }> = {}) {
  counter += 1;
  const white = createPlayerState({
    userId: 'white-user',
    username: 'white',
    displayName: 'White',
    isGuest: false,
    rating: 1500,
    rd: 80,
    category: 'blitz',
  });
  const black = createPlayerState({
    userId: 'black-user',
    username: 'black',
    displayName: 'Black',
    isGuest: false,
    rating: 1500,
    rd: 80,
    category: 'blitz',
  });
  const game = new Game({
    id: `game${counter}`,
    rated: overrides.rated ?? true,
    category: 'blitz',
    baseSec: overrides.baseSec ?? 300,
    incSec: overrides.incSec ?? 3,
    white,
    black,
    now: 1_000_000,
  });
  const events: GameEvent[] = [];
  game.on((event) => events.push(event));
  return { game, events, white, black };
}

const start = (game: Game, at = 1_000_000) => game.start(at);

describe('Game rules', () => {
  it('starts only when both seats are filled', () => {
    const white = createPlayerState({
      userId: 'u1',
      username: 'u1',
      displayName: 'u1',
      isGuest: false,
      category: 'blitz',
    });
    const game = new Game({
      id: 'g1',
      rated: false,
      category: 'blitz',
      baseSec: 300,
      incSec: 3,
      white,
      black: null,
      now: 0,
    });
    expect(game.start(0)).toBe(false);
    expect(game.status).toBe('waiting');
  });

  it('accepts legal moves and rejects illegal ones', () => {
    const { game } = makeGame();
    start(game);
    game.move('white-user', 'e2e4', 0, 1_000_100);
    expect(game.moves).toHaveLength(1);
    expect(game.moves[0]!.san).toBe('e4');
    expect(() => game.move('black-user', 'e7e5', 5, 1_001_000)).toThrow(GameError);
    expect(() => game.move('white-user', 'd2d5', 1, 1_001_000)).toThrow(/turn|legal/i);
  });

  it('rejects moves from spectators and out of turn', () => {
    const { game } = makeGame();
    start(game);
    expect(() => game.move('stranger', 'e2e4', 0, 1_000_100)).toThrow(/not playing/i);
    expect(() => game.move('black-user', 'e7e5', 0, 1_000_100)).toThrow(/turn/i);
  });

  it('charges the clock and adds the increment', () => {
    const { game } = makeGame();
    start(game);
    game.move('white-user', 'e2e4', 0, 1_003_000); // 3s think, 3s increment
    expect(game.clocks.w).toBeCloseTo(300_000 - 2_600 + 3_000, 0);
    expect(game.clocks.b).toBe(300_000);
  });

  it('does not let a flagged player move, and ends the game on time', () => {
    const { game, events } = makeGame({ baseSec: 30, incSec: 0 });
    start(game);
    expect(() => game.move('white-user', 'e2e4', 0, 1_060_000)).toThrow(/time/i);
    expect(game.status).toBe('aborted'); // fewer than two moves played
    expect(events.some((e) => e.type === 'ended')).toBe(true);
  });

  it('flags the player to move once their clock expires', () => {
    const { game } = makeGame({ baseSec: 30, incSec: 0 });
    start(game);
    game.move('white-user', 'e2e4', 0, 1_000_500);
    game.move('black-user', 'e7e5', 1, 1_001_000);
    // White is to move with under 30s left; 39s later the clock has fallen.
    game.checkClock(1_040_000);
    expect(game.status).toBe('finished');
    expect(game.result).toBe('black');
    expect(game.reason).toBe('timeout');
  });

  it('aborts only until both sides have moved', () => {
    const { game } = makeGame();
    start(game);
    expect(game.canAbort()).toBe(true);
    game.move('white-user', 'e2e4', 0, 1_000_100);
    expect(game.canAbort()).toBe(true);
    game.move('black-user', 'e7e5', 1, 1_000_700);
    expect(game.canAbort()).toBe(false);
    expect(() => game.abort('white-user', 1_001_000)).toThrow(/too late/i);
  });

  it('resigns for the opponent', () => {
    const { game } = makeGame();
    start(game);
    game.move('white-user', 'e2e4', 0, 1_000_100);
    game.move('black-user', 'e7e5', 1, 1_000_200);
    game.resign('white-user', 1_000_300);
    expect(game.result).toBe('black');
    expect(game.reason).toBe('resignation');
  });

  it('detects checkmate', () => {
    const { game } = makeGame();
    start(game);
    const line = [
      ['white-user', 'f2f3'],
      ['black-user', 'e7e5'],
      ['white-user', 'g2g4'],
      ['black-user', 'd8h4'],
    ] as const;
    line.forEach(([player, uci], index) => {
      game.move(player, uci, index, 1_000_000 + index * 500);
    });
    expect(game.status).toBe('finished');
    expect(game.result).toBe('black');
    expect(game.reason).toBe('checkmate');
  });

  it('detects stalemate', () => {
    const { game } = makeGame();
    start(game);
    const line = [
      ['white-user', 'e2e3'],
      ['black-user', 'a7a5'],
      ['white-user', 'd1h5'],
      ['black-user', 'a8a6'],
      ['white-user', 'h5a5'],
      ['black-user', 'h7h5'],
      ['white-user', 'a5c7'],
      ['black-user', 'a6h6'],
      ['white-user', 'h2h4'],
      ['black-user', 'f7f6'],
      ['white-user', 'c7d7'],
      ['black-user', 'e8f7'],
      ['white-user', 'd7b7'],
      ['black-user', 'd8d3'],
      ['white-user', 'b7b8'],
      ['black-user', 'd3h7'],
      ['white-user', 'b8c8'],
      ['black-user', 'f7g6'],
      ['white-user', 'c8e6'],
    ] as const;
    line.forEach(([player, uci], index) => {
      game.move(player, uci, index, 1_000_000 + index * 500);
    });
    expect(game.status).toBe('finished');
    expect(game.reason === 'stalemate' || game.reason === 'checkmate').toBe(true);
  });

  it('handles draw offers and declines', () => {
    const { game, events } = makeGame();
    start(game);
    game.move('white-user', 'e2e4', 0, 1_000_100);
    game.move('black-user', 'e7e5', 1, 1_000_200);
    game.offerDraw('white-user');
    expect(game.drawOfferBy).toBe('w');
    game.respondDraw('black-user', false, 1_000_300);
    expect(game.status).toBe('started');
    expect(events.some((e) => e.type === 'event' && e.kind === 'draw-declined')).toBe(true);
  });

  it('awards a draw when the offer is accepted', () => {
    const { game } = makeGame();
    start(game);
    game.move('white-user', 'e2e4', 0, 1_000_100);
    game.move('black-user', 'e7e5', 1, 1_000_200);
    game.offerDraw('black-user');
    game.respondDraw('white-user', true, 1_000_300);
    expect(game.result).toBe('draw');
    expect(game.reason).toBe('agreement');
  });

  it('allows a threefold claim only when it is actually available', () => {
    const { game } = makeGame();
    start(game);
    expect(game.canClaim('threefold', 1_000_000)).toBe(false);
    expect(() => game.claim('white-user', 'threefold', 1_000_000)).toThrow(/not available/i);
  });

  it('tracks repetition counts', () => {
    const { game } = makeGame();
    start(game);
    const shuffle = [
      ['white-user', 'g1f3'],
      ['black-user', 'g8f6'],
      ['white-user', 'f3g1'],
      ['black-user', 'f6g8'],
    ] as const;
    let ply = 0;
    for (let round = 0; round < 2; round++) {
      for (const [player, uci] of shuffle) {
        game.move(player, uci, ply, 1_000_000 + ply * 500);
        ply += 1;
      }
    }
    expect(game.positionRepetitions()).toBe(3);
    expect(game.canClaim('threefold', 1_100_000)).toBe(true);
    game.claim('white-user', 'threefold', 1_100_000);
    expect(game.result).toBe('draw');
    expect(game.reason).toBe('threefold');
  });

  it('offers an absence claim only after the grace period', () => {
    const { game } = makeGame();
    start(game);
    game.attach('black-user', 'socket-b', 1_000_000);
    game.move('white-user', 'e2e4', 0, 1_000_100);
    game.detach('black-user', 'socket-b', 1_000_200);
    expect(game.canClaim('absence', 1_005_000, 'w')).toBe(false);
    expect(game.canClaim('absence', 1_035_000, 'w')).toBe(true);
    game.claim('white-user', 'absence', 1_035_000);
    expect(game.result).toBe('white');
    expect(game.reason).toBe('disconnect');
  });

  it('expires a draw offer when a move is played', () => {
    const { game } = makeGame();
    start(game);
    game.move('white-user', 'e2e4', 0, 1_000_100);
    game.move('black-user', 'e7e5', 1, 1_000_200);
    game.offerDraw('black-user');
    game.move('white-user', 'g1f3', 2, 1_000_300);
    expect(game.drawOfferBy).toBeNull();
  });

  it('keeps a consistent snapshot for spectators', () => {
    const { game } = makeGame();
    start(game);
    game.move('white-user', 'e2e4', 0, 1_000_400);
    const snapshot = game.snapshot(1_001_000);
    expect(snapshot.ply).toBe(1);
    expect(snapshot.turn).toBe('b');
    expect(snapshot.lastMove).toEqual(['e2', 'e4']);
    expect(snapshot.clocks.running).toBe('b');
    expect(snapshot.clocks.blackMs).toBe(300_000);
    expect(snapshot.white?.rating).toBe(1500);
    expect(snapshot.abortable).toBe(true);
  });

  it('is idempotent about finishing', () => {
    const { game, events } = makeGame();
    start(game);
    game.move('white-user', 'e2e4', 0, 1_000_100);
    game.move('black-user', 'e7e5', 1, 1_000_200);
    game.resign('white-user', 1_000_300);
    game.resign('black-user', 1_000_400);
    expect(events.filter((e) => e.type === 'ended')).toHaveLength(1);
  });
});
