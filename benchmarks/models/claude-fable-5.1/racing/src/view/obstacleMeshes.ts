import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Obstacle } from '../sim/obstacles';
import { PALETTE } from './palette';
import { makeChevronTexture, makeGlowTexture, makeHazardTexture } from './textures';

interface ConeVisual {
  obstacle: Obstacle;
  mesh: THREE.Mesh;
  flying: boolean;
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinZ: number;
  life: number;
}

interface DroneVisual {
  obstacle: Obstacle;
  group: THREE.Group;
  ring: THREE.Mesh;
  shadowDisc: THREE.Mesh;
}

/** Visuals for the hazards and boost pads. Solid objects cast shadows; triggers are flat decals. */
export class ObstacleMeshes {
  readonly group = new THREE.Group();
  private readonly cones: ConeVisual[] = [];
  private readonly drones: DroneVisual[] = [];
  private readonly chevrons = makeChevronTexture();
  private readonly oilRings: THREE.MeshBasicMaterial[] = [];

  constructor(obstacles: ReadonlyArray<Obstacle>) {
    this.group.name = 'obstacles';
    const glowTexture = makeGlowTexture();

    // --- Shared resources -------------------------------------------------------
    const hazard = makeHazardTexture();
    hazard.repeat.set(2, 1);
    const barrierMaterial = new THREE.MeshStandardMaterial({
      map: hazard,
      emissive: 0xffffff,
      emissiveMap: hazard,
      emissiveIntensity: 0.55,
      roughness: 0.5,
      metalness: 0.2,
    });
    const barrierGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber).multiplyScalar(2), toneMapped: false });

    const coneBody = new THREE.ConeGeometry(0.42, 1.0, 8);
    coneBody.translate(0, 0.56, 0);
    paint(coneBody, new THREE.Color(0xff6a1a).multiplyScalar(1.5));
    const coneBand = new THREE.CylinderGeometry(0.235, 0.3, 0.16, 8);
    coneBand.translate(0, 0.5, 0);
    paint(coneBand, new THREE.Color(0xffffff).multiplyScalar(1.8));
    const coneBase = new THREE.BoxGeometry(0.95, 0.07, 0.95);
    coneBase.translate(0, 0.035, 0);
    paint(coneBase, new THREE.Color(0xff6a1a).multiplyScalar(0.9));
    const coneGeometry = mergeGeometries([coneBody, coneBand, coneBase]);
    const coneMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      emissive: 0xff4a00,
      emissiveIntensity: 0.35,
      flatShading: true,
    });

    const droneBody = new THREE.IcosahedronGeometry(1.2, 0);
    const droneMaterial = new THREE.MeshStandardMaterial({ color: 0x23203f, roughness: 0.3, metalness: 0.5, flatShading: true });
    const droneGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.red).multiplyScalar(2.6), toneMapped: false });
    const ringGeometry = new THREE.TorusGeometry(1.6, 0.11, 6, 20);
    const beamGeometry = new THREE.CylinderGeometry(0.25, 1.5, 1.5, 12, 1, true);
    beamGeometry.translate(0, -0.75, 0);
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.red).multiplyScalar(1.6),
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    ringGeometry.rotateX(Math.PI / 2);
    const eyeGeometry = new THREE.SphereGeometry(0.36, 10, 8);
    const discGeometry = new THREE.PlaneGeometry(5, 5);
    discGeometry.rotateX(-Math.PI / 2);
    const discMaterial = new THREE.MeshBasicMaterial({
      map: glowTexture,
      color: new THREE.Color(PALETTE.red).multiplyScalar(1.4),
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    const oilMaterial = new THREE.MeshStandardMaterial({
      color: 0x07040f,
      roughness: 0.04,
      metalness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });

    this.chevrons.repeat.set(1, 2);
    const padMaterial = new THREE.MeshBasicMaterial({
      map: this.chevrons,
      color: new THREE.Color(PALETTE.lime).multiplyScalar(1.8),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const padBaseMaterial = new THREE.MeshBasicMaterial({
      color: 0x0c2a14,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const padEdgeMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lime).multiplyScalar(2), toneMapped: false });

    // --- Instances -----------------------------------------------------------------
    for (const o of obstacles) {
      const heading = Math.atan2(o.tx, o.tz);
      switch (o.kind) {
        case 'barrier': {
          const holder = new THREE.Group();
          holder.position.set(o.x, 0, o.z);
          holder.rotation.y = heading;
          const block = new THREE.Mesh(new THREE.BoxGeometry(o.halfWidth * 2, 1.25, o.halfDepth * 2), barrierMaterial);
          block.position.y = 0.625;
          block.castShadow = true;
          block.receiveShadow = true;
          const cap = new THREE.Mesh(new THREE.BoxGeometry(o.halfWidth * 2 + 0.1, 0.14, o.halfDepth * 2 + 0.1), barrierGlow);
          cap.position.y = 1.32;
          holder.add(block, cap);
          for (const side of [1, -1]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.16), barrierGlow);
            post.position.set(side * (o.halfWidth - 0.2), 1.8, 0);
            holder.add(post);
          }
          this.group.add(holder);
          break;
        }
        case 'cone': {
          const mesh = new THREE.Mesh(coneGeometry, coneMaterial);
          mesh.castShadow = true;
          mesh.position.set(o.x, 0, o.z);
          this.group.add(mesh);
          this.cones.push({ obstacle: o, mesh, flying: false, vx: 0, vy: 0, vz: 0, spinX: 0, spinZ: 0, life: 0 });
          break;
        }
        case 'drone': {
          const group = new THREE.Group();
          const body = new THREE.Mesh(droneBody, droneMaterial);
          body.castShadow = true;
          const ring = new THREE.Mesh(ringGeometry, droneGlow);
          const eyeFront = new THREE.Mesh(eyeGeometry, droneGlow);
          eyeFront.position.z = -0.98;
          const eyeBack = new THREE.Mesh(eyeGeometry, droneGlow);
          eyeBack.position.z = 0.98;
          const beam = new THREE.Mesh(beamGeometry, beamMaterial);
          beam.renderOrder = 3;
          group.add(body, ring, eyeFront, eyeBack, beam);
          group.rotation.y = heading;
          const shadowDisc = new THREE.Mesh(discGeometry, discMaterial);
          shadowDisc.renderOrder = 2;
          this.group.add(group, shadowDisc);
          this.drones.push({ obstacle: o, group, ring, shadowDisc });
          break;
        }
        case 'oil': {
          const holder = new THREE.Group();
          holder.position.set(o.x, 0.025, o.z);
          holder.rotation.y = heading + o.id;
          const puddle = new THREE.Mesh(new THREE.CircleGeometry(o.radius, 9), oilMaterial);
          puddle.rotation.x = -Math.PI / 2;
          puddle.scale.set(1, 0.82, 1);
          puddle.receiveShadow = true;
          const ringMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(PALETTE.violet).multiplyScalar(1.6),
            toneMapped: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
          });
          const ring = new THREE.Mesh(new THREE.RingGeometry(o.radius * 0.9, o.radius * 1.08, 9), ringMaterial);
          ring.rotation.x = -Math.PI / 2;
          ring.scale.set(1, 0.82, 1);
          ring.position.y = 0.01;
          // Iridescent sheen so the slick reads clearly on the dark asphalt.
          const sheenMaterial = new THREE.MeshBasicMaterial({
            map: glowTexture,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            polygonOffset: true,
            polygonOffsetFactor: -5,
            polygonOffsetUnits: -5,
          });
          const sheen = new THREE.Mesh(new THREE.PlaneGeometry(o.radius * 2.1, o.radius * 1.7), sheenMaterial);
          sheen.rotation.x = -Math.PI / 2;
          sheen.position.y = 0.02;
          sheen.renderOrder = 2;
          holder.add(puddle, ring, sheen);
          this.oilRings.push(ringMaterial, sheenMaterial);
          this.group.add(holder);
          break;
        }
        case 'boost': {
          const holder = new THREE.Group();
          holder.position.set(o.x, 0.03, o.z);
          holder.rotation.y = heading;
          const width = o.halfWidth * 2;
          const depth = o.halfDepth * 2;
          const base = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), padBaseMaterial);
          base.rotation.x = -Math.PI / 2;
          const arrows = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), padMaterial);
          // After this rotation the texture's "up" points along the driving direction.
          arrows.rotation.x = -Math.PI / 2;
          arrows.rotation.z = Math.PI;
          arrows.position.y = 0.015;
          arrows.renderOrder = 2;
          holder.add(base, arrows);
          for (const side of [1, -1]) {
            const edge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, depth), padEdgeMaterial);
            edge.position.set(side * (width / 2), 0.04, 0);
            holder.add(edge);
          }
          this.group.add(holder);
          break;
        }
      }
    }
  }

  /** Launches a cone that the car just hit. */
  knockCone(obstacle: Obstacle, carVX: number, carVZ: number): void {
    const cone = this.cones.find((c) => c.obstacle === obstacle);
    if (!cone) return;
    cone.flying = true;
    cone.life = 0;
    const speed = Math.hypot(carVX, carVZ);
    const sideways = (obstacle.id % 2 === 0 ? 1 : -1) * (2 + speed * 0.08);
    const nx = speed > 0.1 ? carVX / speed : 0;
    const nz = speed > 0.1 ? carVZ / speed : 1;
    cone.vx = carVX * 0.55 + nz * sideways;
    cone.vz = carVZ * 0.55 - nx * sideways;
    cone.vy = 4.5 + speed * 0.09;
    cone.spinX = 6 + (obstacle.id % 3) * 2;
    cone.spinZ = -5 + (obstacle.id % 4) * 3;
  }

  /** Puts every knocked cone back (race restart). */
  reset(): void {
    for (const cone of this.cones) {
      cone.flying = false;
      cone.mesh.visible = true;
      cone.mesh.position.set(cone.obstacle.x, 0, cone.obstacle.z);
      cone.mesh.rotation.set(0, 0, 0);
    }
  }

  update(dt: number, time: number): void {
    for (const cone of this.cones) {
      if (!cone.flying) continue;
      cone.life += dt;
      cone.vy -= 22 * dt;
      const position = cone.mesh.position;
      position.x += cone.vx * dt;
      position.y += cone.vy * dt;
      position.z += cone.vz * dt;
      if (position.y < 0.12) {
        position.y = 0.12;
        cone.vy = Math.abs(cone.vy) * 0.35;
        cone.vx *= 0.6;
        cone.vz *= 0.6;
        cone.spinX *= 0.5;
        cone.spinZ *= 0.5;
        if (cone.vy < 0.8) cone.vy = 0;
      }
      cone.mesh.rotation.x += cone.spinX * dt;
      cone.mesh.rotation.z += cone.spinZ * dt;
      if (cone.life > 4) {
        cone.flying = false;
        cone.mesh.visible = false;
      }
    }

    for (const drone of this.drones) {
      const o = drone.obstacle;
      const hover = 1.5 + Math.sin(time * 3 + o.phase) * 0.15;
      drone.group.position.set(o.x, hover, o.z);
      drone.ring.rotation.y = time * 2.5;
      drone.ring.rotation.z = Math.sin(time * 1.7 + o.phase) * 0.25;
      drone.shadowDisc.position.set(o.x, 0.05, o.z);
    }

    this.chevrons.offset.y = -(time * 1.6) % 1;
    const shimmer = 1.2 + 0.6 * Math.sin(time * 4);
    for (let i = 0; i < this.oilRings.length; i++) {
      const hue = 0.74 + 0.14 * Math.sin(time * 1.3 + i * 0.5);
      this.oilRings[i].color.setHSL(hue, 1, 0.55).multiplyScalar(shimmer);
    }
  }
}

function paint(geometry: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
