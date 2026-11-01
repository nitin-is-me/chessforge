import { describe, expect, it } from 'vitest';
import {
  classifyTimeControl,
  estimatedDurationSec,
  formatTimeControl,
  isRatedAllowed,
  isValidTimeControl,
  PRESETS,
} from '../shared/timeControl.js';

describe('time control classification', () => {
  it('estimates duration as base + 40 increments', () => {
    expect(estimatedDurationSec({ baseSec: 300, incSec: 3 })).toBe(420);
    expect(estimatedDurationSec({ baseSec: 60, incSec: 0 })).toBe(60);
  });

  it('classifies at the documented boundaries', () => {
    expect(classifyTimeControl({ baseSec: 179, incSec: 0 })).toBe('bullet');
    expect(classifyTimeControl({ baseSec: 180, incSec: 0 })).toBe('blitz');
    expect(classifyTimeControl({ baseSec: 479, incSec: 0 })).toBe('blitz');
    expect(classifyTimeControl({ baseSec: 480, incSec: 0 })).toBe('rapid');
    expect(classifyTimeControl({ baseSec: 1499, incSec: 0 })).toBe('rapid');
    expect(classifyTimeControl({ baseSec: 1500, incSec: 0 })).toBe('classical');
  });

  it('classifies common presets', () => {
    expect(classifyTimeControl({ baseSec: 60, incSec: 0 })).toBe('bullet');
    expect(classifyTimeControl({ baseSec: 120, incSec: 1 })).toBe('bullet');
    expect(classifyTimeControl({ baseSec: 180, incSec: 2 })).toBe('blitz');
    expect(classifyTimeControl({ baseSec: 300, incSec: 3 })).toBe('blitz');
    expect(classifyTimeControl({ baseSec: 600, incSec: 5 })).toBe('rapid');
    expect(classifyTimeControl({ baseSec: 900, incSec: 10 })).toBe('rapid');
    expect(classifyTimeControl({ baseSec: 1800, incSec: 0 })).toBe('classical');
  });

  it('marks classical as casual only', () => {
    expect(isRatedAllowed({ baseSec: 1800, incSec: 0 })).toBe(false);
    expect(isRatedAllowed({ baseSec: 300, incSec: 3 })).toBe(true);
  });

  it('formats controls like lichess', () => {
    expect(formatTimeControl({ baseSec: 300, incSec: 3 })).toBe('5+3');
    expect(formatTimeControl({ baseSec: 60, incSec: 0 })).toBe('1+0');
    expect(formatTimeControl({ baseSec: 1800, incSec: 0 })).toBe('30+0');
  });

  it('validates user supplied controls', () => {
    expect(isValidTimeControl({ baseSec: 300, incSec: 3 })).toBe(true);
    expect(isValidTimeControl({ baseSec: 5, incSec: 0 })).toBe(false);
    expect(isValidTimeControl({ baseSec: 300, incSec: 500 })).toBe(false);
    expect(isValidTimeControl({ baseSec: 300.5, incSec: 0 })).toBe(false);
  });

  it('has unique, valid presets', () => {
    const ids = new Set(PRESETS.map((p) => p.id));
    expect(ids.size).toBe(PRESETS.length);
    for (const preset of PRESETS) {
      expect(isValidTimeControl(preset)).toBe(true);
      expect(preset.category).toBe(classifyTimeControl(preset));
    }
  });
});
