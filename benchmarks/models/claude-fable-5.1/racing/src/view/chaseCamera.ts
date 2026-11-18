import * as THREE from 'three';
import { CAR_CFG } from '../config';
import { clamp, damp, dampAngle } from '../sim/math';

const BASE_FOV = 60;
/** Minimum horizontal field of view, so portrait windows still show the road ahead. */
const MIN_HORIZONTAL_FOV = 58;

/**
 * Third-person chase camera. It trails the car with a slightly lagging yaw (so turns are
 * felt), pulls back and widens the field of view with speed, and shakes on impacts.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private fovBoost = 0;
  private distance = 9.2;
  private shake = 0;
  private shakeTime = 0;
  private orbit = 0;
  private readonly lookTarget = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.5, 3200);
    this.setAspect(aspect);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.applyFov();
  }

  private applyFov(): void {
    let fov = BASE_FOV + this.fovBoost;
    const horizontal = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * this.camera.aspect) * (180 / Math.PI);
    if (horizontal < MIN_HORIZONTAL_FOV) {
      fov = 2 * Math.atan(Math.tan((MIN_HORIZONTAL_FOV * Math.PI) / 360) / this.camera.aspect) * (180 / Math.PI);
      fov = Math.min(fov, 100);
    }
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Adds an impact shake (0..1). */
  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Instantly places the camera behind the car (race start / restart). */
  snap(x: number, z: number, heading: number): void {
    this.yaw = heading;
    this.fovBoost = 0;
    this.distance = 9.2;
    this.shake = 0;
    this.orbit = 0;
    this.place(x, z, heading);
    this.applyFov();
  }

  private place(x: number, z: number, heading: number): void {
    const yaw = this.yaw + this.orbit;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const height = 3.9 + this.distance * 0.1;
    this.camera.position.set(x - sin * this.distance, height, z - cos * this.distance);

    // Look ahead of the car (along its real heading) so the upcoming road stays in view.
    const ahead = 9;
    this.lookTarget.set(x + Math.sin(heading) * ahead, 1.3, z + Math.cos(heading) * ahead);

    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.55;
      this.camera.position.x += Math.sin(this.shakeTime * 71) * s;
      this.camera.position.y += Math.sin(this.shakeTime * 93 + 1.7) * s * 0.7;
      this.camera.position.z += Math.cos(this.shakeTime * 57 + 0.4) * s;
    }
    this.camera.lookAt(this.lookTarget);
  }

  /**
   * @param speed signed forward speed of the car
   * @param finished true once the race is over: the camera slowly orbits the car
   */
  update(x: number, z: number, heading: number, speed: number, boosting: boolean, finished: boolean, dt: number): void {
    const speedRatio = clamp(Math.abs(speed) / CAR_CFG.maxSpeed, 0, 1.3);

    // The faster the car, the tighter the camera follows its heading.
    this.yaw = dampAngle(this.yaw, heading, 3.2 + speedRatio * 2.6, dt);
    this.orbit = finished ? this.orbit + dt * 0.35 : damp(this.orbit, 0, 4, dt);

    this.distance = damp(this.distance, 9.2 + speedRatio * 2.6 + (boosting ? 1.2 : 0), 3, dt);
    const targetFov = speedRatio * 13 + (boosting ? 7 : 0);
    const previous = this.fovBoost;
    this.fovBoost = damp(this.fovBoost, targetFov, 3.5, dt);
    if (Math.abs(this.fovBoost - previous) > 0.005) this.applyFov();

    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.shakeTime += dt;
    this.place(x, z, heading);
  }
}
