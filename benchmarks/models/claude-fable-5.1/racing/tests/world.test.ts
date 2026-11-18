import { describe, expect, it } from 'vitest';
import { CAR_CFG, FIXED_DT, RACE_CFG, TRACK_CFG } from '../src/config';
import { autopilot } from '../src/sim/autopilot';
import type { CarInput } from '../src/sim/car';
import { World, type GameEvent } from '../src/sim/world';

const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0 };
const FULL: CarInput = { throttle: 1, brake: 0, steer: 0 };

function skipCountdown(world: World): void {
  while (world.race.phase === 'countdown') world.step(FIXED_DT, IDLE);
  world.events.length = 0;
}

function run(world: World, input: CarInput, seconds: number, seen?: GameEvent[]): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    world.step(FIXED_DT, input);
    if (seen) seen.push(...world.events);
    world.events.length = 0;
  }
}

/** Teleports the car onto the track at lap distance s / lateral offset d, facing forwards. */
function placeCar(world: World, s: number, d: number, speed = 0): void {
  const p = { x: 0, z: 0 };
  world.track.pointAt(s, d, p);
  const heading = world.track.headingAt(s);
  world.car.x = p.x;
  world.car.z = p.z;
  world.car.heading = heading;
  world.car.vx = Math.sin(heading) * speed;
  world.car.vz = Math.cos(heading) * speed;
  world.car.speed = speed;
  world.track.locate(p.x, p.z, -1, world.loc);
}

describe('world', () => {
  it('starts on the grid behind the line, facing the driving direction', () => {
    const world = new World();
    expect(world.loc.s).toBeCloseTo(world.track.length - RACE_CFG.gridOffset, 0);
    expect(Math.abs(world.loc.d)).toBeLessThan(0.1);
    const facing = Math.sin(world.car.heading) * world.loc.tx + Math.cos(world.car.heading) * world.loc.tz;
    expect(facing).toBeGreaterThan(0.999);
    expect(world.race.phase).toBe('countdown');
  });

  it('holds the car during the countdown, then releases it', () => {
    const world = new World();
    const seen: GameEvent[] = [];
    run(world, FULL, RACE_CFG.countdownSeconds - 0.1, seen);
    expect(world.car.speed).toBe(0);
    expect(world.race.time).toBe(0);
    run(world, FULL, 1.1, seen);
    expect(seen.filter((e) => e.type === 'countdown').map((e) => (e.type === 'countdown' ? e.value : 0))).toEqual([2, 1]);
    expect(seen.some((e) => e.type === 'go')).toBe(true);
    expect(world.race.phase).toBe('racing');
    expect(world.car.speed).toBeGreaterThan(10);
    expect(world.race.time).toBeGreaterThan(0.9);
  });

  it('keeps the car inside the barriers and reports wall hits', () => {
    const world = new World();
    skipCountdown(world);
    const seen: GameEvent[] = [];
    // Full throttle, hard left, for a long time: the car must stay inside the walls.
    const input: CarInput = { throttle: 1, brake: 0, steer: 1 };
    let maxOffset = 0;
    for (let i = 0; i < 120 * 20; i++) {
      if (i % 600 === 0) input.steer = -input.steer;
      world.step(FIXED_DT, input);
      seen.push(...world.events);
      world.events.length = 0;
      maxOffset = Math.max(maxOffset, Math.abs(world.loc.d));
    }
    expect(maxOffset).toBeLessThanOrEqual(TRACK_CFG.wallOffset - CAR_CFG.wallRadius + 0.05);
    expect(seen.some((e) => e.type === 'wall')).toBe(true);
  });

  it('loses speed when hitting a wall at an angle', () => {
    const world = new World();
    skipCountdown(world);
    placeCar(world, 60, 0, 40);
    world.car.heading += 0.6;
    world.car.vx = Math.sin(world.car.heading) * 40;
    world.car.vz = Math.cos(world.car.heading) * 40;
    const seen: GameEvent[] = [];
    run(world, IDLE, 1.2, seen);
    const wall = seen.find((e) => e.type === 'wall');
    expect(wall).toBeDefined();
    expect(Math.hypot(world.car.vx, world.car.vz)).toBeLessThan(30);
  });

  it('flags the run-off shoulder as off-track', () => {
    const world = new World();
    skipCountdown(world);
    placeCar(world, 100, TRACK_CFG.roadHalfWidth + 1.5, 30);
    const seen: GameEvent[] = [];
    run(world, FULL, 0.05, seen);
    expect(world.car.offroad).toBe(true);
    expect(seen.some((e) => e.type === 'offtrack')).toBe(true);
    placeCar(world, 100, 0, 30);
    run(world, FULL, 0.05);
    expect(world.car.offroad).toBe(false);
  });

  it('bounces off solid barriers and loses speed', () => {
    const world = new World();
    skipCountdown(world);
    const barrier = world.obstacles.find((o) => o.kind === 'barrier')!;
    placeCar(world, barrier.s - 12, barrier.d, 35);
    const seen: GameEvent[] = [];
    run(world, IDLE, 1, seen);
    const crash = seen.find((e) => e.type === 'crash');
    expect(crash).toBeDefined();
    // The car did not tunnel through: it is still on the approach side of the barrier.
    expect(world.loc.s).toBeLessThan(barrier.s);
    expect(Math.abs(world.car.speed)).toBeLessThan(15);
  });

  it('never lets the car overlap a barrier, whatever the approach', () => {
    const world = new World();
    skipCountdown(world);
    const barrier = world.obstacles.find((o) => o.kind === 'barrier')!;
    for (const offset of [-2.5, -1, 0, 1.3, 2.8]) {
      placeCar(world, barrier.s - 10, barrier.d + offset, 50);
      run(world, FULL, 1.5);
      const dx = world.car.x - barrier.x;
      const dz = world.car.z - barrier.z;
      const u = Math.abs(dx * barrier.tz - dz * barrier.tx);
      const w = Math.abs(dx * barrier.tx + dz * barrier.tz);
      const inside = u < barrier.halfWidth + 0.5 && w < barrier.halfDepth + 0.5;
      expect(inside).toBe(false);
    }
  });

  it('knocks cones away at a small speed cost', () => {
    const world = new World();
    skipCountdown(world);
    const cone = world.obstacles.find((o) => o.kind === 'cone')!;
    placeCar(world, cone.s - 6, cone.d, 30);
    const seen: GameEvent[] = [];
    run(world, IDLE, 0.5, seen);
    expect(cone.hit).toBe(true);
    expect(seen.filter((e) => e.type === 'cone')).toHaveLength(1);
    expect(world.car.speed).toBeLessThan(28);
    expect(world.car.speed).toBeGreaterThan(20);
  });

  it('makes the car slip on oil and boosts it on boost pads', () => {
    const world = new World();
    skipCountdown(world);
    const oil = world.obstacles.find((o) => o.kind === 'oil')!;
    placeCar(world, oil.s - 5, oil.d, 30);
    const seen: GameEvent[] = [];
    run(world, IDLE, 0.3, seen);
    expect(seen.filter((e) => e.type === 'oil')).toHaveLength(1);
    expect(world.car.slipTimer).toBeGreaterThan(0);

    const boost = world.obstacles.find((o) => o.kind === 'boost')!;
    placeCar(world, boost.s - 5, boost.d, 55);
    run(world, FULL, 1.5, seen);
    expect(seen.filter((e) => e.type === 'boost')).toHaveLength(1);
    expect(world.car.speed).toBeGreaterThan(CAR_CFG.maxSpeed);
  });

  it('moves patrol drones across the road over time', () => {
    const world = new World();
    const drone = world.obstacles.find((o) => o.kind === 'drone')!;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 120 * 5; i++) {
      world.step(FIXED_DT, IDLE);
      min = Math.min(min, drone.d);
      max = Math.max(max, drone.d);
    }
    expect(max - min).toBeGreaterThan(8);
    expect(Math.max(Math.abs(min), Math.abs(max)) + drone.radius).toBeLessThan(TRACK_CFG.roadHalfWidth);
  });

  it('detects wrong-way driving', () => {
    const world = new World();
    skipCountdown(world);
    placeCar(world, 100, 0, 0);
    world.car.heading += Math.PI;
    const seen: GameEvent[] = [];
    run(world, FULL, 3, seen);
    expect(world.wrongWay).toBe(true);
    expect(seen.some((e) => e.type === 'wrongway' && e.active)).toBe(true);
    expect(world.race.lap).toBe(1);
  });

  it('can be completed by normal driving: three laps, checkpoints in order, then Race Complete', () => {
    const world = new World();
    const input: CarInput = { throttle: 0, brake: 0, steer: 0 };
    const seen: GameEvent[] = [];
    const maxSteps = 120 * 60 * 6;
    let steps = 0;
    while (world.race.phase !== 'finished' && steps < maxSteps) {
      autopilot(world, input);
      world.step(FIXED_DT, input);
      seen.push(...world.events.filter((e) => e.type === 'checkpoint' || e.type === 'lap' || e.type === 'finish'));
      world.events.length = 0;
      steps++;
    }
    expect(world.race.phase).toBe('finished');
    expect(world.race.lapTimes).toHaveLength(3);
    expect(world.race.lap).toBe(3);

    const perLap = world.race.checkpointCount;
    const expected: string[] = [];
    for (let lap = 0; lap < 3; lap++) {
      for (let i = 0; i < perLap; i++) expected.push('checkpoint');
      expected.push(lap < 2 ? 'lap' : 'finish');
    }
    expect(seen.map((e) => e.type)).toEqual(expected);

    // A lap is ~1.5 km: a sane race takes between one and four minutes.
    expect(world.race.time).toBeGreaterThan(60);
    expect(world.race.time).toBeLessThan(240);

    // After the finish the clock is frozen and the car rolls to a stop.
    const finalTime = world.race.time;
    run(world, FULL, 8);
    expect(world.race.time).toBe(finalTime);
    expect(Math.abs(world.car.speed)).toBeLessThan(0.5);
    expect(world.race.phase).toBe('finished');
  });

  it('restarts consistently from any state', () => {
    const world = new World();
    const fresh = new World();
    const input: CarInput = { throttle: 0, brake: 0, steer: 0 };
    for (let i = 0; i < 120 * 40; i++) {
      autopilot(world, input);
      world.step(FIXED_DT, input);
    }
    expect(world.race.checkpointsPassed + world.race.lap).toBeGreaterThan(1);
    world.obstacles.find((o) => o.kind === 'cone')!.hit = true;

    world.reset();
    expect(world.events).toHaveLength(0);
    expect(world.time).toBe(0);
    expect(world.car).toEqual(fresh.car);
    expect(world.loc).toEqual(fresh.loc);
    expect(world.race.phase).toBe('countdown');
    expect(world.race.time).toBe(0);
    expect(world.race.lap).toBe(1);
    expect(world.race.checkpointsPassed).toBe(0);
    expect(world.race.lapTimes).toHaveLength(0);
    expect(world.obstacles.every((o) => !o.hit && !o.inside)).toBe(true);
    expect(world.obstacles.map((o) => [o.x, o.z])).toEqual(fresh.obstacles.map((o) => [o.x, o.z]));
    expect(world.wrongWay).toBe(false);
  });
});
