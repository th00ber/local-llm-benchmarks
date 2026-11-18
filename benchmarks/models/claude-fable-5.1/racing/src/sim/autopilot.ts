import { CAR_CFG, TRACK_CFG } from '../config';
import type { CarInput } from './car';
import { clamp, wrapAngle, wrapDist } from './math';
import type { World } from './world';

const target = { x: 0, z: 0 };

/**
 * A simple pure-pursuit driver: follows the centreline, slows down for bends and steers
 * around hazards. It only produces the same throttle / brake / steer input a player would,
 * and is used by the automated tests to prove that the race can be completed by normal driving.
 */
export function autopilot(world: World, out: CarInput): CarInput {
  const { car, track, loc } = world;
  const speed = Math.abs(car.speed);
  const maxD = TRACK_CFG.roadHalfWidth - 2;

  // Pick a lateral line that avoids the hazards coming up.
  let targetD = 0;
  let caution = false;
  const scan = 16 + speed * 1.1;
  for (const o of world.obstacles) {
    if (o.kind === 'boost' || (o.kind === 'cone' && o.hit)) continue;
    const ahead = wrapDist(o.s - loc.s, track.length);
    if (ahead < -3 || ahead > scan) continue;
    const clearance = o.halfWidth + o.radius + (o.kind === 'drone' ? 3.2 : 2.2);
    if (Math.abs(targetD - o.d) < clearance) {
      const side = o.d >= targetD ? -1 : 1;
      targetD = clamp(o.d + side * clearance, -maxD, maxD);
    }
    if (o.kind === 'drone') caution = true;
  }

  const lookAhead = 7 + speed * 0.42;
  track.pointAt(loc.s + lookAhead, targetD, target);
  const desired = Math.atan2(target.x - car.x, target.z - car.z);
  const error = wrapAngle(desired - car.heading);
  out.steer = clamp(error * 3.2, -1, 1);

  const curvature = track.maxCurvatureAhead(loc.s, 12 + speed * 1.3);
  let targetSpeed = Math.min(CAR_CFG.maxSpeed, Math.sqrt((CAR_CFG.lateralGrip * 0.62) / Math.max(curvature, 1e-4)));
  if (caution) targetSpeed = Math.min(targetSpeed, 30);
  if (Math.abs(error) > 0.5) targetSpeed = Math.min(targetSpeed, 18);

  out.throttle = speed < targetSpeed ? 1 : 0;
  out.brake = speed > targetSpeed + 4 ? 1 : 0;
  return out;
}
