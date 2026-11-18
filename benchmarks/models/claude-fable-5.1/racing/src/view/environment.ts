import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TRACK_CFG } from '../config';
import { createRng, smoothstep } from '../sim/math';
import type { Track } from '../sim/track';
import { PALETTE, SUN_DIRECTION } from './palette';
import { makeCrowdTexture, makeSignTexture, makeWindowTexture } from './textures';
import { WALL_THICKNESS } from './trackMesh';

/** Distance from a point to the track centreline (brute force - only used while building). */
function distanceToTrack(track: Track, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < track.count; i += 2) {
    const dx = x - track.px[i];
    const dz = z - track.pz[i];
    const dist = dx * dx + dz * dz;
    if (dist < best) best = dist;
  }
  return Math.sqrt(best);
}

function terrainNoise(x: number, z: number): number {
  return (
    Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013 + 0.7) * 0.5 +
    Math.sin(x * 0.027 + z * 0.021 + 2.1) * 0.3 +
    Math.cos(x * 0.006 - z * 0.008) * 0.45 +
    0.75
  );
}

function terrainHeight(track: Track, x: number, z: number): number {
  const dist = distanceToTrack(track, x, z);
  const corridor = TRACK_CFG.wallOffset + WALL_THICKNESS;
  const rise = smoothstep(corridor + 14, corridor + 120, dist);
  const rim = smoothstep(420, 1100, Math.hypot(x, z));
  return -0.6 + rise * terrainNoise(x, z) * 9 + rim * 70;
}

interface Footprint {
  x: number;
  z: number;
  r: number;
}

/**
 * Everything around the circuit: low-poly terrain and mountains, a neon skyline, trees,
 * crystals, light pylons, billboards and a grandstand. All generated from a fixed seed.
 */
export function buildEnvironment(track: Track): THREE.Group {
  const group = new THREE.Group();
  group.name = 'environment';
  const rng = createRng(20261111);
  const footprints: Footprint[] = [];
  const corridor = TRACK_CFG.wallOffset + WALL_THICKNESS;

  group.add(buildTerrain(track));
  group.add(buildMountains(rng));
  group.add(buildSkyline(track, rng, footprints, corridor));
  group.add(buildGrandstand(track, footprints));
  group.add(buildBillboards(track, footprints));
  group.add(buildPylons(track));
  group.add(buildTrees(track, rng, footprints, corridor));
  group.add(buildCrystals(track, rng, footprints, corridor));
  return group;
}

function buildTerrain(track: Track): THREE.Mesh {
  const size = 2800;
  const segments = 112;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const low = new THREE.Color(PALETTE.terrainLow);
  const high = new THREE.Color(PALETTE.terrainHigh);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = terrainHeight(track, x, z);
    position.setY(i, y);
    color.copy(low).lerp(high, smoothstep(0, 26, y));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const terrain = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0.05 }),
  );
  terrain.receiveShadow = true;
  return terrain;
}

function buildMountains(rng: () => number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const count = 46;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rng() * 0.1;
    // Keep the peaks lower in front of the sun so it stays visible.
    const towardsSun = Math.max(0, Math.cos(angle) * SUN_DIRECTION.x + Math.sin(angle) * SUN_DIRECTION.z);
    const sunDip = 1 - 0.72 * Math.pow(towardsSun, 6);
    const distance = 900 + rng() * 380;
    const height = (130 + rng() * 230) * sunDip;
    const radius = 150 + rng() * 170;
    const cone = new THREE.ConeGeometry(radius, height, 5 + Math.floor(rng() * 3), 1);
    cone.rotateY(rng() * Math.PI);
    cone.translate(Math.cos(angle) * distance, height / 2 + 20, Math.sin(angle) * distance);
    parts.push(cone);
  }
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: PALETTE.mountain, flatShading: true, roughness: 1, metalness: 0 }),
  );
}

function buildSkyline(track: Track, rng: () => number, footprints: Footprint[], corridor: number): THREE.Group {
  const group = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const roofs: THREE.BufferGeometry[] = [];
  // Districts: [centre x, centre z, radius, building count, max height]
  const districts: Array<[number, number, number, number, number]> = [
    [105, 20, 70, 26, 95],
    [-170, 15, 42, 12, 70],
    [40, 260, 150, 18, 120],
    [-330, -200, 120, 12, 110],
    [-60, -260, 110, 10, 90],
  ];
  for (const [cx, cz, radius, count, maxHeight] of districts) {
    for (let k = 0; k < count; k++) {
      for (let tries = 0; tries < 12; tries++) {
        const angle = rng() * Math.PI * 2;
        const dist = Math.sqrt(rng()) * radius;
        const x = cx + Math.cos(angle) * dist;
        const z = cz + Math.sin(angle) * dist;
        const width = 12 + rng() * 16;
        const depth = 12 + rng() * 16;
        const r = Math.hypot(width, depth) / 2;
        if (distanceToTrack(track, x, z) < corridor + 16 + r) continue;
        if (footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + r + 2)) continue;
        const height = 18 + Math.pow(rng(), 1.6) * maxHeight;
        const box = new THREE.BoxGeometry(width, height, depth);
        const uv = box.attributes.uv as THREE.BufferAttribute;
        const tile = 16;
        for (let v = 0; v < uv.count; v++) {
          // BoxGeometry faces: +x, -x, +y, -y, +z, -z (4 vertices each).
          const face = Math.floor(v / 4);
          const horizontal = face < 2 ? depth : width;
          const vertical = face === 2 || face === 3 ? 0 : height;
          uv.setXY(v, (uv.getX(v) * horizontal) / tile, (uv.getY(v) * vertical) / tile);
        }
        const baseY = terrainHeight(track, x, z);
        box.translate(x, baseY + height / 2 - 1, z);
        parts.push(box);

        // Glowing roof trim.
        const trim = new THREE.BoxGeometry(width + 0.6, 0.5, depth + 0.6);
        trim.translate(x, baseY + height - 1 + 0.25, z);
        roofs.push(trim);
        footprints.push({ x, z, r });
        break;
      }
    }
  }
  const windows = makeWindowTexture();
  const towers = new THREE.Mesh(
    mergeGeometries(parts),
    new THREE.MeshStandardMaterial({
      color: PALETTE.building,
      roughness: 0.6,
      metalness: 0.3,
      emissive: 0xffffff,
      emissiveMap: windows,
      emissiveIntensity: 1.1,
    }),
  );
  const trims = new THREE.Mesh(
    mergeGeometries(roofs),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.magenta).multiplyScalar(1.4), toneMapped: false }),
  );
  for (const part of parts) part.dispose();
  for (const part of roofs) part.dispose();
  group.add(towers, trims);
  return group;
}

function buildGrandstand(track: Track, footprints: Footprint[]): THREE.Group {
  const group = new THREE.Group();
  // On the right-hand side of the main straight, just before the start line.
  const s = track.length - 46;
  const i = track.indexAt(s);
  const tx = track.tx[i];
  const tz = track.tz[i];
  const offset = -(TRACK_CFG.wallOffset + WALL_THICKNESS + 13);
  const x = track.px[i] + tz * offset;
  const z = track.pz[i] - tx * offset;
  group.position.set(x, -0.6, z);
  // Local +Z = driving direction, local +X = towards the track.
  group.rotation.y = Math.atan2(tx, tz);
  footprints.push({ x, z, r: 36 });

  const length = 64;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x23274a, roughness: 0.8, metalness: 0.2 });
  const crowd = makeCrowdTexture();
  crowd.repeat.set(4, 1);
  const crowdMaterial = new THREE.MeshStandardMaterial({
    map: crowd,
    emissive: 0xffffff,
    emissiveMap: crowd,
    emissiveIntensity: 0.55,
    roughness: 0.9,
  });
  const steps = 5;
  for (let k = 0; k < steps; k++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3 * (k + 1), length), concrete);
    step.position.set(6 - k * 2.6, (1.3 * (k + 1)) / 2, 0);
    step.castShadow = true;
    step.receiveShadow = true;
    group.add(step);
    const people = new THREE.Mesh(new THREE.PlaneGeometry(length, 1.1), crowdMaterial);
    people.rotation.y = Math.PI / 2;
    people.position.set(6 - k * 2.6 - 1.25, 1.3 * (k + 1) + 0.55, 0);
    group.add(people);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(15, 0.5, length + 4), concrete);
  roof.position.set(0.5, 11.5, 0);
  roof.rotation.z = -0.1;
  roof.castShadow = true;
  group.add(roof);
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.6, length + 4),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.cyan).multiplyScalar(1.6), toneMapped: false }),
  );
  edge.position.set(7.9, 10.8, 0);
  group.add(edge);
  for (const pz of [-length / 2, -length / 6, length / 6, length / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 12, 0.6), concrete);
    post.position.set(-6.4, 6, pz);
    post.castShadow = true;
    group.add(post);
  }
  return group;
}

function buildBillboards(track: Track, footprints: Footprint[]): THREE.Group {
  const group = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x1b1e3a, roughness: 0.5, metalness: 0.6 });
  // [lap fraction, side (+1 left / -1 right), text, subtitle, colour, accent]
  const boards: Array<[number, number, string, string, string, string]> = [
    [0.07, 1, 'SUNRISE CIRCUIT', '3 LAPS  //  5 CHECKPOINTS', '#ffb347', '#ff3fa4'],
    [0.2, -1, 'TURBO VOLT', 'CHARGE AHEAD', '#2ff3ff', '#a6ff4d'],
    [0.33, -1, 'HYPERLINE', 'TYRES OF TOMORROW', '#ff3fa4', '#2ff3ff'],
    [0.47, 1, 'NOVA COLA', 'TASTE THE DAWN', '#a6ff4d', '#ffb347'],
    [0.62, -1, 'ION DRIVE', 'ZERO LAG', '#2ff3ff', '#ff3fa4'],
    [0.77, 1, 'PHOTON', 'LIGHT SPEED LOGISTICS', '#ffb347', '#8a5cff'],
    [0.9, -1, 'LAST SECTOR', 'PUSH  PUSH  PUSH', '#ff3fa4', '#ffb347'],
  ];
  for (const [fraction, side, text, subtitle, color, accent] of boards) {
    const i = track.indexAt(fraction * track.length);
    const tx = track.tx[i];
    const tz = track.tz[i];
    const offset = side * (TRACK_CFG.wallOffset + WALL_THICKNESS + 12);
    const x = track.px[i] + tz * offset;
    const z = track.pz[i] - tx * offset;
    const holder = new THREE.Group();
    holder.position.set(x, -0.6, z);
    // Face the approaching cars, slightly turned towards the road.
    holder.rotation.y = Math.atan2(tx, tz) + Math.PI + side * 0.45;
    footprints.push({ x, z, r: 10 });

    const texture = makeSignTexture(text, { width: 768, height: 256, subtitle, color, accent });
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 5),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    panel.position.set(0, 9.5, 0.2);
    const back = new THREE.Mesh(new THREE.BoxGeometry(15.5, 5.5, 0.3), frame);
    back.position.set(0, 9.5, 0);
    back.castShadow = true;
    holder.add(panel, back);
    for (const px of [-5, 5]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.5, 0.5), frame);
      leg.position.set(px, 3.4, -0.1);
      leg.castShadow = true;
      holder.add(leg);
    }
    group.add(holder);
  }
  return group;
}

function buildPylons(track: Track): THREE.Group {
  const group = new THREE.Group();
  const spacing = 34;
  const count = Math.floor(track.length / spacing);
  const height = 7.5;

  const pole = new THREE.BoxGeometry(0.28, height, 0.28);
  pole.translate(0, height / 2 - 0.6, 0);
  const arm = new THREE.BoxGeometry(2.6, 0.2, 0.2);
  arm.translate(-1.2, height - 0.7, 0);
  const poleGeometry = mergeGeometries([pole, arm]);
  pole.dispose();
  arm.dispose();
  const lampGeometry = new THREE.BoxGeometry(1.5, 0.16, 0.5);
  lampGeometry.translate(-1.9, height - 0.85, 0);

  const poles = new THREE.InstancedMesh(
    poleGeometry,
    new THREE.MeshStandardMaterial({ color: 0x1b1e3a, roughness: 0.5, metalness: 0.7 }),
    count,
  );
  const lamps = new THREE.InstancedMesh(lampGeometry, new THREE.MeshBasicMaterial({ toneMapped: false }), count);
  poles.castShadow = true;

  const dummy = new THREE.Object3D();
  const cyan = new THREE.Color(PALETTE.cyan).multiplyScalar(1.8);
  const magenta = new THREE.Color(PALETTE.magenta).multiplyScalar(1.9);
  for (let k = 0; k < count; k++) {
    const i = track.indexAt(k * spacing + 9);
    const side = k % 2 === 0 ? 1 : -1;
    const offset = side * (TRACK_CFG.wallOffset + WALL_THICKNESS + 1.1);
    dummy.position.set(track.px[i] + track.tz[i] * offset, 0, track.pz[i] - track.tx[i] * offset);
    // The arm (local -X) must reach over the wall towards the road.
    const heading = Math.atan2(track.tx[i], track.tz[i]);
    dummy.rotation.set(0, side === 1 ? heading : heading + Math.PI, 0);
    dummy.updateMatrix();
    poles.setMatrixAt(k, dummy.matrix);
    lamps.setMatrixAt(k, dummy.matrix);
    lamps.setColorAt(k, side === 1 ? cyan : magenta);
  }
  poles.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;
  if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  group.add(poles, lamps);
  return group;
}

function paintGeometry(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function buildTrees(track: Track, rng: () => number, footprints: Footprint[], corridor: number): THREE.InstancedMesh {
  const trunk = paintGeometry(new THREE.CylinderGeometry(0.28, 0.4, 2.2, 5), 0x2b1d3f);
  trunk.translate(0, 1.1, 0);
  const lower = paintGeometry(new THREE.ConeGeometry(2.3, 4.2, 6), 0x0f5a66);
  lower.translate(0, 3.9, 0);
  const upper = paintGeometry(new THREE.ConeGeometry(1.6, 3.6, 6), 0x18808a);
  upper.translate(0, 6.3, 0);
  const geometry = mergeGeometries([trunk, lower, upper]);
  trunk.dispose();
  lower.dispose();
  upper.dispose();

  const max = 340;
  const trees = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }),
    max,
  );
  trees.castShadow = true;
  const dummy = new THREE.Object3D();
  let placed = 0;
  for (let tries = 0; tries < max * 12 && placed < max; tries++) {
    const x = (rng() - 0.5) * 760;
    const z = (rng() - 0.5) * 560;
    const dist = distanceToTrack(track, x, z);
    if (dist < corridor + 4.5 || dist > corridor + 95) continue;
    // Denser near the road, sparser further out.
    if (rng() > 1.15 - (dist - corridor) / 110) continue;
    if (footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + 2.5)) continue;
    const scale = 0.75 + rng() * 0.9;
    dummy.position.set(x, terrainHeight(track, x, z) - 0.2, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(scale, scale * (0.85 + rng() * 0.4), scale);
    dummy.updateMatrix();
    trees.setMatrixAt(placed++, dummy.matrix);
  }
  trees.count = placed;
  trees.instanceMatrix.needsUpdate = true;
  return trees;
}

function buildCrystals(track: Track, rng: () => number, footprints: Footprint[], corridor: number): THREE.InstancedMesh {
  const geometry = new THREE.OctahedronGeometry(1, 0);
  geometry.scale(0.7, 1.8, 0.7);
  const max = 70;
  // Per-instance colours make each crystal glow in its own neon tint.
  const crystals = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ toneMapped: false }), max);
  const dummy = new THREE.Object3D();
  const colors = [PALETTE.cyan, PALETTE.magenta, PALETTE.violet, PALETTE.amber];
  const color = new THREE.Color();
  let placed = 0;
  for (let tries = 0; tries < max * 20 && placed < max; tries++) {
    const x = (rng() - 0.5) * 820;
    const z = (rng() - 0.5) * 620;
    const dist = distanceToTrack(track, x, z);
    if (dist < corridor + 7 || dist > corridor + 150) continue;
    if (footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + 3)) continue;
    const scale = 0.8 + rng() * 1.8;
    dummy.position.set(x, terrainHeight(track, x, z) + scale * 1.1, z);
    dummy.rotation.set((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    crystals.setMatrixAt(placed, dummy.matrix);
    color.setHex(colors[Math.floor(rng() * colors.length)]).multiplyScalar(0.9 + rng() * 0.8);
    crystals.setColorAt(placed, color);
    placed++;
  }
  crystals.count = placed;
  crystals.instanceMatrix.needsUpdate = true;
  if (crystals.instanceColor) crystals.instanceColor.needsUpdate = true;
  return crystals;
}
