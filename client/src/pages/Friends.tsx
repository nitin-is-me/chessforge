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
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState('5+3');
  const [challenge, setChallenge] = useState<ChallengeView | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentPreset, setSentPreset] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [target, setTarget] = useState<FriendsPayload['friends'][number] | null>(null);
  const [dialogPreset, setDialogPreset] = useState('5+3');

  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[5]!;
  const dialogChosen = PRESETS.find((item) => item.id === dialogPreset) ?? preset;

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
      })
      .finally(() => {
        if (alive) setLoading(false);
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
      setSentPreset(null);
      navigate(`/g/${payload.gameId}`);
    };
    const onDeclined = (payload: { id: string; by: string }) => {
      setSentTo(null);
      setSentPreset(null);
      setNote(`${payload.by} declined your challenge.`);
    };
    const onExpired = () => {
      setSentTo(null);
      setSentPreset(null);
      setNote('That challenge expired without an answer.');
    };

    socket.on('friends:update', onUpdate);
    socket.on('presence:update', onPresence);
    socket.on('challenge:received', onChallenge);
    socket.on('challenge:cancelled', onCancelled);
    socket.on('challenge:accepted', onAccepted);
    socket.on('challenge:declined', onDeclined);
    socket.on('challenge:expired', onExpired);
    return () => {
      socket.off('friends:update', onUpdate);
      socket.off('presence:update', onPresence);
      socket.off('challenge:received', onChallenge);
      socket.off('challenge:cancelled', onCancelled);
      socket.off('challenge:accepted', onAccepted);
      socket.off('challenge:declined', onDeclined);
      socket.off('challenge:expired', onExpired);
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
    const chosen = dialogChosen;
    setTarget(null);
    setSentTo(friendUsername);
    setSentPreset(chosen.label);
    setNote(`Challenge sent to ${friendUsername} · ${chosen.label}`);
    setMessage(null);
    setError(null);
    try {
      await connectSocket();
      socket.emit('challenge:send', {
        username: friendUsername,
        baseSec: chosen.baseSec,
        incSec: chosen.incSec,
        rated: false,
      });
    } catch {
      setSentTo(null);
      setSentPreset(null);
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
          {note ? <p className="mt-1 text-sm text-forge-accent-strong">{note}</p> : null}
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

      {target ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-forge-line bg-forge-panel-2 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="font-display text-lg">Challenge {target.displayName}</h2>
            <p className="mt-1 text-sm text-forge-muted">
              Pick a time control. Challenges are casual and use your {dialogChosen.category} rating of{' '}
              {user?.ratings[dialogChosen.category]?.rating ?? 'unrated'}.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDialogPreset(item.id)}
                  aria-pressed={dialogPreset === item.id}
                  className={`rounded-lg border px-2 py-2 text-xs transition-colors ${
                    dialogPreset === item.id
                      ? 'border-forge-accent/60 bg-forge-accent/10 text-forge-accent'
                      : 'border-forge-line text-forge-muted hover:text-forge-text'
                  }`}
                >
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className="block text-[10px] uppercase tracking-[0.1em]">{item.category}</span>
                </button>
              ))}
            </div>
            <div className="mt-5 flex gap-2">
              <button type="button" className="btn btn-secondary flex-1" onClick={() => setTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary flex-1"
                onClick={() => void sendChallenge(target.username)}
              >
                Send challenge
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-forge-line-soft px-4 py-3">
              <h2 className="font-display text-lg">Friends</h2>
              <span className="text-xs text-forge-faint">{data ? data.friends.length : '–'}</span>
            </div>
            {!data ? (
              loading ? (
                <div className="px-4 py-4" aria-busy="true" aria-label="Loading friends">
                  {[0, 1].map((row) => (
                    <div key={row} className="flex animate-pulse items-center gap-3 py-2.5">
                      <span className="h-2 w-2 rounded-full bg-forge-line" />
                      <div className="flex-1 space-y-1.5">
                        <span className="block h-2.5 w-28 rounded bg-forge-line-soft" />
                        <span className="block h-2 w-16 rounded bg-forge-line-soft" />
                      </div>
                      <span className="h-6 w-16 rounded bg-forge-line-soft" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-8 text-sm text-forge-muted">
                  Could not load your friends. Refresh to try again.
                </p>
              )
            ) : data.friends.length === 0 ? (
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
                    onClick={() => {
                      setDialogPreset(presetId);
                      setTarget(friend);
                    }}
                    disabled={!friend.online || sentTo === friend.username}
                  >
                    {sentTo === friend.username ? (sentPreset ? `Sent · ${sentPreset}` : 'Sent') : 'Challenge'}
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
