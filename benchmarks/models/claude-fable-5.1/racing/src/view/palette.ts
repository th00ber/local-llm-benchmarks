/** Shared colours of the "Neon Dawn" look: indigo night giving way to a low orange sun. */
export const PALETTE = {
  cyan: 0x2ff3ff,
  magenta: 0xff3fa4,
  amber: 0xffb347,
  lime: 0xa6ff4d,
  violet: 0x8a5cff,
  red: 0xff3b3b,
  white: 0xf2f4ff,

  skyZenith: 0x10164a,
  skyMid: 0x6a3a94,
  skyHorizon: 0xe8837a,
  sunGlow: 0xff9a3d,
  fog: 0xc9788c,

  sunLight: 0xffa866,
  skyLight: 0x7f8cff,
  groundLight: 0x4a2440,

  asphalt: 0x3b3d60,
  shoulder: 0x1d4650,
  wall: 0x1c1e36,
  terrainLow: 0x152447,
  terrainHigh: 0x4a2a6a,
  mountain: 0x2a1f55,
  building: 0x121631,
} as const;

/** Unit vector pointing from the world towards the low morning sun. */
export const SUN_DIRECTION = (() => {
  const x = 0.86;
  const y = 0.2;
  const z = -0.47;
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
})();
