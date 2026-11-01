import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { AuthShell } from './Auth';

function Feedback({ tone, children }: { tone: 'ok' | 'error' | 'muted'; children: React.ReactNode }) {
  const className =
    tone === 'error'
      ? 'border-forge-danger/30 bg-forge-danger/10 text-forge-danger'
      : tone === 'ok'
        ? 'border-forge-success/30 bg-forge-success/10 text-forge-success'
        : 'border-forge-line-soft bg-forge-bg/40 text-forge-muted';
  return <p className={`rounded-lg border px-3 py-2 text-sm ${className}`}>{children}</p>;
}

/**
 * Target of the verification link. The token is single-use and is consumed the
 * moment the page loads, so a refresh after success reports a spent link rather
 * than silently re-verifying.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
  const [message, setMessage] = useState(token ? '' : 'This link is missing its token.');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .confirmEmail(token)
      .then(() => {
        if (!cancelled) setState('done');
      })
      .catch((error) => {
        if (cancelled) return;
        setState('failed');
        setMessage(error instanceof ApiError ? error.message : 'Could not confirm this address');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthShell
      title="Confirm your email"
      subtitle="Confirmation lets us reach you about your account and password."
      footer={
        <>
          <Link to="/login" className="link">
            Go to sign in
          </Link>
        </>
      }
    >
      {state === 'working' ? (
        <Feedback tone="muted">Confirming your address…</Feedback>
      ) : state === 'done' ? (
        <Feedback tone="ok">Your email address is confirmed.</Feedback>
      ) : (
        <Feedback tone="error">{message}</Feedback>
      )}
    </AuthShell>
  );
}

function RequestResetForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the email');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email a single-use link that expires in 30 minutes."
      footer={
        <>
          Remembered it?{' '}
          <Link to="/login" className="link">
            Sign in
          </Link>
        </>
      }
    >
      {sent ? (
        <Feedback tone="ok">
          If that address belongs to an account, the link is on its way. Check your inbox in a
          minute.
        </Feedback>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="reset-email">
              Email
            </label>
            <input
              id="reset-email"
              type="email"
              className="field"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          {error ? <Feedback tone="error">{error}</Feedback> : null}
          <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

function SetNewPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset the password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Resetting signs you out everywhere, so any stolen session stops working."
      footer={
        <>
          <Link to="/login" className="link">
            Back to sign in
          </Link>
        </>
      }
    >
      {done ? (
        <div className="space-y-4">
          <Feedback tone="ok">Your password has been changed.</Feedback>
          <Link to="/login" className="btn btn-primary w-full py-2.5">
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="reset-password">
              New password
            </label>
            <input
              id="reset-password"
              type="password"
              className="field"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="reset-confirm">
              Repeat password
            </label>
            <input
              id="reset-confirm"
              type="password"
              className="field"
              autoComplete="new-password"
              minLength={8}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </div>
          {error ? <Feedback tone="error">{error}</Feedback> : null}
          <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
            {busy ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  return token ? <SetNewPasswordForm token={token} /> : <RequestResetForm />;
}
