import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from './store/session';
import { primeAudio, playSound } from './lib/sounds';
import { socket } from './lib/socket';
import type { ChallengeView } from '@shared/protocol';
import { formatTimeControl } from '@shared/timeControl';
import HomePage from './pages/Home';
import GamePage from './pages/Game';
import ComputerPage from './pages/Computer';
import AnalysisPage from './pages/Analysis';
import ProfilePage from './pages/Profile';
import FriendsPage from './pages/Friends';
import SettingsPage from './pages/Settings';
import WelcomePage from './pages/Welcome';
import { LoginPage, SignupPage } from './pages/Auth';
import { ResetPasswordPage, VerifyEmailPage } from './pages/Account';

function ForgeMark() {
  return (
    <span className="grid h-9 w-9 place-items-center rounded-xl border border-forge-line bg-forge-panel-2">
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path d="M6 18h12l-1.5-3H7.5L6 18Z" fill="#e3a455" />
        <path d="M9.5 13.5h5l1-4.5-3.5-4-3.5 4 1 4.5Z" fill="#e3a455" opacity="0.9" />
        <circle cx="12" cy="7.5" r="1.2" fill="#0b0c0f" />
      </svg>
    </span>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `rounded-lg px-3 py-2 text-sm transition-colors ${
          isActive ? 'bg-white/[0.06] text-forge-text' : 'text-forge-muted hover:text-forge-text'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function Header() {
  const { user, guest, loading, logout } = useSession();
  const location = useLocation();
  // The game, computer and analysis screens own their slim top strip on phones so
  // the board gets the space.
  const compactGameHeader =
    location.pathname.startsWith('/g/') ||
    location.pathname === '/computer' ||
    location.pathname.startsWith('/analysis/');
  const rating = user?.ratings.blitz?.rating ?? user?.ratings.rapid?.rating ?? user?.ratings.bullet?.rating;
  const category = user?.ratings.blitz ? 'blitz' : user?.ratings.rapid ? 'rapid' : 'bullet';

  return (
    <header
      className={`sticky top-0 z-40 border-b border-forge-line/70 bg-forge-bg/95 md:bg-forge-bg/85 md:backdrop-blur-xl ${
        compactGameHeader ? 'hidden md:block' : ''
      }`}
    >
      <div className="page flex h-16 items-center gap-4">
        <Link to="/" className="flex items-center gap-2.5">
          <ForgeMark />
          <span className="font-display text-[19px] tracking-tight">ChessForge</span>
        </Link>

        <nav className="ml-2 hidden items-center gap-0.5 md:flex">
          <NavItem to="/">Play</NavItem>
          <NavItem to="/computer">Computer</NavItem>
          <NavItem to="/friends">Friends</NavItem>
          <NavItem to="/settings">Settings</NavItem>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {loading ? (
            <div className="h-9 w-24 rounded-lg shimmer" />
          ) : guest ? (
            <>
              <Link to="/login" state={{ from: location.pathname }} className="btn btn-ghost hidden sm:inline-flex">
                Sign in
              </Link>
              <Link to="/signup" state={{ from: location.pathname }} className="btn btn-primary">
                Create account
              </Link>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to={`/u/${user?.username}`}
                className="flex items-center gap-2.5 rounded-full border border-forge-line bg-forge-panel-2/80 py-1 pl-1 pr-3 transition-colors hover:border-forge-accent/40"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-forge-accent/15 text-xs font-semibold uppercase text-forge-accent">
                  {user?.displayName.slice(0, 1)}
                </span>
                <span className="text-sm">{user?.displayName}</span>
                {rating ? (
                  <span className="text-xs tabular-nums text-forge-muted" title={`${category} rating`}>
                    {rating}
                  </span>
                ) : null}
              </Link>
              <button type="button" onClick={() => void logout()} className="btn btn-ghost !px-2.5" title="Sign out">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" strokeLinecap="round" />
                  <path d="M10 8l-4 4 4 4M6 12h9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
      <nav className="page flex gap-1 overflow-x-auto border-t border-forge-line/60 py-1.5 md:hidden">
        <NavItem to="/">Play</NavItem>
        <NavItem to="/computer">Computer</NavItem>
        <NavItem to="/friends">Friends</NavItem>
        <NavItem to="/settings">Settings</NavItem>
      </nav>
    </header>
  );
}

function GithubMark({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.55v-2.1c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.78 1.05.78 2.12v3.14c0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-forge-line/60 py-8">
      <div className="page flex flex-col gap-4 text-xs text-forge-faint sm:flex-row sm:items-center sm:justify-between">
        <p>
          ChessForge — open source chess. Engine analysis runs locally with{' '}
          <a href="https://stockfishchess.org" className="link" target="_blank" rel="noreferrer">
            Stockfish
          </a>{' '}
          (GPL-3.0).
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span>No ads. No tracking.</span>
          <a
            href="https://github.com/nitin-is-me/chessforge"
            className="link inline-flex items-center gap-1.5"
            target="_blank"
            rel="noreferrer"
          >
            <GithubMark />
            Source
          </a>
          <a
            href="https://github.com/nitin-is-me"
            className="group inline-flex items-center gap-1.5 rounded-full border border-forge-line bg-white/[0.02] px-2.5 py-1 transition-colors hover:border-forge-accent/40"
            target="_blank"
            rel="noreferrer"
          >
            <GithubMark className="h-3.5 w-3.5 text-forge-muted transition-colors group-hover:text-forge-accent" />
            <span className="text-forge-faint">Made by</span>
            <span className="font-medium text-forge-text transition-colors group-hover:text-forge-accent">
              @nitin-is-me
            </span>
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  const bootstrap = useSession((state) => state.bootstrap);
  const bootstrapped = useSession((state) => state.bootstrapped);
  const error = useSession((state) => state.error);
  const clearError = useSession((state) => state.clearError);
  const [incomingChallenge, setIncomingChallenge] = useState<ChallengeView | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  // Screens that fill the viewport and draw their own chrome: no footer under them.
  const isGamePage =
    location.pathname.startsWith('/g/') ||
    location.pathname === '/computer' ||
    location.pathname.startsWith('/analysis/');

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    primeAudio();
  }, []);

  useEffect(() => {
    const onChallenge = (payload: ChallengeView) => {
      setIncomingChallenge(payload);
      playSound('notify');
    };
    const onCancelled = (payload: { id: string }) => {
      setIncomingChallenge((curr) => (curr?.id === payload.id ? null : curr));
    };
    const onAccepted = (payload: { gameId: string }) => {
      setIncomingChallenge(null);
      navigate(`/g/${payload.gameId}`);
    };

    socket.on('challenge:received', onChallenge);
    socket.on('challenge:cancelled', onCancelled);
    socket.on('challenge:accepted', onAccepted);
    return () => {
      socket.off('challenge:received', onChallenge);
      socket.off('challenge:cancelled', onCancelled);
      socket.off('challenge:accepted', onAccepted);
    };
  }, [navigate]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(clearError, 6000);
    return () => window.clearTimeout(timer);
  }, [error, clearError]);

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      {incomingChallenge && (
        <div className="border-b border-forge-accent/40 bg-gradient-to-r from-forge-accent/20 via-forge-accent/15 to-forge-panel-2 px-4 py-2.5 text-sm text-forge-text shadow-md flex items-center justify-between gap-3 flex-wrap animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-forge-accent/25 text-forge-accent text-sm">
              ⚔️
            </span>
            <div className="min-w-0">
              <span className="font-semibold text-forge-accent">{incomingChallenge.from.displayName}</span>
              <span className="text-forge-muted text-xs sm:text-sm ml-1.5">
                challenged you to a {formatTimeControl({ baseSec: incomingChallenge.baseSec, incSec: incomingChallenge.incSec })} {incomingChallenge.rated ? 'rated' : 'casual'} game!
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
            <button
              type="button"
              className="btn btn-primary !py-1 !px-3 text-xs font-medium shadow-sm hover:brightness-110"
              onClick={() => {
                socket.emit('challenge:accept', { id: incomingChallenge.id });
                setIncomingChallenge(null);
              }}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn btn-secondary !py-1 !px-3 text-xs text-forge-muted hover:text-forge-text"
              onClick={() => {
                socket.emit('challenge:decline', { id: incomingChallenge.id });
                setIncomingChallenge(null);
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}
      {error ? (
        <div className="border-b border-forge-danger/30 bg-forge-danger/10 px-4 py-2 text-center text-sm text-forge-danger flex items-center justify-center gap-3">
          <span>{error}</span>
          <button
            type="button"
            className="underline hover:text-forge-text text-xs ml-1"
            onClick={() => {
              clearError();
              void bootstrap();
            }}
          >
            Retry
          </button>
          <button
            type="button"
            className="text-xs text-forge-danger/70 hover:text-forge-text px-1"
            onClick={clearError}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ) : null}
      <main className="flex-1">
        {bootstrapped ? (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/g/:id" element={<GamePage />} />
            <Route path="/computer" element={<ComputerPage />} />
            <Route path="/analysis/:id" element={<AnalysisPage />} />
            <Route path="/u/:username" element={<ProfilePage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/verify" element={<VerifyEmailPage />} />
            <Route path="/reset" element={<ResetPasswordPage />} />
            <Route
              path="*"
              element={
                <div className="page py-24 text-center">
                  <h1 className="font-display text-4xl">Page not found</h1>
                  <p className="mt-3 text-forge-muted">That board has no such square.</p>
                  <Link to="/" className="btn btn-primary mt-6">
                    Back to the lobby
                  </Link>
                </div>
              }
            />
          </Routes>
        ) : (
          <div className="page flex h-[60vh] items-center justify-center">
            <div className="flex items-center gap-3 text-sm text-forge-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-forge-line border-t-forge-accent" />
              Setting up the board…
            </div>
          </div>
        )}
      </main>
      {isGamePage ? null : <Footer />}
    </div>
  );
}
