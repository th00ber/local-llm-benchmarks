import { CAR_CFG } from '../config';
import type { CarState } from './car';
import { clamp, TAU } from './math';
import type { Track } from './track';
import type { ObstaclePlacement } from './trackLayout';

/**
 * barrier - solid block, bounces the car and kills most of its speed
 * drone   - solid patrol drone sweeping across the road
 * cone    - light marker, gets knocked away and costs a little speed
 * oil     - slick: grip and steering are reduced for a moment
 * boost   - pad: short burst of extra acceleration and top speed
 */
export type ObstacleKind = 'barrier' | 'drone' | 'cone' | 'oil' | 'boost';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  /** Distance along the lap and lateral offset. */
  s: number;
  baseD: number;
  d: number;
  /** World position (updated every step for drones). */
  x: number;
  z: number;
  /** Centreline anchor and track tangent at s. */
  ax: number;
  az: number;
  tx: number;
  tz: number;
  /** Half extent across the road, half extent along the road, and corner radius. */
  halfWidth: number;
  halfDepth: number;
  radius: number;
  amplitude: number;
  period: number;
  phase: number;
  /** Cones: true once knocked away (until the race restarts). */
  hit: boolean;
  /** True while the car overlaps a trigger (oil / boost), to fire events once per pass. */
  inside: boolean;
}

export type ObstacleContact =
  | { type: 'crash'; obstacle: Obstacle; impact: number }
  | { type: 'cone'; obstacle: Obstacle }
  | { type: 'oil'; obstacle: Obstacle }
  | { type: 'boost'; obstacle: Obstacle };

const SHAPES: Record<ObstacleKind, { halfWidth: number; halfDepth: number; radius: number }> = {
  barrier: { halfWidth: 2.6, halfDepth: 0.7, radius: 0 },
  drone: { halfWidth: 0, halfDepth: 0, radius: 1.3 },
  cone: { halfWidth: 0, halfDepth: 0, radius: 0.45 },
  oil: { halfWidth: 0, halfDepth: 0, radius: 2.5 },
  boost: { halfWidth: 2.6, halfDepth: 3.5, radius: 0 },
};

const tmp = { x: 0, z: 0 };

export function createObstacles(track: Track, layout: ReadonlyArray<ObstaclePlacement>): Obstacle[] {
  return layout.map((placement, id) => {
    const s = placement.at * track.length;
    track.pointAt(s, 0, tmp);
    const ax = tmp.x;
    const az = tmp.z;
    track.tangentAt(s, tmp);
    const shape = SHAPES[placement.kind];
    const obstacle: Obstacle = {
      id,
      kind: placement.kind,
      s,
      baseD: placement.d,
      d: placement.d,
      x: 0,
      z: 0,
      ax,
      az,
      tx: tmp.x,
      tz: tmp.z,
      halfWidth: shape.halfWidth,
      halfDepth: shape.halfDepth,
      radius: shape.radius,
      amplitude: placement.amplitude ?? 0,
      period: placement.period ?? 1,
      phase: placement.phase ?? 0,
      hit: false,
      inside: false,
    };
    placeObstacle(obstacle, 0);
    return obstacle;
  });
}

/** Updates the lateral position of an obstacle for the given world time. */
export function placeObstacle(o: Obstacle, time: number): void {
  o.d = o.amplitude !== 0 ? o.baseD + o.amplitude * Math.sin((time / o.period) * TAU + o.phase) : o.baseD;
  // Left normal = (tz, -tx)
  o.x = o.ax + o.tz * o.d;
  o.z = o.az - o.tx * o.d;
}

export function resetObstacle(o: Obstacle): void {
  o.hit = false;
  o.inside = false;
  placeObstacle(o, 0);
}

/**
 * Tests the car against one obstacle and applies the gameplay consequence
 * (bounce, slowdown, slip, boost). Returns a contact description, or null.
 */
export function resolveObstacle(car: CarState, o: Obstacle): ObstacleContact | null {
  const dx = car.x - o.x;
  const dz = car.z - o.z;
  const reach = Math.max(o.halfWidth, o.halfDepth) + o.radius + CAR_CFG.bodyRadius;
  if (dx * dx + dz * dz > reach * reach) {
    o.inside = false;
    return null;
  }

  // Position of the car in the obstacle frame: u across the road (left), w along the road.
  const u = dx * o.tz - dz * o.tx;
  const w = dx * o.tx + dz * o.tz;

  switch (o.kind) {
    case 'oil': {
      const inside = dx * dx + dz * dz < o.radius * o.radius;
      const entered = inside && !o.inside;
      o.inside = inside;
      if (!inside) return null;
      car.slipTimer = CAR_CFG.slipDuration;
      return entered ? { type: 'oil', obstacle: o } : null;
    }
    case 'boost': {
      const inside = Math.abs(u) < o.halfWidth + 0.6 && Math.abs(w) < o.halfDepth;
      const entered = inside && !o.inside;
      o.inside = inside;
      if (!inside) return null;
      car.boostTimer = CAR_CFG.boostDuration;
      return entered ? { type: 'boost', obstacle: o } : null;
    }
    case 'cone': {
      if (o.hit) return null;
      const r = o.radius + CAR_CFG.bodyRadius * 0.85;
      if (dx * dx + dz * dz > r * r) return null;
      o.hit = true;
      car.vx *= 0.9;
      car.vz *= 0.9;
      return { type: 'cone', obstacle: o };
    }
    case 'barrier':
    case 'drone': {
      // Circle (car) against a rounded box (obstacle).
      const cu = clamp(u, -o.halfWidth, o.halfWidth);
      const cw = clamp(w, -o.halfDepth, o.halfDepth);
      let nu = u - cu;
      let nw = w - cw;
      const r = o.radius + CAR_CFG.bodyRadius;
      const distSq = nu * nu + nw * nw;
      if (distSq >= r * r) return null;

      const dist = Math.sqrt(distSq);
      let penetration: number;
      if (dist > 1e-5) {
        nu /= dist;
        nw /= dist;
        penetration = r - dist;
      } else {
        // Car centre inside the box: push out through the nearest face.
        const du = o.halfWidth - Math.abs(u);
        const dw = o.halfDepth - Math.abs(w);
        if (dw <= du) {
          nu = 0;
          nw = w >= 0 ? 1 : -1;
          penetration = dw + r;
        } else {
          nu = u >= 0 ? 1 : -1;
          nw = 0;
          penetration = du + r;
        }
      }

      // Back to world space: across = (tz, -tx), along = (tx, tz).
      const nx = nu * o.tz + nw * o.tx;
      const nz = -nu * o.tx + nw * o.tz;
      car.x += nx * penetration;
      car.z += nz * penetration;

      const vn = car.vx * nx + car.vz * nz;
      if (vn >= 0) return null; // already separating
      const restitution = 0.35;
      car.vx -= (1 + restitution) * vn * nx;
      car.vz -= (1 + restitution) * vn * nz;
      // Solid hits are expensive: lose a good part of the remaining speed.
      const keep = clamp(1 - -vn * 0.03, 0.45, 0.9);
      car.vx *= keep;
      car.vz *= keep;
      return { type: 'crash', obstacle: o, impact: -vn };
    }
  }
}
