import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePreferences } from '../store/preferences';
import { useSession } from '../store/session';
import type { BoardTheme } from '../components/Board';
import { categoryLabel } from '@shared/timeControl';
import { playSound } from '../lib/sounds';
import { api, ApiError } from '../lib/api';

/** Shows the signed-in player's own address and lets them resend the link. */
function EmailSettings() {
  const [info, setInfo] = useState<{ email: string | null; verified: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .myEmail()
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info?.email) return null;

  const resend = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.requestEmailVerification();
      setMessage(result.alreadyVerified ? 'This address is already confirmed.' : 'Confirmation link sent.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the email');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-forge-line-soft bg-forge-bg/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-forge-faint">Email</div>
          <div className="text-sm">{info.email}</div>
        </div>
        <span className={`chip ${info.verified ? 'chip-accent' : ''}`}>
          {info.verified ? 'confirmed' : 'unconfirmed'}
        </span>
      </div>
      {!info.verified ? (
        <button type="button" className="btn btn-secondary mt-3" onClick={() => void resend()} disabled={busy}>
          {busy ? 'Sending…' : 'Resend confirmation'}
        </button>
      ) : null}
      {message ? <p className="mt-2 text-xs text-forge-success">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-forge-danger">{error}</p> : null}
    </div>
  );
}

const THEMES: { id: BoardTheme; name: string; light: string; dark: string }[] = [
  { id: 'forge', name: 'Forge', light: '#cbb79a', dark: '#7c6549' },
  { id: 'midnight', name: 'Midnight', light: '#93a6ba', dark: '#46586b' },
  { id: 'sand', name: 'Sand', light: '#e6d8c2', dark: '#b29a78' },
];

export default function SettingsPage() {
  const { boardTheme, setBoardTheme, muted, setMuted } = usePreferences();
  const { user, guest, logout } = useSession();

  return (
    <div className="page py-6">
      <h1 className="font-display text-3xl">Settings</h1>
      <p className="mt-1 text-sm text-forge-muted">Preferences are stored locally on this device.</p>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="font-display text-xl">Board</h2>
          <p className="mt-1 text-sm text-forge-muted">Pick the palette that suits your room.</p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => setBoardTheme(theme.id)}
                className={`overflow-hidden rounded-xl border text-left transition-all ${
                  boardTheme === theme.id
                    ? 'border-forge-accent/70 ring-2 ring-forge-accent/20'
                    : 'border-forge-line hover:border-forge-accent/40'
                }`}
              >
                <span
                  className="block h-16 w-full"
                  style={{
                    backgroundImage: `conic-gradient(${theme.dark} 25%, ${theme.light} 0 50%, ${theme.dark} 0 75%, ${theme.light} 0)`,
                    backgroundSize: '25% 25%',
                  }}
                />
                <span className="block px-2.5 py-2 text-xs">{theme.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="font-display text-xl">Sound</h2>
          <p className="mt-1 text-sm text-forge-muted">
            Move, capture, check and end-of-game sounds are synthesised locally.
          </p>
          <label className="mt-4 flex cursor-pointer items-center justify-between rounded-xl border border-forge-line-soft bg-forge-bg/40 p-3">
            <span className="text-sm">Board sounds</span>
            <input
              type="checkbox"
              checked={!muted}
              onChange={(event) => setMuted(!event.target.checked)}
              className="h-4 w-4 accent-[#e3a455]"
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary mt-3"
            onClick={() => playSound('capture')}
            disabled={muted}
          >
            Test sound
          </button>
          <p className="mt-3 text-xs text-forge-faint">
            Browsers block audio until you interact with the page. ChessForge unlocks it on your
            first click or keypress, so board sounds keep working afterwards.
          </p>
        </section>

        <section className="panel p-5">
          <h2 className="font-display text-xl">Account</h2>
          {guest ? (
            <>
              <p className="mt-1 text-sm text-forge-muted">
                You are playing as a guest. Guest games are kept for 30 days and cannot be rated.
              </p>
              <div className="mt-4 flex gap-2">
                <Link to="/signup" className="btn btn-primary">
                  Create account
                </Link>
                <Link to="/login" className="btn btn-secondary">
                  Sign in
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-forge-muted">
                Signed in as <span className="text-forge-text">{user?.displayName}</span>.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(['bullet', 'blitz', 'rapid', 'classical'] as const).map((category) => (
                  <div key={category} className="rounded-lg border border-forge-line-soft bg-forge-bg/40 p-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-forge-faint">{categoryLabel(category)}</div>
                    <div className="text-sm tabular-nums">{user?.ratings[category]?.rating ?? '—'}</div>
                  </div>
                ))}
              </div>
              <EmailSettings />
              <div className="mt-4 flex gap-2">
                <Link to={`/u/${user?.username}`} className="btn btn-secondary">
                  View profile
                </Link>
                <button type="button" className="btn btn-danger" onClick={() => void logout()}>
                  Sign out
                </button>
              </div>
            </>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="font-display text-xl">About</h2>
          <p className="mt-2 text-sm leading-relaxed text-forge-muted">
            ChessForge is an open-source chess platform. Games are authoritative on the server;
            clocks, ratings and results are never trusted from the browser. Analysis runs entirely in
            your browser with Stockfish.
          </p>
          <dl className="mt-4 space-y-2 text-xs text-forge-faint">
            <div className="flex justify-between">
              <dt>Board pieces</dt>
              <dd>cburnett (GPL)</dd>
            </div>
            <div className="flex justify-between">
              <dt>Engine</dt>
              <dd>Stockfish 19 lite (GPL-3.0)</dd>
            </div>
            <div className="flex justify-between">
              <dt>Ratings</dt>
              <dd>Glicko-2, per category</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
