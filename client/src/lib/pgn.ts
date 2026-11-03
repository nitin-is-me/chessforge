import type { GameResult, MoveRecord } from '@shared/protocol';
import { formatTimeControl } from '@shared/timeControl';

export interface PgnSource {
  moves: MoveRecord[];
  white: string;
  black: string;
  result: GameResult | null;
  baseSec: number;
  incSec: number;
  /** Epoch ms for the PGN date header; defaults to now. */
  date?: number | null;
}

/**
 * Builds the same PGN the server does (`GameManager.buildPgn`), so a review of a
 * game that was never archived can still be exported. Moves are already stored
 * as SAN, so there is nothing to replay.
 */
export function buildPgn(source: PgnSource): string {
  const resultTag =
    source.result === 'white' ? '1-0' : source.result === 'black' ? '0-1' : source.result === 'draw' ? '1/2-1/2' : '*';
  const date = new Date(source.date ?? Date.now()).toISOString().slice(0, 10).replace(/-/g, '.');
  const headers = [
    `[Event "ChessForge ${formatTimeControl({ baseSec: source.baseSec, incSec: source.incSec })}"]`,
    `[Site "ChessForge"]`,
    `[Date "${date}"]`,
    `[White "${source.white}"]`,
    `[Black "${source.black}"]`,
    `[Result "${resultTag}"]`,
    `[TimeControl "${source.baseSec}+${source.incSec}"]`,
  ];

  const body: string[] = [];
  let line = '';
  source.moves.forEach((move, index) => {
    if (index % 2 === 0) line += `${index / 2 + 1}. `;
    line += `${move.san} `;
    if (line.length >= 76) {
      body.push(line.trim());
      line = '';
    }
  });
  if (line.trim()) body.push(line.trim());
  body.push(resultTag);

  return `${headers.join('\n')}\n\n${body.join('\n')}\n`;
}
