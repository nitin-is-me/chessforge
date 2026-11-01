/**
 * UI fixture: creates a real game between two sessions and plays a fixed
 * opening slowly, so a browser can watch it update live.
 * Prints FIXTURE_GAME <id> and FIXTURE_READY once the opening is on the board.
 */
import { io } from 'socket.io-client';

const BASE = process.env.FIXTURE_BASE ?? 'http://127.0.0.1:3000';
const MOVES = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'g8f6', 'e1g1', 'f8e7'];
const HOLD_MS = Number(process.env.FIXTURE_HOLD_MS ?? 180_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function session() {
  const response = await fetch(`${BASE}/api/me`);
  const cookie = (response.headers.getSetCookie?.()[0] ?? '').split(';')[0];
  const data = await response.json();
  return { cookie, user: data.user };
}

function connect(cookie) {
  return io(BASE, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie },
    reconnection: false,
  });
}

function waitForState(socket, predicate, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('game:state', handler);
      reject(new Error('timeout waiting for state'));
    }, timeout);
    const handler = (state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off('game:state', handler);
      resolve(state);
    };
    socket.on('game:state', handler);
  });
}

async function main() {
  const [a, b] = await Promise.all([session(), session()]);
  const room = await fetch(`${BASE}/api/games/room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
    body: JSON.stringify({ baseSec: 300, incSec: 3, rated: false, color: 'white' }),
  }).then((response) => response.json());

  const white = connect(a.cookie);
  const black = connect(b.cookie);

  white.emit('game:join', { gameId: room.id }, () => {});
  await waitForState(white, (state) => state.id === room.id);
  black.emit('game:join', { gameId: room.id }, () => {});
  await waitForState(black, (state) => state.status === 'started');

  for (let index = 0; index < MOVES.length; index += 1) {
    const mover = index % 2 === 0 ? white : black;
    const watcher = index % 2 === 0 ? black : white;
    mover.emit('game:move', { gameId: room.id, uci: MOVES[index], ply: index });
    await waitForState(watcher, (state) => state.ply === index + 1);
    await sleep(700);
  }

  console.log(`FIXTURE_GAME ${room.id}`);
  console.log('FIXTURE_READY');

  await sleep(HOLD_MS);
  white.emit('game:resign', { gameId: room.id });
  await sleep(1500);
  console.log('FIXTURE_FINISHED');
  white.close();
  black.close();
}

main().catch((error) => {
  console.error('fixture failed:', error);
  process.exitCode = 1;
});
