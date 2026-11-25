// locomotion.js - walk/climb controller math for the sandbox (Step 5.7).
//
// ES module, imported by map-sandbox.html (like sandbox-api.js) and
// by the Node tests. The Python package (brier-bot/locomotion/) is
// the SOURCE OF TRUTH for the constants; this file mirrors them
// literally, and the Python cross-validation test asserts they match.
//
// The mirror shares the MATH (gait selection, phase, costs, grip,
// climb speed). The sandbox's steering owns the velocity integration
// (it already moves creatures); the Python controllers own the full
// step loop. Both call the same functions below - the gait a
// creature shows in the sandbox is the gait the Python controller
// would select at the same speed, and the climb it attempts is the
// climb the Python controller would attempt on the same slope.
//
// Grounded in the locomotion docs (walking = inverted pendulum,
// §5.1; Walk -> Trot -> Canter -> Gallop with velocity, §5.2;
// climbing by claws / adhesion / friction) and the shipped Unified
// model's Froude gait bands (brier_unified_model.py:140-143).

// --- Constants (mirrored literally from locomotion/constants.py) ---
export const G = 9.81;
export const CLIMB_SLOPE_MIN = 0.35;
export const WALK_BASE_COST = 0.24;
export const LIFT_K = 1.0;
export const CLIMB_BASE_COST = 0.5;
export const REST_GAIN = 0.6;
export const STEP_LENGTH_FRACTION = 0.65;
export const LEG_POWER_PER_KG = 4.0;
export const MUSCLE_EFFICIENCY = 0.25;
export const SLIP_MAX_SPEED = 5.0;
export const GAIT_COST = { walk: 1.0, trot: 1.6, canter: 2.4, gallop: 3.5 };
export const GRIP_LIMIT = { friction: 0.7, claws: 1.0, adhesion: 2.0 };
export const GAITS = ["walk", "trot", "canter", "gallop"];
// Sandbox mirror leg lengths (world units, matching the rig
// proportions) and grip by group (beavers have claws).
export const SANDBOX_LEG_LENGTH = { land: 0.35, humanoid: 0.62 };
export const SANDBOX_GRIP = { land: "claws", humanoid: "friction" };

// Froude band edges (the Unified model's smoothstep thresholds).
const WALK_FADE = [0.3, 0.7];
const TROT_FADE = [1.2, 2.0];
const CANTER_FADE = [2.2, 3.0];

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function finiteNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("BAD_ARGUMENT: " + field + " must be a finite number");
  }
  return value;
}

export function froude(speed, legLength) {
  const v = finiteNumber(speed, "speed");
  const leg = finiteNumber(legLength, "legLength");
  if (v < 0) throw new Error("BAD_ARGUMENT: speed must be >= 0");
  if (leg <= 0) throw new Error("BAD_ARGUMENT: legLength must be > 0");
  return (v * v) / (G * leg);
}

export function gaitWeights(fr) {
  const f = finiteNumber(fr, "froude");
  if (f < 0) throw new Error("BAD_ARGUMENT: froude must be >= 0");
  const walk = 1 - smoothstep(WALK_FADE[0], WALK_FADE[1], f);
  const trot = smoothstep(WALK_FADE[0], WALK_FADE[1], f) *
    (1 - smoothstep(TROT_FADE[0], TROT_FADE[1], f));
  const canter = smoothstep(TROT_FADE[0], TROT_FADE[1], f) *
    (1 - smoothstep(CANTER_FADE[0], CANTER_FADE[1], f));
  const gallop = smoothstep(CANTER_FADE[0], CANTER_FADE[1], f);
  return { walk, trot, canter, gallop };
}

export function dominantGait(fr) {
  // Ties break toward the slower gait (the 1e-9 epsilon keeps
  // float noise at a band midpoint from flipping the gait).
  const weights = gaitWeights(fr);
  let best = GAITS[0];
  for (const gait of GAITS.slice(1)) {
    if (weights[gait] > weights[best] + 1e-9) best = gait;
  }
  return best;
}

export function stepLength(legLength) {
  const leg = finiteNumber(legLength, "legLength");
  if (leg <= 0) throw new Error("BAD_ARGUMENT: legLength must be > 0");
  return STEP_LENGTH_FRACTION * leg;
}

export function strideLength(legLength) {
  return 2 * stepLength(legLength);
}

export function phaseAdvance(distance, legLength) {
  const d = finiteNumber(distance, "distance");
  if (d < 0) throw new Error("BAD_ARGUMENT: distance must be >= 0");
  return (d / strideLength(legLength)) * 2 * Math.PI;
}

export function comHeight(phase, legLength) {
  const p = finiteNumber(phase, "phase");
  const leg = finiteNumber(legLength, "legLength");
  if (leg <= 0) throw new Error("BAD_ARGUMENT: legLength must be > 0");
  const step = stepLength(leg);
  const theta = Math.asin(Math.min(1, step / (2 * leg)));
  return leg * Math.cos(theta * Math.cos(p));
}

export function gripLimit(grip) {
  if (!(grip in GRIP_LIMIT)) {
    throw new Error("BAD_GRIP: unknown grip mode " + JSON.stringify(grip));
  }
  return GRIP_LIMIT[grip];
}

export function climbMaxSpeed(slope) {
  const s = finiteNumber(slope, "slope");
  if (s <= 0) return Infinity;
  return LEG_POWER_PER_KG / (G * Math.sin(Math.atan(s)));
}

// Energy cost rates (%/s on the 0-100 scale).
export function walkCostRate(gait, slope, speed) {
  if (!(gait in GAIT_COST)) {
    throw new Error("BAD_ARGUMENT: unknown gait " + JSON.stringify(gait));
  }
  const s = finiteNumber(slope, "slope");
  const v = finiteNumber(speed, "speed");
  return WALK_BASE_COST * GAIT_COST[gait] + LIFT_K * Math.max(0, s) * v;
}

export function climbCostRate(slope, climbSpeed) {
  const s = finiteNumber(slope, "slope");
  const v = finiteNumber(climbSpeed, "climbSpeed");
  return CLIMB_BASE_COST + LIFT_K * s * v;
}

// The climb decision for a slope/grip/energy triple. Returns
// {state, gripLimit, margin, climbSpeed}: 'flat' below the
// threshold, 'climbing' within grip, 'slipping' past it,
// 'holding' when exhausted below the limit (static friction
// holds without muscle). The caller owns the position update.
export function climbFor(slope, grip, energy) {
  const s = finiteNumber(slope, "slope");
  const e = finiteNumber(energy, "energy");
  const limit = gripLimit(grip);
  if (s <= CLIMB_SLOPE_MIN) {
    return { state: "flat", gripLimit: limit, margin: limit - s,
             climbSpeed: 0 };
  }
  if (s > limit) {
    return { state: "slipping", gripLimit: limit, margin: limit - s,
             climbSpeed: 0 };
  }
  if (e <= 0) {
    return { state: "holding", gripLimit: limit, margin: limit - s,
             climbSpeed: 0 };
  }
  return { state: "climbing", gripLimit: limit, margin: limit - s,
           climbSpeed: climbMaxSpeed(s) };
}

// Slide acceleration (m/s^2) while slipping on a slope past the
// grip limit: g*(sin(theta) - mu*cos(theta)). Never negative
// (at the limit exactly, friction holds).
export function slipAccel(slope, grip) {
  const s = finiteNumber(slope, "slope");
  const mu = gripLimit(grip);
  const theta = Math.atan(s);
  return Math.max(0, G * (Math.sin(theta) - mu * Math.cos(theta)));
}
