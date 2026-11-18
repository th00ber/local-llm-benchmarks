import { describe, expect, it } from 'vitest';
import { formatTime, toKmh } from '../src/sim/format';
import { approach, clamp, createRng, damp, dampAngle, mod, wrapAngle, wrapDist } from '../src/sim/math';

describe('math helpers', () => {
  it('clamps values', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('computes a positive modulo', () => {
    expect(mod(-1, 10)).toBe(9);
    expect(mod(11, 10)).toBe(1);
    expect(mod(0, 10)).toBe(0);
  });

  it('wraps angles to (-PI, PI]', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI * 0.5);
    expect(wrapAngle(0.25)).toBeCloseTo(0.25);
  });

  it('wraps loop distances to the shortest signed delta', () => {
    expect(wrapDist(990, 1000)).toBeCloseTo(-10);
    expect(wrapDist(-990, 1000)).toBeCloseTo(10);
    expect(wrapDist(20, 1000)).toBeCloseTo(20);
  });

  it('damps independently of the step size', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 10, 4, 1 / 60);
    let b = 0;
    for (let i = 0; i < 240; i++) b = damp(b, 10, 4, 1 / 240);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeGreaterThan(9.7);
  });

  it('damps angles the short way round', () => {
    const next = dampAngle(Math.PI - 0.1, -Math.PI + 0.1, 5, 0.1);
    expect(next).toBeGreaterThan(Math.PI - 0.1);
  });

  it('approaches a target without overshooting', () => {
    expect(approach(0, 1, 0.3)).toBeCloseTo(0.3);
    expect(approach(0.9, 1, 0.3)).toBe(1);
    expect(approach(0, -1, 0.3)).toBeCloseTo(-0.3);
  });

  it('creates deterministic random sequences', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 20; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('formatting', () => {
  it('formats race times as M:SS.mmm', () => {
    expect(formatTime(0)).toBe('0:00.000');
    expect(formatTime(7.25)).toBe('0:07.250');
    expect(formatTime(67.345)).toBe('1:07.345');
    expect(formatTime(600.001)).toBe('10:00.001');
  });

  it('handles invalid times', () => {
    expect(formatTime(Number.NaN)).toBe('-:--.---');
    expect(formatTime(-1)).toBe('-:--.---');
  });

  it('converts m/s to km/h', () => {
    expect(toKmh(10)).toBeCloseTo(36);
    expect(toKmh(-10)).toBeCloseTo(36);
  });
});
