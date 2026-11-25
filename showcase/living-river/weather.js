// weather.js - ice math + the seeded weather driver (Step 5.8).
//
// ES module, imported by map-sandbox.html (like locomotion.js)
// and by the Node tests. The Python module (brier-bot/uelse/
// ice.py) is the SOURCE OF TRUTH for the ice constants; this
// file mirrors them literally, and the Python cross-validation
// test asserts they match and the pure functions agree on
// identical inputs.
//
// The mirror shares the MATH (Stefan growth, degree-day melt,
// the step). The sandbox's solver owns the per-cell ice field
// (it already owns the water field); the Python IceField owns
// the full field step. Both call the same functions below -
// the ice a player sees in the sandbox is the ice the Python
// model would grow at the same temperature.
//
// The seeded driver (weatherAt) is the sandbox's own weather:
// a PURE function of (seed, t, season), deterministic - the
// same inputs give the same {temp, rain, wind}. Its shapes
// mirror simulation_river/weather.py (diurnal 3600 s, storm
// 311 s); its phases come from mulberry32(seed), so seeds
// differ. No state, no RNG calls at run time.

// --- Constants (mirrored literally from uelse/ice.py) ---
// K_I and MELT_RATE are DERIVED in Python from the stated
// calibration targets (freeze 0.02 m at -5 C in 300 s; melt
// 0.05 m at +10 C in 300 s) - the literals below are the
// derived values, copied exactly.
export const K_I = 40.83706666666667;
export const MELT_RATE = 1.6666666666666667e-05;
export const RHO_ICE = 917.0;
export const L_F = 334000.0;
export const K_ICE_PHYSICAL = 2.22;
export const T_FREEZE = 0.0;
export const H0_SEED = 0.0005;
export const FROZEN_THRESHOLD = 0.002;
export const H_MAX = 0.5;
export const WET_DEPTH_MIN = 0.05;
export const MELT_EPSILON = 1e-09;

// --- Driver constants (the seeded weather shapes) ---
export const DIURNAL_PERIOD_S = 3600.0;
export const DIURNAL_AMP_C = 4.0;
export const STORM_PERIOD_S = 311.0;
export const TEMP_MIN_C = -5.0;
export const TEMP_MAX_C = 38.0;
export const RAIN_MAX = 0.8;
export const WIND_BASE = 0.35;
export const WIND_MAX = 1.5;

function finiteNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("BAD_ARGUMENT: " + field + " must be a finite number");
  }
  return value;
}

// --- Ice math (mirrors uelse/ice.py) ---

export function stefanThickness(kI, dT, t) {
  const k = finiteNumber(kI, "kI");
  const d = finiteNumber(dT, "dT");
  const s = finiteNumber(t, "t");
  if (k <= 0) throw new Error("BAD_ARGUMENT: kI must be > 0");
  if (d <= 0 || s <= 0) return 0.0;
  return Math.sqrt(2.0 * k * d * s / (RHO_ICE * L_F));
}

export function growthRate(h, tempC, kI) {
  const hh = finiteNumber(h, "h");
  const tc = finiteNumber(tempC, "tempC");
  const k = kI === undefined ? K_I : finiteNumber(kI, "kI");
  if (k <= 0) throw new Error("BAD_ARGUMENT: kI must be > 0");
  if (hh <= 0) {
    throw new Error("BAD_STATE: ice thickness is not positive - new ice " +
      "starts at H0_SEED, it never grows from exactly zero");
  }
  const dT = T_FREEZE - tc;
  if (dT <= 0) return 0.0;
  return k * dT / (RHO_ICE * L_F * hh);
}

export function meltRate(tempC, rate) {
  const tc = finiteNumber(tempC, "tempC");
  const r = rate === undefined ? MELT_RATE : finiteNumber(rate, "rate");
  if (r < 0) throw new Error("BAD_ARGUMENT: rate must be >= 0");
  const dT = tc - T_FREEZE;
  if (dT <= 0) return 0.0;
  return -r * dT;
}

export function stepIce(h, tempC, dt, kI, rate) {
  const hh = finiteNumber(h, "h");
  const tc = finiteNumber(tempC, "tempC");
  const d = finiteNumber(dt, "dt");
  if (hh < 0) {
    throw new Error("BAD_STATE: ice thickness is negative - corrupt state");
  }
  if (d <= 0) throw new Error("BAD_ARGUMENT: dt must be > 0");
  if (hh > H_MAX) {
    throw new Error("BAD_STATE: ice thickness exceeds the H_MAX cap");
  }
  if (tc < T_FREEZE) {
    const start = hh === 0.0 ? H0_SEED : hh;
    return Math.min(H_MAX, start + growthRate(start, tc, kI) * d);
  }
  if (tc > T_FREEZE) {
    const out = hh + meltRate(tc, rate) * d;
    return out < MELT_EPSILON ? 0.0 : out;
  }
  return hh; // exactly freezing: holds
}

export function isFrozen(h) {
  return finiteNumber(h, "h") >= FROZEN_THRESHOLD;
}

// --- The seeded weather driver ---

// mulberry32: the sandbox's seeded RNG (same function as
// map-sandbox.html's — the driver is self-contained so the
// Node tests can run it without the page).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weatherPhases(seed) {
  const s = finiteNumber(seed, "seed");
  const rng = mulberry32(Math.floor(s));
  return {
    temp: rng() * Math.PI * 2,
    temp2: rng() * Math.PI * 2,
    rain: rng() * Math.PI * 2,
    wind: rng() * Math.PI * 2,
    wind2: rng() * Math.PI * 2,
  };
}

// The sandbox's season temperature baseline (mirrors
// tempBaseline in map-sandbox.html): summer ~24.5 C, deep
// winter (season 0.875) -2 C.
export function tempBaseline(season) {
  const s = finiteNumber(season, "season");
  return 12 + 14 * Math.cos((s - 0.375) * Math.PI * 2);
}

export function weatherAt(seed, t, season) {
  const s = finiteNumber(seed, "seed");
  const tt = finiteNumber(t, "t");
  const sn = finiteNumber(season, "season");
  if (tt < 0) throw new Error("BAD_ARGUMENT: t must be >= 0");
  if (sn < 0 || sn > 1) {
    throw new Error("BAD_ARGUMENT: season must be in [0, 1]");
  }
  const p = weatherPhases(s);
  const temp = Math.max(TEMP_MIN_C, Math.min(TEMP_MAX_C,
    tempBaseline(sn)
    + DIURNAL_AMP_C * Math.sin(2 * Math.PI * tt / DIURNAL_PERIOD_S + p.temp)
    + 1.5 * Math.sin(2 * Math.PI * tt / 173 + p.temp2)));
  const storm = 0.5 + 0.5 * Math.sin(2 * Math.PI * tt / STORM_PERIOD_S + p.rain);
  const rain = RAIN_MAX * storm * storm;
  const wind = Math.max(0, Math.min(WIND_MAX,
    WIND_BASE
    + 0.25 * Math.sin(2 * Math.PI * tt / 47 + p.wind)
    + 0.1 * Math.sin(2 * Math.PI * tt / 13 + p.wind2)));
  return { temp: temp, rain: rain, wind: wind };
}
