/** Small allocation-free math helpers shared by the simulation and the view. */

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Positive modulo: result is always in [0, n). */
export function mod(value: number, n: number): number {
  const r = value % n;
  return r < 0 ? r + n : r;
}

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(angle: number): number {
  let a = angle % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Wraps a signed distance on a loop of the given length to (-length/2, length/2]. */
export function wrapDist(delta: number, length: number): number {
  let d = delta % length;
  if (d > length / 2) d -= length;
  else if (d <= -length / 2) d += length;
  return d;
}

/** Frame-rate independent exponential smoothing towards a target. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** Same as damp, but follows the shortest way around the circle. */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}

/** Moves current towards target by at most maxDelta. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Deterministic pseudo random generator (mulberry32), so the scenery is identical on every run. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
