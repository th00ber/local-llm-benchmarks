/** Central gameplay tunables. Distances are metres, speeds m/s, angles radians. */

export const TRACK_CFG = {
  /** Half width of the asphalt. */
  roadHalfWidth: 9,
  /** Distance from the centreline to the barrier walls (asphalt + run-off shoulder). */
  wallOffset: 12.5,
  /** Distance between centreline samples. */
  sampleSpacing: 2,
} as const;

export const CAR_CFG = {
  /** Collision radius against walls. */
  wallRadius: 1.15,
  /** Collision radius against obstacles. */
  bodyRadius: 1.25,

  maxSpeed: 60,
  boostMaxSpeed: 78,
  maxReverseSpeed: 14,
  offroadMaxSpeed: 24,

  engineAccel: 27,
  boostAccel: 46,
  brakeDecel: 48,
  reverseAccel: 16,
  /** Constant rolling resistance + speed proportional drag used when coasting. */
  rollingDecel: 2.5,
  coastDrag: 0.22,
  /** Deceleration applied while above the off-road speed limit. */
  offroadDecel: 26,

  /** Steering input smoothing (units of full lock per second). */
  steerInRate: 5.5,
  steerOutRate: 8,
  /** Tightest turn radius at low speed. */
  minTurnRadius: 6.5,
  /** Lateral acceleration budget: limits yaw rate at high speed (speed-dependent steering). */
  lateralGrip: 42,
  maxYawRate: 2.2,

  /** How quickly sideways velocity is killed (1/s). Lower = more drift. */
  gripRate: 12,
  offroadGripRate: 6,
  slipGripRate: 1.2,
  slipSteerFactor: 0.55,

  slipDuration: 1.5,
  boostDuration: 1.8,
} as const;

export const RACE_CFG = {
  laps: 3,
  countdownSeconds: 3,
  /** Distance behind the start/finish line where the car is placed on the grid. */
  gridOffset: 14,
} as const;

/** Fixed physics step. Rendering interpolates between steps. */
export const FIXED_DT = 1 / 120;
export const MAX_FRAME_DT = 0.1;
