import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../client/src/styles.css', import.meta.url), 'utf8');

type Shade = 'light' | 'dark';

/** The board is painted from a single 2x2 tile, so the CSS rule is the source of truth. */
function tile(): { topLeft: Shade; topRight: Shade; bottomLeft: Shade; bottomRight: Shade } {
  const block = /\.board-shell cg-board\s*\{([\s\S]*?)\}/.exec(css)?.[1];
  expect(block, 'no .board-shell cg-board rule in client/src/styles.css').toBeTruthy();
  expect(block!).toContain('background-size: 25% 25%');
  expect(block!).not.toMatch(/conic-gradient\([^)]*\bfrom\b/);

  const stops = [...block!.matchAll(/var\(--board-(light|dark)/g)].map((match) => match[1] as Shade);
  expect(stops, 'expected the four conic-gradient stops').toHaveLength(4);

  // A conic gradient starts at 12 o'clock and runs clockwise, so the first stop
  // is the top-right quadrant of the tile and the last one is the top-left.
  return { topRight: stops[0]!, bottomRight: stops[1]!, bottomLeft: stops[2]!, topLeft: stops[3]! };
}

/** White orientation: row 0 is rank 8, column 0 is the a-file. */
function grid(): Shade[][] {
  const q = tile();
  return Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, file) =>
      row % 2 === 0
        ? file % 2 === 0
          ? q.topLeft
          : q.topRight
        : file % 2 === 0
          ? q.bottomLeft
          : q.bottomRight,
    ),
  );
}

const square = (name: string): Shade => {
  const file = name.charCodeAt(0) - 'a'.charCodeAt(0);
  const row = 8 - Number(name[1]);
  return grid()[row]![file]!;
};

describe('board square colours', () => {
  it('is dark at a1 and h8, light at h1 and a8', () => {
    expect(square('a1')).toBe('dark');
    expect(square('h1')).toBe('light');
    expect(square('a8')).toBe('light');
    expect(square('h8')).toBe('dark');
  });

  it('is dark exactly when file + rank is even', () => {
    for (const file of 'abcdefgh') {
      for (let rank = 1; rank <= 8; rank += 1) {
        const dark = (file.charCodeAt(0) - 'a'.charCodeAt(0) + (rank - 1)) % 2 === 0;
        expect(square(`${file}${rank}`), `${file}${rank}`).toBe(dark ? 'dark' : 'light');
      }
    }
  });

  it('stays correct when the board is flipped', () => {
    // Playing Black is a 180° view of the same board, so h8 sits bottom-left
    // and h1 top-left. The checkerboard is unchanged by that turn.
    expect(square('h8')).toBe('dark');
    expect(square('h1')).toBe('light');
    expect(grid().map((row) => [...row].reverse()).reverse()).toEqual(grid());
  });
});
