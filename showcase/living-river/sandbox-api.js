// sandbox-api.js — the sandbox's door (Step 3.4, M22).
//
// The Living River map sandbox's API: pick / hold / snapshot / place-back,
// exposed as window.SandboxAPI for same-origin callers (the HUD pattern —
// the workbench iframes this page and calls in through the window).
//
// PURE LOGIC: no THREE, no DOM. The sandbox page imports this module and
// wires it to the live sim through a context object (getCreatures,
// getWorld, recolor, rescale). That keeps the module testable in Node
// with a mock context, and keeps the sim working if the API ever fails
// to wire (the sandbox's wire-up is try/catch-guarded; the sim never
// depends on the API existing).
//
// Design (SCHEMA.md §8, decisions 23–31):
// - The API shape is a JS surface on the page because the sandbox's live
//   state exists only in the page's JS memory — a server-side API cannot
//   touch it (the port-8000 server is a static file server).
// - Stable IDs: crumbs-npc:<world-id>:<tag>. The world id was minted once
//   (2026-11-23, Step 3.4) and is recorded in the ledger (provenance
//   entry). A creature's stable id is assigned at equip time and STORED
//   on the creature (c.stableId) — the API reads the stored id and never
//   re-derives it, so the id survives a tag shift (doors design § on ID
//   survival: roster rebuilds, mid-family removal, rename).
// - Every method returns {ok:true, ...} or {ok:false, error, code} and
//   NEVER throws on bad input (the validate.py discipline). An unexpected
//   internal failure returns code INTERNAL — the sandbox never crashes
//   on a bad call.
// - The API produces ledger-ready snapshot documents; it does NOT record
//   them (the browser cannot write to disk). Recording is the caller's
//   job via the interchange ledger module, routed through the Chair (D5).
// - Hold means frozen (the Q2 recommendation — Q2 itself is still owed
//   from Lloyd): a held creature skips steering, keeps its pose, and its
//   tag reads "TAG · HELD". Children keep shadowing a held parent and
//   Beaver B keeps shadowing a held Beaver A (M3 — conscious, harmless).
// - Place-back restores state + traits + build scalars from a validated
//   crumbs-creature/1 document. Build GEOMETRY (segments, dam site, lodge
//   coordinates, lodge built) must match the live build exactly, or the
//   place-back is refused (BUILD_MISMATCH) — mesh rebuild from saved
//   coordinates is M2 restore work, not built yet.
// - pickGround (Stage 18, the raycast — Q7 ruled by Lloyd 2026-11-23):
//   the API exposes the sandbox's own raycast through the context
//   (ctx.pickGround, wired in map-sandbox.html — the raycast needs the
//   camera + the ground mesh, so it lives in the sandbox module, not
//   here). A sandbox without the wire-up refuses NO_PICK_CHANNEL —
//   the pick never silently guesses.

export const SANDBOX_API_VERSION = "1.1.0";

// The Living River sandbox world id — minted once (Step 3.4, 2026-11-23),
// recorded in the ledger (provenance entry, subject = this id). Any future
// Living River world file must use it. Never regenerate.
export const SANDBOX_WORLD_ID = "662a7073-dd24-4fcf-b191-5e2f10412735";

export const CREATED_BY = "living-river-sandbox";

// Tags are deterministic: FAMILY-##, numbered in family order
// (BEAVER-01 is always Beaver A). Two digits — the roster caps at 40
// creatures, 8 per family.
const TAG_RE = /^[A-Z]+-\d{2}$/;

export function composeStableId(worldId, tag) {
  return "crumbs-npc:" + worldId + ":" + tag;
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function err(code, message) {
  return { ok: false, error: message, code: code };
}

// Normalize a caller-supplied tag: trim + uppercase, then the tag shape.
// Returns {tag} or {error, code}.
function normalizeTag(raw) {
  if (typeof raw !== "string") {
    return err("BAD_TAG", "tag must be a string like BEAVER-01, got " + (raw === null ? "null" : typeof raw));
  }
  const tag = raw.trim().toUpperCase();
  if (!TAG_RE.test(tag)) {
    return err("BAD_TAG", "malformed tag " + JSON.stringify(raw) + " — expected FAMILY-##, e.g. BEAVER-01");
  }
  return { tag: tag };
}

export function createSandboxAPI(ctx) {
  if (!ctx || typeof ctx.getCreatures !== "function" || typeof ctx.getWorld !== "function") {
    throw new Error("sandbox-api: context needs getCreatures() and getWorld() functions");
  }

  // Hold registry: stableId -> {tag, stableId, snapshot, heldAt}.
  // In-memory only (like the 3.2 IdRegistry) — the ledger is the durable
  // home for snapshots. A roster removal drops the hold; heldList reports
  // dropped stale entries instead of hiding them.
  const held = new Map();

  function stableIdFor(c) {
    // The stored id wins; compose defensively for creatures that predate
    // the field (mock creatures in tests, or a roster built before 3.4).
    return (c && typeof c.stableId === "string" && c.stableId) ||
      composeStableId(SANDBOX_WORLD_ID, c.tag);
  }

  function findCreature(tag) {
    const creatures = ctx.getCreatures() || [];
    for (const c of creatures) {
      if (c.tag === tag) return c;
    }
    return null;
  }

  function resolve(rawTag) {
    const n = normalizeTag(rawTag);
    if (n.error) return n;
    const c = findCreature(n.tag);
    if (!c) {
      return err("UNKNOWN_TAG", "no creature with tag " + n.tag + " — see list() for the live roster");
    }
    return { tag: n.tag, creature: c };
  }

  // Drop hold entries whose creature is gone from the roster or no longer
  // flagged held (a reset/rebuild clears c.held in the sandbox). Returns
  // how many stale entries were dropped.
  function dropStaleHolds() {
    let dropped = 0;
    for (const [stableId, rec] of held) {
      const c = findCreature(rec.tag);
      if (!c || !c.held || stableIdFor(c) !== stableId) {
        held.delete(stableId);
        dropped++;
      }
    }
    return dropped;
  }

  function liveSummary(c) {
    const b = c.build;
    return {
      tag: c.tag,
      stable_id: stableIdFor(c),
      group: c.group,
      sex: c.sex,
      name: c.name,
      x: c.x, y: c.y, z: c.z,
      mode: c.mode,
      energy: c.energy, energy_max: c.energyMax,
      hydration: c.hydration,
      held: !!c.held,
      build: b ? {
        state: b.state, sticks: b.sticks,
        segments: b.segments ? b.segments.length : 0,
        lodge_built: !!(b.lodge && b.lodge.built),
      } : null,
    };
  }

  function liveDetail(c) {
    const s = liveSummary(c);
    s.alt = c.alt;
    s.velocity = { vx: c.vx, vy: c.vy, vz: c.vz };
    s.heading = c.heading;
    s.identity = c.identity;
    s.fly_state = c.flyState;
    s.hop_t = c.hopT;
    s.activity = c.activity;
    s.recovering = !!c.recovering;
    s.exhausted = !!c.exhausted;
    s.drinking = !!c.drinking;
    s.target = { tx: c.tx, ty: c.ty };
    s.parent_tag = c.parent ? c.parent.tag : null;
    s.parent_id = c.parent ? stableIdFor(c.parent) : null;
    s.traits = c.traits ? {
      scale: c.traits.scale, pace: c.traits.pace,
      drain: c.traits.drain, hydro: c.traits.hydro,
      bold: c.traits.bold, variant: c.traits.variant,
    } : null;
    return s;
  }

  // Serialize one live creature to a crumbs-creature/1 document
  // (FR-GRAB-2 + SCHEMA.md §1). Allowlist only: rig, tagEl, parent and
  // build meshes are live objects and are never serialized. Returns
  // {doc} or {error, code}.
  function serializeCreature(c) {
    const bad = [];
    const num = (v, field) => {
      if (!isFiniteNumber(v)) { bad.push(field); return 0; }
      return v;
    };
    const state = {
      position: {
        x: num(c.x, "state.position.x"), y: num(c.y, "state.position.y"),
        z: num(c.z, "state.position.z"), alt: num(c.alt, "state.position.alt"),
      },
      velocity: {
        vx: num(c.vx, "state.velocity.vx"), vy: num(c.vy, "state.velocity.vy"),
        vz: num(c.vz, "state.velocity.vz"),
      },
      heading: num(c.heading, "state.heading"),
      mode: typeof c.mode === "string" ? c.mode : "walking",
      energy: clamp(num(c.energy, "state.energy") / (isFiniteNumber(c.energyMax) && c.energyMax > 0 ? c.energyMax : 100) * 100, 0, 100),
      hydration: clamp(num(c.hydration, "state.hydration"), 0, 100),
      identity: isFiniteNumber(c.identity) ? String(c.identity) : null,
      flyState: typeof c.flyState === "string" ? c.flyState : null,
      hopT: num(c.hopT, "state.hopT"),
      recovering: !!c.recovering,
      exhausted: !!c.exhausted,
      drinking: !!c.drinking,
      target: { tx: num(c.tx, "state.target.tx"), ty: num(c.ty, "state.target.ty") },
      parent: c.parent ? stableIdFor(c.parent) : null,
    };
    if (bad.length) {
      return err("CORRUPT_STATE",
        "creature " + c.tag + " has non-finite state (" + bad.join(", ") +
        ") — refusing to snapshot corrupt state");
    }
    // The sandbox's activity is "" for idle — and the schema's
    // activity field is a non-empty string when present (validate.py
    // refuses an empty one). An empty activity is omitted, never
    // emitted as "". On place-back, an absent activity restores to
    // "" (see placeBack) — omission IS the encoding of idle.
    if (typeof c.activity === "string" && c.activity.length > 0) {
      state.activity = c.activity;
    }
    const doc = {
      format: "crumbs-creature/1",
      version: 1,
      id: stableIdFor(c),
      name: c.name,
      tag: c.tag,
      created: new Date().toISOString(),
      created_by: CREATED_BY,
      family: c.group,
      face_3d: { rig: { present: true } },
      state: state,
      build: null,
      world_context: null,
    };
    if (c.traits) {
      doc.traits = {
        scale: c.traits.scale, pace: c.traits.pace,
        drain: c.traits.drain, hydro: c.traits.hydro,
        bold: c.traits.bold, variant: c.traits.variant,
      };
      doc.face_3d.variant = c.traits.variant;
    }
    if (c.build) {
      const b = c.build;
      doc.build = {
        state: b.state,
        sticks: b.sticks,
        timer: b.timer,
        segIndex: b.segIndex,
        segments: (b.segments || []).map((s) => ({ x: s.x, y: s.y })),
        damSite: b.damSite ? { x: b.damSite.x, y: b.damSite.y } : null,
        lodge: b.lodge ? {
          x: b.lodge.x, y: b.lodge.y,
          built: !!b.lodge.built, progress: b.lodge.progress,
        } : null,
      };
    }
    const w = ctx.getWorld() || {};
    doc.world_context = {
      world_id: SANDBOX_WORLD_ID,
      terrainSeed: w.terrainSeed,
      NX: w.NX, NY: w.NY,
      elapsed: w.elapsed,
      season: w.season,
      rain: w.rain, wind: w.wind, temp: w.temp,
    };
    return { doc: doc };
  }

  // Focused validator for a place-back document: the essentials, with
  // named reasons. The full validator lives in Python (validate.py);
  // this one guards the live sim against a bad restore. Returns
  // {doc} or {error, code}.
  function validatePlaceBackDoc(doc, expectedStableId) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      return err("BAD_DOCUMENT", "place-back document must be a crumbs-creature/1 object, got " +
        (doc === null ? "null" : Array.isArray(doc) ? "array" : typeof doc));
    }
    if (doc.format !== "crumbs-creature/1") {
      return err("BAD_DOCUMENT", "place-back document format must be crumbs-creature/1, got " +
        JSON.stringify(doc.format));
    }
    const major = String(doc.version).split(".")[0];
    if (major !== "1") {
      return err("BAD_DOCUMENT", "place-back document needs the v" + major + " reader — this API reads v1 only");
    }
    if (doc.id !== expectedStableId) {
      return err("WRONG_CREATURE", "document is for " + JSON.stringify(doc.id) +
        ", not " + expectedStableId + " — refusing to restore one creature's state onto another");
    }
    if (doc.state !== undefined && doc.state !== null && typeof doc.state !== "object") {
      return err("BAD_DOCUMENT", "state must be an object");
    }
    const st = doc.state || {};
    const numField = (obj, field, lo, hi) => {
      if (obj[field] === undefined || obj[field] === null) return null;
      if (!isFiniteNumber(obj[field])) return field + " must be a finite number";
      if (lo !== undefined && obj[field] < lo) return field + " must be >= " + lo;
      if (hi !== undefined && obj[field] > hi) return field + " must be <= " + hi;
      return null;
    };
    for (const f of ["energy", "hydration"]) {
      const e = numField(st, f, 0, 100);
      if (e) return err("BAD_DOCUMENT", "state." + e);
    }
    if (st.position !== undefined && st.position !== null) {
      if (typeof st.position !== "object") return err("BAD_DOCUMENT", "state.position must be an object");
      for (const f of ["x", "y", "z", "alt"]) {
        const e = numField(st.position, f);
        if (e) return err("BAD_DOCUMENT", "state.position." + e);
      }
    }
    if (st.velocity !== undefined && st.velocity !== null) {
      if (typeof st.velocity !== "object") return err("BAD_DOCUMENT", "state.velocity must be an object");
      for (const f of ["vx", "vy", "vz"]) {
        const e = numField(st.velocity, f);
        if (e) return err("BAD_DOCUMENT", "state.velocity." + e);
      }
    }
    if (doc.traits !== undefined && doc.traits !== null) {
      if (typeof doc.traits !== "object") return err("BAD_DOCUMENT", "traits must be an object");
      for (const f of ["scale", "pace", "drain", "hydro"]) {
        const e = numField(doc.traits, f, 0);
        if (e) return err("BAD_DOCUMENT", "traits." + e);
      }
      if (doc.traits.bold !== undefined && doc.traits.bold !== "high" && doc.traits.bold !== "low") {
        return err("BAD_DOCUMENT", 'traits.bold must be "high" or "low"');
      }
      if (doc.traits.variant !== undefined &&
          (!Number.isInteger(doc.traits.variant) || doc.traits.variant < 0 || doc.traits.variant > 2)) {
        return err("BAD_DOCUMENT", "traits.variant must be an integer 0–2");
      }
    }
    return { doc: doc };
  }

  // Restore a validated document onto a live creature. Build geometry
  // (segments, dam site, lodge coordinates + built) must match the live
  // build exactly — mesh rebuild from saved coordinates is M2 restore
  // work, not built yet, so a mismatch is refused rather than half-applied.
  // Returns {restored:[fields]} or {error, code}.
  function restoreCreature(c, doc) {
    const restored = [];
    const st = doc.state || {};
    if (st.position) {
      if (st.position.x !== undefined) c.x = st.position.x;
      if (st.position.y !== undefined) c.y = st.position.y;
      if (st.position.z !== undefined) c.z = st.position.z;
      if (st.position.alt !== undefined) c.alt = st.position.alt;
      restored.push("position");
    }
    if (st.velocity) {
      if (st.velocity.vx !== undefined) c.vx = st.velocity.vx;
      if (st.velocity.vy !== undefined) c.vy = st.velocity.vy;
      if (st.velocity.vz !== undefined) c.vz = st.velocity.vz;
      restored.push("velocity");
    }
    if (st.heading !== undefined) { c.heading = st.heading; restored.push("heading"); }
    if (typeof st.mode === "string") { c.mode = st.mode; restored.push("mode"); }
    if (st.energy !== undefined) {
      c.energy = clamp(st.energy / 100 * (c.energyMax || 100), 0, c.energyMax || 100);
      restored.push("energy");
    }
    if (st.hydration !== undefined) { c.hydration = clamp(st.hydration, 0, 100); restored.push("hydration"); }
    if (st.identity !== undefined && st.identity !== null) {
      const v = parseFloat(st.identity);
      if (Number.isFinite(v)) { c.identity = v; restored.push("identity"); }
    }
    if (st.flyState !== undefined) { c.flyState = st.flyState; restored.push("flyState"); }
    if (st.hopT !== undefined) { c.hopT = st.hopT; restored.push("hopT"); }
    // Activity is ALWAYS restored: present means the captured
    // activity, absent means the creature was idle ("") at capture —
    // the schema cannot express an empty activity, so omission IS
    // the encoding of idle (see serializeCreature).
    c.activity = (typeof st.activity === "string") ? st.activity : "";
    restored.push("activity");
    if (typeof st.recovering === "boolean") c.recovering = st.recovering;
    if (typeof st.exhausted === "boolean") c.exhausted = st.exhausted;
    if (typeof st.drinking === "boolean") c.drinking = st.drinking;
    if (st.target) {
      if (st.target.tx !== undefined) c.tx = st.target.tx;
      if (st.target.ty !== undefined) c.ty = st.target.ty;
      restored.push("target");
    }
    // Parent is a roster relationship, owned by the live roster — the
    // document's parent is informational and is never restored.
    if (doc.traits && c.traits) {
      const t = doc.traits;
      let changed = false;
      for (const f of ["scale", "pace", "drain", "hydro", "bold", "variant"]) {
        if (t[f] !== undefined && c.traits[f] !== t[f]) { c.traits[f] = t[f]; changed = true; }
      }
      if (changed) {
        c.scaleEff = c.traits.scale * (c.sex === "child" ? 0.6 : 1);
        c.paceEff = c.traits.pace * (c.sex === "child" ? 0.7 : 1);
        c.energyMax = c.sex === "child" ? 70 : 100;
        if (c.energy > c.energyMax) c.energy = c.energyMax;
        if (typeof ctx.recolor === "function") ctx.recolor(c);
        if (typeof ctx.rescale === "function") ctx.rescale(c);
        restored.push("traits");
      }
    }
    if (doc.build !== undefined && doc.build !== null && c.build) {
      const b = doc.build, live = c.build;
      const sameSegs = Array.isArray(b.segments) && Array.isArray(live.segments) &&
        b.segments.length === live.segments.length &&
        b.segments.every((s, i) => s.x === live.segments[i].x && s.y === live.segments[i].y);
      const sameSite = (!b.damSite && !live.damSite) ||
        (b.damSite && live.damSite && b.damSite.x === live.damSite.x && b.damSite.y === live.damSite.y);
      const sameLodge = (!b.lodge && !live.lodge) ||
        (b.lodge && live.lodge && b.lodge.x === live.lodge.x && b.lodge.y === live.lodge.y &&
          !!b.lodge.built === !!live.lodge.built);
      if (!sameSegs || !sameSite || !sameLodge) {
        return err("BUILD_MISMATCH",
          "the document's build geometry (segments, dam site, or lodge) differs from the live build — " +
          "mesh rebuild from saved coordinates is not built yet (M2), so this place-back is refused " +
          "rather than half-applied");
      }
      if (typeof b.state === "string") live.state = b.state;
      if (Number.isInteger(b.sticks) && b.sticks >= 0) live.sticks = b.sticks;
      if (isFiniteNumber(b.timer) && b.timer >= 0) live.timer = b.timer;
      if (Number.isInteger(b.segIndex) && b.segIndex >= 0) live.segIndex = b.segIndex;
      if (b.lodge && live.lodge && isFiniteNumber(b.lodge.progress)) {
        live.lodge.progress = clamp(b.lodge.progress, 0, 1);
      }
      restored.push("build");
    }
    return { restored: restored };
  }

  function safe(fn) {
    return function () {
      try {
        return fn.apply(null, arguments);
      } catch (e) {
        return err("INTERNAL", "sandbox-api internal failure: " + (e && e.message ? e.message : String(e)));
      }
    };
  }

  const api = {
    version: SANDBOX_API_VERSION,
    worldId: SANDBOX_WORLD_ID,

    status: safe(() => {
      const creatures = ctx.getCreatures() || [];
      const w = ctx.getWorld() || {};
      dropStaleHolds();
      return {
        ok: true,
        api: "sandbox-api",
        version: SANDBOX_API_VERSION,
        world_id: SANDBOX_WORLD_ID,
        creatures: creatures.length,
        held: Array.from(held.values()).map((r) => r.tag),
        running: !!w.running,
        map: { NX: w.NX, NY: w.NY },
        elapsed: w.elapsed,
      };
    }),

    list: safe(() => {
      const creatures = ctx.getCreatures() || [];
      dropStaleHolds();
      return { ok: true, creatures: creatures.map(liveSummary) };
    }),

    pick: safe((rawTag) => {
      const r = resolve(rawTag);
      if (r.error) return r;
      return { ok: true, creature: liveDetail(r.creature) };
    }),

    hold: safe((rawTag) => {
      const r = resolve(rawTag);
      if (r.error) return r;
      const c = r.creature;
      const stableId = stableIdFor(c);
      if (c.held || held.has(stableId)) {
        return err("ALREADY_HELD", "creature " + r.tag + " is already held — place it back before holding it again");
      }
      const s = serializeCreature(c);
      if (s.error) return s;
      c.held = true;
      const rec = {
        tag: r.tag, stableId: stableId,
        snapshot: s.doc, heldAt: new Date().toISOString(),
      };
      held.set(stableId, rec);
      return { ok: true, held: true, tag: r.tag, stable_id: stableId, snapshot: s.doc };
    }),

    snapshot: safe((rawTag) => {
      const r = resolve(rawTag);
      if (r.error) return r;
      const s = serializeCreature(r.creature);
      if (s.error) return s;
      return { ok: true, snapshot: s.doc };
    }),

    placeBack: safe((rawTag, doc) => {
      const r = resolve(rawTag);
      if (r.error) return r;
      const c = r.creature;
      const stableId = stableIdFor(c);
      if (!c.held && !held.has(stableId)) {
        return err("NOT_HELD", "creature " + r.tag + " is not held — nothing to place back " +
          "(hold it first; a place-back of something never held is refused)");
      }
      let restored = [];
      // Only an OMITTED doc means "just un-hold". An explicit null is a
      // bad document, not an absent one — a caller passing a null it got
      // from a failed snapshot must not silently un-hold with no restore.
      if (doc !== undefined) {
        const v = validatePlaceBackDoc(doc, stableId);
        if (v.error) return v;
        const res = restoreCreature(c, doc);
        if (res.error) return res;
        restored = res.restored;
      }
      c.held = false;
      held.delete(stableId);
      return {
        ok: true, placed_back: true, tag: r.tag, stable_id: stableId,
        restored: restored, creature: liveSummary(c),
      };
    }),

    heldList: safe(() => {
      const dropped = dropStaleHolds();
      return {
        ok: true,
        held: Array.from(held.values()).map((rec) => ({
          tag: rec.tag, stable_id: rec.stableId,
          held_at: rec.heldAt, snapshot_created: rec.snapshot.created,
        })),
        dropped_stale: dropped,
      };
    }),

    isHeld: safe((rawTag) => {
      const n = normalizeTag(rawTag);
      if (n.error) return n;
      const c = findCreature(n.tag);
      // A well-formed tag for a creature that isn't there is simply
      // not held; a malformed tag is a BAD_TAG above.
      return { ok: true, tag: n.tag, held: !!(c && c.held) };
    }),

    // The 3D-view pick (Stage 18, the raycast — Q7). Delegates to the
    // sandbox-side raycast (ctx.pickGround, wired in map-sandbox.html)
    // and passes its result through unchanged — success {ok, x, y,
    // height} in sim coords, or a named refusal (BAD_PICK, NOT_READY,
    // NO_GROUND_HIT). A sandbox without the wire-up refuses
    // NO_PICK_CHANNEL: the pick never silently guesses, and typed
    // coordinates stay the fallback. Client coords are viewport
    // client coords in the sandbox page's space (the click's
    // clientX/Y); the sandbox-side function does the canvas-rect
    // conversion where the canvas lives.
    pickGround: safe((clientX, clientY) => {
      if (!isFiniteNumber(clientX) || !isFiniteNumber(clientY)) {
        return err("BAD_PICK", "pick coordinates must be finite numbers, got (" +
          String(clientX) + ", " + String(clientY) + ")");
      }
      if (typeof ctx.pickGround !== "function") {
        return err("NO_PICK_CHANNEL", "this sandbox has no pick channel — it " +
          "predates the pickGround wire-up (Stage 18, the raycast); type the " +
          "coordinates instead");
      }
      const r = ctx.pickGround(clientX, clientY);
      if (!r || typeof r !== "object" || Array.isArray(r)) {
        return err("INTERNAL", "pickGround returned a non-object — the wire-up is broken");
      }
      return r;
    }),

    // Internal: called by the sandbox on Reset (and only there). Clears
    // every hold — a reset rebuilds creature state, so held snapshots
    // would go stale. The ledger copy of a snapshot, if recorded, survives.
    _clearHolds: safe(() => {
      const creatures = ctx.getCreatures() || [];
      for (const c of creatures) c.held = false;
      const n = held.size;
      held.clear();
      return { ok: true, cleared: n };
    }),
  };

  return api;
}
