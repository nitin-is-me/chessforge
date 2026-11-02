import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Board } from '../components/Board';
import { PlayerBar } from '../components/PlayerBar';
import { MoveList } from '../components/MoveList';
import { GameActions } from '../components/GameActions';
import { ResultBanner } from '../components/ResultBanner';
import { ChatPanel } from '../components/ChatPanel';
import { useGame } from '../store/game';
import { usePreferences } from '../store/preferences';
import { useSession } from '../store/session';
import { api } from '../lib/api';
import { categoryLabel, formatTimeControl } from '@shared/timeControl';
import { categoryColor, reasonText, resultHeadline } from '../lib/format';
import { playSound } from '../lib/sounds';

type Sheet = 'chat' | 'moves' | 'more' | null;

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path
        fillRule="evenodd"
        d="M4.804 21.644A6.707 6.707 0 0 0 6 21.75a6.721 6.721 0 0 0 3.583-1.029c.774.182 1.584.279 2.417.279 5.322 0 9.75-3.97 9.75-9 0-5.03-4.428-9-9.75-9s-9.75 3.97-9.75 9c0 2.409 1.025 4.587 2.674 6.192.232.226.277.428.254.543a3.73 3.73 0 0 1-.814 1.686.75.75 0 0 0 .44 1.223Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
      <path d="M6 21V4M6 4h11l-1.2 3.2L17 11H6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
      <path d="M7 4v13a2 2 0 0 0 2 2h8M7 4 4 7m3-3 3 3M17 20v-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
      <circle cx="6.5" cy="12" r="2.5" />
      <circle cx="17.5" cy="6" r="2.5" />
      <circle cx="17.5" cy="18" r="2.5" />
      <path d="M8.8 10.8l6.4-3.5M8.8 13.2l6.4 3.5" strokeLinecap="round" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
      <path d="M14.5 5 8 12l6.5 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const PIECE_GLYPH: Record<'w' | 'b', Record<string, string>> = {
  w: { q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const PIECE_ORDER = ['q', 'r', 'b', 'n', 'p'] as const;
const PIECE_COUNT: Record<string, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 };

/** Enemy pieces a colour has taken, read straight from the position. */
function capturedBy(fen: string, color: 'w' | 'b'): string[] {
  const placement = fen.split(' ')[0] ?? '';
  const enemy = color === 'w' ? 'b' : 'w';
  const alive: Record<string, number> = { q: 0, r: 0, b: 0, n: 0, p: 0 };
  for (const char of placement) {
    if (char === '/' || /\d/.test(char)) continue;
    if ((char === char.toLowerCase() ? 'b' : 'w') !== enemy) continue;
    const role = char.toLowerCase();
    if (role in alive) alive[role] += 1;
  }
  const taken: string[] = [];
  for (const role of PIECE_ORDER) {
    const missing = Math.max(0, (PIECE_COUNT[role] ?? 0) - alive[role]!);
    for (let index = 0; index < missing; index += 1) taken.push(role);
  }
  return taken;
}

/** Thin trophies row in the empty band beside each clock — phones only. */
function CapturedPieces({ pieces, color, owner }: { pieces: string[]; color: 'w' | 'b'; owner: string }) {
  if (pieces.length === 0) return <div className="h-[18px] lg:hidden" aria-hidden />;
  return (
    <div
      className="flex h-[18px] items-center gap-px overflow-hidden lg:hidden"
      role="img"
      aria-label={`Pieces ${owner} has captured: ${pieces.join(', ')}`}
    >
      {pieces.map((role, index) => (
        <span
          key={`${role}-${index}`}
          className="text-[14px] leading-none"
          style={
            color === 'w'
              ? { color: '#f1efe7', textShadow: '0 0 1px rgba(0,0,0,0.9)' }
              : { color: '#0c0f13', textShadow: '0 0 1.5px rgba(226,226,226,0.85)' }
          }
        >
          {PIECE_GLYPH[color][role]}
        </span>
      ))}
    </div>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-3.5 w-3.5" aria-hidden>
      <path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DockButton({
  label,
  icon,
  badge,
  danger,
  disabled,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  badge?: string | number | null;
  danger?: boolean;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 text-[10px] font-semibold leading-none transition-colors active:scale-[0.98] disabled:opacity-40 ${
        danger
          ? 'border-forge-danger/35 bg-forge-danger/10 text-[#e79a94]'
          : active
            ? 'border-forge-accent/45 bg-forge-accent/15 text-forge-accent'
            : 'border-forge-line bg-forge-panel-2 text-forge-muted hover:text-forge-text'
      }`}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
      {badge ? (
        <span className="absolute -top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function OverlayCard({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'success' | 'danger';
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-forge-line bg-forge-panel-2/95',
    accent: 'border-forge-accent/45 bg-forge-panel-2/95',
    success: 'border-forge-success/45 bg-forge-panel-2/95',
    danger: 'border-forge-danger/45 bg-forge-panel-2/95',
  };
  return (
    <div
      className={`pointer-events-auto w-full max-w-[380px] rounded-xl border px-2.5 py-2 text-xs shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)] backdrop-blur-md ${tones[tone]}`}
    >
      {children}
    </div>
  );
}

export default function GamePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const session = useSession((state) => state.user);
  const theme = usePreferences((state) => state.boardTheme);
  const {
    snapshot,
    myColor,
    offset,
    error,
    loading,
    missing,
    rematchGameId,
    connected,
    chatUnread,
    join,
    leave,
    clearError,
    acceptChat,
    declineChat,
  } = useGame();
  const [flipped, setFlipped] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'moves' | 'chat'>('moves');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  // Only one chat surface may be mounted: a hidden sidebar panel would keep
  // marking messages read while the phone shows the bottom sheet.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );

  useEffect(() => {
    if (!id) return;
    void join(id);
    return () => leave();
  }, [id, join, leave]);

  useEffect(() => {
    if (rematchGameId) {
      navigate(`/g/${rematchGameId}`);
      useGame.setState({ rematchGameId: null });
    }
  }, [rematchGameId, navigate]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(clearError, 5000);
    return () => window.clearTimeout(timer);
  }, [error, clearError]);

  useEffect(() => {
    if (!confirmResign) return;
    const timer = window.setTimeout(() => setConfirmResign(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmResign]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const apply = () => setIsDesktop(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheet(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  const orientation = useMemo<'white' | 'black'>(() => {
    const base = myColor === 'b' ? 'black' : 'white';
    if (!flipped) return base;
    return base === 'white' ? 'black' : 'white';
  }, [myColor, flipped]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const copyPgn = async () => {
    try {
      const pgn = await api.pgn(id);
      await navigator.clipboard.writeText(pgn);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (missing) {
    return (
      <div className="page py-24 text-center">
        <h1 className="font-display text-4xl">Game not found</h1>
        <p className="mt-3 text-forge-muted">{error ?? 'This game may have expired.'}</p>
        <Link to="/" className="btn btn-primary mt-6">Back to the lobby</Link>
      </div>
    );
  }

  if (loading || !snapshot) {
    return (
      <div className="page py-4">
        <div className="mx-auto grid max-w-[1000px] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="board-shell shimmer" />
          <div className="panel h-[calc(100dvh-240px)] min-h-[320px] shimmer" />
        </div>
      </div>
    );
  }

  const isWhiteView = orientation === 'white';
  const topColor = isWhiteView ? 'b' : 'w';
  const bottomColor = isWhiteView ? 'w' : 'b';
  const topPlayer = topColor === 'w' ? snapshot.white : snapshot.black;
  const bottomPlayer = bottomColor === 'w' ? snapshot.white : snapshot.black;
  const running = snapshot.status === 'started';
  const myTurn = running && myColor === snapshot.turn && snapshot.status === 'started';
  const opponentColor = myColor === 'w' ? 'b' : myColor === 'b' ? 'w' : null;
  const opponent = opponentColor === 'w' ? snapshot.white : opponentColor === 'b' ? snapshot.black : null;
  const finished = snapshot.status === 'finished' || snapshot.status === 'aborted';
  const isPlayer = Boolean(myColor);

  const ratingDelta = (before: number | null, after: number | null) =>
    before !== null && after !== null ? Math.round(after - before) : null;
  const myDelta =
    myColor === 'w'
      ? ratingDelta(snapshot.ratings.whiteBefore, snapshot.ratings.whiteAfter)
      : myColor === 'b'
        ? ratingDelta(snapshot.ratings.blackBefore, snapshot.ratings.blackAfter)
        : null;

  const offerFromOpponent = snapshot.drawOfferBy && snapshot.drawOfferBy !== myColor;
  const offerFromMe = snapshot.drawOfferBy && snapshot.drawOfferBy === myColor;
  const chatRequestedByOpponent =
    snapshot.chat.state === 'requested' && Boolean(myColor) && snapshot.chat.requestedBy !== myColor;
  const rematchFromOpponent = snapshot.rematch && Boolean(myColor) && snapshot.rematch.offerBy !== myColor;
  const rematchFromMe = snapshot.rematch && Boolean(myColor) && snapshot.rematch.offerBy === myColor;
  const chatBadge = chatRequestedByOpponent ? '!' : chatUnread > 0 ? (chatUnread > 9 ? '9+' : chatUnread) : null;

  const statusText =
    snapshot.status === 'waiting'
      ? 'Waiting for opponent'
      : snapshot.status === 'started'
        ? myColor
          ? myTurn
            ? 'Your move'
            : "Opponent's move"
          : 'Spectating'
        : reasonText(snapshot.reason);

  const openChat = () => {
    // Phones use the sheet, desktop the sidebar — never both.
    if (isDesktop) setSidebarTab('chat');
    else setSheet('chat');
    useGame.getState().markChatRead();
  };

  const openSidebarChat = () => {
    setSidebarTab('chat');
    useGame.getState().markChatRead();
  };

  return (
    <div className="game-shell px-2 pb-1 pt-1.5 sm:px-4 sm:pt-2">
      <div className="mx-auto grid h-full min-h-0 max-w-[1180px] gap-2 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-4">
        {/* ── Main column: board, clocks, compact controls ── */}
        <div className="flex min-h-0 w-full flex-col">
          {/* Top strip */}
          <div className="mb-1 flex shrink-0 items-center justify-between gap-2 text-[11px] text-forge-muted">
            <div className="flex min-w-0 items-center gap-1.5">
              <Link
                to="/"
                aria-label="Back to lobby"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-forge-line text-forge-muted hover:text-forge-text lg:hidden"
              >
                <BackIcon />
              </Link>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: categoryColor(snapshot.category) }}
                aria-hidden
              />
              <span className="uppercase tracking-[0.12em]">{categoryLabel(snapshot.category)}</span>
              <span className="text-forge-faint">·</span>
              <span className="tabular-nums">
                {formatTimeControl({ baseSec: snapshot.baseSec, incSec: snapshot.incSec })}
              </span>
              <span className="hidden text-forge-faint sm:inline">·</span>
              <span className="hidden sm:inline">{snapshot.rated ? 'Rated' : 'Casual'}</span>
              <span className="truncate text-forge-faint">· {statusText}</span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="btn btn-ghost !px-1.5 !py-1 text-[11px]"
                onClick={() => setFlipped((v) => !v)}
                title="Flip board"
              >
                <FlipIcon />
                <span className="hidden sm:inline">Flip</span>
              </button>
              <button
                type="button"
                className="btn btn-ghost !px-1.5 !py-1 text-[11px]"
                onClick={() => void copyLink()}
                title="Copy game link"
              >
                <ShareIcon />
                <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
              </button>
            </div>
          </div>

          {/* Board + clocks: held in the vertical middle of the space above the move strip */}
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
            <div className="game-board-col flex w-full flex-col gap-1">
            <PlayerBar
              player={topPlayer}
              color={topColor}
              active={running && snapshot.turn === topColor}
              remainingMs={topColor === 'w' ? snapshot.clocks.whiteMs : snapshot.clocks.blackMs}
              turnStartedAt={snapshot.clocks.turnStartedAt}
              compensationMs={snapshot.clocks.compensationMs}
              offset={offset}
              running={running}
              isMe={topColor === myColor}
              thinking={running && snapshot.turn === topColor && !(topPlayer?.online ?? true)}
              label={snapshot.status === 'waiting' ? 'Waiting for opponent' : undefined}
              compact
            />

            <CapturedPieces
              pieces={capturedBy(snapshot.fen, topColor)}
              color={topColor === 'w' ? 'b' : 'w'}
              owner={topPlayer?.displayName ?? 'Opponent'}
            />

            <div className="relative">
              <Board
                fen={snapshot.fen}
                orientation={orientation}
                canMove={Boolean(myTurn) && !finished}
                lastMove={snapshot.lastMove}
                check={Boolean(snapshot.check)}
                onMove={(uci) => useGame.getState().move(uci)}
                theme={theme}
                className="board-fit-game"
              />

              {/* Transient notices float over the board so the board never shifts or scrolls */}
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col items-center gap-1.5">
                {!connected && (
                  <OverlayCard tone="accent">
                    Connection lost — reconnecting. Your clock keeps running.
                  </OverlayCard>
                )}

                {connected && running && opponent && !opponent.online && (
                  <OverlayCard tone="neutral">
                    {opponent.displayName} disconnected. If they don&apos;t return, you can claim the win.
                  </OverlayCard>
                )}

                {chatRequestedByOpponent && (
                  <OverlayCard tone="accent">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="font-semibold text-forge-accent">{opponent?.displayName ?? 'Opponent'}</span>{' '}
                        wants to chat.
                      </span>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          className="btn btn-primary !px-2.5 !py-1 text-[11px]"
                          onClick={() => {
                            acceptChat();
                            openChat();
                          }}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary !px-2.5 !py-1 text-[11px]"
                          onClick={() => declineChat()}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  </OverlayCard>
                )}

                {offerFromOpponent && running && (
                  <OverlayCard tone="accent">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="font-semibold text-forge-accent">½ · </span>
                        {opponent?.displayName ?? 'Opponent'} offers a draw.
                      </span>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          className="btn btn-primary !px-2.5 !py-1 text-[11px]"
                          onClick={() => {
                            useGame.getState().acceptDraw();
                            playSound('notify');
                          }}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary !px-2.5 !py-1 text-[11px]"
                          onClick={() => {
                            useGame.getState().declineDraw();
                            playSound('illegal');
                          }}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  </OverlayCard>
                )}

                {offerFromMe && running && (
                  <OverlayCard tone="neutral">Draw offered — waiting for a response…</OverlayCard>
                )}

                {rematchFromOpponent && finished && (
                  <OverlayCard tone="success">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {opponent?.displayName ?? 'Opponent'} wants a rematch!
                      </span>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          className="btn btn-primary !px-2.5 !py-1 text-[11px]"
                          onClick={() => useGame.getState().acceptRematch()}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary !px-2.5 !py-1 text-[11px]"
                          onClick={() => useGame.setState({ rematchGameId: null })}
                        >
                          Later
                        </button>
                      </div>
                    </div>
                  </OverlayCard>
                )}

                {rematchFromMe && finished && (
                  <OverlayCard tone="neutral">Rematch offered — waiting for opponent…</OverlayCard>
                )}

                {snapshot.status === 'waiting' && (
                  <OverlayCard tone="neutral">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">Share the link — the game starts when someone joins.</span>
                      <button
                        type="button"
                        className="btn btn-secondary shrink-0 !px-2.5 !py-1 text-[11px]"
                        onClick={() => void copyLink()}
                      >
                        {copied ? 'Copied' : 'Copy link'}
                      </button>
                    </div>
                  </OverlayCard>
                )}

                {finished && (
                  <OverlayCard tone="accent">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-display text-sm leading-tight">{resultHeadline(snapshot, myColor)}</p>
                        <p className="mt-0.5 truncate text-[10px] text-forge-muted">{reasonText(snapshot.reason)}</p>
                      </div>
                      {myDelta !== null && (
                        <span
                          className={`shrink-0 text-base tabular-nums ${
                            myDelta > 0 ? 'text-forge-success' : myDelta < 0 ? 'text-forge-danger' : 'text-forge-muted'
                          }`}
                        >
                          {myDelta > 0 ? '+' : ''}
                          {myDelta}
                        </span>
                      )}
                    </div>
                  </OverlayCard>
                )}

                {error && (
                  <OverlayCard tone="danger">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0">{error}</span>
                      <button type="button" className="shrink-0 text-[10px] underline" onClick={clearError}>
                        dismiss
                      </button>
                    </div>
                  </OverlayCard>
                )}
              </div>
            </div>

            <CapturedPieces
              pieces={capturedBy(snapshot.fen, bottomColor)}
              color={bottomColor === 'w' ? 'b' : 'w'}
              owner={bottomPlayer?.displayName ?? 'Opponent'}
            />

            <PlayerBar
              player={bottomPlayer}
              color={bottomColor}
              active={running && snapshot.turn === bottomColor}
              remainingMs={bottomColor === 'w' ? snapshot.clocks.whiteMs : snapshot.clocks.blackMs}
              turnStartedAt={snapshot.clocks.turnStartedAt}
              compensationMs={snapshot.clocks.compensationMs}
              offset={offset}
              running={running}
              isMe={bottomColor === myColor}
              compact
            />
            </div>
          </div>

          {/* Mobile: a short live move strip — the header opens the full list */}
          <div className="mt-1 flex h-[clamp(72px,12dvh,104px)] shrink-0 flex-col overflow-hidden lg:hidden">
            <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
              <button
                type="button"
                onClick={() => setSheet('moves')}
                aria-label="Expand moves"
                title="Expand moves"
                className="flex shrink-0 items-center justify-between gap-2 border-b border-forge-line/70 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-forge-faint transition-colors hover:text-forge-text"
              >
                <span>Moves ({snapshot.ply})</span>
                <ExpandIcon />
              </button>
              <MoveList moves={snapshot.moves} fill />
            </div>
          </div>

          {/* Mobile/tablet action dock — every control one tap away, no scrolling */}
          <div className="mt-1 flex shrink-0 items-stretch gap-1 pb-[max(2px,env(safe-area-inset-bottom))] lg:hidden">
            <DockButton
              label="Chat"
              icon={<ChatIcon />}
              badge={chatBadge}
              active={sheet === 'chat'}
              onClick={() => (sheet === 'chat' ? setSheet(null) : openChat())}
            />
            {finished ? (
              <Link
                to={`/analysis/${snapshot.id}`}
                className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border border-forge-line bg-forge-panel-2 px-1 py-1.5 text-[10px] font-semibold leading-none text-forge-muted hover:text-forge-text"
              >
                <span className="font-display text-[13px] leading-none">⤢</span>
                Analyse
              </Link>
            ) : running && isPlayer ? (
              <>
                <DockButton
                  label={offerFromMe ? 'Offered' : 'Draw'}
                  icon={<span className="text-[15px] font-semibold leading-none">½</span>}
                  disabled={Boolean(offerFromMe)}
                  onClick={() => useGame.getState().offerDraw()}
                />
                <DockButton
                  label={confirmResign ? 'Sure?' : 'Resign'}
                  icon={<FlagIcon />}
                  danger
                  onClick={() => {
                    if (confirmResign) {
                      useGame.getState().resign();
                      setConfirmResign(false);
                    } else {
                      setConfirmResign(true);
                    }
                  }}
                />
              </>
            ) : null}
            <DockButton
              label="More"
              icon={<MoreIcon />}
              active={sheet === 'more'}
              onClick={() => setSheet((current) => (current === 'more' ? null : 'more'))}
            />
          </div>

          {!isPlayer && session && (
            <p className="mt-1 shrink-0 text-center text-[10px] text-forge-faint lg:hidden">
              Spectating as {session.displayName}
            </p>
          )}
        </div>

        {/* ── Desktop sidebar ── */}
        <aside className="hidden min-h-0 flex-col gap-2 lg:flex">
          <div className="panel shrink-0 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h1 className="truncate font-display text-sm leading-tight">
                  {snapshot.white?.displayName ?? 'Open'} <span className="text-forge-faint">vs</span>{' '}
                  {snapshot.black?.displayName ?? 'Open seat'}
                </h1>
                <p className="mt-0.5 truncate text-[10px] text-forge-muted">{statusText}</p>
              </div>
              <span className="chip whitespace-nowrap !py-0.5 !text-[9px]">{snapshot.status}</span>
            </div>
          </div>

          <div className="flex shrink-0 gap-1 rounded-lg bg-forge-panel-2 p-1">
            <button
              type="button"
              className={`flex-1 rounded py-1 text-[11px] font-medium transition-colors ${
                sidebarTab === 'moves' ? 'bg-forge-accent text-forge-bg' : 'text-forge-muted hover:text-forge-text'
              }`}
              onClick={() => setSidebarTab('moves')}
            >
              Moves ({snapshot.ply})
            </button>
            <button
              type="button"
              className={`relative flex-1 rounded py-1 text-[11px] font-medium transition-colors ${
                sidebarTab === 'chat' ? 'bg-forge-accent text-forge-bg' : 'text-forge-muted hover:text-forge-text'
              }`}
              onClick={openSidebarChat}
            >
              Chat
              {chatBadge ? (
                <span className="absolute -right-0.5 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow">
                  {chatBadge}
                </span>
              ) : null}
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {sidebarTab === 'moves' ? (
              <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
                <MoveList moves={snapshot.moves} />
              </div>
            ) : isDesktop ? (
              <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
                <ChatPanel snapshot={snapshot} myColor={myColor} opponentName={opponent?.displayName ?? 'your opponent'} />
              </div>
            ) : (
              <div className="panel flex min-h-0 flex-1 items-center justify-center p-4 text-center text-xs text-forge-muted">
                Open chat from the dock on phones.
              </div>
            )}
          </div>

          {finished ? (
            <div className="shrink-0">
              <ResultBanner
                result={snapshot.result}
                myColor={myColor}
                reason={snapshot.reason}
                delta={myDelta}
                opponentLabel={opponent?.displayName}
              />
            </div>
          ) : null}

          <div className="shrink-0">
            <GameActions snapshot={snapshot} myColor={myColor} onCopyPgn={() => void copyPgn()} />
          </div>
        </aside>
      </div>

      {/* ── Mobile bottom sheet: chat / moves / more ── */}
      {sheet && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSheet(null)}
        >
          <div
            className="flex max-h-[80dvh] flex-col rounded-t-2xl border-t border-forge-line bg-forge-panel-2 shadow-[0_-18px_50px_-10px_rgba(0,0,0,0.9)]"
            style={sheet === 'more' ? undefined : { height: '62dvh' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-forge-line px-3 py-2">
              <span className="truncate text-sm font-semibold">
                {sheet === 'chat'
                  ? `Chat with ${opponent?.displayName ?? 'opponent'}`
                  : sheet === 'moves'
                    ? `Moves (${snapshot.ply})`
                    : 'More'}
              </span>
              <button
                type="button"
                aria-label="Close panel"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-forge-muted hover:bg-white/5 hover:text-forge-text"
                onClick={() => setSheet(null)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
              {sheet === 'chat' && (
                <ChatPanel snapshot={snapshot} myColor={myColor} opponentName={opponent?.displayName ?? 'your opponent'} />
              )}

              {sheet === 'moves' && (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <MoveList moves={snapshot.moves} fill />
                </div>
              )}

              {sheet === 'more' && (
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
                  {finished ? (
                    <ResultBanner
                      result={snapshot.result}
                      myColor={myColor}
                      reason={snapshot.reason}
                      delta={myDelta}
                      opponentLabel={opponent?.displayName}
                    />
                  ) : null}
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className="btn btn-secondary flex-1 !py-2 text-xs"
                      onClick={() => setFlipped((v) => !v)}
                    >
                      Flip board
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary flex-1 !py-2 text-xs"
                      onClick={() => void copyLink()}
                    >
                      {copied ? 'Copied' : 'Share link'}
                    </button>
                  </div>
                  <GameActions
                    snapshot={snapshot}
                    myColor={myColor}
                    variant="menu"
                    onCopyPgn={() => void copyPgn()}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
