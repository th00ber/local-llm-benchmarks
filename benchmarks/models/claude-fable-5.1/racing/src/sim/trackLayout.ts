import type { Point2 } from './track';
import type { ObstacleKind } from './obstacles';

/**
 * Control points of the "Neon Dawn" circuit (metres, XZ plane), in driving order.
 * Point 0 is the start/finish line, in the middle of the main straight.
 * The circuit is ~1.5 km long: main straight, a long left sweeper, a double left that dives
 * into the infield, a wide right-hander, a left loop and a fast left/right/left kink.
 */
export const TRACK_POINTS: ReadonlyArray<Point2> = [
  [-40, 140],
  [30, 140],
  [100, 140],
  [195, 105],
  [220, 30],
  [195, -60],
  [130, -120],
  [50, -130],
  [0, -90],
  [10, -20],
  [-30, 35],
  [-95, 20],
  [-110, -50],
  [-150, -115],
  [-215, -100],
  [-250, -35],
  [-233, 20],
  [-245, 75],
  [-205, 125],
  [-150, 140],
  [-95, 140],
];

/**
 * Checkpoint positions as fractions of the lap distance. Gate 0 (fraction 0) is the
 * start/finish line; the others must be passed in order before a lap is counted.
 */
export const GATE_FRACTIONS: ReadonlyArray<number> = [0, 0.165, 0.335, 0.5, 0.665, 0.835];

export interface ObstaclePlacement {
  kind: ObstacleKind;
  /** Position along the lap as a fraction in [0, 1). */
  at: number;
  /** Lateral offset from the centreline (positive = left). */
  d: number;
  /** Drones only: lateral sweep amplitude (m) and period (s). */
  amplitude?: number;
  period?: number;
  phase?: number;
}

export const OBSTACLE_LAYOUT: ReadonlyArray<ObstaclePlacement> = [
  // Main straight: boost pad, then a cone slalom into the first sweeper.
  { kind: 'boost', at: 0.035, d: 0 },
  { kind: 'cone', at: 0.085, d: 3.2 },
  { kind: 'cone', at: 0.089, d: 4.4 },
  { kind: 'cone', at: 0.093, d: 5.6 },
  { kind: 'cone', at: 0.115, d: -3.2 },
  { kind: 'cone', at: 0.119, d: -4.4 },
  { kind: 'cone', at: 0.123, d: -5.6 },

  // Staggered barrier chicane on the sweeper exit.
  { kind: 'barrier', at: 0.215, d: 4.8 },
  { kind: 'barrier', at: 0.245, d: -4.8 },

  { kind: 'oil', at: 0.3, d: -2.5 },
  { kind: 'boost', at: 0.36, d: 3 },

  // Patrol drone sweeping across the road before the infield right-hander.
  { kind: 'drone', at: 0.43, d: 0, amplitude: 5.2, period: 3.6, phase: 0 },

  { kind: 'barrier', at: 0.545, d: -5 },
  { kind: 'oil', at: 0.575, d: 3.5 },
  { kind: 'barrier', at: 0.6, d: 5 },

  { kind: 'boost', at: 0.64, d: -3 },
  { kind: 'cone', at: 0.7, d: -1.2 },
  { kind: 'cone', at: 0.7, d: 1.2 },
  { kind: 'oil', at: 0.735, d: -4 },
  { kind: 'oil', at: 0.755, d: 3 },

  { kind: 'drone', at: 0.8, d: 0, amplitude: 5.2, period: 3.1, phase: 1.3 },

  // Final kink: a centre barrier, then a boost pad onto the main straight.
  { kind: 'barrier', at: 0.895, d: 0 },
  { kind: 'cone', at: 0.93, d: 5.5 },
  { kind: 'cone', at: 0.934, d: 4.3 },
  { kind: 'boost', at: 0.965, d: 0 },
];
