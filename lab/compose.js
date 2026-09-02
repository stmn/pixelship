/* compose.js - turns a seed + options into a finished, coloured ship.
   Shared by the browser app and the node contact-sheet renderer, so the
   composition rules exist in exactly one place.

   Loads as a classic <script> (browser) and via require() (node).          */

(function (root, factory) {
  var deps;
  if (typeof module !== 'undefined' && module.exports) {
    deps = {
      shape: require('./shape.js'),
      shading: require('./shading.js'),
      palette: require('./palette.js'),
      mounts: require('./mounts.js'),
    };
    module.exports = factory(deps);
  } else {
    /* The lab modules do not agree on an export style: shading.js publishes a
       namespace object, the rest leak bare globals. Accept either, and fail
       loudly with the missing name rather than silently later.               */
    var pick = function (ns, names) {
      var o = root[ns] || {}, out = {}, i, n;
      for (i = 0; i < names.length; i++) {
        n = names[i];
        out[n] = o[n] !== undefined ? o[n] : root[n];
      }
      return out;
    };
    deps = {
      shape: pick('PixelshipShape', ['generateMask', 'makeShapeRng', 'SHAPE_DEFAULTS']),
      shading: pick('PixelshipShading', ['shadeMask', 'shadeStep', 'DEFAULTS']),
      palette: pick('PixelshipPalette', ['makePalette', 'PALETTE_DEFAULTS']),
      mounts: pick('PixelshipMounts', ['detectMounts', 'stampMounts', 'MOUNT_DEFAULTS']),
    };
    var required = [['shape', 'generateMask'], ['shape', 'makeShapeRng'], ['shading', 'shadeMask'],
                    ['shading', 'shadeStep'], ['palette', 'makePalette'], ['mounts', 'detectMounts']];
    for (var q = 0; q < required.length; q++) {
      if (typeof deps[required[q][0]][required[q][1]] !== 'function')
        throw new Error('pixelship: missing ' + required[q][0] + '.' + required[q][1] +
                        ' - is lab/' + required[q][0] + '.js loaded before compose.js?');
    }
    root.PixelShipCompose = factory(deps);
  }
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  var EMPTY = 0, HULL = 1, OUTLINE = 4, COCKPIT = 5, ACCENT = 6, NOZZLE = 7, GUN = 8, LAMP = 9;

  /* Tuning that turns the raw modules into readable vehicles rather than
     shaded mounds. Derived by measurement, not taste alone: flat terraces
     (few ramp steps, no dither) + narrow hull + prominent thin wings.      */
  var SHAPE_TUNING = {
    coreMinWidth: 3.0,
    noseTaperExp: 0.95,
    envelopeChoices: ['spindle', 'dart', 'teardrop', 'ellipse'],
    elongationMin: 1.15,
    elongationMax: 2.40,
    wingChance: 1.0,
    wingAmount: 3.2,
    wingAmountJitter: 1.4,
    wingWidth: 0.060,
    wingWidthJitter: 0.04,
    wingCount: 3,
    wingNegativeChance: 0.45,
    envelopeCore: 0.88,
    fillDensity: 0.68,
    noiseAmount: 0.45,
    noiseScale: 2.2,
  };

  var SHADE_TUNING = {
    rampSteps: 5,
    ditherMode: 'off',
    contrast: 1.4,
    /* Light straight down the sprite's long axis. Measured: azimuth 0 and 180
       are the only angles with ZERO mirror-symmetry violations; every oblique
       angle breaks 57-74% of pixels against their mirror. 0 is the top-lit one
       (mean ramp step 2.29 upper half vs 1.66 lower).                        */
    lightAzimuthDeg: 0,
    /* Low bulge keeps the hull reading as a plated surface rather than a dome. */
    thicknessShape: 0.18,
    thicknessScale: 0.12,
    aoStrength: 0.62,
    rimStrength: 0.35,
    ridgeStrength: 0.22,
    normalStrength: 0.85,
    flatLevel: 0.5,
  };

  /* No cockpit by default - the stamped canopy reads as an egg glued to the
     hull at every size we tried. Still available via mounts.cockpitWanted.   */
  var MOUNT_TUNING = {
    cockpitWanted: false,
    cockpitMaxRxFrac: 0.085,
    cockpitMaxRyFrac: 0.11,
    cockpitMaxAreaFrac: 0.045,
    cockpitBandTop: 0.10,
    cockpitBandBottom: 0.42,
    cockpitAspectMax: 1.8,
  };

  /* Merging that IGNORES explicitly-undefined values. The audit found that
     `Object.assign({}, defaults, {knob: undefined})` silently produced empty
     ships in three of the four modules; this is the guard against that.     */
  function merge() {
    var out = {}, i, k, src;
    for (i = 0; i < arguments.length; i++) {
      src = arguments[i];
      if (!src) continue;
      for (k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        var v = src[k];
        if (v === undefined) continue;
        if (typeof v === 'number' && isNaN(v)) continue;
        out[k] = v;
      }
    }
    return out;
  }

  function clamp255(v) { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; }

  /* (material, shade step) -> RGB. HULL reads off the ramp; every other
     material keeps its own hue but is modulated by the same step, so nothing
     renders dead flat (the audit's "shading skips non-HULL" defect).        */
  function colorFor(mat, step, pal, steps) {
    if (mat === OUTLINE) return pal.outline;
    if (mat === HULL || !pal.materials || !pal.materials[mat]) {
      var i = step < 0 ? 0 : step >= pal.ramp.length ? pal.ramp.length - 1 : step;
      return pal.ramp[i];
    }
    var t = steps > 1 ? step / (steps - 1) : 0.5;
    var b = pal.materials[mat], k = 0.62 + 0.76 * t;
    return [clamp255(b[0] * k), clamp255(b[1] * k), clamp255(b[2] * k)];
  }

  /* Deterministic per-role seeds: changing the palette must not reshape the
     hull, and reshaping the hull must not recolour it.                      */
  function roleSeed(seed, salt) {
    var h = (seed ^ salt) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return (h ^ (h >>> 16)) | 0;
  }

  /* Returns everything the renderer needs, with no colour baked into pixels:
     { W, H, mats, steps, rampSteps, pal, mounts, meta }                     */
  function composeShip(seed, size, opts) {
    opts = opts || {};
    var shapeOpts = merge(SHAPE_TUNING, { size: size }, opts.shape);
    var shadeOpts = merge(SHADE_TUNING, opts.shade);
    var mountOpts = merge(MOUNT_TUNING, opts.mounts);
    var palOpts = merge({ steps: shadeOpts.rampSteps }, opts.palette);

    /* opts.mask lets a hand-drawn hull enter the pipeline. Everything below
       this line is source-agnostic - it only ever sees a binary mask. */
    var res;
    if (opts.mask && opts.mask.data && opts.mask.W && opts.mask.H) {
      res = { mask: opts.mask.data, W: opts.mask.W, H: opts.mask.H,
              meta: { custom: true, massFraction: null, aspect: null } };
    } else {
      res = D.shape.generateMask(D.shape.makeShapeRng(roleSeed(seed, 0x51ED270B)), shapeOpts);
    }
    var W = res.W, H = res.H;

    var mounts = D.mounts.detectMounts(res.mask, W, H, mountOpts);

    var mats = new Uint8Array(W * H), i;
    for (i = 0; i < W * H; i++) mats[i] = res.mask[i] ? HULL : EMPTY;
    if (D.mounts.stampMounts) {
      try { D.mounts.stampMounts(mats, W, H, mounts, mountOpts); } catch (e) { /* optional */ }
    }

    /* 1px outline around the whole silhouette */
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var p = y * W + x;
      if (mats[p] !== EMPTY) continue;
      if ((x > 0 && mats[p - 1] && mats[p - 1] !== OUTLINE) ||
          (x < W - 1 && mats[p + 1] && mats[p + 1] !== OUTLINE) ||
          (y > 0 && mats[p - W] && mats[p - W] !== OUTLINE) ||
          (y < H - 1 && mats[p + W] && mats[p + W] !== OUTLINE)) mats[p] = OUTLINE;
    }

    var shaded = D.shading.shadeMask(res.mask, W, H, shadeOpts);
    var steps = new Int8Array(W * H);
    var mid = Math.floor(shadeOpts.rampSteps / 2);
    for (i = 0; i < W * H; i++) {
      var s = D.shading.shadeStep(shaded[i]);
      steps[i] = s < 0 ? mid : s;
    }

    var pal = D.palette.makePalette(D.shape.makeShapeRng(roleSeed(seed, 0x9E3779B9)), palOpts);

    return {
      seed: seed, W: W, H: H, mats: mats, steps: steps,
      rampSteps: shadeOpts.rampSteps, pal: pal, mounts: mounts, meta: res.meta,
      opts: { shape: shapeOpts, shade: shadeOpts, mounts: mountOpts, palette: palOpts },
    };
  }

  /* ---- packing a drawn mask small enough to live in localStorage ----
     One bit per pixel, base64. A 96x96 hull is 1152 bytes raw, ~1.5 KB encoded. */
  function packMask(mask, W, H) {
    var bytes = new Uint8Array(Math.ceil(W * H / 8)), i;
    for (i = 0; i < W * H; i++) if (mask[i]) bytes[i >> 3] |= (1 << (i & 7));
    var s = '';
    for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return { W: W, H: H, bits: (typeof btoa !== 'undefined' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')) };
  }
  function unpackMask(p) {
    if (!p || !p.bits) return null;
    var s = (typeof atob !== 'undefined' ? atob(p.bits) : Buffer.from(p.bits, 'base64').toString('binary'));
    var mask = new Uint8Array(p.W * p.H);
    for (var i = 0; i < p.W * p.H; i++) if (s.charCodeAt(i >> 3) & (1 << (i & 7))) mask[i] = 1;
    return { data: mask, W: p.W, H: p.H };
  }

  /* Size-invariant silhouette: crop to bbox, resample to NxN, threshold.
     Shared by the diverse-fleet sampler and the test suite so both measure
     the same thing. */
  function silhouette(ship, N) {
    N = N || 8;
    var W = ship.W, H = ship.H, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, x, y, m;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      m = ship.mats[y * W + x];
      if (!m || m === OUTLINE) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    var out = new Uint8Array(N * N);
    if (x1 < 0) return out;
    var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
      var sx = x0 + Math.floor(i * bw / N), sy = y0 + Math.floor(j * bh / N);
      var v = ship.mats[sy * W + sx];
      out[j * N + i] = (v && v !== OUTLINE) ? 1 : 0;
    }
    return out;
  }
  function silhouetteIoU(a, b) {
    var inter = 0, uni = 0;
    for (var i = 0; i < a.length; i++) { if (a[i] && b[i]) inter++; if (a[i] || b[i]) uni++; }
    return uni ? inter / uni : 1;
  }

  return {
    composeShip: composeShip,
    silhouette: silhouette,
    silhouetteIoU: silhouetteIoU,
    packMask: packMask,
    unpackMask: unpackMask,
    colorFor: colorFor,
    merge: merge,
    roleSeed: roleSeed,
    SHAPE_TUNING: SHAPE_TUNING,
    SHADE_TUNING: SHADE_TUNING,
    MOUNT_TUNING: MOUNT_TUNING,
    MATERIALS: { EMPTY: EMPTY, HULL: HULL, OUTLINE: OUTLINE, COCKPIT: COCKPIT, ACCENT: ACCENT, NOZZLE: NOZZLE, GUN: GUN, LAMP: LAMP },
  };
});
