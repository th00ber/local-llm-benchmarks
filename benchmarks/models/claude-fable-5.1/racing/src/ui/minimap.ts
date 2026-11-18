import { TRACK_CFG } from '../config';
import type { World } from '../sim/world';

/** Small top-down map: track outline, checkpoints, moving hazards and the car. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly background = document.createElement('canvas');
  private size = 0;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: World,
  ) {
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  /** Re-reads the CSS size of the canvas and repaints the static track layer. */
  resize(): void {
    const cssSize = this.canvas.clientWidth;
    if (cssSize <= 0) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(cssSize * pixelRatio);
    if (size === this.size) return;
    this.size = size;
    this.canvas.width = size;
    this.canvas.height = size;
    this.background.width = size;
    this.background.height = size;
    this.paintBackground();
  }

  private toX(x: number): number {
    return x * this.scale + this.offsetX;
  }

  private toY(z: number): number {
    return z * this.scale + this.offsetY;
  }

  private paintBackground(): void {
    const ctx = this.background.getContext('2d');
    if (!ctx) return;
    const { track } = this.world;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < track.count; i++) {
      minX = Math.min(minX, track.px[i]);
      maxX = Math.max(maxX, track.px[i]);
      minZ = Math.min(minZ, track.pz[i]);
      maxZ = Math.max(maxZ, track.pz[i]);
    }
    const margin = this.size * 0.1;
    this.scale = Math.min((this.size - margin * 2) / (maxX - minX), (this.size - margin * 2) / (maxZ - minZ));
    this.offsetX = this.size / 2 - ((minX + maxX) / 2) * this.scale;
    this.offsetY = this.size / 2 - ((minZ + maxZ) / 2) * this.scale;

    ctx.clearRect(0, 0, this.size, this.size);
    const path = new Path2D();
    for (let i = 0; i < track.count; i++) {
      const x = this.toX(track.px[i]);
      const y = this.toY(track.pz[i]);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    ctx.lineJoin = 'round';
    const roadWidth = Math.max(3, TRACK_CFG.wallOffset * 2 * this.scale);
    ctx.strokeStyle = 'rgba(47, 243, 255, 0.55)';
    ctx.lineWidth = roadWidth + this.size * 0.02;
    ctx.stroke(path);
    ctx.strokeStyle = '#1a1c36';
    ctx.lineWidth = roadWidth;
    ctx.stroke(path);

    // Start / finish line.
    const nx = track.tz[0];
    const nz = -track.tx[0];
    const half = TRACK_CFG.wallOffset * 1.6;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, this.size * 0.018);
    ctx.beginPath();
    ctx.moveTo(this.toX(track.px[0] + nx * half), this.toY(track.pz[0] + nz * half));
    ctx.lineTo(this.toX(track.px[0] - nx * half), this.toY(track.pz[0] - nz * half));
    ctx.stroke();
  }

  draw(carX: number, carZ: number, heading: number, time: number): void {
    const ctx = this.ctx;
    if (!ctx || this.size === 0) return;
    const { world } = this;
    const unit = this.size / 100;
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.drawImage(this.background, 0, 0);

    // Checkpoints: passed = green, next = pulsing amber, pending = violet.
    const { race, track, gates } = world;
    const active = race.phase !== 'finished';
    for (let g = 1; g < gates.length; g++) {
      const i = track.indexAt(gates[g]);
      const isNext = active && g === race.nextGate;
      const passed = !active || race.nextGate === 0 || g < race.nextGate;
      ctx.fillStyle = isNext ? '#ffb347' : passed ? '#a6ff4d' : '#8a5cff';
      const radius = isNext ? unit * (3 + Math.sin(time * 6) * 0.8) : unit * 2.1;
      ctx.beginPath();
      ctx.arc(this.toX(track.px[i]), this.toY(track.pz[i]), radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Patrol drones.
    ctx.fillStyle = '#ff3b3b';
    for (const o of world.obstacles) {
      if (o.kind !== 'drone') continue;
      ctx.beginPath();
      ctx.arc(this.toX(o.x), this.toY(o.z), unit * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Car: an arrow pointing along the heading (forward = (sin h, cos h)).
    const x = this.toX(carX);
    const y = this.toY(carZ);
    const fx = Math.sin(heading);
    const fy = Math.cos(heading);
    const length = unit * 6;
    const width = unit * 3.4;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ff3fa4';
    ctx.lineWidth = unit * 1.1;
    ctx.beginPath();
    ctx.moveTo(x + fx * length, y + fy * length);
    ctx.lineTo(x - fx * length * 0.6 - fy * width, y - fy * length * 0.6 + fx * width);
    ctx.lineTo(x - fx * length * 0.6 + fy * width, y - fy * length * 0.6 - fx * width);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }
}
