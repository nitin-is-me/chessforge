import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Board } from '../components/Board';
import { GameRow } from '../components/GameRow';
import { usePreferences } from '../store/preferences';
import { useSession } from '../store/session';
import { api, ApiError } from '../lib/api';
import { connectSocket, socket } from '../lib/socket';
import type { GameListItem } from '@shared/api';
import type { PoolStatus } from '@shared/protocol';
import {
  categoryLabel,
  PRESETS,
  type Preset,
  type TimeCategory,
} from '@shared/timeControl';

const HERO_FEN = 'rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6';

const CATEGORIES: TimeCategory[] = ['bullet', 'blitz', 'rapid', 'classical'];

export default function HomePage() {
  const navigate = useNavigate();
  const { user, guest } = useSession();
  const theme = usePreferences((state) => state.boardTheme);
  const [tab, setTab] = useState<TimeCategory>('blitz');
  const [rated, setRated] = useState(!guest);
  const [pairing, setPairing] = useState<Preset | null>(null);
  const [poolStatus, setPoolStatus] = useState<PoolStatus | null>(null);
  const [online, setOnline] = useState<number | null>(null);
  const [recent, setRecent] = useState<GameListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [privatePresetId, setPrivatePresetId] = useState<string | null>(null);
  const quickPairRef = useRef<HTMLElement | null>(null);

  const presets = useMemo(() => PRESETS.filter((preset) => preset.category === tab), [tab]);

  // Until the picker is touched it follows the open tab; afterwards the pick sticks.
  const privatePreset = useMemo(() => {
    const chosen = privatePresetId
      ? PRESETS.find((preset) => preset.id === privatePresetId)
      : undefined;
    return chosen ?? presets[0] ?? PRESETS[0]!;
  }, [privatePresetId, presets]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/healthz');
        const data = (await response.json()) as { online?: number };
        if (!cancelled) setOnline(data.online ?? 0);
      } catch {
        // Offline is fine; the lobby still works locally.
      }
    };
    void load();
    const timer = window.setInterval(load, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (guest) return;
    let cancelled = false;
    api
      .myGames()
      .then((data) => {
        if (!cancelled) setRecent(data.games.slice(0, 5));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [guest, user?.id]);

  useEffect(() => {
    const onPaired = (payload: { gameId: string }) => {
      setPairing(null);
      navigate(`/g/${payload.gameId}`);
    };
    const onStatus = (status: PoolStatus | null) => setPoolStatus(status);
    socket.on('pool:paired', onPaired);
    socket.on('pool:status', onStatus);
    return () => {
      socket.off('pool:paired', onPaired);
      socket.off('pool:status', onStatus);
    };
  }, [navigate]);

  const startPairing = async (preset: Preset) => {
    setError(null);
    setPairing(preset);
    try {
      await connectSocket();
      socket.emit('pool:join', { baseSec: preset.baseSec, incSec: preset.incSec, rated });
    } catch {
      setPairing(null);
      setError('Could not reach the game server. Try again in a moment.');
    }
  };

  const cancelPairing = () => {
    socket.emit('pool:leave');
    setPairing(null);
    setPoolStatus(null);
  };

  const createPrivate = async () => {
    setError(null);
    setCreating(true);
    try {
      const room = await api.createRoom(
        privatePreset.baseSec,
        privatePreset.incSec,
        rated && !guest,
        'random',
      );
      navigate(`/g/${room.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create a game');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <section className="relative overflow-hidden hero-grain">
        <div className="page grid gap-12 py-10 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:py-16">
          <div className="fade-in">
            <span className="chip chip-accent">Free · Ad-free · Open source</span>
            <h1 className="mt-5 font-display text-[2.8rem] leading-[1.03] tracking-tight sm:text-[3.6rem]">
              Chess that feels
              <span className="block text-forge-accent">forged for focus.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-forge-muted">
              Instant pairing, honest clocks, and a board that gets out of the way. Every game is
              timed on the server, survives a dropped connection, and is ready for engine review the
              moment it ends.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn btn-primary px-5 py-3 text-[15px]"
                onClick={() =>
                  quickPairRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                Find a game
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <Link to="/computer" className="btn btn-secondary px-5 py-3 text-[15px]">
                Play the computer
              </Link>
            </div>
            <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-forge-muted">
              {PRESETS.length} time controls — bullet, blitz, rapid and classical — plus private
              games you can share by link. Pick your pace in the pool below, or jump straight into{' '}
              <button
                type="button"
                className="link bg-transparent p-0 text-[13px] underline decoration-dotted decoration-forge-accent/60 underline-offset-4"
                onClick={() => void startPairing(PRESETS.find((preset) => preset.id === '10+5')!)}
              >
                10+5 blitz
              </button>
              .
            </p>
            <dl className="mt-9 grid max-w-md grid-cols-3 gap-4 border-t border-forge-line pt-5">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-forge-faint">Players online</dt>
                <dd className="stat-value mt-1">{online ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-forge-faint">Your rating</dt>
                <dd className="stat-value mt-1">{user?.ratings.blitz?.rating ?? 1500}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-forge-faint">Games today</dt>
                <dd className="stat-value mt-1">∞</dd>
              </div>
            </dl>
          </div>

          <div className="relative mx-auto w-full max-w-[460px]">
            <div className="pointer-events-none absolute -inset-8 rounded-[2rem] bg-forge-accent/10 blur-3xl" />
            <div className="relative rounded-[20px] border border-forge-line bg-forge-panel p-3 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)]">
              <Board fen={HERO_FEN} theme={theme} />
              <div className="flex items-center justify-between px-1 pb-1 pt-3 text-xs text-forge-muted">
                <span className="chip">Najdorf · Sicilian</span>
                <span>White to play · move 6</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page scroll-mt-24 pb-4" id="quick-pair" ref={quickPairRef}>
        <div className="panel p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl">Quick pair</h2>
              <p className="mt-1 text-sm text-forge-muted">
                Join a pool and get matched by rating. Clocks are authoritative from the first move.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-forge-muted">
                <input
                  type="checkbox"
                  checked={rated && !guest}
                  disabled={guest}
                  onChange={(event) => setRated(event.target.checked)}
                  className="h-4 w-4 rounded border-forge-line bg-forge-bg accent-[#e3a455]"
                />
                Rated
                {guest ? <span className="text-[11px] text-forge-faint">(account required)</span> : null}
              </label>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-b border-forge-line-soft pb-2">
            {CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setTab(category)}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  tab === category
                    ? 'bg-white/[0.07] text-forge-text'
                    : 'text-forge-muted hover:text-forge-text'
                }`}
              >
                {categoryLabel(category)}
              </button>
            ))}
            <span className="ml-auto text-xs text-forge-muted">
              {categoryLabel(tab)} · {presets.length} formats
            </span>
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => void startPairing(preset)}
                className="group flex items-center justify-between rounded-xl border border-forge-line-soft bg-forge-panel-2/70 px-4 py-3 text-left transition-all hover:border-forge-accent/45 hover:bg-forge-panel-3"
              >
                <div>
                  <div className="font-display text-xl">{preset.label}</div>
                  <div className="mt-0.5 text-xs text-forge-muted">
                    {preset.baseSec / 60} min + {preset.incSec}s · {categoryLabel(preset.category)}
                  </div>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-lg border border-forge-line text-forge-muted transition-colors group-hover:border-forge-accent/50 group-hover:text-forge-accent">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-forge-line-soft pt-4">
            <label className="block">
              <span className="label">Private game</span>
              <select
                className="field w-auto min-w-[13rem] py-2"
                value={privatePreset.id}
                onChange={(event) => setPrivatePresetId(event.target.value)}
                disabled={creating}
              >
                {CATEGORIES.map((category) => (
                  <optgroup key={category} label={categoryLabel(category)}>
                    {PRESETS.filter((preset) => preset.category === category).map((preset) => (
                      <option
                        key={preset.id}
                        value={preset.id}
                        className="bg-forge-panel-2 text-forge-text"
                      >
                        {preset.label} · {preset.baseSec / 60} min + {preset.incSec}s
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-secondary" onClick={() => void createPrivate()} disabled={creating}>
              {creating ? 'Creating…' : 'Create a private game'}
            </button>
            <span className="pb-1 text-xs text-forge-muted">
              {privatePreset.label} · {categoryLabel(privatePreset.category).toLowerCase()}. You get a
              link to share; the clock starts when both players are seated.
            </span>
          </div>

          {error ? <p className="mt-3 text-sm text-forge-danger">{error}</p> : null}
        </div>
      </section>

      {recent.length > 0 ? (
        <section className="page mt-6">
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-forge-line-soft px-4 py-3">
              <h2 className="font-display text-lg">Your recent games</h2>
              <Link to={`/u/${user?.username}`} className="text-xs text-forge-muted hover:text-forge-accent">
                View profile
              </Link>
            </div>
            {recent.map((game) => (
              <GameRow key={game.id} game={game} showPlayer />
            ))}
          </div>
        </section>
      ) : null}

      <section className="page mt-10 grid gap-4 sm:grid-cols-3">
        {[
          {
            title: 'Server-authoritative clocks',
            body: 'Moves and time are validated on the server. Lag compensation is quota-based, so a bad connection cannot be farmed for thinking time.',
          },
          {
            title: 'Reconnect without losing',
            body: 'Refreshing the page or losing Wi-Fi resumes the same game with the same clock. Restarts recover every live game from Postgres.',
          },
          {
            title: 'Engine review, local',
            body: 'Stockfish runs in a Web Worker on your machine. Win% and accuracy use the published formulas, so the numbers mean something.',
          },
        ].map((feature) => (
          <article key={feature.title} className="panel p-4">
            <h3 className="font-display text-lg">{feature.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-forge-muted">{feature.body}</p>
          </article>
        ))}
      </section>

      {pairing ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-forge-bg/80 p-4 backdrop-blur-sm">
          <div className="panel w-full max-w-sm p-6 text-center">
            <div className="relative mx-auto h-16 w-16">
              <span className="absolute inset-0 rounded-full border-2 border-forge-line" />
              <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-forge-accent" />
              <span className="absolute inset-0 grid place-items-center font-display text-lg">
                {pairing.label}
              </span>
            </div>
            <h2 className="mt-5 font-display text-2xl">Finding an opponent</h2>
            <p className="mt-1 text-sm text-forge-muted">
              {categoryLabel(pairing.category)} · {rated && !guest ? 'Rated' : 'Casual'}
              {poolStatus ? ` · ${poolStatus.waiting} in pool` : ''}
            </p>
            <p className="mt-4 text-xs text-forge-faint">
              The rating window widens the longer you wait. Your clock only starts once both players
              are seated.
            </p>
            <button type="button" className="btn btn-secondary mt-5 w-full" onClick={cancelPairing}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
