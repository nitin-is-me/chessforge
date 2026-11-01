import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const socket: GameSocket = io({
  autoConnect: false,
  withCredentials: true,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 12,
  reconnectionDelay: 600,
  reconnectionDelayMax: 4000,
});

let connecting: Promise<void> | null = null;

/**
 * Connects once, and resolves when the socket is usable. The REST bootstrap
 * must have run first so the session cookie exists.
 */
export function connectSocket(): Promise<void> {
  if (socket.connected) return Promise.resolve();
  if (connecting) return connecting;

  connecting = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Could not reach the game server'));
    }, 10_000);

    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };

    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
    socket.connect();
  }).finally(() => {
    connecting = null;
  });

  return connecting;
}
