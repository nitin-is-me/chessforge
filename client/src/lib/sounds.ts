/**
 * Chess sounds.
 *
 * The recorded sounds come from PyChess's sound pack, licensed
 * GPL-3.0-or-later, peak-normalised so they sit at a consistent volume. They
 * live in `client/public/sounds` and are served from `/sounds`.
 *
 * `start` and `end` are synthesized chords: PyChess's start cue was a loud burst
 * of pieces being dropped, and its only game-over cues were win/lose/draw
 * variants, which were tried and then dropped in favour of one neutral chord.
 */

export type SoundName =
  | 'move'
  | 'capture'
  | 'check'
  | 'castle'
  | 'end'
  | 'start'
  | 'illegal'
  | 'notify';

const SAMPLE_FOR: Partial<Record<SoundName, string>> = {
  move: '/sounds/move.wav',
  capture: '/sounds/capture.wav',
  check: '/sounds/check.wav',
  castle: '/sounds/castle.wav',
  illegal: '/sounds/illegal.wav',
  notify: '/sounds/notify.wav',
};

let muted = false;
try {
  muted = window.localStorage.getItem('chessforge:muted') === '1';
} catch {
  muted = false;
}

let volume = 1;
const samples = new Map<string, HTMLAudioElement>();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage.setItem('chessforge:muted', next ? '1' : '0');
  } catch {
    // Ignore storage failures (private mode).
  }
}

export function setVolume(next: number): void {
  volume = Math.max(0, Math.min(1, next));
}

/** One shared element per file, used as a template that each play clones. */
function sample(url: string): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  let base = samples.get(url);
  if (!base) {
    base = new Audio(url);
    base.preload = 'auto';
    samples.set(url, base);
  }
  return base;
}

// --- synthesized chords for start/end -------------------------------------

let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

function playChord(frequencies: number[], duration: number, gain: number, delay = 0): void {
  const ctx = ensureContext();
  if (!ctx) return;

  const start = ctx.currentTime + delay;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, start);
  master.gain.linearRampToValueAtTime(gain * volume, start + 0.05);
  master.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  for (const frequency of frequencies) {
    const osc = ctx.createOscillator();
    const level = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, start);
    level.gain.value = 1 / frequencies.length;
    osc.connect(level).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }
  master.connect(ctx.destination);
}

export function playSound(name: SoundName): void {
  if (muted) return;

  const url = SAMPLE_FOR[name];
  if (url) {
    const base = sample(url);
    if (!base) return;
    // A fresh node per play, so two quick moves overlap instead of cutting
    // each other off mid-thock.
    const node = base.cloneNode() as HTMLAudioElement;
    node.volume = volume;
    void node.play().catch(() => undefined);
    return;
  }

  if (name === 'start') {
    // The old synthesized opening chord: short, quiet, nothing like a bag of
    // pieces being dropped on the table.
    playChord([261.63, 329.63, 392, 523.25], 0.55, 0.15);
    return;
  }

  // 'end': descending minor chord, resolving low.
  playChord([261.63, 311.13, 392, 523.25], 0.7, 0.15);
  playChord([130.81], 0.5, 0.1, 0.6);
}

let primed = false;

/**
 * Mobile browsers only allow audio after a gesture, and preloading a sample
 * does not count. Play every clip silently once on the first interaction so
 * later moves are instant.
 */
export function primeAudio(): void {
  if (primed || typeof document === 'undefined') return;
  primed = true;

  const unlock = () => {
    for (const url of new Set(Object.values(SAMPLE_FOR))) {
      const base = sample(url);
      if (!base) continue;
      base.muted = true;
      void base
        .play()
        .then(() => {
          base.pause();
          base.currentTime = 0;
          base.muted = false;
        })
        .catch(() => {
          base.muted = false;
        });
    }
    ensureContext();
    for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
      document.removeEventListener(type, unlock);
    }
  };

  for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
    document.addEventListener(type, unlock, { passive: true });
  }
}
