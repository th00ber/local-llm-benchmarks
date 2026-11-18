import * as THREE from 'three';
import { createRng } from '../sim/math';
import { PALETTE, SUN_DIRECTION } from './palette';

const SKY_RADIUS = 2400;

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uSunTop;
  uniform vec3 uSunBottom;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    // Early morning gradient: warm haze on the horizon, violet above, indigo at the zenith.
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
    col = mix(col, uZenith, smoothstep(0.14, 0.7, h));
    col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.12, h));

    // Sunward glow hugging the horizon plus a halo around the sun.
    float sd = dot(d, uSunDir);
    float azimuth = max(0.0, dot(normalize(d.xz + vec2(1e-5)), normalize(uSunDir.xz)));
    float band = exp(-abs(h - 0.02) * 6.5);
    col += uGlow * pow(azimuth, 5.0) * band * 0.85;
    col += uGlow * pow(max(sd, 0.0), 28.0) * 0.55;

    // Big low sun with retro horizontal cut-outs on its lower half.
    const float sunRadius = 0.105;
    float dist = acos(clamp(sd, -1.0, 1.0));
    float disc = 1.0 - smoothstep(sunRadius - 0.003, sunRadius, dist);
    float rel = (h - uSunDir.y) / sunRadius;
    float stripePhase = fract((rel + 1.0) * 4.5);
    float stripeWidth = mix(0.62, 0.08, clamp(rel + 0.75, 0.0, 1.0));
    float cut = rel < 0.25 ? step(stripeWidth, stripePhase) : 1.0;
    vec3 sunCol = mix(uSunBottom, uSunTop, clamp(rel * 0.5 + 0.5, 0.0, 1.0));
    col = mix(col, sunCol, disc * cut);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Sky dome, stars and the low-angled morning lighting rig. */
export class Sky {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly sunDirection = new THREE.Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z);
  private readonly dome: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly shadowTarget = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uSunDir: { value: this.sunDirection },
        uZenith: { value: new THREE.Color(PALETTE.skyZenith) },
        uMid: { value: new THREE.Color(PALETTE.skyMid) },
        uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        uGlow: { value: new THREE.Color(PALETTE.sunGlow) },
        uSunTop: { value: new THREE.Color(0xfff0b0).multiplyScalar(3.2) },
        uSunBottom: { value: new THREE.Color(0xff4f7a).multiplyScalar(2.4) },
      },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 20), material);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // A few last stars high in the sky, away from the sun.
    const rng = createRng(1234);
    const starCount = 420;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let tries = 0; tries < 20; tries++) {
        const u = rng() * Math.PI * 2;
        y = 0.32 + rng() * 0.68;
        const r = Math.sqrt(1 - y * y);
        x = Math.cos(u) * r;
        z = Math.sin(u) * r;
        if (x * SUN_DIRECTION.x + z * SUN_DIRECTION.z < 0.55) break;
      }
      positions[i * 3] = x * (SKY_RADIUS - 60);
      positions[i * 3 + 1] = y * (SKY_RADIUS - 60);
      positions[i * 3 + 2] = z * (SKY_RADIUS - 60);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0xdfe6ff,
        size: 1.8,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        fog: false,
      }),
    );
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);
    scene.add(this.group);

    // Low, warm key light: long shadows across the track.
    this.sun = new THREE.DirectionalLight(PALETTE.sunLight, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -70;
    cam.right = 70;
    cam.top = 70;
    cam.bottom = -70;
    cam.near = 10;
    cam.far = 520;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Cool sky fill and a faint magenta bounce from the ground.
    scene.add(new THREE.HemisphereLight(PALETTE.skyLight, PALETTE.groundLight, 1.25));
    // Rim light from the opposite side so shapes stay readable in shadow.
    const rim = new THREE.DirectionalLight(0x5f7bff, 0.55);
    rim.position.set(-SUN_DIRECTION.x, 0.6, -SUN_DIRECTION.z);
    scene.add(rim);

    scene.fog = new THREE.Fog(PALETTE.fog, 140, 1500);
  }

  /**
   * Bakes the procedural sky into an environment map, so glossy surfaces (car paint, glass,
   * wet-looking asphalt) pick up the colours of the dawn sky.
   */
  createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(this.dome.geometry, this.dome.material));
    const target = pmrem.fromScene(envScene, 0.02, 1, 5000);
    pmrem.dispose();
    return target.texture;
  }

  setShadowsEnabled(enabled: boolean): void {
    this.sun.castShadow = enabled;
  }

  setShadowMapSize(size: number): void {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /** Keeps the dome centred on the camera and the shadow frustum centred around the car. */
  update(camera: THREE.Camera, focusX: number, focusZ: number): void {
    this.group.position.copy(camera.position);

    // Snap the shadow focus to a coarse grid to avoid shimmering edges while driving.
    const snap = 4;
    this.shadowTarget.set(Math.round(focusX / snap) * snap, 0, Math.round(focusZ / snap) * snap);
    this.sun.target.position.copy(this.shadowTarget);
    this.sun.position.copy(this.shadowTarget).addScaledVector(this.sunDirection, 260);
  }
}
