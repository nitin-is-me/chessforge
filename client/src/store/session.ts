import { create } from 'zustand';
import type { UserProfile } from '@shared/protocol';
import { api } from '../lib/api';

interface SessionState {
  user: UserProfile | null;
  guest: boolean;
  loading: boolean;
  error: string | null;
  bootstrapped: boolean;
  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (user: UserProfile, guest?: boolean) => void;
  logout: () => Promise<void>;
  clearError: () => void;
}

/**
 * Single-flight bootstrap. React StrictMode mounts effects twice in
 * development; two concurrent /api/me calls would each mint a guest identity
 * and the cookie/socket would disagree about who the player is.
 */
let bootstrapPromise: Promise<void> | null = null;

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  guest: true,
  loading: true,
  error: null,
  bootstrapped: false,

  async bootstrap() {
    if (get().bootstrapped && get().user) return;
    if (bootstrapPromise) return bootstrapPromise;
    set({ loading: true, error: null });
    bootstrapPromise = (async () => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const data = await api.me();
          set({ user: data.user, guest: data.guest, loading: false, bootstrapped: true, error: null });
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
          }
        }
      }
      set({
        loading: false,
        bootstrapped: true,
        error: lastError instanceof Error ? lastError.message : 'Could not reach the server',
      });
    })().finally(() => {
      bootstrapPromise = null;
    });
    return bootstrapPromise;
  },

  clearError() {
    set({ error: null });
  },

  async refresh() {
    try {
      const data = await api.me();
      set({ user: data.user, guest: data.guest, error: null });
    } catch {
      // Keep the previous session on transient failures.
    }
  },

  setUser(user, guest = false) {
    set({ user, guest, loading: false, error: null });
  },

  async logout() {
    try {
      await api.logout();
    } finally {
      const data = await api.me();
      set({ user: data.user, guest: data.guest });
    }
  },
}));
