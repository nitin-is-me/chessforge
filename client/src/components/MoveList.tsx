import { useEffect, useRef } from 'react';
import type { MoveRecord } from '@shared/protocol';

interface MoveListProps {
  moves: MoveRecord[];
  currentPly?: number | null;
  onSelect?: (ply: number) => void;
  compact?: boolean;
  /** Fill the parent instead of capping its height, e.g. in the phone move strip. */
  fill?: boolean;
}

export function MoveList({ moves, currentPly = null, onSelect, compact = false, fill = false }: MoveListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [moves.length]);

  const rows: { number: number; white?: MoveRecord; black?: MoveRecord }[] = [];
  for (let index = 0; index < moves.length; index += 2) {
    rows.push({
      number: index / 2 + 1,
      white: moves[index],
      black: moves[index + 1],
    });
  }

  if (moves.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-sm text-forge-faint ${
          fill ? 'min-h-0 flex-1' : compact ? 'h-24' : 'h-40'
        }`}
      >
        Moves will appear here
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={`overflow-y-auto font-mono text-[13px] ${
        fill ? 'min-h-0 flex-1' : compact ? 'max-h-48' : 'max-h-[300px]'
      }`}
    >
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row) => (
            <tr key={row.number} className="odd:bg-white/[0.015]">
              <td className="w-9 select-none py-1 pl-2 pr-1 text-right text-forge-faint">{row.number}.</td>
              {(['white', 'black'] as const).map((side) => {
                const move = row[side];
                if (!move) return <td key={side} className="py-1" />;
                const selected = currentPly === move.ply;
                return (
                  <td key={side} className="py-1 pr-2">
                    <button
                      type="button"
                      onClick={() => onSelect?.(move.ply)}
                      className={`w-full rounded px-1.5 py-0.5 text-left transition-colors ${
                        selected
                          ? 'bg-forge-accent/20 text-forge-accent-strong'
                          : 'text-forge-text/85 hover:bg-white/5 hover:text-forge-text'
                      } ${onSelect ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      {move.san}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
