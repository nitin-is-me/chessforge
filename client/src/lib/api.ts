import type { GameSnapshot, UserProfile, FriendsPayload } from '@shared/protocol';
import type {
  GamesResponse,
  MeResponse,
  ProfileResponse,
  RoomResponse,
} from '@shared/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init.headers,
    ...init,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    let message = 'Request failed';
    let code = 'error';
    if (typeof payload === 'object' && payload) {
      if ('message' in payload) message = String((payload as { message: string }).message);
      if ('error' in payload) code = String((payload as { error: string }).error);
    } else if (typeof payload === 'string' && payload.trim()) {
      const clean = payload.replace(/<[^>]*>/g, '').trim();
      if (clean && clean.length < 150) {
        message = clean;
      }
    }
    throw new ApiError(response.status, code, message);
  }

  return payload as T;
}

export const api = {
  me: () => request<MeResponse>('/me'),
  login: (username: string, password: string) =>
    request<{ user: UserProfile }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  signup: (username: string, password: string, email?: string) =>
    request<{ user: UserProfile }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, password, email: email ?? '' }),
    }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  myEmail: () => request<{ email: string | null; verified: boolean }>('/me/email'),
  requestEmailVerification: () =>
    request<{ ok: true; alreadyVerified?: boolean }>('/auth/email/verify', { method: 'POST' }),
  confirmEmail: (token: string) =>
    request<{ ok: true }>('/auth/email/confirm', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  requestPasswordReset: (email: string) =>
    request<{ ok: true }>('/auth/password/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>('/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  profile: (username: string) => request<ProfileResponse>(`/users/${encodeURIComponent(username)}`),
  myGames: () => request<GamesResponse>('/me/games'),
  game: (id: string) => request<GameSnapshot>(`/games/${id}`),
  pgn: async (id: string) => {
    const response = await fetch(`/api/games/${id}/pgn`, { credentials: 'same-origin' });
    return response.text();
  },
  createRoom: (baseSec: number, incSec: number, rated: boolean, color: 'white' | 'black' | 'random') =>
    request<RoomResponse>('/games/room', {
      method: 'POST',
      body: JSON.stringify({ baseSec, incSec, rated, color }),
    }),
  saveComputerGame: (payload: {
    baseSec: number;
    incSec: number;
    engineLevel: number;
    moves: string[];
    result: 'white' | 'black' | 'draw' | null;
    reason: string | null;
    playerColor: 'white' | 'black';
  }) =>
    request<{ id: string }>('/games/computer', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  friends: () => request<FriendsPayload>('/friends'),
  requestFriend: (username: string) =>
    request<FriendsPayload>('/friends/request', {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),
  respondFriend: (id: string, accept: boolean) =>
    request<FriendsPayload>('/friends/respond', {
      method: 'POST',
      body: JSON.stringify({ id, accept }),
    }),
  removeFriend: (id: string) =>
    request<FriendsPayload>(`/friends/${id}`, { method: 'DELETE' }),
  block: (username: string) =>
    request<FriendsPayload>('/blocks', {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),
  unblock: (id: string) =>
    request<FriendsPayload>(`/blocks/${id}`, { method: 'DELETE' }),
  report: (username: string, reason: string, gameId?: string) =>
    request<{ ok: true }>('/report', {
      method: 'POST',
      body: JSON.stringify({ username, reason, gameId }),
    }),
};
