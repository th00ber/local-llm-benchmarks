import * as THREE from 'three';
import { Sound } from './audio/sound';
import { CAR_CFG, FIXED_DT, MAX_FRAME_DT, RACE_CFG, TRACK_CFG } from './config';
import { formatTime } from './sim/format';
import { clamp, wrapAngle } from './sim/math';
import { World, type GameEvent } from './sim/world';
import { Hud } from './ui/hud';
import { Input } from './ui/input';
import { Minimap } from './ui/minimap';
import { CarMesh } from './view/carMesh';
import { ChaseCamera } from './view/chaseCamera';
import { buildEnvironment } from './view/environment';
import { Gates } from './view/gates';
import { ObstacleMeshes } from './view/obstacleMeshes';
import { PALETTE } from './view/palette';
import { Particles } from './view/particles';
import { RenderPipeline } from './view/pipeline';
import { Sky } from './view/sky';
import { buildTrackMeshes } from './view/trackMesh';

const RECORD_KEY = 'neon-dawn-gp.best-race';

function loadRecord(): number | null {
  try {
    const raw = window.localStorage.getItem(RECORD_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function saveRecord(time: number): void {
  try {
    window.localStorage.setItem(RECORD_KEY, String(time));
  } catch {
    // Records are simply not persisted when storage is unavailable.
  }
}

/** Owns the simulation, the 3D view, the HUD and the main loop. */
export class Game {
  readonly world = new World();
  private readonly scene = new THREE.Scene();
  private readonly chase: ChaseCamera;
  private readonly pipeline: RenderPipeline;
  private readonly sky: Sky;
  private readonly carMesh = new CarMesh();
  private readonly gates: Gates;
  private readonly obstacleMeshes: ObstacleMeshes;
  private readonly particles = new Particles();
  private readonly hud: Hud;
  private readonly minimap: Minimap;
  private readonly input: Input;
  private readonly sound = new Sound();
  private readonly resizeObserver: ResizeObserver;

  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private viewTime = 0;
  private prevX = 0;
  private prevZ = 0;
  private prevHeading = 0;
  private trailTimer = 0;
  private lastImpactMessage = -10;

  constructor(
    private readonly container: HTMLElement,
    canvas: HTMLCanvasElement,
    minimapCanvas: HTMLCanvasElement,
  ) {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.chase = new ChaseCamera(width / height);
    this.pipeline = new RenderPipeline(canvas, this.scene, this.chase.camera);
    this.pipeline.setSize(width, height);

    // --- Scene ---------------------------------------------------------------
    this.sky = new Sky(this.scene);
    this.scene.environment = this.sky.createEnvironment(this.pipeline.renderer);
    this.scene.environmentIntensity = 0.7;
    this.scene.add(buildEnvironment(this.world.track));
    this.scene.add(buildTrackMeshes(this.world.track));
    this.gates = new Gates(this.world.track, this.world.gates);
    this.scene.add(this.gates.group);
    this.obstacleMeshes = new ObstacleMeshes(this.world.obstacles);
    this.scene.add(this.obstacleMeshes.group);
    this.scene.add(this.carMesh.root);
    this.scene.add(this.particles.mesh);

    this.pipeline.onQualityChange = (level) => {
      // Cheaper shadows on the lower presets.
      this.sky.setShadowMapSize(level >= 2 ? 1024 : 2048);
      this.sky.setShadowsEnabled(level < 4);
    };

    // --- Interface -----------------------------------------------------------
    this.hud = new Hud({
      onRestart: () => this.restart(),
      onToggleSound: () => this.toggleSound(),
    });
    this.hud.setSoundEnabled(this.sound.enabled);
    this.minimap = new Minimap(minimapCanvas, this.world);
    this.input = new Input({
      onRestart: () => this.restart(),
      onToggleSound: () => this.toggleSound(),
      onFirstInteraction: () => this.sound.unlock(),
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    window.addEventListener('resize', this.resize);
    canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());

    this.restart();
  }

  start(): void {
    if (this.rafId !== 0) return;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  dispose(): void {
    this.stop();
    this.input.dispose();
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.resize);
    this.pipeline.renderer.dispose();
  }

  /** Resets the whole race: car, timer, checkpoints, laps, obstacles and every piece of UI. */
  restart(): void {
    const { world } = this;
    world.reset();
    this.accumulator = 0;
    this.prevX = world.car.x;
    this.prevZ = world.car.z;
    this.prevHeading = world.car.heading;
    this.trailTimer = 0;
    this.lastImpactMessage = -10;

    this.obstacleMeshes.reset();
    this.particles.clear();
    this.chase.snap(world.car.x, world.car.z, world.car.heading);
    this.gates.setLamps(1, false);
    this.gates.setProgress(world.race.nextGate, true);
    this.hud.reset();
    this.hud.showCountdown(String(RACE_CFG.countdownSeconds));
    this.sound.play('countdown');
  }

  private toggleSound(): void {
    this.sound.unlock();
    this.hud.setSoundEnabled(this.sound.toggle());
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.pipeline.setSize(width, height);
    this.chase.setAspect(width / height);
    this.minimap.resize();
  };

  private readonly frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const dt = clamp((now - this.lastTime) / 1000, 0, MAX_FRAME_DT);
    this.lastTime = now;
    if (dt <= 0) return;

    const { world } = this;
    const car = world.car;

    // --- Fixed-step simulation -------------------------------------------------
    this.accumulator += dt;
    const input = this.input.read();
    while (this.accumulator >= FIXED_DT) {
      this.prevX = car.x;
      this.prevZ = car.z;
      this.prevHeading = car.heading;
      world.step(FIXED_DT, input);
      this.accumulator -= FIXED_DT;
      if (world.events.length > 0) this.handleEvents();
    }

    // --- Interpolated presentation -------------------------------------------
    const alpha = this.accumulator / FIXED_DT;
    const x = this.prevX + (car.x - this.prevX) * alpha;
    const z = this.prevZ + (car.z - this.prevZ) * alpha;
    const heading = this.prevHeading + wrapAngle(car.heading - this.prevHeading) * alpha;
    this.viewTime += dt;
    const time = this.viewTime;
    const finished = world.race.phase === 'finished';

    this.carMesh.update(x, z, heading, car, dt, time);
    this.emitTrails(x, z, heading, dt);
    this.particles.update(dt);
    this.obstacleMeshes.update(dt, time);
    this.gates.setProgress(world.race.nextGate, !finished);
    this.gates.update(time);
    this.chase.update(x, z, heading, car.speed, car.boostTimer > 0, finished, dt);
    this.sky.update(this.chase.camera, x, z);

    this.hud.update(world, dt);
    this.minimap.draw(x, z, heading, time);
    this.sound.updateEngine(car.speed / CAR_CFG.maxSpeed, world.race.phase === 'racing' ? input.throttle : 0, !finished);

    this.pipeline.render(this.scene, this.chase.camera, dt);
  };

  /** Continuous effects: shoulder dust, boost exhaust, oil smoke and wall-scrape sparks. */
  private emitTrails(x: number, z: number, heading: number, dt: number): void {
    const { car, loc } = this.world;
    const speed = Math.abs(car.speed);
    this.trailTimer -= dt;
    if (this.trailTimer > 0 || speed < 6) return;
    this.trailTimer = 0.035;

    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const rearX = x - fx * 2.1;
    const rearZ = z - fz * 2.1;
    if (car.boostTimer > 0) {
      this.particles.burst(rearX, 0.45, rearZ, car.vx * 0.3, car.vz * 0.3, 2, PALETTE.cyan, 2.2, 1.5, 1.2, 0.35, 0.11, 2);
    }
    if (car.offroad) {
      this.particles.burst(rearX, 0.1, rearZ, car.vx * 0.15, car.vz * 0.15, 2, 0x4fd0c0, 0.5, 2.2, 3, 0.5, 0.13, 9);
    } else if (car.slipTimer > 0) {
      this.particles.burst(rearX, 0.1, rearZ, car.vx * 0.2, car.vz * 0.2, 1, PALETTE.violet, 1.2, 1.8, 2, 0.5, 0.13, 5);
    }
    const scrapeLimit = TRACK_CFG.wallOffset - CAR_CFG.wallRadius - 0.08;
    if (Math.abs(loc.d) > scrapeLimit && speed > 10) {
      const side = loc.d > 0 ? 1 : -1;
      this.particles.burst(
        x + loc.tz * side * 1.1,
        0.5,
        z - loc.tx * side * 1.1,
        car.vx * 0.5,
        car.vz * 0.5,
        2,
        PALETTE.amber,
        2.4,
        3,
        4,
        0.4,
        0.1,
      );
    }
  }

  /** Turns simulation events into feedback: HUD messages, sounds, particles, camera shake. */
  private handleEvents(): void {
    const { world, hud, sound } = this;
    const { car, loc } = world;
    const events = world.events;
    for (let i = 0; i < events.length; i++) {
      const event: GameEvent = events[i];
      switch (event.type) {
        case 'countdown':
          hud.showCountdown(String(event.value));
          this.gates.setLamps(RACE_CFG.countdownSeconds + 1 - event.value, false);
          sound.play('countdown');
          break;
        case 'go':
          hud.showCountdown('GO!', true);
          this.gates.setLamps(0, true);
          sound.play('go');
          break;
        case 'wall': {
          const strength = clamp(event.impact / 22, 0.15, 1);
          const side = loc.d > 0 ? 1 : -1;
          this.particles.burst(
            car.x + loc.tz * side * 1.1,
            0.6,
            car.z - loc.tx * side * 1.1,
            car.vx * 0.4,
            car.vz * 0.4,
            Math.round(6 + strength * 16),
            PALETTE.amber,
            2.6,
            5 + strength * 5,
            5,
            0.6,
            0.13,
          );
          this.chase.addShake(0.25 + strength * 0.6);
          sound.play('wall', strength);
          hud.flash('bad');
          if (world.time - this.lastImpactMessage > 0.9) {
            hud.showMessage(strength > 0.5 ? 'WALL HIT!' : 'WALL SCRAPE', 'bad', 1.1, 2);
            this.lastImpactMessage = world.time;
          }
          break;
        }
        case 'crash': {
          const strength = clamp(event.impact / 30, 0.25, 1);
          const o = event.obstacle;
          this.particles.burst(o.x, 0.9, o.z, car.vx * 0.3, car.vz * 0.3, 26, PALETTE.amber, 2.8, 9, 7, 0.8, 0.16);
          this.particles.burst(o.x, 0.9, o.z, 0, 0, 10, PALETTE.white, 2.2, 5, 5, 0.5, 0.1);
          this.chase.addShake(0.5 + strength * 0.5);
          sound.play('crash', strength);
          hud.flash('bad');
          hud.showMessage(o.kind === 'drone' ? 'DRONE HIT!' : 'CRASH!', 'bad', 1.3, 3);
          this.lastImpactMessage = world.time;
          break;
        }
        case 'cone':
          this.obstacleMeshes.knockCone(event.obstacle, car.vx, car.vz);
          this.particles.burst(event.obstacle.x, 0.5, event.obstacle.z, car.vx * 0.4, car.vz * 0.4, 8, 0xff6a1a, 2, 4, 4, 0.5, 0.12);
          this.chase.addShake(0.18);
          sound.play('cone');
          hud.showMessage('CONE DOWN  -10% SPEED', 'bad', 1, 1);
          break;
        case 'oil':
          sound.play('oil');
          hud.showMessage('OIL SLICK - SLIPPING!', 'bad', 1.4, 2);
          break;
        case 'boost':
          this.particles.burst(car.x, 0.5, car.z, car.vx * 0.5, car.vz * 0.5, 18, PALETTE.lime, 2.4, 6, 4, 0.6, 0.14, 4);
          sound.play('boost');
          hud.flash('boost');
          hud.showMessage('BOOST!', 'boost', 1.1, 2);
          break;
        case 'offtrack':
          hud.showMessage('OFF TRACK - SLOW ZONE', 'bad', 1.2, 1);
          break;
        case 'wrongway':
          hud.setWrongWay(event.active);
          break;
        case 'checkpoint':
          sound.play('checkpoint');
          hud.flash('good');
          hud.showMessage(`CHECKPOINT ${event.index} / ${event.total}`, 'good', 1.3, 3);
          break;
        case 'lap':
          sound.play('lap');
          hud.flash('good');
          hud.showMessage(
            `LAP ${event.lap} DONE  ${formatTime(event.lapTime)}${event.best && event.lap > 1 ? '  BEST LAP' : ''}`,
            'good',
            2.4,
            4,
          );
          break;
        case 'finish': {
          const previous = loadRecord();
          const isRecord = previous === null || event.time < previous;
          if (isRecord) saveRecord(event.time);
          sound.play('finish');
          hud.flash('good');
          hud.setWrongWay(false);
          hud.showFinish(world, previous, isRecord);
          for (const hex of [PALETTE.cyan, PALETTE.magenta, PALETTE.amber, PALETTE.lime]) {
            this.particles.burst(car.x, 2.5, car.z, car.vx * 0.6, car.vz * 0.6, 22, hex, 2.4, 9, 11, 1.6, 0.18, 9);
          }
          break;
        }
      }
    }
    events.length = 0;
  }
}
