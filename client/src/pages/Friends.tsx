import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ChallengeView, FriendsPayload } from '@shared/protocol';
import { api, ApiError } from '../lib/api';
import { connectSocket, socket } from '../lib/socket';
import { useSession } from '../store/session';
import { usePreferences } from '../store/preferences';
import { PRESETS } from '@shared/timeControl';

export default function FriendsPage() {
  const navigate = useNavigate();
  const { user, guest } = useSession();
  const theme = usePreferences((state) => state.boardTheme);
  const [data, setData] = useState<FriendsPayload | null>(null);
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState('5+3');
  const [challenge, setChallenge] = useState<ChallengeView | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[5]!;

  useEffect(() => {
    if (guest) return;
    let alive = true;
    api
      .friends()
      .then((payload) => {
        if (alive) setData(payload);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Could not load friends');
      });
    void connectSocket();
    return () => {
      alive = false;
    };
  }, [guest]);

  useEffect(() => {
    const onUpdate = (payload: FriendsPayload) => setData(payload);
    const onPresence = (payload: { userId: string; online: boolean; playing: boolean }) => {
      setData((previous) => {
        if (!previous) return previous;
        const update = (list: FriendsPayload['friends']) =>
          list.map((friend) =>
            friend.id === payload.userId ? { ...friend, online: payload.online, playing: payload.playing } : friend,
          );
        return {
          friends: update(previous.friends),
          incoming: update(previous.incoming),
          outgoing: update(previous.outgoing),
          blocked: previous.blocked ? update(previous.blocked) : [],
        };
      });
    };
    const onChallenge = (payload: ChallengeView) => setChallenge(payload);
    const onCancelled = () => setChallenge(null);
    const onAccepted = (payload: { gameId: string }) => {
      setSentTo(null);
      navigate(`/g/${payload.gameId}`);
    };

    socket.on('friends:update', onUpdate);
    socket.on('presence:update', onPresence);
    socket.on('challenge:received', onChallenge);
    socket.on('challenge:cancelled', onCancelled);
    socket.on('challenge:accepted', onAccepted);
    return () => {
      socket.off('friends:update', onUpdate);
      socket.off('presence:update', onPresence);
      socket.off('challenge:received', onChallenge);
      socket.off('challenge:cancelled', onCancelled);
      socket.off('challenge:accepted', onAccepted);
    };
  }, [navigate]);

  if (guest) {
    return (
      <div className="page py-24 text-center">
        <h1 className="font-display text-4xl">Friends need an account</h1>
        <p className="mx-auto mt-3 max-w-md text-forge-muted">
          Guest accounts cannot add friends, send challenges, or chat. Creating an account keeps your
          game history and rating.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/signup" className="btn btn-primary">
            Create account
          </Link>
          <Link to="/login" className="btn btn-secondary">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const addFriend = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    try {
      const payload = await api.requestFriend(username.trim());
      setData(payload);
      setUsername('');
      setMessage('Request sent.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the request');
    }
  };

  const respond = async (id: string, accept: boolean) => {
    try {
      setData(await api.respondFriend(id, accept));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not respond');
    }
  };

  const block = async (username: string) => {
    try {
      setData(await api.block(username));
      setMessage('Player blocked.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not block');
    }
  };

  const unblock = async (id: string) => {
    try {
      setData(await api.unblock(id));
      setMessage('Player unblocked.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not unblock');
    }
  };

  const remove = async (id: string) => {
    try {
      setData(await api.removeFriend(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove');
    }
  };

  const sendChallenge = async (friendUsername: string) => {
    setSentTo(friendUsername);
    setMessage(null);
    setError(null);
    try {
      await connectSocket();
      socket.emit('challenge:send', {
        username: friendUsername,
        baseSec: preset.baseSec,
        incSec: preset.incSec,
        rated: false,
      });
    } catch {
      setError('Could not reach the game server');
    }
  };

  return (
    <div className="page py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Friends</h1>
          <p className="mt-1 text-sm text-forge-muted">
            Challenge friends directly, or watch their presence while you play.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={presetId}
            onChange={(event) => setPresetId(event.target.value)}
            className="field !w-auto !py-2 !text-sm"
            aria-label="Challenge time control"
          >
            {PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {challenge ? (
        <div className="panel mt-4 flex flex-wrap items-center justify-between gap-3 border-forge-accent/30 p-4">
          <div>
            <p className="font-medium">
              {challenge.from.displayName} challenges you
            </p>
            <p className="text-sm text-forge-muted">
              {challenge.baseSec / 60}+{challenge.incSec} · {challenge.category}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                socket.emit('challenge:accept', { id: challenge.id });
                setChallenge(null);
              }}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                socket.emit('challenge:decline', { id: challenge.id });
                setChallenge(null);
              }}
            >
              Decline
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-forge-line-soft px-4 py-3">
              <h2 className="font-display text-lg">Friends</h2>
              <span className="text-xs text-forge-faint">{data?.friends.length ?? 0}</span>
            </div>
            {!data || data.friends.length === 0 ? (
              <p className="px-4 py-8 text-sm text-forge-muted">
                No friends yet. Add someone by username to challenge them directly.
              </p>
            ) : (
              data.friends.map((friend) => (
                <div key={friend.id} className="flex items-center gap-3 border-b border-forge-line-soft px-4 py-2.5 last:border-0">
                  <span className={`h-2 w-2 rounded-full ${friend.online ? 'bg-forge-success' : 'bg-forge-line'}`} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/u/${friend.username}`} className="truncate text-sm font-medium hover:text-forge-accent">
                      {friend.displayName}
                    </Link>
                    <div className="text-xs text-forge-muted">
                      {friend.online ? (friend.playing ? 'playing' : 'idle') : 'offline'}
                      {friend.ratings.blitz ? ` · blitz ${friend.ratings.blitz.rating}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary !px-2 !py-1 text-xs"
                    onClick={() => void sendChallenge(friend.username)}
                    disabled={!friend.online}
                  >
                    {sentTo === friend.username ? 'Sent' : 'Challenge'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost !px-2 !py-1 text-xs"
                    onClick={() => void remove(friend.id)}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger !px-2 !py-1 text-xs"
                    onClick={() => void block(friend.username)}
                  >
                    Block
                  </button>
                </div>
              ))
            )}
          </div>

          {data && data.incoming.length > 0 ? (
            <div className="panel overflow-hidden">
              <div className="border-b border-forge-line-soft px-4 py-3">
                <h2 className="font-display text-lg">Requests</h2>
              </div>
              {data.incoming.map((person) => (
                <div key={person.id} className="flex items-center justify-between gap-3 border-b border-forge-line-soft px-4 py-2.5 last:border-0">
                  <Link to={`/u/${person.username}`} className="text-sm hover:text-forge-accent">
                    {person.displayName}
                  </Link>
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-primary !px-2 !py-1 text-xs" onClick={() => void respond(person.id, true)}>
                      Accept
                    </button>
                    <button type="button" className="btn btn-secondary !px-2 !py-1 text-xs" onClick={() => void respond(person.id, false)}>
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {data && data.outgoing.length > 0 ? (
            <div className="panel p-4">
              <h2 className="font-display text-lg">Sent requests</h2>
              <p className="mt-1 text-sm text-forge-muted">
                Waiting on: {data.outgoing.map((person) => person.displayName).join(', ')}
              </p>
            </div>
          ) : null}

          {data && data.blocked && data.blocked.length > 0 ? (
            <div className="panel overflow-hidden">
              <div className="border-b border-forge-line-soft px-4 py-3">
                <h2 className="font-display text-lg">Blocked</h2>
              </div>
              {data.blocked.map((person) => (
                <div key={person.id} className="flex items-center justify-between gap-3 border-b border-forge-line-soft px-4 py-2.5 last:border-0">
                  <Link to={`/u/${person.username}`} className="text-sm hover:text-forge-accent">
                    {person.displayName}
                  </Link>
                  <button
                    type="button"
                    className="btn btn-secondary !px-2 !py-1 text-xs"
                    onClick={() => void unblock(person.id)}
                  >
                    Unblock
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="space-y-4">
          <div className="panel p-4">
            <h2 className="font-display text-lg">Add a friend</h2>
            <form onSubmit={addFriend} className="mt-3 space-y-2">
              <input
                className="field"
                placeholder="Username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
              <button type="submit" className="btn btn-secondary w-full">
                Send request
              </button>
            </form>
            {message ? <p className="mt-2 text-sm text-forge-success">{message}</p> : null}
            {error ? <p className="mt-2 text-sm text-forge-danger">{error}</p> : null}
          </div>

          <div className="panel p-4">
            <h2 className="font-display text-lg">Your rating</h2>
            <p className="mt-1 text-sm text-forge-muted">
              Challenges use your {preset.category} rating of{' '}
              {user?.ratings[preset.category]?.rating ?? 'unrated'}. Challenge games are casual by
              default.
            </p>
            <div className="mt-3 rounded-lg border border-forge-line-soft bg-forge-bg/50 p-3 text-xs text-forge-faint">
              Board theme: <span className="text-forge-text">{theme}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
