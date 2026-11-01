/**
 * High-quality chess sounds using Web Audio API synthesis.
 * No external assets needed - all sounds generated programmatically.
 * Designed to be loud, crisp, and realistic.
 *
 * Sound design:
 * - Move: Sharp wooden "thock" ~220Hz with odd harmonics + micro click
 * - Capture: Deeper thock ~165Hz + bright impact click + body resonance
 * - Check: Clear bell tone (major 6th: C5+A5) with shimmer
 * - Castle: Two distinct thocks (king + rook)
 * - End: Descending minor chord resolving to low C
 * - Start: Ascending major chord
 * - Illegal: Low rough buzz with tremolo
 * - Notify: Soft bell for chat/draw offers
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

let context: AudioContext | null = null;
let muted = false;
let masterGain: GainNode | null = null;

try {
  muted = window.localStorage.getItem('chessforge:muted') === '1';
} catch {
  muted = false;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  if (masterGain) masterGain.gain.value = next ? 0 : 1;
  try {
    window.localStorage.setItem('chessforge:muted', next ? '1' : '0');
  } catch {
    // Ignore storage failures (private mode).
  }
}

function ensureContext(): AudioContext | null {
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    masterGain = context.createGain();
    masterGain.gain.value = muted ? 0 : 1;
    masterGain.connect(context.destination);
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const;

function unlockOnGesture(): void {
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === 'running') {
    for (const type of GESTURES) document.removeEventListener(type, unlockOnGesture);
    return;
  }
  void ctx.resume().then(() => {
    if (ctx.state !== 'running') return;
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    source.connect(ctx.destination);
    source.start();
    for (const type of GESTURES) document.removeEventListener(type, unlockOnGesture);
  });
}

let primed = false;

export function primeAudio(): void {
  if (primed || typeof document === 'undefined') return;
  primed = true;
  for (const type of GESTURES) document.addEventListener(type, unlockOnGesture, { passive: true });
}

/**
 * Creates a band-limited impulse (click) for percussive transients.
 */
function createClick(ctx: AudioContext, frequency: number, gain: number, delay: number): void {
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = 'sine';
  osc.frequency.value = frequency;
  filter.type = 'highpass';
  filter.frequency.value = frequency * 0.5;

  gainNode.gain.setValueAtTime(0, start);
  gainNode.gain.linearRampToValueAtTime(gain, start + 0.0005);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + 0.008);

  osc.connect(filter).connect(gainNode).connect(masterGain!);
  osc.start(start);
  osc.stop(start + 0.01);
}

/**
 * Plays a rich harmonic tone with proper ADSR envelope.
 * Uses additive synthesis for wood-like timbre.
 */
function playTone(ctx: AudioContext, options: {
  fundamental: number;
  duration: number;
  gain: number;
  delay?: number;
  harmonics?: number[];        // relative amplitudes [1st, 2nd, 3rd...]
  attack?: number;
  decay?: number;
  type?: OscillatorType;
}): void {
  const {
    fundamental,
    duration,
    gain,
    delay = 0,
    harmonics = [1, 0, 0.35, 0, 0.15, 0, 0.08], // odd harmonics = hollow wood sound
    attack = 0.003,
    decay = 0.95,
    type = 'triangle',
  } = options;

  const start = ctx.currentTime + delay;
  const masterGainNode = ctx.createGain();

  // ADSR envelope: fast attack, exponential decay
  masterGainNode.gain.setValueAtTime(0.0001, start);
  masterGainNode.gain.linearRampToValueAtTime(gain, start + attack);
  masterGainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration * decay);

  // Fundamental + harmonic series
  for (let i = 0; i < harmonics.length; i += 1) {
    const hGain = harmonics[i];
    if (hGain <= 0) continue;

    const osc = ctx.createOscillator();
    const hGainNode = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(fundamental * (i + 1), start);

    hGainNode.gain.setValueAtTime(0, start);
    hGainNode.gain.linearRampToValueAtTime(hGain * gain, start + attack * 0.5);
    hGainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration * decay);

    osc.connect(hGainNode).connect(masterGainNode);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  masterGainNode.connect(masterGain!);
}

/**
 * Filtered noise burst for impact clicks.
 */
function playNoiseBurst(ctx: AudioContext, options: {
  duration: number;
  gain: number;
  filterFreq: number;
  filterQ: number;
  delay?: number;
}): void {
  const { duration, gain, filterFreq, filterQ, delay = 0 } = options;
  const start = ctx.currentTime + delay;
  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  // Shaped noise with exponential decay
  for (let i = 0; i < frames; i += 1) {
    const envelope = Math.exp(-i / frames * 4);
    data[i] = (Math.random() * 2 - 1) * envelope;
  }

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gainNode = ctx.createGain();

  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;
  filter.Q.value = filterQ;

  gainNode.gain.setValueAtTime(0, start);
  gainNode.gain.linearRampToValueAtTime(gain, start + 0.0005);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.buffer = buffer;
  source.connect(filter).connect(gainNode).connect(masterGain!);
  source.start(start);
}

/**
 * Plays a chord (multiple sine waves).
 */
function playChord(ctx: AudioContext, frequencies: number[], duration: number, gain: number, delay: number): void {
  const start = ctx.currentTime + delay;
  const masterGainNode = ctx.createGain();
  masterGainNode.gain.setValueAtTime(0.0001, start);
  masterGainNode.gain.linearRampToValueAtTime(gain, start + 0.05);
  masterGainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  for (const freq of frequencies) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);
    gainNode.gain.value = gain / frequencies.length;
    osc.connect(gainNode).connect(masterGainNode);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }
  masterGainNode.connect(masterGain!);
}

export function playSound(name: SoundName): void {
  const ctx = ensureContext();
  if (!ctx || !masterGain) return;

  switch (name) {
    case 'move': {
      // Sharp wooden thock ~220Hz (A3) with odd harmonics only
      playTone(ctx, {
        fundamental: 220,
        duration: 0.065,
        gain: 0.35,
        harmonics: [1, 0, 0.4, 0, 0.18, 0, 0.09],
        attack: 0.001,
        decay: 0.9,
      });
      // Micro contact click
      createClick(ctx, 4500, 0.12, 0);
      break;
    }
    case 'capture': {
      // Deeper thock ~165Hz (E3) - heavier piece
      playTone(ctx, {
        fundamental: 165,
        duration: 0.1,
        gain: 0.4,
        harmonics: [1, 0, 0.45, 0, 0.22, 0, 0.12],
        attack: 0.0015,
        decay: 0.92,
      });
      // Bright impact click
      createClick(ctx, 3800, 0.25, 0.001);
      // Body resonance
      playTone(ctx, {
        fundamental: 82, // E2
        duration: 0.18,
        gain: 0.08,
        delay: 0.005,
        harmonics: [1, 0.1, 0.05],
        attack: 0.01,
        decay: 0.8,
      });
      break;
    }
    case 'check': {
      // Clear bell: C5 (523Hz) + A5 (880Hz) = major 6th
      playTone(ctx, { fundamental: 523.25, duration: 0.14, gain: 0.25, attack: 0.002, harmonics: [1, 0.05] });
      playTone(ctx, { fundamental: 880, duration: 0.18, gain: 0.18, delay: 0.05, attack: 0.002, harmonics: [1, 0.03] });
      // Shimmer
      playTone(ctx, { fundamental: 1046.5, duration: 0.08, gain: 0.06, delay: 0.12, attack: 0.002 });
      break;
    }
    case 'castle': {
      // Two distinct thocks for king + rook
      playTone(ctx, { fundamental: 200, duration: 0.06, gain: 0.3, harmonics: [1, 0, 0.35, 0, 0.15], attack: 0.001 });
      createClick(ctx, 4200, 0.1, 0);
      playTone(ctx, { fundamental: 200, duration: 0.06, gain: 0.3, delay: 0.075, harmonics: [1, 0, 0.35, 0, 0.15], attack: 0.001 });
      createClick(ctx, 4200, 0.1, 0.075);
      break;
    }
    case 'end': {
      // Descending minor chord: C4 - Eb4 - G4 - C5
      playChord(ctx, [261.63, 311.13, 392, 523.25], 0.7, 0.15, 0);
      // Final resolution to low C
      playTone(ctx, { fundamental: 130.81, duration: 0.5, gain: 0.1, delay: 0.6, harmonics: [1, 0.2], attack: 0.02 });
      break;
    }
    case 'start': {
      // Ascending major chord: C4 - E4 - G4 - C5
      playChord(ctx, [261.63, 329.63, 392, 523.25], 0.55, 0.15, 0);
      break;
    }
    case 'illegal': {
      // Low rough buzz with tremolo
      const start = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.value = 110; // A2
      lfo.type = 'sine';
      lfo.frequency.value = 28; // 28Hz tremolo
      lfoGain.gain.value = 40; // frequency modulation depth

      lfo.connect(lfoGain).connect(osc.frequency);
      osc.connect(gainNode).connect(masterGain);

      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.linearRampToValueAtTime(0.12, start + 0.008);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);

      osc.start(start);
      lfo.start(start);
      osc.stop(start + 0.25);
      lfo.stop(start + 0.25);
      break;
    }
    case 'notify': {
      // Soft bell for chat/draw offers
      playTone(ctx, { fundamental: 660, duration: 0.16, gain: 0.12, attack: 0.003, harmonics: [1, 0.03] });
      playTone(ctx, { fundamental: 880, duration: 0.2, gain: 0.09, delay: 0.08, attack: 0.003, harmonics: [1, 0.02] });
      break;
    }
  }
}

// Volume control
export function setVolume(volume: number): void {
  if (masterGain) masterGain.gain.value = muted ? 0 : Math.max(0, Math.min(1, volume));
}