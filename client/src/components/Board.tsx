import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';

export type BoardTheme = 'forge' | 'midnight' | 'sand';

interface BoardProps {
  fen: string;
  orientation?: 'white' | 'black';
  canMove?: boolean;
  lastMove?: [string, string] | null;
  check?: boolean;
  onMove?: (uci: string) => void;
  theme?: BoardTheme;
  className?: string;
}

interface PromotionChoice {
  from: string;
  to: string;
  color: 'w' | 'b';
}

const PROMOTION_ROLES = ['q', 'r', 'b', 'n'] as const;
const GLYPHS: Record<'w' | 'b', Record<string, string>> = {
  w: { q: '♕', r: '♖', b: '♗', n: '♘' },
  b: { q: '♛', r: '♜', b: '♝', n: '♞' },
};

export function Board({
  fen,
  orientation = 'white',
  canMove = false,
  lastMove,
  check = false,
  onMove,
  theme = 'forge',
  className = '',
}: BoardProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const [promotion, setPromotion] = useState<PromotionChoice | null>(null);

  const turn = useMemo<'w' | 'b'>(() => (fen.split(' ')[1] === 'b' ? 'b' : 'w'), [fen]);
  const cgTurn = turn === 'w' ? 'white' : 'black';

  const destinations = useMemo(() => {
    const map = new Map<Key, Key[]>();
    if (!canMove) return map;
    try {
      const chess = new Chess(fen);
      for (const move of chess.moves({ verbose: true })) {
        const from = move.from as Key;
        const list = map.get(from) ?? [];
        if (!list.includes(move.to as Key)) list.push(move.to as Key);
        map.set(from, list);
      }
    } catch {
      return map;
    }
    return map;
  }, [fen, canMove]);

  // Chessground keeps one event binding while the props underneath it change.
  const latest = useRef({ fen, onMove });
  useEffect(() => {
    latest.current = { fen, onMove };
  });

  // These are the only inputs that justify a board redraw. Every parent render
  // (chat, presence, offer pills) used to call set() again, which restarts piece
  // animations mid-move — the biggest source of dropped frames on phones.
  const configKey = [
    fen,
    orientation,
    cgTurn,
    check ? '1' : '0',
    lastMove ? `${lastMove[0]}${lastMove[1]}` : '',
    canMove ? '1' : '0',
  ].join('|');
  const appliedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const handleAfter = (from: Key, to: Key) => {
      const { fen: currentFen, onMove: emit } = latest.current;
      if (!emit) return;
      try {
        const chess = new Chess(currentFen);
        const promotions = chess
          .moves({ verbose: true })
          .filter((move) => move.from === from && move.to === to && move.promotion);
        if (promotions.length > 0) {
          setPromotion({ from, to, color: chess.turn() });
          return;
        }
      } catch {
        // Fall through: the server validates anyway.
      }
      emit(`${from}${to}`);
    };

    const config: Config = {
      fen,
      orientation,
      turnColor: cgTurn,
      check: check ? cgTurn : false,
      lastMove: lastMove ? (lastMove as Key[]) : undefined,
      coordinates: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        color: canMove ? cgTurn : undefined,
        dests: destinations,
        showDests: true,
        events: { after: handleAfter },
      },
      draggable: { enabled: canMove, showGhost: true, distance: 3 },
      selectable: { enabled: true },
      premovable: { enabled: false },
      drawable: { enabled: false },
    };

    if (!apiRef.current) {
      apiRef.current = Chessground(host, config);
      appliedKeyRef.current = configKey;
    } else if (appliedKeyRef.current !== configKey) {
      apiRef.current.set(config);
      appliedKeyRef.current = configKey;
    }
    // `configKey` already covers every prop this config is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  // The observer lives for the whole mount; rebuilding it on every update was
  // pointless work on each move.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => apiRef.current?.redrawAll());
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    },
    [],
  );

  const choosePromotion = (role: (typeof PROMOTION_ROLES)[number]) => {
    if (!promotion) return;
    onMove?.(`${promotion.from}${promotion.to}${role}`);
    setPromotion(null);
  };

  return (
    <div className={`board-shell board-theme-${theme} ${className}`}>
      <div ref={hostRef} />
      {promotion ? (
        <div className="promotion-tray" role="dialog" aria-label="Choose a promotion piece">
          <div className="promotion-options">
            {PROMOTION_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => choosePromotion(role)}
                aria-label={`Promote to ${role}`}
                style={{ color: promotion.color === 'w' ? '#f4f1ec' : '#1c1f24' }}
              >
                {GLYPHS[promotion.color][role]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
