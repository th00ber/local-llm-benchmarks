import * as THREE from 'three';
import { TRACK_CFG } from '../config';
import type { Track } from '../sim/track';
import { PALETTE } from './palette';
import { makeCurtainTexture, makeSignTexture } from './textures';
import { WALL_THICKNESS } from './trackMesh';

type GateStatus = 'pending' | 'next' | 'passed';

interface GateVisual {
  glow: THREE.MeshBasicMaterial;
  curtain: THREE.Mesh;
  curtainMaterial: THREE.MeshBasicMaterial;
  status: GateStatus;
}

const STATUS_COLOR: Record<GateStatus, THREE.Color> = {
  pending: new THREE.Color(PALETTE.violet).multiplyScalar(0.55),
  next: new THREE.Color(PALETTE.amber).multiplyScalar(2.2),
  passed: new THREE.Color(PALETTE.lime).multiplyScalar(0.9),
};

/**
 * Start/finish gantry (with countdown lights) and the checkpoint arches.
 * The next gate to cross is highlighted with a pulsing light curtain across the road.
 */
export class Gates {
  readonly group = new THREE.Group();
  private readonly visuals: GateVisual[] = [];
  private readonly lamps: THREE.MeshBasicMaterial[] = [];
  private readonly lampOff = new THREE.Color(0x2a0d14);
  private readonly lampRed = new THREE.Color(PALETTE.red).multiplyScalar(3);
  private readonly lampGreen = new THREE.Color(PALETTE.lime).multiplyScalar(3);
  private readonly curtainTexture = makeCurtainTexture();

  constructor(track: Track, gates: ReadonlyArray<number>) {
    this.group.name = 'gates';
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x20233f, roughness: 0.4, metalness: 0.7 });
    this.curtainTexture.repeat.set(6, 1);

    gates.forEach((s, index) => {
      const i = track.indexAt(s);
      const holder = new THREE.Group();
      holder.position.set(track.px[i], 0, track.pz[i]);
      // Local +Z = driving direction, local +X = left side of the road.
      holder.rotation.y = Math.atan2(track.tx[i], track.tz[i]);
      const isFinish = index === 0;
      const visual = isFinish ? this.buildGantry(holder, frameMaterial) : this.buildArch(holder, frameMaterial, index);
      this.visuals.push(visual);
      this.group.add(holder);
    });
  }

  private buildCurtain(holder: THREE.Group, height: number): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
    const material = new THREE.MeshBasicMaterial({
      map: this.curtainTexture,
      color: STATUS_COLOR.next,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_CFG.wallOffset * 2, height), material);
    mesh.position.y = height / 2;
    mesh.visible = false;
    mesh.renderOrder = 5;
    holder.add(mesh);
    return { mesh, material };
  }

  private addPillars(holder: THREE.Group, frame: THREE.Material, height: number, size: number): number {
    const x = TRACK_CFG.wallOffset + WALL_THICKNESS + size / 2 + 0.2;
    for (const side of [1, -1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(size, height, size), frame);
      pillar.position.set(side * x, height / 2, 0);
      pillar.castShadow = true;
      holder.add(pillar);
    }
    return x;
  }

  private buildGantry(holder: THREE.Group, frame: THREE.Material): GateVisual {
    const height = 10.5;
    const x = this.addPillars(holder, frame, height, 1.5);
    const span = x * 2 + 1.5;

    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 2.6, 1.6), frame);
    beam.position.y = height;
    beam.castShadow = true;
    holder.add(beam);

    const glow = new THREE.MeshBasicMaterial({ color: STATUS_COLOR.pending.clone(), toneMapped: false });
    for (const y of [height - 1.45, height + 1.45]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(span + 0.2, 0.22, 1.75), glow);
      strip.position.y = y;
      holder.add(strip);
    }
    for (const side of [1, -1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.25, height - 1.5, 1.65), glow);
      strip.position.set(side * x, (height - 1.5) / 2, 0);
      holder.add(strip);
    }

    // Sign facing the approaching cars (-Z) and a second one facing the other way.
    const signMaterial = new THREE.MeshBasicMaterial({
      map: makeSignTexture('NEON DAWN GP', {
        width: 1024,
        height: 128,
        subtitle: 'START  //  FINISH',
        color: '#2ff3ff',
        accent: '#ff3fa4',
      }),
      toneMapped: false,
    });
    for (const dir of [-1, 1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(17, 2.1), signMaterial);
      sign.position.set(0, height, dir * 0.82);
      if (dir === -1) sign.rotation.y = Math.PI;
      holder.add(sign);
    }

    // Countdown lamps hanging under the beam, facing the grid.
    const lampGeometry = new THREE.SphereGeometry(0.42, 12, 8);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.3, 0.5), frame);
    housing.position.set(0, height - 2.4, -0.6);
    holder.add(housing);
    for (let k = 0; k < 3; k++) {
      const material = new THREE.MeshBasicMaterial({ color: this.lampOff.clone(), toneMapped: false });
      const lamp = new THREE.Mesh(lampGeometry, material);
      lamp.position.set((k - 1) * 1.9, height - 2.4, -0.9);
      holder.add(lamp);
      this.lamps.push(material);
    }

    const curtain = this.buildCurtain(holder, height - 1.6);
    return { glow, curtain: curtain.mesh, curtainMaterial: curtain.material, status: 'pending' };
  }

  private buildArch(holder: THREE.Group, frame: THREE.Material, index: number): GateVisual {
    const height = 8;
    const x = this.addPillars(holder, frame, height, 0.9);
    const span = x * 2 + 0.9;

    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.9, 0.9), frame);
    beam.position.y = height;
    beam.castShadow = true;
    holder.add(beam);

    const glow = new THREE.MeshBasicMaterial({ color: STATUS_COLOR.pending.clone(), toneMapped: false });
    const under = new THREE.Mesh(new THREE.BoxGeometry(span - 1.2, 0.2, 1), glow);
    under.position.y = height - 0.56;
    holder.add(under);
    for (const side of [1, -1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, height - 0.6, 1), glow);
      strip.position.set(side * (x - 0.42), (height - 0.6) / 2, 0);
      holder.add(strip);
    }

    const signMaterial = new THREE.MeshBasicMaterial({
      map: makeSignTexture(`CHECKPOINT ${index}`, { width: 512, height: 96, color: '#ffb347', accent: '#2ff3ff' }),
      toneMapped: false,
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.5), signMaterial);
    sign.position.set(0, height + 1.3, -0.1);
    sign.rotation.y = Math.PI;
    holder.add(sign);
    const back = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1.7, 0.16), frame);
    back.position.set(0, height + 1.3, 0);
    holder.add(back);

    const curtain = this.buildCurtain(holder, height - 0.8);
    return { glow, curtain: curtain.mesh, curtainMaterial: curtain.material, status: 'pending' };
  }

  /**
   * Updates gate colours: `nextGate` is highlighted (unless the race is over), gates before
   * it in the current lap are shown as passed.
   */
  setProgress(nextGate: number, active: boolean): void {
    const count = this.visuals.length;
    for (let i = 0; i < count; i++) {
      let status: GateStatus;
      if (active && i === nextGate) status = 'next';
      else if (i === 0) status = 'pending';
      else if (!active || nextGate === 0 || i < nextGate) status = 'passed';
      else status = 'pending';
      const visual = this.visuals[i];
      if (visual.status === status) continue;
      visual.status = status;
      visual.glow.color.copy(STATUS_COLOR[status]);
      visual.curtain.visible = status === 'next';
    }
  }

  /** Countdown lamps: `lit` red lamps, or all green when `go` is true. */
  setLamps(lit: number, go: boolean): void {
    for (let k = 0; k < this.lamps.length; k++) {
      const color = go ? this.lampGreen : k < lit ? this.lampRed : this.lampOff;
      this.lamps[k].color.copy(color);
    }
  }

  update(time: number): void {
    const pulse = 0.4 + 0.22 * Math.sin(time * 5);
    for (const visual of this.visuals) {
      if (visual.status !== 'next') continue;
      visual.curtainMaterial.opacity = pulse;
    }
    this.curtainTexture.offset.x = time * 0.05;
  }
}
