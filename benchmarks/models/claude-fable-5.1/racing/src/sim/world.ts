import { CAR_CFG, RACE_CFG, TRACK_CFG } from '../config';
import { createCarState, resetCarState, stepCar, type CarInput, type CarState } from './car';
import { wrapAngle } from './math';
import { createObstacles, placeObstacle, resetObstacle, resolveObstacle, type Obstacle } from './obstacles';
import { RaceState } from './race';
import { createLocation, Track, type TrackLocation } from './track';
import { GATE_FRACTIONS, OBSTACLE_LAYOUT, TRACK_POINTS } from './trackLayout';

export type GameEvent =
  | { type: 'countdown'; value: number }
  | { type: 'go' }
  | { type: 'wall'; impact: number }
  | { type: 'crash'; impact: number; obstacle: Obstacle }
  | { type: 'cone'; obstacle: Obstacle }
  | { type: 'oil' }
  | { type: 'boost' }
  | { type: 'offtrack' }
  | { type: 'wrongway'; active: boolean }
  | { type: 'checkpoint'; index: number; total: number }
  | { type: 'lap'; lap: number; lapTime: number; best: boolean }
  | { type: 'finish'; time: number; lapTime: number; best: boolean };

const NO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0 };
const tmp = { x: 0, z: 0 };

/**
 * The complete, renderer-independent game simulation: track, car, obstacles and race rules.
 * `step` advances it by a fixed time step and queues events for the presentation layer.
 */
export class World {
  readonly track: Track;
  readonly car: CarState = createCarState();
  readonly race: RaceState;
  readonly obstacles: Obstacle[];
  /** Lap distances of the gates (index 0 = start/finish line). */
  readonly gates: number[];
  /** Car position projected on the track. */
  readonly loc: TrackLocation = createLocation();
  /** Events produced since the consumer last cleared the list. */
  readonly events: GameEvent[] = [];
  /** Simulation time since the last reset (keeps running during the countdown). */
  time = 0;
  wrongWay = false;

  private wallCooldown = 0;
  private crashCooldown = 0;
  private wrongWayTimer = 0;
  private wasOffroad = false;
  private readonly finishInput: CarInput = { throttle: 0, brake: 0, steer: 0 };

  constructor() {
    this.track = new Track(TRACK_POINTS, TRACK_CFG.sampleSpacing);
    this.gates = GATE_FRACTIONS.map((f) => f * this.track.length);
    this.race = new RaceState(this.gates, this.track.length, RACE_CFG.laps, RACE_CFG.countdownSeconds);
    this.obstacles = createObstacles(this.track, OBSTACLE_LAYOUT);
    this.reset();
  }

  /** Puts everything back on the starting grid: car, timer, checkpoints, laps, obstacles. */
  reset(): void {
    const startS = this.track.length - RACE_CFG.gridOffset;
    this.track.pointAt(startS, 0, tmp);
    resetCarState(this.car, tmp.x, tmp.z, this.track.headingAt(startS));
    this.track.locate(this.car.x, this.car.z, -1, this.loc);
    this.race.reset();
    for (const o of this.obstacles) resetObstacle(o);
    this.events.length = 0;
    this.time = 0;
    this.wrongWay = false;
    this.wallCooldown = 0;
    this.crashCooldown = 0;
    this.wrongWayTimer = 0;
    this.wasOffroad = false;
  }

  step(dt: number, playerInput: CarInput): void {
    const { car, race, track, loc } = this;
    this.time += dt;
    this.wallCooldown -= dt;
    this.crashCooldown -= dt;

    for (const o of this.obstacles) {
      if (o.amplitude !== 0) placeObstacle(o, this.time);
    }

    let input = playerInput;
    if (race.phase === 'countdown') {
      const tick = race.tickCountdown(dt);
      if (tick > 0) this.events.push({ type: 'countdown', value: tick });
      else if (tick === 0) this.events.push({ type: 'go' });
      input = NO_INPUT;
      if (race.phase === 'countdown') {
        // Hold the car on the grid until the lights go out.
        car.vx = 0;
        car.vz = 0;
      }
    } else if (race.phase === 'finished') {
      // Race over: any boost is cancelled and the car brakes to a stop on its own.
      car.boostTimer = 0;
      this.finishInput.brake = car.speed > 1 ? 0.7 : 0;
      input = this.finishInput;
    }

    const sPrev = loc.s;
    stepCar(car, input, dt);
    track.locate(car.x, car.z, loc.index, loc);

    this.resolveWalls(dt);
    this.resolveObstacles();

    car.offroad = Math.abs(loc.d) > TRACK_CFG.roadHalfWidth + 0.4;
    if (car.offroad && !this.wasOffroad && Math.abs(car.speed) > 8) this.events.push({ type: 'offtrack' });
    this.wasOffroad = car.offroad;

    const update = race.advance(dt, sPrev, loc.s);
    if (update.type !== 'none') this.events.push(update);

    this.updateWrongWay(dt);
  }

  private resolveWalls(dt: number): void {
    const { car, loc } = this;
    const limit = TRACK_CFG.wallOffset - CAR_CFG.wallRadius;
    const offset = Math.abs(loc.d);
    if (offset <= limit) return;

    const side = loc.d > 0 ? 1 : -1;
    // Unit normal pointing from the centreline towards the wall that was hit.
    const nx = loc.tz * side;
    const nz = -loc.tx * side;
    const penetration = offset - limit;
    car.x -= nx * penetration;
    car.z -= nz * penetration;

    const vn = car.vx * nx + car.vz * nz;
    if (vn > 0) {
      const vt = car.vx * loc.tx + car.vz * loc.tz;
      const keep = Math.max(0.55, 1 - vn * 0.022);
      const restitution = 0.3;
      car.vx = loc.tx * vt * keep - nx * vn * restitution;
      car.vz = loc.tz * vt * keep - nz * vn * restitution;

      if (vn > 2.5 && this.wallCooldown <= 0) {
        this.events.push({ type: 'wall', impact: vn });
        this.wallCooldown = 0.35;
      }
    }

    // Scraping along the barrier costs speed and gently turns the car back along the track,
    // so a player pinned against a wall can always drive away.
    const scrape = Math.exp(-0.9 * dt);
    car.vx *= scrape;
    car.vz *= scrape;
    const tangentHeading = Math.atan2(loc.tx, loc.tz);
    let error = wrapAngle(tangentHeading - car.heading);
    if (Math.abs(error) > Math.PI / 2) error = wrapAngle(error + Math.PI);
    const maxTurn = (1.4 + Math.max(0, vn) * 0.25) * dt;
    car.heading += Math.max(-maxTurn, Math.min(maxTurn, error));

    this.track.locate(car.x, car.z, loc.index, loc);
  }

  private resolveObstacles(): void {
    const { car, loc } = this;
    let moved = false;
    for (const o of this.obstacles) {
      const contact = resolveObstacle(car, o);
      if (!contact) continue;
      switch (contact.type) {
        case 'crash':
          moved = true;
          if (contact.impact > 2 && this.crashCooldown <= 0) {
            this.events.push({ type: 'crash', impact: contact.impact, obstacle: o });
            this.crashCooldown = 0.3;
          }
          break;
        case 'cone':
          this.events.push({ type: 'cone', obstacle: o });
          break;
        case 'oil':
          this.events.push({ type: 'oil' });
          break;
        case 'boost':
          this.events.push({ type: 'boost' });
          break;
      }
    }
    if (moved) {
      this.track.locate(car.x, car.z, loc.index, loc);
      // An obstacle must never push the car through a wall.
      const limit = TRACK_CFG.wallOffset - CAR_CFG.wallRadius;
      if (Math.abs(loc.d) > limit) {
        const side = loc.d > 0 ? 1 : -1;
        const penetration = Math.abs(loc.d) - limit;
        car.x -= loc.tz * side * penetration;
        car.z -= -loc.tx * side * penetration;
        this.track.locate(car.x, car.z, loc.index, loc);
      }
    }
  }

  private updateWrongWay(dt: number): void {
    const { car, loc, race } = this;
    const along = car.vx * loc.tx + car.vz * loc.tz;
    const facing = Math.sin(car.heading) * loc.tx + Math.cos(car.heading) * loc.tz;
    const goingBackwards = race.phase === 'racing' && along < -4 && facing < -0.2;
    this.wrongWayTimer = goingBackwards ? this.wrongWayTimer + dt : 0;
    const wrongWay = this.wrongWayTimer > 0.8;
    if (wrongWay !== this.wrongWay) {
      this.wrongWay = wrongWay;
      this.events.push({ type: 'wrongway', active: wrongWay });
    }
  }
}
