import { CAR_CFG } from '../config';
import { approach, clamp } from './math';

/** Normalised driving input. */
export interface CarInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 - brakes, then reverses once (nearly) stopped. */
  brake: number;
  /** -1..1, positive = steer left. */
  steer: number;
}

export interface CarState {
  x: number;
  z: number;
  /** Heading angle: forward = (sin h, cos h). Increases when turning left. */
  heading: number;
  /** World-space velocity. */
  vx: number;
  vz: number;
  /** Smoothed steering position, -1..1 (positive = left). */
  steer: number;
  /** Signed speed along the car's forward axis (m/s). */
  speed: number;
  /** Sideways (drift) speed, positive = sliding to the left. */
  lateralSpeed: number;
  yawRate: number;
  /** Longitudinal acceleration of the last step, for body pitch / brake lights. */
  accel: number;
  /** Seconds of reduced grip left (oil slick). */
  slipTimer: number;
  /** Seconds of boost left (boost pad). */
  boostTimer: number;
  /** True while the car is on the run-off shoulder. */
  offroad: boolean;
  braking: boolean;
}

export function createCarState(): CarState {
  return {
    x: 0,
    z: 0,
    heading: 0,
    vx: 0,
    vz: 0,
    steer: 0,
    speed: 0,
    lateralSpeed: 0,
    yawRate: 0,
    accel: 0,
    slipTimer: 0,
    boostTimer: 0,
    offroad: false,
    braking: false,
  };
}

export function resetCarState(car: CarState, x: number, z: number, heading: number): void {
  car.x = x;
  car.z = z;
  car.heading = heading;
  car.vx = 0;
  car.vz = 0;
  car.steer = 0;
  car.speed = 0;
  car.lateralSpeed = 0;
  car.yawRate = 0;
  car.accel = 0;
  car.slipTimer = 0;
  car.boostTimer = 0;
  car.offroad = false;
  car.braking = false;
}

/**
 * Speed-dependent steering: at low speed the yaw rate is limited by the minimum turn radius
 * (no spinning on the spot), at high speed by the lateral grip budget (wider arcs when fast).
 */
export function maxYawRate(speedAbs: number): number {
  const lowSpeedLimit = speedAbs / CAR_CFG.minTurnRadius;
  const gripLimit = CAR_CFG.lateralGrip / Math.max(speedAbs, 0.001);
  return Math.min(lowSpeedLimit, gripLimit, CAR_CFG.maxYawRate);
}

/** Advances the arcade car model by dt seconds. Collisions are resolved by the world afterwards. */
export function stepCar(car: CarState, input: CarInput, dt: number): void {
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  const steerTarget = clamp(input.steer, -1, 1);

  car.slipTimer = Math.max(0, car.slipTimer - dt);
  car.boostTimer = Math.max(0, car.boostTimer - dt);
  const slipping = car.slipTimer > 0;
  const boosting = car.boostTimer > 0;

  // --- Steering -----------------------------------------------------------
  const steerRate = steerTarget === 0 ? CAR_CFG.steerOutRate : CAR_CFG.steerInRate;
  car.steer = approach(car.steer, steerTarget, steerRate * dt);

  let fx = Math.sin(car.heading);
  let fz = Math.cos(car.heading);
  const forwardSpeed = car.vx * fx + car.vz * fz;
  const direction = forwardSpeed >= 0 ? 1 : -1;
  let yawRate = car.steer * maxYawRate(Math.abs(forwardSpeed)) * direction;
  if (slipping) yawRate *= CAR_CFG.slipSteerFactor;
  car.yawRate = yawRate;
  car.heading += yawRate * dt;

  // --- Decompose velocity in the new car frame ------------------------------
  fx = Math.sin(car.heading);
  fz = Math.cos(car.heading);
  const lx = fz; // left = (cos h, -sin h)
  const lz = -fx;
  let vf = car.vx * fx + car.vz * fz;
  let vl = car.vx * lx + car.vz * lz;
  const vfBefore = vf;

  // --- Longitudinal forces ---------------------------------------------------
  const topSpeed = boosting ? CAR_CFG.boostMaxSpeed : CAR_CFG.maxSpeed;
  car.braking = false;
  if (boosting) {
    // Boost pads push the car forward regardless of the pedal.
    vf += CAR_CFG.boostAccel * Math.max(0, 1 - vf / topSpeed) * dt;
  } else if (throttle > 0) {
    if (vf < 0) {
      vf = Math.min(0, vf + CAR_CFG.brakeDecel * throttle * dt);
    } else {
      // Acceleration tapers off towards top speed; above it (after a boost) the car bleeds speed.
      vf += CAR_CFG.engineAccel * throttle * (1 - vf / topSpeed) * dt;
    }
  }

  if (brake > 0) {
    if (vf > 0.6) {
      vf = Math.max(0, vf - CAR_CFG.brakeDecel * brake * dt);
      car.braking = true;
    } else if (throttle === 0 || vf <= 0) {
      // Nearly stopped: the brake key becomes reverse.
      vf -= CAR_CFG.reverseAccel * brake * Math.max(0, 1 + vf / CAR_CFG.maxReverseSpeed) * dt;
    }
  }

  if (throttle === 0 && brake === 0 && !boosting) {
    // Coasting: rolling resistance + drag.
    const decel = (CAR_CFG.rollingDecel + CAR_CFG.coastDrag * Math.abs(vf)) * dt;
    vf = Math.abs(vf) <= decel ? 0 : vf - Math.sign(vf) * decel;
  }

  if (car.offroad) {
    // Meaningful off-track penalty: the shoulder drags the car down to a crawl.
    const limit = CAR_CFG.offroadMaxSpeed;
    if (vf > limit) vf = Math.max(limit, vf - CAR_CFG.offroadDecel * dt);
    else if (vf < -limit * 0.5) vf = Math.min(-limit * 0.5, vf + CAR_CFG.offroadDecel * dt);
  }

  // --- Lateral grip ------------------------------------------------------------
  const grip = slipping ? CAR_CFG.slipGripRate : car.offroad ? CAR_CFG.offroadGripRate : CAR_CFG.gripRate;
  vl *= Math.exp(-grip * dt);

  // --- Recompose and integrate -------------------------------------------------
  car.vx = fx * vf + lx * vl;
  car.vz = fz * vf + lz * vl;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.speed = vf;
  car.lateralSpeed = vl;
  car.accel = (vf - vfBefore) / dt;
}
