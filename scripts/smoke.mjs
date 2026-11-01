/**
 * End-to-end smoke test: two real sessions, one real game, real database.
 * Run the server first, then: node scripts/smoke.mjs
 */
import { io } from 'socket.io-client';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function newSession() {
  const res = await fetch(`${BASE}/api/me`);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const raw = setCookie[0] ?? res.headers.get('set-cookie') ?? '';
  const cookie = raw.split(';')[0];
  const data = await res.json();
  return { cookie, user: data.user };
}

function connect(cookie) {
  const socket = io(BASE, {
    transports: ['polling'],
    extraHeaders: { Cookie: cookie },
    reconnection: false,
  });
  return socket;
}

const waitFor = (socket, event, timeout = 8000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const waitForState = (socket, predicate, timeout = 8000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('game:state', handler);
      reject(new Error('timeout waiting for game state'));
    }, timeout);
    const handler = (state) => {
      if (predicate(state)) {
        clearTimeout(timer);
        socket.off('game:state', handler);
        resolve(state);
      }
    };
    socket.on('game:state', handler);
  });

const waitUntil = async (fn, timeout = 8000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('condition timed out');
};

async function main() {
  const health = await fetch(`${BASE}/api/healthz`).then((r) => r.json());
  check('health endpoint responds', health.ok === true, JSON.stringify(health));

  const [a, b] = await Promise.all([newSession(), newSession()]);
  check('guest sessions are distinct', a.user.id !== b.user.id, `${a.user.username} vs ${b.user.username}`);
  check('session cookie issued', Boolean(a.cookie), a.cookie.slice(0, 20));

  const createRes = await fetch(`${BASE}/api/games/room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
    body: JSON.stringify({ baseSec: 300, incSec: 3, rated: false, color: 'white' }),
  });
  const room = await createRes.json();
  check('room created', createRes.ok && typeof room.id === 'string', JSON.stringify(room));

  const socketA = connect(a.cookie);
  const statePromiseA = waitFor(socketA, 'game:state');
  socketA.emit('game:join', { gameId: room.id }, () => {});
  const stateA = await statePromiseA;
  check('creator seated as white', stateA.white?.id === a.user.id && stateA.black === null);

  const socketB = connect(b.cookie);
  const joined = waitFor(socketB, 'game:state');
  socketB.emit('game:join', { gameId: room.id }, () => {});
  const stateB = await joined;
  check('second player joined as black', stateB.black?.id === b.user.id, stateB.black?.username ?? 'none');
  check('game started when both seated', stateB.status === 'started', stateB.status);

  const started = await waitUntil(async () => {
    const snapshot = await fetch(`${BASE}/api/games/${room.id}`).then((r) => r.json());
    return snapshot.status === 'started' ? snapshot : null;
  });
  check('server reports a running game', started.status === 'started');

  // Play a short legal opening.
  socketA.emit('game:move', { gameId: room.id, uci: 'e2e4', ply: 0 });
  const e4State = await waitForState(socketB, (state) => state.ply >= 1);
  check('move applied and broadcast', e4State.ply === 1 && e4State.fen.includes('4P3'), `ply=${e4State.ply}`);

  socketB.emit('game:move', { gameId: room.id, uci: 'e7e5', ply: 1 });
  const e5State = await waitForState(socketA, (state) => state.ply >= 2);
  check('opponent move accepted', e5State.ply === 2);

  const illegal = waitFor(socketA, 'game:error');
  socketA.emit('game:move', { gameId: room.id, uci: 'e4e5', ply: 2 });
  const illegalError = await illegal;
  check('illegal move rejected by server', Boolean(illegalError.code), JSON.stringify(illegalError));

  const ended = waitFor(socketB, 'game:ended');
  socketA.emit('game:resign', { gameId: room.id });
  const end = await ended;
  check('resignation ends the game', end.result === 'black' && end.reason === 'resignation', `${end.result}/${end.reason}`);

  const stored = await fetch(`${BASE}/api/games/${room.id}`).then((r) => r.json());
  check('game persisted with moves', stored.moves.length === 2 && stored.status === 'finished', `moves=${stored.moves.length}`);

  const pgn = await fetch(`${BASE}/api/games/${room.id}/pgn`).then((r) => r.text());
  check('pgn available', pgn.includes('1. e4 e5'), pgn.split('\n').pop() ?? '');

  // Cross-origin mutation must be blocked.
  const blocked = await fetch(`${BASE}/api/games/room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie, Origin: 'https://evil.example' },
    body: JSON.stringify({ baseSec: 300, incSec: 3, rated: false, color: 'white' }),
  });
  check('foreign origin rejected', blocked.status === 403, `status=${blocked.status}`);

  // Unauthenticated socket must be refused.
  const anonymous = io(BASE, { transports: ['polling'], reconnection: false });
  const refused = await new Promise((resolve) => {
    anonymous.on('connect_error', (err) => resolve(err.message));
    anonymous.on('connect', () => resolve('connected'));
    setTimeout(() => resolve('timeout'), 4000);
  });
  check('socket requires a session', refused !== 'connected', String(refused));
  anonymous.close();

  socketA.close();
  socketB.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('smoke test crashed:', error);
  process.exitCode = 1;
});
