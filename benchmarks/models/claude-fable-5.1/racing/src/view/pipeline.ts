import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface QualityListener {
  (level: number): void;
}

/**
 * Quality presets, from best to cheapest. The pipeline steps down automatically when the
 * frame rate stays low, so the game remains playable on slow GPUs.
 */
const QUALITY_LEVELS = [
  { pixelRatio: 2, bloom: true },
  { pixelRatio: 1.25, bloom: true },
  { pixelRatio: 1, bloom: true },
  { pixelRatio: 1, bloom: false },
  { pixelRatio: 0.7, bloom: false },
] as const;

export const LOWEST_QUALITY = QUALITY_LEVELS.length - 1;

/** WebGL renderer + bloom post-processing + resize handling + adaptive quality. */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private level = 0;
  private width = 1;
  private height = 1;
  private slowTime = 0;
  private warmup = 3;
  private smoothedFrame = 1 / 60;
  onQualityChange: QualityListener | null = null;

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.4, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  get qualityLevel(): number {
    return this.level;
  }

  setQuality(level: number): void {
    const clamped = Math.max(0, Math.min(LOWEST_QUALITY, level));
    if (clamped === this.level) return;
    this.level = clamped;
    this.applySize();
    this.onQualityChange?.(clamped);
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.applySize();
  }

  private applySize(): void {
    const preset = QUALITY_LEVELS[this.level];
    const pixelRatio = Math.min(window.devicePixelRatio || 1, preset.pixelRatio);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(this.width, this.height);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt: number): void {
    if (QUALITY_LEVELS[this.level].bloom) this.composer.render(dt);
    else this.renderer.render(scene, camera);
    this.trackPerformance(dt);
  }

  /** Steps the quality down when the frame time stays above ~30 ms for a couple of seconds. */
  private trackPerformance(dt: number): void {
    // Ignore hitches (tab switches, shader compilation) and the first seconds after start-up.
    if (dt <= 0 || dt > 0.25) return;
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }
    this.smoothedFrame += (dt - this.smoothedFrame) * 0.08;
    if (this.smoothedFrame > 1 / 33) this.slowTime += dt;
    else this.slowTime = Math.max(0, this.slowTime - dt * 2);
    if (this.slowTime > 2 && this.level < LOWEST_QUALITY) {
      this.slowTime = 0;
      this.warmup = 1.5;
      this.smoothedFrame = 1 / 60;
      this.setQuality(this.level + 1);
    }
  }
}
