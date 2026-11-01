import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ProfileResponse } from '@shared/api';
import { api, ApiError } from '../lib/api';
import { GameRow } from '../components/GameRow';
import { useSession } from '../store/session';
import { categoryLabel } from '@shared/timeControl';
import { timeAgo } from '../lib/format';

const CATEGORIES = ['bullet', 'blitz', 'rapid', 'classical'] as const;

export default function ProfilePage() {
  const { username = '' } = useParams();
  const session = useSession((state) => state.user);
  const isMe = session?.username.toLowerCase() === username.toLowerCase();
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [friendMessage, setFriendMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .profile(username)
      .then((profile) => {
        if (alive) setData(profile);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Could not load this profile');
      });
    return () => {
      alive = false;
    };
  }, [username]);

  const addFriend = async () => {
    if (!data) return;
    setBusy(true);
    setFriendMessage(null);
    try {
      await api.requestFriend(data.user.username);
      setFriendMessage('Friend request sent.');
      setData({ ...data, friendState: 'requested' });
    } catch (err) {
      setFriendMessage(err instanceof ApiError ? err.message : 'Could not send the request');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="page py-24 text-center">
        <h1 className="font-display text-4xl">Player not found</h1>
        <p className="mt-3 text-forge-muted">{error}</p>
        <Link to="/" className="btn btn-primary mt-6">
          Back to the lobby
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page py-10">
        <div className="panel h-48 shimmer" />
      </div>
    );
  }

  const rating = data.user.ratings.blitz?.rating ?? data.user.ratings.rapid?.rating ?? 1500;

  return (
    <div className="page py-6">
      <div className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-16 w-16 place-items-center rounded-2xl border border-forge-line bg-forge-accent/10 font-display text-2xl uppercase text-forge-accent">
              {data.user.displayName.slice(0, 1)}
            </span>
            <div>
              <h1 className="font-display text-3xl">{data.user.displayName}</h1>
              <p className="mt-1 flex items-center gap-2 text-sm text-forge-muted">
                {data.online ? (
                  <span className="flex items-center gap-1.5 text-forge-success">
                    <span className="pulse-dot" /> online
                  </span>
                ) : (
                  <span>offline</span>
                )}
                <span>·</span>
                <span>joined {timeAgo(data.user.createdAt)}</span>
                {data.user.isGuest ? (
                  <>
                    <span>·</span>
                    <span className="text-forge-faint">guest account</span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isMe ? (
              <Link to="/settings" className="btn btn-secondary">
                Settings
              </Link>
            ) : data.friendState === 'friends' ? (
              <span className="chip">friends</span>
            ) : data.friendState === 'requested' ? (
              <span className="chip">request sent</span>
            ) : data.friendState === 'incoming' ? (
              <Link to="/friends" className="btn btn-secondary">
                Respond to request
              </Link>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => void addFriend()} disabled={busy}>
                Add friend
              </button>
            )}
            <Link to="/" className="btn btn-primary">
              Play
            </Link>
          </div>
        </div>

        {friendMessage ? <p className="mt-3 text-sm text-forge-muted">{friendMessage}</p> : null}

        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {CATEGORIES.map((category) => {
            const ratingEntry = data.user.ratings[category];
            return (
              <div key={category} className="rounded-xl border border-forge-line-soft bg-forge-bg/40 p-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-forge-faint">{categoryLabel(category)}</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="stat-value">{ratingEntry ? ratingEntry.rating : '—'}</span>
                  {ratingEntry?.provisional ? <span className="text-xs text-forge-faint">?</span> : null}
                </div>
                <div className="text-[11px] text-forge-faint">
                  {ratingEntry ? `${ratingEntry.games} games` : 'no games yet'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="panel p-4">
          <h2 className="font-display text-lg">This player</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-forge-muted">Rating</dt>
              <dd className="tabular-nums">{rating}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-forge-muted">Games</dt>
              <dd className="tabular-nums">{data.stats.games}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-forge-muted">Wins</dt>
              <dd className="tabular-nums text-forge-success">{data.stats.wins}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-forge-muted">Draws</dt>
              <dd className="tabular-nums">{data.stats.draws}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-forge-muted">Losses</dt>
              <dd className="tabular-nums text-forge-danger">{data.stats.losses}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-forge-faint">
            Ratings are Glicko-2 and provisional (marked with ?) until the rating deviation settles
            below 110. Provisional results move ratings quickly by design.
          </p>
        </div>

        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-forge-line-soft px-4 py-3">
            <h2 className="font-display text-lg">Recent games</h2>
            <span className="text-xs text-forge-faint">{data.games.length} shown</span>
          </div>
          {data.games.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-forge-muted">No finished games yet.</p>
          ) : (
            data.games.map((game) => <GameRow key={game.id} game={game} showPlayer={!isMe} />)
          )}
        </div>
      </div>
    </div>
  );
}
