import { mod, wrapDist } from './math';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export type RaceUpdate =
  | { type: 'none' }
  | { type: 'checkpoint'; index: number; total: number }
  | { type: 'lap'; lap: number; lapTime: number; best: boolean }
  | { type: 'finish'; time: number; lapTime: number; best: boolean };

const NONE: RaceUpdate = { type: 'none' };

/**
 * Race rules: countdown, elapsed time, ordered checkpoints and lap counting.
 *
 * `gates` are distances along the lap. gates[0] is the start/finish line, the remaining
 * gates are the intermediate checkpoints. A lap only counts when every checkpoint has been
 * crossed in order, in the driving direction, and the finish line is then crossed forwards.
 */
export class RaceState {
  phase: RacePhase = 'countdown';
  /** Seconds left before the lights go out. */
  countdown: number;
  /** Elapsed race time in seconds (frozen once finished). */
  time = 0;
  /** Current lap, 1-based, capped at totalLaps. */
  lap = 1;
  /** Index into `gates` of the next gate that must be crossed. */
  nextGate = 1;
  lapStartTime = 0;
  readonly lapTimes: number[] = [];
  bestLap: number | null = null;

  constructor(
    readonly gates: ReadonlyArray<number>,
    readonly trackLength: number,
    readonly totalLaps = 3,
    readonly countdownSeconds = 3,
  ) {
    if (gates.length < 2) throw new Error('A race needs a finish line and at least one checkpoint');
    this.countdown = countdownSeconds;
  }

  reset(): void {
    this.phase = 'countdown';
    this.countdown = this.countdownSeconds;
    this.time = 0;
    this.lap = 1;
    this.nextGate = this.gates.length > 1 ? 1 : 0;
    this.lapStartTime = 0;
    this.lapTimes.length = 0;
    this.bestLap = null;
  }

  /** Number of intermediate checkpoints (the finish line is not included). */
  get checkpointCount(): number {
    return this.gates.length - 1;
  }

  /** Checkpoints already validated in the current lap. */
  get checkpointsPassed(): number {
    return this.nextGate === 0 ? this.checkpointCount : this.nextGate - 1;
  }

  /**
   * Advances the countdown. Returns the whole number of seconds that just started being
   * displayed (3, 2, 1), 0 when the race starts, or -1 when nothing changed.
   */
  tickCountdown(dt: number): number {
    if (this.phase !== 'countdown') return -1;
    const before = Math.ceil(this.countdown);
    this.countdown -= dt;
    if (this.countdown <= 0) {
      this.countdown = 0;
      this.phase = 'racing';
      return 0;
    }
    const after = Math.ceil(this.countdown);
    return after !== before ? after : -1;
  }

  /**
   * Advances the race clock and validates gate crossings for a car that moved from lap
   * distance sPrev to sCur during dt.
   */
  advance(dt: number, sPrev: number, sCur: number): RaceUpdate {
    if (this.phase !== 'racing') return NONE;
    this.time += dt;

    const ds = wrapDist(sCur - sPrev, this.trackLength);
    // Only forward motion can validate a gate; huge jumps (teleports) are ignored.
    if (ds <= 0 || ds > 40) return NONE;

    const gateDistance = mod(this.gates[this.nextGate] - sPrev, this.trackLength);
    if (gateDistance <= 0 || gateDistance > ds) return NONE;

    if (this.nextGate !== 0) {
      const index = this.nextGate;
      this.nextGate = (this.nextGate + 1) % this.gates.length;
      return { type: 'checkpoint', index, total: this.checkpointCount };
    }

    // Finish line crossed with every checkpoint validated: the lap counts.
    const lapTime = this.time - this.lapStartTime;
    this.lapTimes.push(lapTime);
    const best = this.bestLap === null || lapTime < this.bestLap;
    if (best) this.bestLap = lapTime;
    this.lapStartTime = this.time;
    this.nextGate = this.gates.length > 1 ? 1 : 0;

    if (this.lapTimes.length >= this.totalLaps) {
      this.phase = 'finished';
      return { type: 'finish', time: this.time, lapTime, best };
    }
    const completed = this.lap;
    this.lap += 1;
    return { type: 'lap', lap: completed, lapTime, best };
  }
}
