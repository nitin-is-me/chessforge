import { create } from 'zustand';
import type { BoardTheme } from '../components/Board';
import { setMuted } from '../lib/sounds';

type Coordinates = 'on' | 'off';

interface PreferencesState {
  boardTheme: BoardTheme;
  coordinates: Coordinates;
  muted: boolean;
  setBoardTheme: (theme: BoardTheme) => void;
  setCoordinates: (value: Coordinates) => void;
  setMuted: (value: boolean) => void;
}

const read = <T extends string>(key: string, fallback: T): T => {
  try {
    const value = window.localStorage.getItem(key);
    return (value as T) ?? fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable.
  }
};

const initialTheme = read<BoardTheme>('chessforge:board', 'forge');
const initialMuted = read<string>('chessforge:muted', '0') === '1';
setMuted(initialMuted);

export const usePreferences = create<PreferencesState>((set) => ({
  boardTheme: initialTheme,
  coordinates: read<Coordinates>('chessforge:coords', 'on'),
  muted: initialMuted,

  setBoardTheme(theme) {
    write('chessforge:board', theme);
    set({ boardTheme: theme });
  },
  setCoordinates(value) {
    write('chessforge:coords', value);
    set({ coordinates: value });
  },
  setMuted(value) {
    write('chessforge:muted', value ? '1' : '0');
    setMuted(value);
    set({ muted: value });
  },
}));
