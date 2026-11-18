import * as THREE from 'three';

const MAX_PARTICLES = 320;

/**
 * A fixed-size pool of glowing shards (sparks, dust, boost exhaust).
 * Nothing is allocated after construction: dead particles are simply reused.
 */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly pz = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly vz = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly gravity = new Float32Array(MAX_PARTICLES);
  private readonly colors = new Float32Array(MAX_PARTICLES * 3);
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private cursor = 0;
  private seed = 1;

  constructor() {
    const geometry = new THREE.TetrahedronGeometry(1, 0);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 6;
    // Allocate the per-instance colour buffer up front.
    this.color.setRGB(1, 1, 1);
    for (let i = 0; i < MAX_PARTICLES; i++) this.mesh.setColorAt(i, this.color);
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
  }

  /** Cheap deterministic random in [0, 1). */
  private random(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /**
   * Emits `count` particles around a point.
   * @param spread random velocity magnitude
   * @param up extra upward velocity
   */
  burst(
    x: number,
    y: number,
    z: number,
    baseVX: number,
    baseVZ: number,
    count: number,
    hex: number,
    intensity: number,
    spread: number,
    up: number,
    life: number,
    size: number,
    gravity = 14,
  ): void {
    this.color.setHex(hex).multiplyScalar(intensity);
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      this.px[i] = x + (this.random() - 0.5) * 0.6;
      this.py[i] = y + this.random() * 0.3;
      this.pz[i] = z + (this.random() - 0.5) * 0.6;
      this.vx[i] = baseVX + (this.random() - 0.5) * 2 * spread;
      this.vy[i] = up * (0.4 + this.random() * 0.8);
      this.vz[i] = baseVZ + (this.random() - 0.5) * 2 * spread;
      const duration = life * (0.6 + this.random() * 0.6);
      this.life[i] = duration;
      this.maxLife[i] = duration;
      this.size[i] = size * (0.6 + this.random() * 0.8);
      this.gravity[i] = gravity;
      const shade = 0.7 + this.random() * 0.5;
      this.colors[i * 3] = this.color.r * shade;
      this.colors[i * 3 + 1] = this.color.g * shade;
      this.colors[i * 3 + 2] = this.color.b * shade;
    }
  }

  clear(): void {
    this.life.fill(0);
    this.mesh.count = 0;
  }

  update(dt: number): void {
    let visible = 0;
    const dummy = this.dummy;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      this.vy[i] -= this.gravity[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.05) {
        this.py[i] = 0.05;
        this.vy[i] = Math.abs(this.vy[i]) * 0.4;
        this.vx[i] *= 0.7;
        this.vz[i] *= 0.7;
      }
      const t = this.life[i] / this.maxLife[i];
      const scale = this.size[i] * (0.25 + 0.75 * t);
      dummy.position.set(this.px[i], this.py[i], this.pz[i]);
      dummy.rotation.set(t * 9 + i, t * 7, i * 0.37);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(visible, dummy.matrix);
      this.color.setRGB(this.colors[i * 3] * t, this.colors[i * 3 + 1] * t, this.colors[i * 3 + 2] * t);
      this.mesh.setColorAt(visible, this.color);
      visible++;
    }
    this.mesh.count = visible;
    if (visible > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
