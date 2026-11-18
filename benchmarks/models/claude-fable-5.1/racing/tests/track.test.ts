import { describe, expect, it } from 'vitest';
import { TRACK_CFG } from '../src/config';
import { createLocation, Track } from '../src/sim/track';
import { GATE_FRACTIONS, OBSTACLE_LAYOUT, TRACK_POINTS } from '../src/sim/trackLayout';

const track = new Track(TRACK_POINTS, TRACK_CFG.sampleSpacing);

describe('track geometry', () => {
  it('is a long closed loop with evenly spaced samples', () => {
    expect(track.length).toBeGreaterThan(1000);
    expect(track.length).toBeLessThan(2200);
    expect(track.cum[track.count]).toBeCloseTo(track.length, 6);
    for (let i = 0; i < track.count; i++) {
      expect(track.segLen[i]).toBeGreaterThan(TRACK_CFG.sampleSpacing * 0.9);
      expect(track.segLen[i]).toBeLessThan(TRACK_CFG.sampleSpacing * 1.1);
      expect(Math.hypot(track.tx[i], track.tz[i])).toBeCloseTo(1, 6);
    }
  });

  it('has both left and right turns', () => {
    let left = 0;
    let right = 0;
    for (let i = 0; i < track.count; i++) {
      if (track.curvature[i] > 0.008) left++;
      if (track.curvature[i] < -0.008) right++;
    }
    expect(left).toBeGreaterThan(20);
    expect(right).toBeGreaterThan(20);
  });

  it('never bends tighter than the walls allow', () => {
    let maxCurvature = 0;
    for (let i = 0; i < track.count; i++) maxCurvature = Math.max(maxCurvature, Math.abs(track.curvature[i]));
    const minRadius = 1 / maxCurvature;
    expect(minRadius).toBeGreaterThan(TRACK_CFG.wallOffset + 8);
  });

  it('keeps separate parts of the circuit clear of each other', () => {
    const spacing = track.length / track.count;
    const skip = Math.ceil(120 / spacing);
    let minDist = Infinity;
    for (let i = 0; i < track.count; i++) {
      for (let j = i + skip; j < track.count; j++) {
        if (track.count - j + i < skip) continue;
        const dist = Math.hypot(track.px[i] - track.px[j], track.pz[i] - track.pz[j]);
        if (dist < minDist) minDist = dist;
      }
    }
    expect(minDist).toBeGreaterThan(TRACK_CFG.wallOffset * 2 + 20);
  });

  it('starts on a straight heading along +X', () => {
    expect(track.tx[0]).toBeGreaterThan(0.99);
    expect(Math.abs(track.curvatureAt(0))).toBeLessThan(0.004);
    expect(Math.abs(track.curvatureAt(track.length - 14))).toBeLessThan(0.004);
  });
});

describe('track queries', () => {
  it('round-trips pointAt -> locate', () => {
    const loc = createLocation();
    const p = { x: 0, z: 0 };
    for (const fraction of [0, 0.13, 0.37, 0.5, 0.71, 0.93, 0.999]) {
      for (const d of [-8, -3, 0, 4, 10]) {
        const s = fraction * track.length;
        track.pointAt(s, d, p);
        track.locate(p.x, p.z, -1, loc);
        expect(Math.abs(loc.d - d)).toBeLessThan(0.15);
        const ds = Math.abs(loc.s - s);
        expect(Math.min(ds, track.length - ds)).toBeLessThan(0.6);
      }
    }
  });

  it('gives the same answer with a local hint as with a global search', () => {
    const global = createLocation();
    const local = createLocation();
    const p = { x: 0, z: 0 };
    let hint = -1;
    for (let s = 0; s < track.length; s += 1.5) {
      track.pointAt(s, 5, p);
      track.locate(p.x, p.z, -1, global);
      track.locate(p.x, p.z, hint, local);
      hint = local.index;
      expect(local.s).toBeCloseTo(global.s, 6);
      expect(local.d).toBeCloseTo(global.d, 6);
    }
  });

  it('reports positive offsets on the left of the driving direction', () => {
    const loc = createLocation();
    // The track starts heading +X, so "left" is -Z.
    track.locate(track.px[0], track.pz[0] - 4, -1, loc);
    expect(loc.d).toBeCloseTo(4, 1);
    track.locate(track.px[0], track.pz[0] + 4, -1, loc);
    expect(loc.d).toBeCloseTo(-4, 1);
  });

  it('wraps distances around the loop', () => {
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    track.pointAt(25, 0, a);
    track.pointAt(25 + track.length, 0, b);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
    track.pointAt(-10, 0, a);
    track.pointAt(track.length - 10, 0, b);
    expect(a.x).toBeCloseTo(b.x, 6);
  });
});

describe('course layout', () => {
  it('has a finish line plus at least four ordered checkpoints spread around the lap', () => {
    expect(GATE_FRACTIONS[0]).toBe(0);
    expect(GATE_FRACTIONS.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < GATE_FRACTIONS.length; i++) {
      expect(GATE_FRACTIONS[i]).toBeGreaterThan(GATE_FRACTIONS[i - 1]);
      expect(GATE_FRACTIONS[i] - GATE_FRACTIONS[i - 1]).toBeGreaterThan(0.1);
    }
    expect(GATE_FRACTIONS[GATE_FRACTIONS.length - 1]).toBeLessThan(0.95);
  });

  it('has at least three hazards, all on the asphalt', () => {
    const hazards = OBSTACLE_LAYOUT.filter((o) => o.kind !== 'boost');
    expect(hazards.length).toBeGreaterThanOrEqual(3);
    expect(new Set(hazards.map((o) => o.kind)).size).toBeGreaterThanOrEqual(3);
    for (const o of OBSTACLE_LAYOUT) {
      expect(o.at).toBeGreaterThanOrEqual(0);
      expect(o.at).toBeLessThan(1);
      expect(Math.abs(o.d) + (o.amplitude ?? 0)).toBeLessThan(TRACK_CFG.roadHalfWidth);
    }
  });
});
