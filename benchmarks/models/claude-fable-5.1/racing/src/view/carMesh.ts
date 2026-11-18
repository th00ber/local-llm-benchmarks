import * as THREE from 'three';
import { CAR_CFG } from '../config';
import type { CarState } from '../sim/car';
import { clamp, damp } from '../sim/math';
import { PALETTE } from './palette';
import { makeGlowTexture } from './textures';

const WHEEL_RADIUS = 0.43;

/** Extrudes a side profile given as [z, y] pairs into a body of the given width (car faces +Z). */
function extrudeProfile(profile: ReadonlyArray<readonly [number, number]>, width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  profile.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** The player's low-poly neon racer. Built facing +Z so that rotation.y equals the car heading. */
export class CarMesh {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly frontPivots: THREE.Group[] = [];
  private readonly tailMaterial: THREE.MeshBasicMaterial;
  private readonly underglow: THREE.MeshBasicMaterial;
  private readonly flames: THREE.Mesh[] = [];
  private readonly glowLight: THREE.PointLight;
  private readonly tailIdle = new THREE.Color(PALETTE.red).multiplyScalar(1.1);
  private readonly tailBrake = new THREE.Color(PALETTE.red).multiplyScalar(4.5);
  private readonly glowNormal = new THREE.Color(PALETTE.cyan);
  private readonly glowBoost = new THREE.Color(PALETTE.amber);
  private roll = 0;
  private pitch = 0;
  private spin = 0;
  private flame = 0;

  constructor() {
    this.root.name = 'car';
    this.root.add(this.body);

    const paint = new THREE.MeshStandardMaterial({ color: 0xf4f6ff, roughness: 0.22, metalness: 0.35, flatShading: true });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x14152a, roughness: 0.55, metalness: 0.4, flatShading: true });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x0a1030,
      roughness: 0.08,
      metalness: 0.9,
      emissive: 0x143a66,
      emissiveIntensity: 0.6,
      flatShading: true,
    });
    const neonCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.cyan).multiplyScalar(2), toneMapped: false });
    const neonMagenta = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.magenta).multiplyScalar(2.2),
      toneMapped: false,
    });
    const headlight = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2cc).multiplyScalar(3), toneMapped: false });
    this.tailMaterial = new THREE.MeshBasicMaterial({ color: this.tailIdle.clone(), toneMapped: false });

    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      this.body.add(mesh);
      return mesh;
    };

    // Main wedge body.
    add(
      extrudeProfile(
        [
          [-2.15, 0.3],
          [2.05, 0.3],
          [2.28, 0.4],
          [2.18, 0.56],
          [0.78, 0.76],
          [-1.35, 0.88],
          [-2.15, 0.95],
        ],
        1.78,
      ),
      paint,
    );
    // Canopy.
    add(
      extrudeProfile(
        [
          [0.92, 0.72],
          [0.1, 1.17],
          [-0.82, 1.15],
          [-1.55, 0.84],
        ],
        1.36,
      ),
      glass,
    );
    // Wide fenders, side skirts, splitter and diffuser.
    for (const side of [1, -1]) {
      add(new THREE.BoxGeometry(0.34, 0.5, 1.35), paint, side * 0.86, 0.6, 1.35);
      add(new THREE.BoxGeometry(0.38, 0.58, 1.45), paint, side * 0.86, 0.66, -1.3);
      add(new THREE.BoxGeometry(0.2, 0.2, 1.4), carbon, side * 0.9, 0.34, 0.02);
      add(new THREE.BoxGeometry(0.05, 0.07, 3.6), neonCyan, side * 1.03, 0.4, 0).castShadow = false;
    }
    add(new THREE.BoxGeometry(1.95, 0.07, 0.5), carbon, 0, 0.27, 2.12);
    add(new THREE.BoxGeometry(1.7, 0.26, 0.3), carbon, 0, 0.42, -2.12);

    // Hood and roof stripes.
    const hoodStripe = add(new THREE.BoxGeometry(0.3, 0.02, 1.4), neonMagenta, 0, 0.672, 1.48);
    hoodStripe.rotation.x = 0.142;
    hoodStripe.castShadow = false;
    add(new THREE.BoxGeometry(0.3, 0.02, 0.9), neonMagenta, 0, 1.17, -0.36).castShadow = false;

    // Rear wing.
    add(new THREE.BoxGeometry(2.0, 0.07, 0.5), carbon, 0, 1.34, -1.95);
    for (const side of [1, -1]) {
      add(new THREE.BoxGeometry(0.09, 0.42, 0.3), carbon, side * 0.62, 1.12, -1.92);
      add(new THREE.BoxGeometry(0.06, 0.3, 0.6), neonMagenta, side * 1.02, 1.36, -1.95).castShadow = false;
    }

    // Lights.
    for (const side of [1, -1]) {
      add(new THREE.BoxGeometry(0.46, 0.09, 0.1), headlight, side * 0.58, 0.5, 2.2).castShadow = false;
    }
    add(new THREE.BoxGeometry(1.62, 0.1, 0.08), this.tailMaterial, 0, 0.8, -2.17).castShadow = false;

    // Exhaust flames (only visible while boosting).
    const flameGeometry = new THREE.ConeGeometry(0.2, 1.6, 6);
    flameGeometry.rotateX(-Math.PI / 2);
    flameGeometry.translate(0, 0, -0.8);
    const flameMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.cyan).multiplyScalar(2.5),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    for (const side of [1, -1]) {
      const flame = new THREE.Mesh(flameGeometry, flameMaterial);
      flame.position.set(side * 0.5, 0.44, -2.25);
      flame.visible = false;
      this.body.add(flame);
      this.flames.push(flame);
    }

    // Wheels: dark tyres with a glowing spoke so the rotation is visible.
    const tyreGeometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.36, 12);
    tyreGeometry.rotateZ(Math.PI / 2);
    const hubGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.38, 8);
    hubGeometry.rotateZ(Math.PI / 2);
    const spokeGeometry = new THREE.BoxGeometry(0.4, 0.07, 0.6);
    const tyre = new THREE.MeshStandardMaterial({ color: 0x0c0d18, roughness: 0.8, flatShading: true });
    const hub = new THREE.MeshStandardMaterial({ color: 0x2a2d52, roughness: 0.3, metalness: 0.6 });
    const positions: Array<[number, number, boolean]> = [
      [0.92, 1.36, true],
      [-0.92, 1.36, true],
      [0.94, -1.3, false],
      [-0.94, -1.3, false],
    ];
    for (const [x, z, front] of positions) {
      const pivot = new THREE.Group();
      pivot.position.set(x, WHEEL_RADIUS, z);
      const wheel = new THREE.Group();
      const tyreMesh = new THREE.Mesh(tyreGeometry, tyre);
      tyreMesh.castShadow = true;
      wheel.add(tyreMesh, new THREE.Mesh(hubGeometry, hub), new THREE.Mesh(spokeGeometry, neonCyan));
      pivot.add(wheel);
      this.root.add(pivot);
      this.wheels.push(wheel);
      if (front) this.frontPivots.push(pivot);
    }

    // Neon underglow on the road.
    this.underglow = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      color: this.glowNormal.clone(),
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 7), this.underglow);
    glowPlane.rotation.x = -Math.PI / 2;
    glowPlane.position.y = 0.05;
    glowPlane.renderOrder = 2;
    this.root.add(glowPlane);

    this.glowLight = new THREE.PointLight(PALETTE.cyan, 7, 9, 1.8);
    this.glowLight.position.set(0, 0.7, -0.4);
    this.root.add(this.glowLight);
  }

  /**
   * @param x, z, heading interpolated pose
   * @param car simulation state (for wheels, lights and body motion)
   */
  update(x: number, z: number, heading: number, car: CarState, dt: number, time: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = heading;

    // Body roll (outwards in bends) and pitch (squat / dive).
    const targetRoll = clamp(car.yawRate * car.speed * 0.0024, -0.075, 0.075);
    const targetPitch = clamp(-car.accel * 0.0017, -0.05, 0.065);
    this.roll = damp(this.roll, targetRoll, 7, dt);
    this.pitch = damp(this.pitch, targetPitch, 6, dt);
    this.body.rotation.z = this.roll;
    this.body.rotation.x = this.pitch;
    // A little engine shake that grows with speed, plus a wobble on oil.
    const speedRatio = Math.min(1, Math.abs(car.speed) / CAR_CFG.maxSpeed);
    this.body.position.y = Math.sin(time * 47) * 0.006 * speedRatio;
    this.body.rotation.y = car.slipTimer > 0 ? Math.sin(time * 14) * 0.09 * Math.min(1, car.slipTimer * 2) : 0;

    this.spin += (car.speed / WHEEL_RADIUS) * dt;
    if (this.spin > 1e4 || this.spin < -1e4) this.spin = 0;
    for (const wheel of this.wheels) wheel.rotation.x = this.spin;
    for (const pivot of this.frontPivots) pivot.rotation.y = car.steer * 0.42;

    this.tailMaterial.color.copy(car.braking ? this.tailBrake : this.tailIdle);

    const boosting = car.boostTimer > 0;
    this.flame = damp(this.flame, boosting ? 1 : 0, boosting ? 14 : 6, dt);
    const flicker = 0.8 + 0.2 * Math.sin(time * 61) + 0.1 * Math.sin(time * 97);
    for (const flame of this.flames) {
      flame.visible = this.flame > 0.03;
      flame.scale.set(1, 1, this.flame * flicker * 1.5);
    }
    this.underglow.color.copy(this.glowNormal).lerp(this.glowBoost, this.flame);
    this.underglow.opacity = 0.6 + 0.2 * speedRatio + 0.2 * this.flame;
    this.glowLight.color.copy(this.underglow.color);
  }
}
