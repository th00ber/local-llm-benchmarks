import { clamp, mod } from './math';

export type Point2 = readonly [number, number];

/** Result of projecting a world position onto the track centreline. */
export interface TrackLocation {
  /** Index of the centreline segment the position projects onto (-1 = unknown). */
  index: number;
  /** Distance along the centreline from the start/finish line, in [0, length). */
  s: number;
  /** Signed lateral offset from the centreline. Positive = left of the driving direction. */
  d: number;
  /** Unit tangent (driving direction) at the projection. */
  tx: number;
  tz: number;
  /** Projected point on the centreline. */
  px: number;
  pz: number;
}

export function createLocation(): TrackLocation {
  return { index: -1, s: 0, d: 0, tx: 0, tz: 1, px: 0, pz: 0 };
}

export interface XZ {
  x: number;
  z: number;
}

/**
 * A closed race track described by a centreline on the XZ plane.
 *
 * The centreline is a closed centripetal Catmull-Rom spline through the control points,
 * resampled at (almost) uniform arc length. Conventions:
 *   - heading angle h: forward = (sin h, cos h)
 *   - left normal of a tangent (tx, tz) = (tz, -tx)
 */
export class Track {
  readonly count: number;
  readonly length: number;
  readonly px: Float64Array;
  readonly pz: Float64Array;
  /** Unit tangents at the samples. */
  readonly tx: Float64Array;
  readonly tz: Float64Array;
  /** Signed curvature (1/m) at the samples. Positive = left-hand bend. */
  readonly curvature: Float64Array;
  /** Cumulative distance at each sample; cum[count] === length. */
  readonly cum: Float64Array;
  readonly segLen: Float64Array;

  constructor(controlPoints: ReadonlyArray<Point2>, spacing = 2) {
    if (controlPoints.length < 4) throw new Error('A track needs at least 4 control points');

    const dense = sampleClosedCatmullRom(controlPoints, 48);
    const denseCount = dense.length / 2;

    // Cumulative length of the dense polyline.
    const denseCum = new Float64Array(denseCount + 1);
    for (let i = 0; i < denseCount; i++) {
      const j = (i + 1) % denseCount;
      denseCum[i + 1] = denseCum[i] + Math.hypot(dense[j * 2] - dense[i * 2], dense[j * 2 + 1] - dense[i * 2 + 1]);
    }
    const denseLength = denseCum[denseCount];

    // Resample at uniform arc length.
    const count = Math.max(16, Math.round(denseLength / spacing));
    this.count = count;
    this.px = new Float64Array(count);
    this.pz = new Float64Array(count);
    let k = 0;
    for (let i = 0; i < count; i++) {
      const target = (i / count) * denseLength;
      while (k < denseCount - 1 && denseCum[k + 1] < target) k++;
      const span = denseCum[k + 1] - denseCum[k];
      const u = span > 0 ? (target - denseCum[k]) / span : 0;
      const a = k;
      const b = (k + 1) % denseCount;
      this.px[i] = dense[a * 2] + (dense[b * 2] - dense[a * 2]) * u;
      this.pz[i] = dense[a * 2 + 1] + (dense[b * 2 + 1] - dense[a * 2 + 1]) * u;
    }

    this.segLen = new Float64Array(count);
    this.cum = new Float64Array(count + 1);
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      this.segLen[i] = Math.hypot(this.px[j] - this.px[i], this.pz[j] - this.pz[i]);
      this.cum[i + 1] = this.cum[i] + this.segLen[i];
    }
    this.length = this.cum[count];

    this.tx = new Float64Array(count);
    this.tz = new Float64Array(count);
    const rawCurvature = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const prev = (i - 1 + count) % count;
      const next = (i + 1) % count;
      const dx = this.px[next] - this.px[prev];
      const dz = this.pz[next] - this.pz[prev];
      const len = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;

      const ax = this.px[i] - this.px[prev];
      const az = this.pz[i] - this.pz[prev];
      const bx = this.px[next] - this.px[i];
      const bz = this.pz[next] - this.pz[i];
      // Signed turn angle: positive when the outgoing segment points to the left of the incoming one.
      const cross = bx * az - bz * ax;
      const dot = ax * bx + az * bz;
      const angle = Math.atan2(cross, dot);
      rawCurvature[i] = angle / ((this.segLen[prev] + this.segLen[i]) * 0.5);
    }

    // Light smoothing so speed advice and visuals do not react to sampling noise.
    this.curvature = new Float64Array(count);
    const radius = 3;
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let o = -radius; o <= radius; o++) sum += rawCurvature[(i + o + count) % count];
      this.curvature[i] = sum / (radius * 2 + 1);
    }
  }

  /** Index of the segment containing distance s. */
  indexAt(s: number): number {
    const sm = mod(s, this.length);
    let i = Math.min(this.count - 1, Math.floor((sm / this.length) * this.count));
    while (i > 0 && this.cum[i] > sm) i--;
    while (i < this.count - 1 && this.cum[i + 1] <= sm) i++;
    return i;
  }

  /** World position at distance s along the centreline, shifted sideways by d (positive = left). */
  pointAt(s: number, d: number, out: XZ): XZ {
    const sm = mod(s, this.length);
    const i = this.indexAt(sm);
    const j = (i + 1) % this.count;
    const u = this.segLen[i] > 0 ? (sm - this.cum[i]) / this.segLen[i] : 0;
    let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * u;
    let tz = this.tz[i] + (this.tz[j] - this.tz[i]) * u;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    out.x = this.px[i] + (this.px[j] - this.px[i]) * u + tz * d;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * u - tx * d;
    return out;
  }

  /** Unit tangent at distance s (written to out.x / out.z). */
  tangentAt(s: number, out: XZ): XZ {
    const sm = mod(s, this.length);
    const i = this.indexAt(sm);
    const j = (i + 1) % this.count;
    const u = this.segLen[i] > 0 ? (sm - this.cum[i]) / this.segLen[i] : 0;
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * u;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * u;
    const tl = Math.hypot(tx, tz) || 1;
    out.x = tx / tl;
    out.z = tz / tl;
    return out;
  }

  /** Heading angle (forward = (sin h, cos h)) of the driving direction at distance s. */
  headingAt(s: number): number {
    const i = this.indexAt(s);
    return Math.atan2(this.tx[i], this.tz[i]);
  }

  curvatureAt(s: number): number {
    return this.curvature[this.indexAt(s)];
  }

  /** Largest absolute curvature between s and s + distance. */
  maxCurvatureAhead(s: number, distance: number): number {
    const start = this.indexAt(s);
    const steps = Math.max(1, Math.ceil(distance / (this.length / this.count)));
    let max = 0;
    for (let o = 0; o <= steps; o++) {
      const c = Math.abs(this.curvature[(start + o) % this.count]);
      if (c > max) max = c;
    }
    return max;
  }

  /**
   * Projects a world position onto the centreline.
   * Pass the previous segment index as hint for a fast, continuity-preserving local search;
   * pass a negative hint for a global search (used after teleports / resets).
   */
  locate(x: number, z: number, hint: number, out: TrackLocation): TrackLocation {
    const n = this.count;
    let best = 0;
    let bestDist = Infinity;
    if (hint < 0) {
      for (let i = 0; i < n; i++) {
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const dist = dx * dx + dz * dz;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
    } else {
      const window = 14;
      for (let o = -window; o <= window; o++) {
        const i = (((hint + o) % n) + n) % n;
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const dist = dx * dx + dz * dz;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
    }

    // Refine on the two segments touching the nearest sample.
    const prev = (best - 1 + n) % n;
    let segIndex = best;
    let segU = 0;
    let segDist = Infinity;
    for (let c = 0; c < 2; c++) {
      const a = c === 0 ? prev : best;
      const b = (a + 1) % n;
      const ex = this.px[b] - this.px[a];
      const ez = this.pz[b] - this.pz[a];
      const lenSq = ex * ex + ez * ez;
      const u = lenSq > 0 ? clamp(((x - this.px[a]) * ex + (z - this.pz[a]) * ez) / lenSq, 0, 1) : 0;
      const qx = this.px[a] + ex * u;
      const qz = this.pz[a] + ez * u;
      const dist = (x - qx) * (x - qx) + (z - qz) * (z - qz);
      if (dist < segDist) {
        segDist = dist;
        segIndex = a;
        segU = u;
      }
    }

    const a = segIndex;
    const b = (a + 1) % n;
    let tx = this.tx[a] + (this.tx[b] - this.tx[a]) * segU;
    let tz = this.tz[a] + (this.tz[b] - this.tz[a]) * segU;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const qx = this.px[a] + (this.px[b] - this.px[a]) * segU;
    const qz = this.pz[a] + (this.pz[b] - this.pz[a]) * segU;

    out.index = a;
    out.s = mod(this.cum[a] + this.segLen[a] * segU, this.length);
    out.tx = tx;
    out.tz = tz;
    out.px = qx;
    out.pz = qz;
    // Left normal = (tz, -tx)
    out.d = (x - qx) * tz - (z - qz) * tx;
    return out;
  }
}

/**
 * Samples a closed centripetal Catmull-Rom spline. Returns a flat [x0, z0, x1, z1, ...] array
 * with `perSegment` points for each control point span.
 */
function sampleClosedCatmullRom(points: ReadonlyArray<Point2>, perSegment: number): Float64Array {
  const n = points.length;
  const out = new Float64Array(n * perSegment * 2);
  const alpha = 0.5;
  let w = 0;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const t0 = 0;
    const t1 = t0 + Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), alpha);
    const t2 = t1 + Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), alpha);
    const t3 = t2 + Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), alpha);
    for (let k = 0; k < perSegment; k++) {
      const t = t1 + ((t2 - t1) * k) / perSegment;
      for (let c = 0; c < 2; c++) {
        const a1 = ((t1 - t) / (t1 - t0)) * p0[c] + ((t - t0) / (t1 - t0)) * p1[c];
        const a2 = ((t2 - t) / (t2 - t1)) * p1[c] + ((t - t1) / (t2 - t1)) * p2[c];
        const a3 = ((t3 - t) / (t3 - t2)) * p2[c] + ((t - t2) / (t3 - t2)) * p3[c];
        const b1 = ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2;
        const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
        out[w++] = ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
      }
    }
  }
  return out;
}
