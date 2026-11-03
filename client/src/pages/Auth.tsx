import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../store/session';

interface LocationState {
  from?: string;
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="page flex min-h-[70vh] items-center justify-center py-10">
      <div className="w-full max-w-md">
        <div className="panel p-6 sm:p-8">
          <span className="chip chip-accent">ChessForge</span>
          <h1 className="mt-4 font-display text-3xl">{title}</h1>
          <p className="mt-1.5 text-sm text-forge-muted">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-4 text-center text-sm text-forge-muted">{footer}</p>
      </div>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useSession((state) => state.setUser);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as LocationState | null)?.from ?? '/';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(username.trim(), password);
      setUser(result.user);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to keep your ratings, history and friends."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" state={{ from }} className="link">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="login-username">
            Username
          </label>
          <input
            id="login-username"
            className="field"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </div>
        <div>
          <label className="label flex items-center justify-between" htmlFor="login-password">
            <span>Password</span>
            <Link to="/reset" className="text-[11px] font-normal normal-case tracking-normal text-forge-muted hover:text-forge-accent">
              Forgot password?
            </Link>
          </label>
          <input
            id="login-password"
            type="password"
            className="field"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        {error ? <p className="rounded-lg border border-forge-danger/30 bg-forge-danger/10 px-3 py-2 text-sm text-forge-danger">{error}</p> : null}
        <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useSession((state) => state.setUser);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A guest who was reviewing a game lands back on it, so the game can be kept.
  const from = (location.state as LocationState | null)?.from;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.signup(username.trim(), password, email.trim() || undefined);
      setUser(result.user);
      navigate(from ?? '/welcome', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Ratings, history and friends are kept per account. Your guest games stay with you."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" state={{ from }} className="link">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="signup-username">
            Username
          </label>
          <input
            id="signup-username"
            className="field"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            pattern="[a-zA-Z0-9_-]{3,20}"
            title="3-20 characters: letters, numbers, dashes, underscores"
            required
          />
          <p className="mt-1 text-xs text-forge-faint">3–20 characters. Letters, numbers, dashes, underscores.</p>
        </div>
        <div>
          <label className="label" htmlFor="signup-password">
            Password
          </label>
          <input
            id="signup-password"
            type="password"
            className="field"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <p className="mt-1 text-xs text-forge-faint">At least 8 characters. Hashed with scrypt.</p>
        </div>
        <div>
          <label className="label" htmlFor="signup-email">
            Email <span className="normal-case tracking-normal text-forge-faint">(optional)</span>
          </label>
          <input
            id="signup-email"
            type="email"
            className="field"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <p className="mt-1 text-xs text-forge-faint">
            Used for password recovery. We send a confirmation link; you can play without confirming.
          </p>
        </div>
        {error ? <p className="rounded-lg border border-forge-danger/30 bg-forge-danger/10 px-3 py-2 text-sm text-forge-danger">{error}</p> : null}
        <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
        <p className="text-center text-[11px] leading-relaxed text-forge-faint">
          No ads, no tracking, no email required to play.
        </p>
      </form>
    </AuthShell>
  );
}
