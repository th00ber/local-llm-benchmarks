import * as THREE from 'three';
import { TRACK_CFG } from '../config';
import type { Track } from '../sim/track';
import { PALETTE } from './palette';
import { makeAsphaltTexture, makeCheckerTexture } from './textures';

export const WALL_HEIGHT = 1.15;
export const WALL_THICKNESS = 0.7;

/**
 * Builds a closed strip that follows the centreline. Edge A is at lateral offset dA / height yA,
 * edge B at dB / yB. The visible face has normal = forward x (A - B), e.g. A on the left and
 * B on the right gives an upward facing ribbon.
 */
export function buildStrip(
  track: Track,
  dA: number,
  yA: number,
  dB: number,
  yB: number,
  vScale = 12,
): THREE.BufferGeometry {
  const n = track.count;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const indices: number[] = [];
  for (let row = 0; row <= n; row++) {
    const i = row % n;
    const lx = track.tz[i];
    const lz = -track.tx[i];
    const a = row * 2;
    const b = a + 1;
    positions[a * 3] = track.px[i] + lx * dA;
    positions[a * 3 + 1] = yA;
    positions[a * 3 + 2] = track.pz[i] + lz * dA;
    positions[b * 3] = track.px[i] + lx * dB;
    positions[b * 3 + 1] = yB;
    positions[b * 3 + 2] = track.pz[i] + lz * dB;
    const v = track.cum[row] / vScale;
    uvs[a * 2] = 0;
    uvs[a * 2 + 1] = v;
    uvs[b * 2] = 1;
    uvs[b * 2 + 1] = v;
    if (row < n) {
      const a2 = a + 2;
      const b2 = b + 2;
      indices.push(b, b2, a, a, b2, a2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Individual quads along the centreline for the samples accepted by `include` (dashes, kerbs). */
function buildSegments(
  track: Track,
  dA: number,
  dB: number,
  y: number,
  include: (index: number) => boolean,
  colorOf?: (index: number, out: THREE.Color) => void,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();
  const n = track.count;
  let vertex = 0;
  for (let i = 0; i < n; i++) {
    if (!include(i)) continue;
    const j = (i + 1) % n;
    for (const k of [i, j]) {
      const lx = track.tz[k];
      const lz = -track.tx[k];
      positions.push(track.px[k] + lx * dA, y, track.pz[k] + lz * dA);
      positions.push(track.px[k] + lx * dB, y, track.pz[k] + lz * dB);
    }
    if (colorOf) {
      colorOf(i, color);
      for (let c = 0; c < 4; c++) colors.push(color.r, color.g, color.b);
    }
    // Vertices: a(i), b(i), a(j), b(j)
    indices.push(vertex + 1, vertex + 3, vertex, vertex, vertex + 3, vertex + 2);
    vertex += 4;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colorOf) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function decalMaterial(color: number, intensity = 1): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(intensity),
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  return material;
}

/** Road surface, shoulders, painted lines, kerbs, barrier walls and the start/finish line. */
export function buildTrackMeshes(track: Track): THREE.Group {
  const group = new THREE.Group();
  group.name = 'track';
  const road = TRACK_CFG.roadHalfWidth;
  const wall = TRACK_CFG.wallOffset;

  // --- Asphalt ----------------------------------------------------------------
  const asphalt = new THREE.Mesh(
    buildStrip(track, road, 0, -road, 0, 16),
    new THREE.MeshStandardMaterial({
      color: PALETTE.asphalt,
      map: makeAsphaltTexture(),
      roughness: 0.62,
      metalness: 0.25,
    }),
  );
  asphalt.receiveShadow = true;
  group.add(asphalt);

  // --- Run-off shoulders (driveable, but slow) -----------------------------------
  const shoulderMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.shoulder,
    roughness: 0.95,
    metalness: 0,
  });
  const outer = wall + WALL_THICKNESS;
  for (const side of [1, -1]) {
    const geometry = side === 1 ? buildStrip(track, outer, 0, road, 0) : buildStrip(track, -road, 0, -outer, 0);
    const shoulder = new THREE.Mesh(geometry, shoulderMaterial);
    shoulder.receiveShadow = true;
    group.add(shoulder);
  }

  // --- Painted neon edge lines and centre dashes ---------------------------------
  const lineY = 0.035;
  const leftLine = new THREE.Mesh(buildStrip(track, road - 0.35, lineY, road - 0.7, lineY), decalMaterial(PALETTE.cyan, 1.0));
  const rightLine = new THREE.Mesh(
    buildStrip(track, -road + 0.7, lineY, -road + 0.35, lineY),
    decalMaterial(PALETTE.magenta, 1.15),
  );
  group.add(leftLine, rightLine);

  const dashes = new THREE.Mesh(
    buildSegments(track, 0.14, -0.14, lineY, (i) => i % 6 < 2),
    decalMaterial(0xaeb8e8, 0.8),
  );
  group.add(dashes);

  // --- Kerbs on the bends ----------------------------------------------------------
  const isBend = (i: number) => {
    const n = track.count;
    for (let o = -4; o <= 4; o++) {
      if (Math.abs(track.curvature[(i + o + n) % n]) > 0.0085) return true;
    }
    return false;
  };
  const kerbColor = (i: number, out: THREE.Color) => {
    if (Math.floor(i / 2) % 2 === 0) out.setHex(PALETTE.magenta).multiplyScalar(1.1);
    else out.setHex(PALETTE.white);
  };
  const kerbMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    emissive: 0x331122,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  for (const side of [1, -1]) {
    const dA = side === 1 ? road + 1.5 : -road + 0.05;
    const dB = side === 1 ? road - 0.05 : -road - 1.5;
    const kerb = new THREE.Mesh(buildSegments(track, dA, dB, 0.02, isBend, kerbColor), kerbMaterial);
    kerb.receiveShadow = true;
    group.add(kerb);
  }

  // --- Barrier walls -----------------------------------------------------------------
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.wall,
    roughness: 0.45,
    metalness: 0.6,
  });
  const h = WALL_HEIGHT;
  const bottom = -1;
  // Left wall (positive offsets): inner face, top, outer face.
  const wallStrips: THREE.BufferGeometry[] = [
    buildStrip(track, wall, h, wall, bottom),
    buildStrip(track, outer, h, wall, h),
    buildStrip(track, outer, bottom, outer, h),
    // Right wall (negative offsets).
    buildStrip(track, -wall, bottom, -wall, h),
    buildStrip(track, -wall, h, -outer, h),
    buildStrip(track, -outer, h, -outer, bottom),
  ];
  for (const geometry of wallStrips) {
    const mesh = new THREE.Mesh(geometry, wallMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Neon tubes: one on the inner face, one on top of each wall.
  const eps = 0.02;
  const leftGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.cyan).multiplyScalar(1.15), toneMapped: false });
  const rightGlow = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.magenta).multiplyScalar(1.3),
    toneMapped: false,
  });
  group.add(
    new THREE.Mesh(buildStrip(track, wall - eps, 0.82, wall - eps, 0.62), leftGlow),
    new THREE.Mesh(buildStrip(track, wall + 0.45, h + eps, wall + 0.25, h + eps), leftGlow),
    new THREE.Mesh(buildStrip(track, -wall + eps, 0.62, -wall + eps, 0.82), rightGlow),
    new THREE.Mesh(buildStrip(track, -wall - 0.25, h + eps, -wall - 0.45, h + eps), rightGlow),
  );

  // --- Start / finish line --------------------------------------------------------------
  const checker = new THREE.Mesh(
    new THREE.PlaneGeometry(road * 2, 3),
    new THREE.MeshBasicMaterial({
      map: makeCheckerTexture(18, 3),
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
  );
  checker.rotation.x = -Math.PI / 2;
  const holder = new THREE.Group();
  holder.position.set(track.px[0], 0.03, track.pz[0]);
  holder.rotation.y = Math.atan2(track.tx[0], track.tz[0]);
  holder.add(checker);
  group.add(holder);

  // Grid slot markings where the car starts.
  const slotMaterial = decalMaterial(PALETTE.white, 0.9);
  const slot = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.25), slotMaterial);
  bar.rotation.x = -Math.PI / 2;
  bar.position.set(0, 0, 2.8);
  const sideA = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 2.4), slotMaterial);
  sideA.rotation.x = -Math.PI / 2;
  sideA.position.set(1.6, 0, 1.7);
  const sideB = sideA.clone();
  sideB.position.x = -1.6;
  slot.add(bar, sideA, sideB);
  const gridIndex = track.indexAt(track.length - 14);
  slot.position.set(track.px[gridIndex], 0.03, track.pz[gridIndex]);
  slot.rotation.y = Math.atan2(track.tx[gridIndex], track.tz[gridIndex]);
  group.add(slot);

  return group;
}
