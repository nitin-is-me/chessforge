/**
 * Socket load test. Creates real games between paired guests and plays random
 * legal moves, reporting throughput and observed move latency.
 *
 * Usage:
 *   node loadtest/run.mjs
 *   CONCURRENCY=40 DURATION_MS=30000 node loadtest/run.mjs
 *
 * Base URL defaults to the local server; point LOAD_BASE at a staging host.
 */
import { io } from 'socket.io-client';
import { Chess } from 'chess.js';

const BASE = process.env.LOAD_BASE ?? 'http://127.0.0.1:3000';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const DURATION_MS = Number(process.env.DURATION_MS ?? 20_000);

const latencies = [];
let movesSent = 0;
let movesApplied = 0;
let gamesPlayed = 0;
let errors = 0;

async function newSession() {
  const response = await fetch(`${BASE}/api/me`);
  const cookie = (response.headers.getSetCookie?.() ?? [])[0]?.split(';')[0] ?? '';
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

/** Waits for a snapshot with a specific ply, registered before the move is sent. */
function waitForPly(socket, ply, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('game:state', handler);
      reject(new Error(`timeout waiting for ply ${ply}`));
    }, timeout);
    const handler = (state) => {
      if (state.ply !== ply) return;
      clearTimeout(timer);
      socket.off('game:state', handler);
      resolve(state);
    };
    socket.on('game:state', handler);
  });
}

function join(socket, gameId, predicate, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('game:state', handler);
      reject(new Error('timeout joining game'));
    }, timeout);
    const handler = (state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off('game:state', handler);
      resolve(state);
    };
    socket.on('game:state', handler);
    socket.emit('game:join', { gameId }, (ack) => {
      if (ack && ack.ok === false) {
        clearTimeout(timer);
        socket.off('game:state', handler);
        reject(new Error(ack.error?.message ?? 'join rejected'));
      }
    });
  });
}

async function runGame() {
  const [a, b] = await Promise.all([newSession(), newSession()]);
  const response = await fetch(`${BASE}/api/games/room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
    body: JSON.stringify({ baseSec: 300, incSec: 3, rated: false, color: 'white' }),
  });
  if (!response.ok) throw new Error(`room creation failed (${response.status})`);
  const room = await response.json();

  const white = connect(a.cookie);
  const black = connect(b.cookie);
  const chess = new Chess();

  try {
    await join(white, room.id, (state) => state.id === room.id);
    await join(black, room.id, (state) => state.status === 'started');

    const started = Date.now();
    let ply = 0;
    const endedPromise = new Promise((resolve) => {
      white.once('game:ended', resolve);
    });

    while (Date.now() - started < DURATION_MS && ply < 80) {
      const legal = chess.moves({ verbose: true });
      if (legal.length === 0) break;
      const move = legal[Math.floor(Math.random() * legal.length)];
      const socket = chess.turn() === 'w' ? white : black;
      const sentAt = Date.now();
      const pending = waitForPly(white, ply + 1);
      socket.emit('game:move', {
        gameId: room.id,
        uci: `${move.from}${move.to}${move.promotion ?? ''}`,
        ply,
      });
      movesSent += 1;
      chess.move(move);
      const state = await Promise.race([pending.catch(() => null), endedPromise.then(() => null)]);
      if (!state) break;
      latencies.push(Date.now() - sentAt);
      movesApplied += 1;
      ply = state.ply;
      if (state.status !== 'started') break;
    }

    if (ply % 2 === 0 && ply > 0) white.emit('game:resign', { gameId: room.id });
    gamesPlayed += 1;
  } catch (error) {
    errors += 1;
    console.error('game failed:', error.message);
  } finally {
    white.close();
    black.close();
  }
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function main() {
  console.log(`Load test: ${CONCURRENCY} concurrent games against ${BASE}`);
  const started = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => runGame()));
  const seconds = (Date.now() - started) / 1000;

  console.log('--- results ---');
  console.log(`duration          ${seconds.toFixed(1)}s`);
  console.log(`games played      ${gamesPlayed}`);
  console.log(`moves sent        ${movesSent}`);
  console.log(`moves applied     ${movesApplied}`);
  console.log(`moves/sec         ${(movesApplied / seconds).toFixed(1)}`);
  console.log(`errors            ${errors}`);
  console.log(`latency p50       ${percentile(latencies, 50)}ms`);
  console.log(`latency p95       ${percentile(latencies, 95)}ms`);
  console.log(`latency p99       ${percentile(latencies, 99)}ms`);

  if (errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
