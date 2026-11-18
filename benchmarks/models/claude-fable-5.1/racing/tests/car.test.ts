import { describe, expect, it } from 'vitest';
import { CAR_CFG } from '../src/config';
import { createCarState, maxYawRate, stepCar, type CarInput, type CarState } from '../src/sim/car';

const DT = 1 / 120;

function drive(car: CarState, input: CarInput, seconds: number, dt = DT): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) stepCar(car, input, dt);
}

describe('car physics', () => {
  it('accelerates forward along its heading and tops out at max speed', () => {
    const car = createCarState();
    drive(car, { throttle: 1, brake: 0, steer: 0 }, 1);
    expect(car.speed).toBeGreaterThan(15);
    expect(car.z).toBeGreaterThan(5);
    expect(Math.abs(car.x)).toBeLessThan(1e-6);

    drive(car, { throttle: 1, brake: 0, steer: 0 }, 20);
    expect(car.speed).toBeGreaterThan(CAR_CFG.maxSpeed * 0.97);
    expect(car.speed).toBeLessThanOrEqual(CAR_CFG.maxSpeed + 1e-6);
  });

  it('coasts down through drag and friction when the throttle is released', () => {
    const car = createCarState();
    drive(car, { throttle: 1, brake: 0, steer: 0 }, 4);
    const fast = car.speed;
    drive(car, { throttle: 0, brake: 0, steer: 0 }, 2);
    expect(car.speed).toBeLessThan(fast - 5);
    drive(car, { throttle: 0, brake: 0, steer: 0 }, 30);
    expect(car.speed).toBe(0);
  });

  it('brakes much harder than it coasts, then reverses when nearly stopped', () => {
    const car = createCarState();
    drive(car, { throttle: 1, brake: 0, steer: 0 }, 4);
    const fast = car.speed;
    drive(car, { throttle: 0, brake: 1, steer: 0 }, 0.5);
    expect(car.speed).toBeLessThan(fast - 18);
    expect(car.speed).toBeGreaterThan(0);
    expect(car.braking).toBe(true);

    drive(car, { throttle: 0, brake: 1, steer: 0 }, 6);
    expect(car.speed).toBeLessThan(-5);
    expect(car.speed).toBeGreaterThanOrEqual(-CAR_CFG.maxReverseSpeed - 1e-6);
  });

  it('turns left with positive steer and right with negative steer', () => {
    const left = createCarState();
    drive(left, { throttle: 1, brake: 0, steer: 0 }, 1.5);
    drive(left, { throttle: 1, brake: 0, steer: 1 }, 1);
    // Heading 0 faces +Z; left of that is +X.
    expect(left.heading).toBeGreaterThan(0.5);
    expect(left.x).toBeGreaterThan(2);

    const right = createCarState();
    drive(right, { throttle: 1, brake: 0, steer: 0 }, 1.5);
    drive(right, { throttle: 1, brake: 0, steer: -1 }, 1);
    expect(right.heading).toBeCloseTo(-left.heading, 6);
    expect(right.x).toBeCloseTo(-left.x, 6);
  });

  it('moves in the direction it faces after turning (steering affects motion)', () => {
    const car = createCarState();
    drive(car, { throttle: 1, brake: 0, steer: 0 }, 1);
    drive(car, { throttle: 0.6, brake: 0, steer: 1 }, 2);
    drive(car, { throttle: 0.6, brake: 0, steer: 0 }, 1);
    const velocityHeading = Math.atan2(car.vx, car.vz);
    const diff = Math.atan2(Math.sin(velocityHeading - car.heading), Math.cos(velocityHeading - car.heading));
    expect(Math.abs(diff)).toBeLessThan(0.05);
  });

  it('cannot steer while standing still', () => {
    const car = createCarState();
    drive(car, { throttle: 0, brake: 0, steer: 1 }, 2);
    expect(car.heading).toBe(0);
  });

  it('has speed dependent steering', () => {
    expect(maxYawRate(0)).toBe(0);
    expect(maxYawRate(15)).toBeGreaterThan(maxYawRate(3));
    expect(maxYawRate(60)).toBeLessThan(maxYawRate(20));
    // Turning circle grows with speed.
    expect(60 / maxYawRate(60)).toBeGreaterThan((20 / maxYawRate(20)) * 3);
  });

  it('steers the opposite way when reversing, like a real car', () => {
    const car = createCarState();
    drive(car, { throttle: 0, brake: 1, steer: 1 }, 2);
    expect(car.speed).toBeLessThan(0);
    expect(car.heading).toBeLessThan(0);
  });

  it('is slowed down hard on the run-off shoulder', () => {
    const car = createCarState();
    drive(car, { throttle: 1, brake: 0, steer: 0 }, 6);
    car.offroad = true;
    drive(car, { throttle: 1, brake: 0, steer: 0 }, 3);
    expect(car.speed).toBeLessThanOrEqual(CAR_CFG.offroadMaxSpeed + 1e-6);
  });

  it('slides more on oil than on dry asphalt', () => {
    const dry = createCarState();
    drive(dry, { throttle: 1, brake: 0, steer: 0 }, 3);
    const oily = { ...dry };
    oily.slipTimer = CAR_CFG.slipDuration;
    drive(dry, { throttle: 1, brake: 0, steer: 1 }, 0.6);
    drive(oily, { throttle: 1, brake: 0, steer: 1 }, 0.6);
    expect(Math.abs(oily.lateralSpeed)).toBeGreaterThan(Math.abs(dry.lateralSpeed) * 2);
    expect(Math.abs(oily.heading)).toBeLessThan(Math.abs(dry.heading));
  });

  it('exceeds normal top speed only while boosting', () => {
    const car = createCarState();
    drive(car, { throttle: 1, brake: 0, steer: 0 }, 10);
    car.boostTimer = CAR_CFG.boostDuration;
    drive(car, { throttle: 1, brake: 0, steer: 0 }, CAR_CFG.boostDuration);
    expect(car.speed).toBeGreaterThan(CAR_CFG.maxSpeed + 5);
    expect(car.speed).toBeLessThanOrEqual(CAR_CFG.boostMaxSpeed);
    drive(car, { throttle: 1, brake: 0, steer: 0 }, 8);
    expect(car.speed).toBeLessThan(CAR_CFG.maxSpeed + 1);
  });

  it('behaves the same at different time steps (frame-rate independence)', () => {
    const script = (car: CarState, dt: number) => {
      drive(car, { throttle: 1, brake: 0, steer: 0 }, 2, dt);
      drive(car, { throttle: 1, brake: 0, steer: 1 }, 1.5, dt);
      drive(car, { throttle: 0, brake: 1, steer: -1 }, 0.5, dt);
    };
    const a = createCarState();
    const b = createCarState();
    script(a, 1 / 60);
    script(b, 1 / 240);
    expect(Math.abs(a.x - b.x)).toBeLessThan(1.5);
    expect(Math.abs(a.z - b.z)).toBeLessThan(1.5);
    expect(Math.abs(a.speed - b.speed)).toBeLessThan(0.5);
    expect(Math.abs(a.heading - b.heading)).toBeLessThan(0.05);
  });
});
