import * as THREE from 'three';
import { createRng } from '../sim/math';

/** All textures are painted procedurally on 2D canvases - no external image is loaded. */

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return [canvas, ctx];
}

function finish(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  return texture;
}

/** Fine asphalt grain with faint tyre-worn lanes. u runs across the road, v along it. */
export function makeAsphaltTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 256);
  const rng = createRng(7);
  ctx.fillStyle = '#8f90a6';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const shade = 110 + Math.floor(rng() * 110);
    ctx.fillStyle = `rgba(${shade},${shade},${shade + 14},${0.25 + rng() * 0.4})`;
    const size = 1 + rng() * 2;
    ctx.fillRect(rng() * 256, rng() * 256, size, size);
  }
  // Darker rubbered-in racing lanes.
  for (const x of [72, 184]) {
    const gradient = ctx.createLinearGradient(x - 26, 0, x + 26, 0);
    gradient.addColorStop(0, 'rgba(20,20,34,0)');
    gradient.addColorStop(0.5, 'rgba(20,20,34,0.3)');
    gradient.addColorStop(1, 'rgba(20,20,34,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - 26, 0, 52, 256);
  }
  // Expansion joints across the road give a sense of speed.
  ctx.fillStyle = 'rgba(15,15,30,0.35)';
  ctx.fillRect(0, 0, 256, 3);
  ctx.fillRect(0, 128, 256, 2);
  return finish(canvas, true);
}

export function makeCheckerTexture(columns: number, rows: number): THREE.CanvasTexture {
  const cell = 32;
  const [canvas, ctx] = makeCanvas(columns * cell, rows * cell);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f4f6ff' : '#11121f';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const texture = finish(canvas);
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

/** Soft radial glow, white in the centre and transparent at the rim. */
export function makeGlowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128);
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return finish(canvas);
}

/** Vertical fade used by the checkpoint light curtains (opaque at the bottom). */
export function makeCurtainTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 128);
  const gradient = ctx.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  gradient.addColorStop(1, 'rgba(255,255,255,0.7)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 128);
  // Subtle vertical scan bars.
  ctx.globalCompositeOperation = 'destination-out';
  for (let x = 0; x < 64; x += 8) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, 0, 2, 128);
  }
  return finish(canvas, true);
}

/** Scrolling chevrons for the boost pads. */
export function makeChevronTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.lineWidth = 14;
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = '#ffffff';
  for (let i = -1; i < 3; i++) {
    const y = i * 64 + 46;
    ctx.beginPath();
    ctx.moveTo(14, y + 22);
    ctx.lineTo(64, y - 22);
    ctx.lineTo(114, y + 22);
    ctx.stroke();
  }
  return finish(canvas, true);
}

/** Diagonal hazard stripes for the solid barriers. */
export function makeHazardTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 64);
  ctx.fillStyle = '#16172b';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#ffb347';
  for (let x = -64; x < 192; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 16, 64);
    ctx.lineTo(x + 48, 0);
    ctx.lineTo(x + 32, 0);
    ctx.closePath();
    ctx.fill();
  }
  return finish(canvas, true);
}

/** Lit windows for the skyline towers (used as an emissive map). */
export function makeWindowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128);
  const rng = createRng(21);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 128, 128);
  const colors = ['#2ff3ff', '#ff3fa4', '#ffb347', '#8a5cff', '#f2f4ff'];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const roll = rng();
      if (roll < 0.52) continue;
      ctx.globalAlpha = 0.35 + rng() * 0.65;
      ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
      ctx.fillRect(x * 16 + 3, y * 16 + 4, 10, 8);
    }
  }
  ctx.globalAlpha = 1;
  return finish(canvas, true);
}

/** Colourful dots standing in for a crowd on the grandstand. */
export function makeCrowdTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 32);
  const rng = createRng(99);
  ctx.fillStyle = '#141732';
  ctx.fillRect(0, 0, 256, 32);
  const colors = ['#2ff3ff', '#ff3fa4', '#ffb347', '#a6ff4d', '#f2f4ff', '#8a5cff'];
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.globalAlpha = 0.5 + rng() * 0.5;
    ctx.fillRect(Math.floor(rng() * 256), 6 + Math.floor(rng() * 22), 3, 4);
  }
  ctx.globalAlpha = 1;
  return finish(canvas, true);
}

export interface SignOptions {
  width?: number;
  height?: number;
  color?: string;
  accent?: string;
  background?: string;
  subtitle?: string;
  fontScale?: number;
}

/** A glowing text panel (gantry signs, billboards, checkpoint numbers). Uses system fonts only. */
export function makeSignTexture(text: string, options: SignOptions = {}): THREE.CanvasTexture {
  const width = options.width ?? 512;
  const height = options.height ?? 128;
  const color = options.color ?? '#2ff3ff';
  const accent = options.accent ?? '#ff3fa4';
  const [canvas, ctx] = makeCanvas(width, height);

  ctx.fillStyle = options.background ?? '#0b0d22';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(4, height * 0.045);
  ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, width - ctx.lineWidth * 2, height - ctx.lineWidth * 2);

  const hasSubtitle = Boolean(options.subtitle);
  const fontSize = height * (hasSubtitle ? 0.4 : 0.52) * (options.fontScale ?? 1);
  ctx.font = `italic 900 ${fontSize}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = height * 0.16;
  ctx.fillStyle = color;
  const y = hasSubtitle ? height * 0.4 : height * 0.53;
  ctx.fillText(text, width / 2, y, width * 0.88);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.85;
  ctx.fillText(text, width / 2, y, width * 0.88);
  ctx.globalAlpha = 1;

  if (options.subtitle) {
    ctx.font = `700 ${height * 0.17}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = accent;
    ctx.fillText(options.subtitle, width / 2, height * 0.76, width * 0.86);
  }
  return finish(canvas);
}
