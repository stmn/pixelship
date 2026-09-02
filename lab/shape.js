/* ══════════════════════════════════════════════════════════════════════════════
   pixelship / lab / shape.js — SHAPE CORE

   Configurable cellular-automata hull generator producing a binary mask.

     generateMask(rng, opts) -> { mask: Uint8Array, W, H, meta }

   Design principles (each fixes a measured defect of the prototype generateA):

   1. SIZE INDEPENDENCE. The CA never runs at sprite resolution. It runs on a
      fixed LOGICAL grid (opts.logicalSize, default 32) whose dimensions depend
      only on opts — not on the requested output size. The resulting logical
      mask is then bbox-cropped and uniformly scaled into the sprite, followed
      by one cleanup pass. The rng is consumed EXACTLY ONCE (to derive an
      internal seed), so every random decision is taken in the logical stage and
      the output size cannot perturb the design.

   2. FORE/AFT POLARITY. Two independent mechanisms, both configurable:
        (a) the seeding probability field is a longitudinal envelope, hw(v),
            v = 0 at the nose (top) .. 1 at the tail (bottom), further shaped by
            noseTaper / tailWeight;
        (b) the CA rule is ANISOTROPIC — the effective neighbour count is
            biased by polarityStrength * (2v - 1), so cells are harder to birth
            near the nose and easier to keep near the tail.
      A hard envelope clip (envelopeClamp) each iteration stops the classic
      "smoothing CA converges to a disc" failure.

   3. NEVER DEGENERATE. A size-independent acceptance gate (probe render at
      opts.probeSize) rejects designs below opts.minMassFraction; rejected
      designs are retried from a DERIVED seed (mixSeed(baseSeed, attempt)), so
      seed + opts still reproduces exactly. If every attempt fails the least-bad
      attempt is used (never one shared analytic hull — that would make every
      seed produce the same ship); a deterministic analytic hull is the last
      resort only when nothing at all was produced. After rendering, a rescue
      dilation guarantees the invariant at every output size.

   Contract: plain JS, no imports, no deps, no Math.random, no Date.
   A mask is a Uint8Array of length W*H, row-major, values 0 or 1.
   ══════════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────── deterministic rng ─────────────────────────── */

function makeShapeRng(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* seed + attempt -> a well-scrambled new seed (deterministic retry) */
function mixSeed(seed, salt) {
  var h = (seed >>> 0) ^ Math.imul(salt + 1 | 0, 0x9E3779B1);
  h = Math.imul(h ^ h >>> 16, 0x85EBCA6B);
  h = Math.imul(h ^ h >>> 13, 0xC2B2AE35);
  return (h ^ h >>> 16) >>> 0;
}

/* ─────────────────────────────── options ───────────────────────────────── */

var SHAPE_DEFAULTS = {
  /* ---- output ---- */
  size: 32,                  // convenience: square sprite side (16..96)
  width: null,               // overrides size
  height: null,              // overrides size
  padding: 0,                // px of guaranteed empty margin on every side
  fillFraction: 1.0,         // 1 = ship touches the padded box; <1 = smaller
  fillFractionJitter: 0.05,  // ± random slack on fillFraction
  verticalAlign: 'center',   // 'center' | 'nose' (hug top) | 'tail' (hug bottom)
  fitToCanvas: true,         // true: scale the ship's bbox into the sprite
                             // false: scale the whole logical grid into the sprite

  /* ---- logical CA resolution (the size-independence knob) ---- */
  logicalSize: 32,           // long axis of the logical grid, in cells
  logicalMin: 10,            // floor for the short axis

  /* ---- proportions ---- */
  elongation: null,          // logicalH / logicalW; null = random in range
  elongationMin: 0.45,
  elongationMax: 2.40,

  /* ---- envelope (seeding probability field) ---- */
  envelope: 'random',        // one of envelopeChoices, or 'random'
  envelopeChoices: ['ellipse', 'teardrop', 'delta', 'dart',
                    'diamond', 'hourglass', 'cross', 'rectangle', 'spindle'],
  envelopeBlend: 0.45,       // chance of blending two profiles (only when envelope='random')
  envelopeClamp: 1.30,       // hard kill radius (in envelope units) during CA
  edgeSoftness: 0.55,        // width of the probability ramp at the envelope edge
  fillDensity: 0.60,         // initial fill probability at the envelope core
  fillDensityJitter: 0.10,   // ± random

  /* ---- envelope noise: what turns a smooth envelope into lobes/wings/notches ---- */
  noiseAmount: 0.65,         // radial wobble of the envelope rim, as a fraction of half-width
  noiseScale: 2.6,           // noise cells across the hull (low = big lobes, high = frills)
  noiseScaleJitter: 1.1,
  noiseOctaves: 2,           // 1 = pure lobes, 3 = lobes + frills

  /* ---- wings / fins: local bulges of the envelope, the low-fill silhouette cue ---- */
  wingChance: 1.00,          // probability a design grows wings at all
  wingCount: 3,              // max simultaneous bulges (each independently rolled)
  wingAmount: 1.60,          // peak extra half-width, as a fraction of the local width
  wingAmountJitter: 1.00,
  wingPosition: 0.66,        // v of the first bulge (0 = nose, 1 = tail)
  wingPositionJitter: 0.30,
  wingWidth: 0.11,           // gaussian sigma of the bulge, in v units
  wingWidthJitter: 0.07,
  wingSecondaryMinV: 0.35,   // extra bulges never sit on the nose
  wingNegativeChance: 0.30,  // chance a bulge is instead a notch (a waisted hull)
  wingNegativeDepth: 0.55,   // max fraction of local width removed by a notch
  envelopeCore: 0.75,        // cells with rad < this are pinned alive after every CA
                             // step, so thin fins survive erosion. 0 = pure CA.
  coreMinWidth: 2.0,         // stations narrower than this (in logical cells) are NOT
                             // pinned, so the nose fades out instead of growing a needle

  /* ---- fore/aft polarity ---- */
  noseTaper: 0.58,           // 0 = raw envelope, 1 = envelope pinched to a point
  noseTaperJitter: 0.22,
  noseTaperExp: 1.10,        // >1 = the taper hugs the nose longer (pointier)
  noseLength: 0.85,          // fraction of the hull length the taper acts over
  tailWeight: 0.35,          // extra width + density in the aft half
  tailWeightJitter: 0.20,
  polarityStrength: 1.10,    // anisotropic CA bias, in neighbour-count units

  /* ---- cellular automaton ---- */
  neighborhood: 'moore',     // 'moore' (8) | 'vonneumann' (4)
  neighborWeightY: 1.0,      // weight of the N/S neighbours (>1 = vertical streaks)
  birth: 5,                  // dead cell becomes alive at n >= birth   (moore scale)
  survive: 4,                // live cell stays alive at n >= survive   (moore scale)
  birthJitter: 0.7,          // ± fractional (thresholds are compared continuously)
  surviveJitter: 0.5,
  iterations: 4,
  iterationsJitter: 1,       // ± integer
  smoothBirth: 5,            // the silhouette-smoothing rule (B5/S3 = prototype smoother)
  smoothSurvive: 3,
  smoothingPolarityScale: 0.6,// how much of polarityStrength the smoother keeps

  /* ---- symmetry ---- */
  symmetry: 'mirrorX',       // 'mirrorX' | 'mirrorXY' | 'radial' | 'none' | 'random'
  symmetryChoices: ['mirrorX', 'mirrorX', 'mirrorX', 'mirrorXY', 'radial'],
  radialFolds: 5,            // N-fold rotational symmetry, or 'random' (3..7)
  radialMirror: true,        // dihedral (rotations + mirror) instead of cyclic
  radialLobeDepth: 0.60,     // how deeply the envelope profile carves the N lobes

  /* ---- post ---- */
  edgeRoughness: 0.35,       // 0 = maximally smoothed silhouette, 1 = raw CA edge
  smoothingPasses: 3,        // passes at edgeRoughness = 0
  holePolicy: 'fill',        // 'fill' | 'keep' | 'keepLarge'
  holeMinSize: 3,            // 'keepLarge': holes smaller than this get filled
  detachedPartMinFraction: 0,// 0 = keep only the largest blob; >0 keeps satellites
                             //     whose size >= fraction * largest blob
  cleanupPasses: 1,          // output-resolution cleanup iterations
  symmetryEnforceOutput: true,// re-mirror at sprite resolution after resampling
  cleanupFillNotches: true,  // fill an empty pixel with >= 3 filled orthogonals
  cleanupRemoveSpurs: true,  // delete a filled pixel with <= 1 filled orthogonal

  /* ---- never-degenerate guarantees ---- */
  minMassFraction: 0.10,     // min filled px / (W*H)
  maxPolarityWidthRatio: 1.05,// reject nose-heavier-than-tail designs; Infinity = allow
                             // (ignored for mirrorXY / radial, which are polarity-free)
  minWidthFraction: 0.22,    // min bbox width  / W
  minHeightFraction: 0.38,   // min bbox height / H
  minAspect: 0.25,           // bbox W/H bounds (rejects needles and pancakes)
  maxAspect: 3.00,
  maxAttempts: 16,
  probeSize: 16,             // size-independent acceptance probe (= smallest sprite)
  referenceSize: 64,         // second probe; the pair measures downscale robustness
  minCrossSizeIoU: 0.78,     // reject designs whose 16px render loses the silhouette
                             // (0 disables the gate)
  rescueDilations: 6,        // last-resort dilation budget after rendering

  /* ---- resampling ---- */
  resampleThreshold: 0.5,
  matchMassOnResample: true, // pick the coverage threshold so the output keeps the
                             // logical mask's area, instead of a fixed 0.5 cut.
                             // This is what keeps thin fins alive at 16px.
  resampleThresholdMin: 0.32,// bounds on the adaptive threshold
  resampleThresholdMax: 0.68,
  supersample: 3,            // sub-samples per axis per output pixel

  /* ---- reproducibility ---- */
  seed: null                 // if set, rng is not consumed at all
};

function shapeOptions(opts) {
  var o = {}, k;
  for (k in SHAPE_DEFAULTS) if (Object.prototype.hasOwnProperty.call(SHAPE_DEFAULTS, k)) o[k] = SHAPE_DEFAULTS[k];
  if (opts) for (k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
  o.width = Math.max(8, Math.round(o.width != null ? o.width : o.size));
  o.height = Math.max(8, Math.round(o.height != null ? o.height : o.size));
  return o;
}

/* ───────────────────────── small numeric helpers ───────────────────────── */

function shapeClamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function shapeLerp(a, b, t) { return a + (b - a) * t; }
function shapeJit(r, base, amt) { return base + (r() * 2 - 1) * amt; }

/* ───────────────────────── envelope half-width ─────────────────────────── */
/* v = 0 at the nose (top row), v = 1 at the tail (bottom row).
   Returns a half-width in [0,1]; callers normalise so max = 1.          */

function envelopeHalfWidth(name, v) {
  switch (name) {
    case 'ellipse':   { var t = 2 * v - 1; return Math.sqrt(Math.max(0, 1 - t * t)); }
    case 'teardrop':  return Math.pow(v, 0.50) * (1 - 0.55 * Math.pow(v, 6));
    case 'delta':     return v;                                   /* arrowhead */
    case 'dart':      return Math.pow(v, 1.7);                    /* very sharp nose */
    case 'diamond':   return 1 - Math.abs(2 * v - 1);
    case 'hourglass': return 0.30 + 0.70 * Math.abs(2 * v - 1);
    case 'cross':     return Math.max(0.20, Math.exp(-Math.pow((v - 0.46) / 0.13, 2)));
    case 'rectangle': return 1;
    case 'spindle':   return Math.pow(Math.sin(Math.PI * shapeClamp(v, 0, 1)), 0.55);
    default:          { var e = 2 * v - 1; return Math.sqrt(Math.max(0, 1 - e * e)); }
  }
}

function envelopeProfile(name, n) {
  var prof = new Float64Array(n), max = 0, i;
  for (i = 0; i < n; i++) {
    var v = n > 1 ? i / (n - 1) : 0.5;
    var w = envelopeHalfWidth(name, v);
    if (!(w > 0)) w = 0;
    prof[i] = w;
    if (w > max) max = w;
  }
  if (max > 0) for (i = 0; i < n; i++) prof[i] /= max;
  return prof;
}

function sampleProfile(prof, v) {
  var n = prof.length;
  var t = shapeClamp(v, 0, 1) * (n - 1);
  var i = Math.floor(t), f = t - i;
  if (i >= n - 1) return prof[n - 1];
  return prof[i] * (1 - f) + prof[i + 1] * f;
}

/* ───────────────────────────── symmetry map ────────────────────────────── */
/* Returns an Int32Array rep[] where rep[i] is the canonical cell of i's orbit.
   Symmetrising is then `g[i] = g[rep[i]]` — exact, order-independent, and
   works uniformly for mirror, double mirror and cyclic/dihedral N-fold. */

function buildSymmetryMap(W, H, mode, folds, radialMirror) {
  var n = W * H, rep = new Int32Array(n), x, y, i;
  var cx = (W - 1) / 2, cy = (H - 1) / 2;
  var mirrorX = (mode === 'mirrorX' || mode === 'mirrorXY' ||
    (mode === 'radial' && !!radialMirror));

  if (mode === 'radial') {
    /* Fold every cell into sector 0 by rotating it back by k*(2pi/folds).
       A canonical-sector map is used instead of unioning rounded rotations:
       on a square lattice those unions chain together and collapse the whole
       grid into one orbit, which turns every N-fold design into a plain disc. */
    var f = Math.max(2, folds | 0), sector = 2 * Math.PI / f;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var dx = x - cx, dy = y - cy;
      var d = Math.sqrt(dx * dx + dy * dy);
      var ang = Math.atan2(dy, dx); if (ang < 0) ang += 2 * Math.PI;
      var local = ang - Math.floor(ang / sector) * sector;
      var X = Math.round(cx + d * Math.cos(local));
      var Y = Math.round(cy + d * Math.sin(local));
      X = X < 0 ? 0 : (X >= W ? W - 1 : X);
      Y = Y < 0 ? 0 : (Y >= H ? H - 1 : Y);
      rep[y * W + x] = Y * W + X;
    }
  } else {
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var rx = (mode === 'mirrorX' || mode === 'mirrorXY') ? Math.min(x, W - 1 - x) : x;
      var ry = (mode === 'mirrorXY') ? Math.min(y, H - 1 - y) : y;
      rep[y * W + x] = ry * W + rx;
    }
  }
  return { rep: rep, mirrorX: mirrorX, W: W, H: H };
}

/* fold a grid (Uint8Array or Float64Array) through a symmetry map */
function symmetrise(g, sym) {
  var rep = sym.rep, i, W = sym.W, H = sym.H, x, y;
  var src = g.slice();
  for (i = 0; i < g.length; i++) g[i] = src[rep[i]];
  /* the rotational fold is only exact up to lattice rounding; the left/right
     mirror is applied afterwards so it holds pixel-for-pixel */
  if (sym.mirrorX) {
    var half = Math.floor(W / 2);
    for (y = 0; y < H; y++) for (x = 0; x < half; x++) g[y * W + (W - 1 - x)] = g[y * W + x];
  }
}

/* ─────────────────────── connectivity / topology ops ───────────────────── */

/* keep the largest 4-connected blob; optionally keep satellites that are at
   least `minFraction` of the largest (a strong non-human, alien cue) */
function maskLargestBlob(g, W, H, minFraction) {
  var n = W * H, lab = new Int32Array(n).fill(-1), stack = [], sizes = {}, best = -1, bestSize = 0, i;
  for (i = 0; i < n; i++) {
    if (!g[i] || lab[i] >= 0) continue;
    var id = i, size = 0;
    lab[i] = id; stack.push(i);
    while (stack.length) {
      var p = stack.pop(); size++;
      var x = p % W, y = (p - x) / W;
      if (x > 0 && g[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack.push(p - 1); }
      if (x < W - 1 && g[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && g[p - W] && lab[p - W] < 0) { lab[p - W] = id; stack.push(p - W); }
      if (y < H - 1 && g[p + W] && lab[p + W] < 0) { lab[p + W] = id; stack.push(p + W); }
    }
    sizes[id] = size;
    if (size > bestSize) { bestSize = size; best = id; }
  }
  var keepMin = minFraction > 0 ? Math.max(1, minFraction * bestSize) : Infinity;
  for (i = 0; i < n; i++) {
    if (!g[i]) continue;
    if (lab[i] === best) continue;
    if (sizes[lab[i]] >= keepMin) continue;
    g[i] = 0;
  }
  return bestSize;
}

/* holePolicy: 'fill' | 'keep' | 'keepLarge' (fill holes smaller than holeMinSize) */
function maskApplyHolePolicy(g, W, H, policy, holeMinSize) {
  if (policy === 'keep') return 0;
  var n = W * H, seen = new Uint8Array(n), stack = [], i, x, y;
  for (x = 0; x < W; x++) { if (!g[x] && !seen[x]) { seen[x] = 1; stack.push(x); } var b = (H - 1) * W + x; if (!g[b] && !seen[b]) { seen[b] = 1; stack.push(b); } }
  for (y = 0; y < H; y++) { var l = y * W; if (!g[l] && !seen[l]) { seen[l] = 1; stack.push(l); } var rgt = y * W + W - 1; if (!g[rgt] && !seen[rgt]) { seen[rgt] = 1; stack.push(rgt); } }
  while (stack.length) {
    var p = stack.pop(); x = p % W; y = (p - x) / W;
    if (x > 0 && !g[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
    if (x < W - 1 && !g[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
    if (y > 0 && !g[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
    if (y < H - 1 && !g[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
  }
  /* every unseen empty cell is enclosed */
  var filled = 0;
  if (policy === 'fill') {
    for (i = 0; i < n; i++) if (!g[i] && !seen[i]) { g[i] = 1; filled++; }
    return filled;
  }
  /* keepLarge: label the holes, fill the small ones */
  var done = new Uint8Array(n);
  for (i = 0; i < n; i++) {
    if (g[i] || seen[i] || done[i]) continue;
    var comp = [];
    done[i] = 1; stack.push(i);
    while (stack.length) {
      var q = stack.pop(); comp.push(q);
      var qx = q % W, qy = (q - qx) / W;
      if (qx > 0 && !g[q - 1] && !seen[q - 1] && !done[q - 1]) { done[q - 1] = 1; stack.push(q - 1); }
      if (qx < W - 1 && !g[q + 1] && !seen[q + 1] && !done[q + 1]) { done[q + 1] = 1; stack.push(q + 1); }
      if (qy > 0 && !g[q - W] && !seen[q - W] && !done[q - W]) { done[q - W] = 1; stack.push(q - W); }
      if (qy < H - 1 && !g[q + W] && !seen[q + W] && !done[q + W]) { done[q + W] = 1; stack.push(q + W); }
    }
    if (comp.length < holeMinSize) { for (var c = 0; c < comp.length; c++) { g[comp[c]] = 1; filled++; } }
  }
  return filled;
}

function maskBBox(g, W, H) {
  var x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    if (!g[y * W + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function maskMass(g) { var m = 0; for (var i = 0; i < g.length; i++) if (g[i]) m++; return m; }

/* ─────────────────────────── the CA itself ─────────────────────────────── */

function caStep(src, dst, W, H, cfg) {
  var moore = cfg.neighborhood !== 'vonneumann';
  var wy = cfg.neighborWeightY;
  var scale = moore ? 1 : 2;               /* von Neumann counts max 4 -> rescale */
  for (var y = 0; y < H; y++) {
    var v = H > 1 ? y / (H - 1) : 0.5;
    var bias = cfg.polarityStrength * (2 * v - 1);
    for (var x = 0; x < W; x++) {
      var i = y * W + x, n = 0;
      var up = y > 0 ? src[i - W] : 0, dn = y < H - 1 ? src[i + W] : 0;
      var lf = x > 0 ? src[i - 1] : 0, rt = x < W - 1 ? src[i + 1] : 0;
      n += (up + dn) * wy + lf + rt;
      if (moore) {
        if (y > 0 && x > 0) n += src[i - W - 1];
        if (y > 0 && x < W - 1) n += src[i - W + 1];
        if (y < H - 1 && x > 0) n += src[i + W - 1];
        if (y < H - 1 && x < W - 1) n += src[i + W + 1];
      }
      n = n * scale + bias;
      var alive = src[i]
        ? (n >= cfg.survive)
        : (n >= cfg.birth);
      dst[i] = alive ? 1 : 0;
    }
  }
}

/* value noise, `cells` features across the grid, optionally folded through the
   symmetry map so the lobes it carves respect the ship's symmetry */
function valueNoiseField(r, W, H, cells, octaves, sym) {
  var field = new Float64Array(W * H), amp = 1, total = 0, i;
  for (var oc = 0; oc < Math.max(1, octaves | 0); oc++) {
    var g = Math.max(2, Math.round(cells * Math.pow(2, oc))) + 1;
    var lat = new Float64Array(g * g);
    for (i = 0; i < lat.length; i++) lat[i] = r() * 2 - 1;
    for (var y = 0; y < H; y++) {
      var fy = (H > 1 ? y / (H - 1) : 0) * (g - 1);
      var y0 = Math.min(g - 2, Math.floor(fy)), ty = fy - y0;
      ty = ty * ty * (3 - 2 * ty);
      for (var x = 0; x < W; x++) {
        var fx = (W > 1 ? x / (W - 1) : 0) * (g - 1);
        var x0 = Math.min(g - 2, Math.floor(fx)), tx = fx - x0;
        tx = tx * tx * (3 - 2 * tx);
        var a = lat[y0 * g + x0], b = lat[y0 * g + x0 + 1];
        var c = lat[(y0 + 1) * g + x0], d = lat[(y0 + 1) * g + x0 + 1];
        field[y * W + x] += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
      }
    }
    total += amp; amp *= 0.5;
  }
  for (i = 0; i < field.length; i++) field[i] /= total;
  if (sym) symmetrise(field, sym);
  return field;
}

/* ───────────────────── logical design (all randomness) ─────────────────── */

function buildLogicalDesign(r, o) {
  /* --- pick the qualitative parameters --- */
  var symmetry = o.symmetry === 'random'
    ? o.symmetryChoices[Math.floor(r() * o.symmetryChoices.length)] : o.symmetry;
  var envelope = o.envelope === 'random'
    ? o.envelopeChoices[Math.floor(r() * o.envelopeChoices.length)] : o.envelope;
  /* an envelope may be a blend of two profiles — continuous silhouette variety */
  var envelope2 = null, blend = 0;
  if (o.envelope === 'random' && r() < o.envelopeBlend) {
    envelope2 = o.envelopeChoices[Math.floor(r() * o.envelopeChoices.length)];
    blend = 0.25 + 0.5 * r();
  }
  var folds = o.radialFolds === 'random' ? (3 + Math.floor(r() * 5)) : (o.radialFolds | 0);
  var elong = o.elongation != null ? o.elongation
    : shapeLerp(o.elongationMin, o.elongationMax, r());
  var fill = shapeClamp(shapeJit(r, o.fillDensity, o.fillDensityJitter), 0.15, 0.95);
  var noseTaper = shapeClamp(shapeJit(r, o.noseTaper, o.noseTaperJitter), 0, 1);
  var tailWeight = shapeClamp(shapeJit(r, o.tailWeight, o.tailWeightJitter), 0, 1);
  var iters = Math.max(0, Math.round(o.iterations + (r() * 2 - 1) * o.iterationsJitter));
  var fillFrac = shapeClamp(shapeJit(r, o.fillFraction, o.fillFractionJitter), 0.35, 1);
  var birth = shapeJit(r, o.birth, o.birthJitter);
  var survive = Math.min(birth, shapeJit(r, o.survive, o.surviveJitter));
  var nScale = Math.max(1.2, shapeJit(r, o.noiseScale, o.noiseScaleJitter));

  /* wings: 0..wingCount gaussian bulges of the longitudinal envelope */
  var wings = [];
  if (r() < o.wingChance) {
    var wn = 1 + Math.floor(r() * Math.max(1, o.wingCount | 0));
    for (var wi = 0; wi < wn; wi++) {
      var neg = r() < o.wingNegativeChance;
      wings.push({
        amp: neg ? -(0.15 + (o.wingNegativeDepth - 0.15) * r())
          : Math.max(0, shapeJit(r, o.wingAmount, o.wingAmountJitter)) * (wi ? 0.7 : 1),
        pos: shapeClamp(wi === 0 ? shapeJit(r, o.wingPosition, o.wingPositionJitter)
          : o.wingSecondaryMinV + (0.98 - o.wingSecondaryMinV) * r(), 0.02, 0.98),
        sig: Math.max(0.03, shapeJit(r, o.wingWidth, o.wingWidthJitter))
      });
    }
  }

  var radial = symmetry === 'radial';
  /* mirrorXY and radial are incompatible with a fore/aft bias by construction */
  var polarity = (radial || symmetry === 'mirrorXY') ? 0 : o.polarityStrength;

  /* --- logical grid --- */
  var S = Math.max(8, o.logicalSize | 0), LW, LH;
  if (radial) { LW = S; LH = S; elong = 1; }
  else if (elong >= 1) { LH = S; LW = Math.max(o.logicalMin, Math.round(S / elong)); }
  else { LW = S; LH = Math.max(o.logicalMin, Math.round(S * elong)); }

  var n = LW * LH;
  var g = new Uint8Array(n), tmp = new Uint8Array(n);
  var sym = buildSymmetryMap(LW, LH, symmetry, folds, o.radialMirror);
  var prof = envelopeProfile(envelope, 65);
  if (envelope2) {
    var prof2 = envelopeProfile(envelope2, 65), mx = 0;
    for (var pi = 0; pi < prof.length; pi++) { prof[pi] = shapeLerp(prof[pi], prof2[pi], blend); if (prof[pi] > mx) mx = prof[pi]; }
    if (mx > 0) for (var pj = 0; pj < prof.length; pj++) prof[pj] /= mx;
  }
  var noise = valueNoiseField(r, LW, LH, nScale, o.noiseOctaves, sym);

  var cx = (LW - 1) / 2, cy = (LH - 1) / 2;
  var hx = Math.max(0.5, (LW - 1) / 2), hy = Math.max(0.5, (LH - 1) / 2);

  /* radius field r(x,y) in envelope units: <=1 inside, >1 outside */
  var rad = new Float64Array(n);
  var rowPinnable = new Uint8Array(LH).fill(1);
  if (radial) {
    /* N-fold mode: the chosen envelope profile is swept around the sector angle,
       carving `folds` lobes instead of acting fore/aft. Alien by construction. */
    var f = Math.max(2, folds), sector = 2 * Math.PI / f;
    var depth = shapeClamp(o.radialLobeDepth, 0, 0.95);
    /* stretch the sector profile to the full [0,1] range, otherwise a flat
       profile (rectangle) degenerates into a plain disc for every seed */
    var lo = Infinity, hi = -Infinity, si;
    for (si = 0; si < prof.length; si++) { if (prof[si] < lo) lo = prof[si]; if (prof[si] > hi) hi = prof[si]; }
    var span = hi - lo;
    var sectorProf = new Float64Array(prof.length);
    for (si = 0; si < prof.length; si++) {
      sectorProf[si] = span > 0.05 ? (prof[si] - lo) / span
        : 0.5 + 0.5 * Math.cos(2 * Math.PI * si / (prof.length - 1));
    }
    for (var ry = 0; ry < LH; ry++) for (var rx2 = 0; rx2 < LW; rx2++) {
      var du = (rx2 - cx) / hx, dv = (ry - cy) / hy;
      var dist = Math.sqrt(du * du + dv * dv);
      var ang = Math.atan2(dv, du);
      var tt = ang / sector; tt = tt - Math.floor(tt);           /* [0,1) in-sector */
      var lobe = (1 - depth) + depth * sampleProfile(sectorProf, tt);
      rad[ry * LW + rx2] = dist / Math.max(0.05, lobe);
    }
  } else {
    var hwRow = new Float64Array(LH), hwMax = 0, y, v;
    for (y = 0; y < LH; y++) {
      v = LH > 1 ? y / (LH - 1) : 0.5;
      var hw = sampleProfile(prof, v);
      /* nose taper: a monotone longitudinal gain, so even a fore/aft-symmetric
         envelope (diamond, hourglass, spindle, ellipse) still gets a nose */
      var tv = shapeClamp(v / Math.max(1e-3, o.noseLength), 0, 1);
      hw *= 1 - noseTaper * Math.pow(1 - tv, o.noseTaperExp);
      /* tail weight: widen the aft half */
      hw *= 1 + 0.45 * tailWeight * Math.max(0, (v - 0.5) * 2);
      /* wings: local gaussian bulges -> narrow body + wide span = low bbox fill */
      for (var wk = 0; wk < wings.length; wk++) {
        var dvw = (v - wings[wk].pos) / wings[wk].sig;
        hw *= 1 + wings[wk].amp * Math.exp(-dvw * dvw);
      }
      hwRow[y] = hw;
      if (hw > hwMax) hwMax = hw;
    }
    /* renormalise so the widest station just reaches the grid edge */
    if (hwMax > 0) for (y = 0; y < LH; y++) hwRow[y] = Math.max(0.02, hwRow[y] / hwMax);
    for (y = 0; y < LH; y++) {
      rowPinnable[y] = (2 * hwRow[y] * hx) >= o.coreMinWidth ? 1 : 0;
      for (var x = 0; x < LW; x++) rad[y * LW + x] = Math.abs((x - cx) / hx) / hwRow[y];
    }
  }
  for (var i2 = 0; i2 < n; i2++) if (!isFinite(rad[i2]) || rad[i2] > 99) rad[i2] = 99;
  /* wobble the envelope rim: this is what grows wings, notches and lobes
     instead of one more smooth convex blob */
  if (o.noiseAmount) for (var ni = 0; ni < n; ni++)
    rad[ni] *= shapeClamp(1 + o.noiseAmount * noise[ni], 0.20, 4);

  /* precompute the pinned core (see envelopeCore / coreMinWidth) */
  var pin = null;
  if (o.envelopeCore > 0) {
    pin = new Uint8Array(n);
    for (var py = 0; py < LH; py++) {
      if (!rowPinnable[py]) continue;
      for (var px2 = 0; px2 < LW; px2++)
        if (rad[py * LW + px2] < o.envelopeCore) pin[py * LW + px2] = 1;
    }
  }

  /* --- seed --- */
  for (var yy = 0; yy < LH; yy++) {
    var vv = LH > 1 ? yy / (LH - 1) : 0.5;
    var dens = fill * (1 + 0.5 * tailWeight * Math.max(0, (vv - 0.5) * 2));
    for (var xx = 0; xx < LW; xx++) {
      var idx = yy * LW + xx;
      var p = dens * shapeClamp(0.5 + (1 - rad[idx]) / Math.max(1e-3, o.edgeSoftness), 0, 1);
      g[idx] = r() < p ? 1 : 0;
    }
  }
  symmetrise(g, sym);

  /* --- anisotropic CA --- */
  var cfg = {
    neighborhood: o.neighborhood, neighborWeightY: o.neighborWeightY,
    birth: birth, survive: survive, polarityStrength: polarity
  };
  /* the smoothing pass is the same automaton with a gentler rule — one code path */
  var smoothCfg = {
    neighborhood: 'moore', neighborWeightY: 1,
    birth: o.smoothBirth, survive: o.smoothSurvive,
    polarityStrength: polarity * o.smoothingPolarityScale
  };
  var sp = Math.round((1 - shapeClamp(o.edgeRoughness, 0, 1)) * o.smoothingPasses);
  var plan = [], pi2;
  for (pi2 = 0; pi2 < iters; pi2++) plan.push(cfg);
  for (pi2 = 0; pi2 < sp; pi2++) plan.push(smoothCfg);
  for (var st = 0; st < plan.length; st++) {
    caStep(g, tmp, LW, LH, plan[st]);
    for (var c = 0; c < n; c++) {
      /* hard envelope clip: the anti-disc guard */
      if (rad[c] > o.envelopeClamp) tmp[c] = 0;
      /* envelope core: keeps thin fins and narrow bodies from being eroded away */
      else if (pin && pin[c]) tmp[c] = 1;
    }
    g.set(tmp);
    symmetrise(g, sym);
  }

  maskLargestBlob(g, LW, LH, o.detachedPartMinFraction);
  symmetrise(g, sym);
  maskApplyHolePolicy(g, LW, LH, o.holePolicy, o.holeMinSize);

  return {
    mask: g, W: LW, H: LH,
    envelope: envelope, envelope2: envelope2, envelopeBlend: blend,
    symmetry: symmetry, folds: folds, elongation: elong,
    fillDensity: fill, noseTaper: noseTaper, tailWeight: tailWeight,
    birth: birth, survive: survive, noiseScale: nScale,
    iterations: iters, smoothing: sp, polarityStrength: polarity,
    fillFraction: fillFrac
  };
}

/* deterministic analytic hull — the last-resort guarantee that nothing is empty */
function fallbackDesign(o) {
  var LW = Math.max(12, o.logicalSize | 0), LH = LW;
  var g = new Uint8Array(LW * LH);
  var prof = envelopeProfile('teardrop', 65);
  var cx = (LW - 1) / 2, hx = (LW - 1) / 2;
  for (var y = 0; y < LH; y++) {
    var v = y / (LH - 1);
    var hw = sampleProfile(prof, v) * 0.85;
    var tv = shapeClamp(v / 0.45, 0, 1);
    hw *= 0.45 + 0.55 * tv;
    for (var x = 0; x < LW; x++) if (Math.abs((x - cx) / hx) <= hw) g[y * LW + x] = 1;
  }
  return {
    mask: g, W: LW, H: LH, envelope: 'teardrop', symmetry: 'mirrorX', folds: 1,
    elongation: 1, fillDensity: 1, noseTaper: 0.55, tailWeight: 0.35,
    iterations: 0, smoothing: 0, polarityStrength: 0, fillFraction: o.fillFraction,
    fallback: true
  };
}

/* ─────────────────── logical design -> sprite-size mask ────────────────── */

/* bilinear sample of a binary field, zero outside */
function sampleField(m, W, H, sx, sy) {
  var x0 = Math.floor(sx - 0.5), y0 = Math.floor(sy - 0.5);
  var fx = (sx - 0.5) - x0, fy = (sy - 0.5) - y0;
  function at(x, y) { return (x < 0 || y < 0 || x >= W || y >= H) ? 0 : m[y * W + x]; }
  var a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/* Uniformly scale a source region into the sprite. This is what makes the
   design size-independent: the same logical mask, the same crop, the same
   uniform scale — only the sampling lattice changes. */
function renderDesign(design, o, W, H) {
  var src = design.mask, SW = design.W, SH = design.H;
  var box = o.fitToCanvas ? maskBBox(src, SW, SH) : { x0: 0, y0: 0, x1: SW - 1, y1: SH - 1, w: SW, h: SH };
  if (!box) return new Uint8Array(W * H);

  var pad = Math.max(0, o.padding | 0);
  var aw = Math.max(1, W - 2 * pad), ah = Math.max(1, H - 2 * pad);
  var ff = shapeClamp(design.fillFraction, 0.2, 1);
  /* +1 accounts for the half-pixel bleed of the bilinear 0.5-contour */
  var scale = Math.min(aw / (box.w + 1), ah / (box.h + 1)) * ff;
  var tw = box.w * scale, th = box.h * scale;
  var ox = (W - tw) / 2;
  var oy = o.verticalAlign === 'nose' ? pad
    : o.verticalAlign === 'tail' ? (H - pad - th)
      : (H - th) / 2;

  var S = Math.max(1, o.supersample | 0);
  var cov = new Float64Array(W * H);
  for (var Y = 0; Y < H; Y++) for (var X = 0; X < W; X++) {
    var acc = 0;
    for (var sy = 0; sy < S; sy++) for (var sx = 0; sx < S; sx++) {
      var px = X + (sx + 0.5) / S, py = Y + (sy + 0.5) / S;
      var u = (px - ox) / scale + box.x0;
      var v = (py - oy) / scale + box.y0;
      acc += sampleField(src, SW, SH, u, v);
    }
    cov[Y * W + X] = acc / (S * S);
  }

  var thr = o.resampleThreshold;
  if (o.matchMassOnResample) {
    /* the ship's area scales with scale^2; pick the coverage cut that reproduces
       it, so a 16px sprite keeps the same proportion of hull as a 96px one */
    var want = Math.round(maskMass(src) * scale * scale);
    if (want > 0 && want < W * H) {
      var vals = [];
      for (var vi = 0; vi < cov.length; vi++) if (cov[vi] > 0) vals.push(cov[vi]);
      if (vals.length) {
        vals.sort(function (a2, b2) { return b2 - a2; });
        var k = Math.min(vals.length, want) - 1;
        thr = shapeClamp(vals[k], o.resampleThresholdMin, o.resampleThresholdMax);
      }
    }
  }
  var out = new Uint8Array(W * H);
  for (var i = 0; i < cov.length; i++) out[i] = cov[i] >= thr ? 1 : 0;
  return out;
}

/* ───────────────────────── output cleanup pass ─────────────────────────── */

function cleanupMask(g, W, H, o, minMass, mirrorOut) {
  for (var pass = 0; pass < Math.max(0, o.cleanupPasses | 0); pass++) {
    var src = Uint8Array.from(g), changed = 0;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var i = y * W + x;
      var nb = (x > 0 ? src[i - 1] : 0) + (x < W - 1 ? src[i + 1] : 0) +
        (y > 0 ? src[i - W] : 0) + (y < H - 1 ? src[i + W] : 0);
      if (!src[i]) {
        if (o.cleanupFillNotches && nb >= 3) { g[i] = 1; changed++; }
      } else {
        if (o.cleanupRemoveSpurs && nb <= 1) { g[i] = 0; changed++; }
      }
    }
    if (!changed) break;
  }
  /* the resample lattice can break exact mirror symmetry by a pixel — restore it
     (only for designs that actually have a left/right mirror axis) */
  if (mirrorOut && o.symmetryEnforceOutput !== false) {
    for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < Math.floor(W / 2); xx++)
      g[yy * W + (W - 1 - xx)] = g[yy * W + xx];
  }
  maskLargestBlob(g, W, H, o.detachedPartMinFraction);
  maskApplyHolePolicy(g, W, H, o.holePolicy, o.holeMinSize);
  if (maskMass(g) < minMass) return false;
  return true;
}

function dilateMask(g, W, H, pad) {
  var p = Math.max(0, pad | 0);
  var src = Uint8Array.from(g);
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var i = y * W + x;
    if (src[i]) continue;
    if (x < p || y < p || x >= W - p || y >= H - p) continue;   /* keep the margin */
    if ((x > 0 && src[i - 1]) || (x < W - 1 && src[i + 1]) ||
      (y > 0 && src[i - W]) || (y < H - 1 && src[i + W])) g[i] = 1;
  }
}

/* ───────────────────────────── measurement ─────────────────────────────── */

/* Polarity metrics (both are 1.0 for a fore/aft-symmetric disc):
     polarityWidthRatio — mean hull width over v in [0.10,0.30] (nose band)
                          divided by mean width over v in [0.70,0.90] (tail band).
                          Ships want < 0.7.
     polarityMassRatio  — mass in the leading 30% of the bbox height divided by
                          mass in the trailing 30%.                              */
function measureMask(mask, W, H) {
  var box = maskBBox(mask, W, H);
  var mass = maskMass(mask);
  var out = {
    mass: mass, massFraction: mass / (W * H), empty: mass === 0,
    bbox: box, aspect: box ? box.w / box.h : 0,
    widthNose: 0, widthTail: 0, polarityWidthRatio: 1,
    massNose: 0, massTail: 0, polarityMassRatio: 1,
    fillRatio: box ? mass / (box.w * box.h) : 0,
    perimeter: 0, edgeComplexity: 0, holes: 0
  };
  if (!box) return out;

  var widths = new Int32Array(box.h);
  for (var y = box.y0; y <= box.y1; y++) {
    var w = 0;
    for (var x = box.x0; x <= box.x1; x++) if (mask[y * W + x]) w++;
    widths[y - box.y0] = w;
  }
  function bandWidth(a, b) {
    var s = 0, c = 0;
    var i0 = Math.floor(a * box.h), i1 = Math.max(i0 + 1, Math.ceil(b * box.h));
    for (var i = i0; i < Math.min(box.h, i1); i++) { s += widths[i]; c++; }
    return c ? s / c : 0;
  }
  out.widthNose = bandWidth(0.10, 0.30);
  out.widthTail = bandWidth(0.70, 0.90);
  out.polarityWidthRatio = out.widthTail > 0 ? out.widthNose / out.widthTail : 1;

  var cut = Math.max(1, Math.round(box.h * 0.30));
  var mn = 0, mt = 0;
  for (var i2 = 0; i2 < cut; i2++) { mn += widths[i2]; mt += widths[box.h - 1 - i2]; }
  out.massNose = mn; out.massTail = mt;
  out.polarityMassRatio = mt > 0 ? mn / mt : 1;

  var per = 0;
  for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) {
    if (!mask[yy * W + xx]) continue;
    if (xx === 0 || !mask[yy * W + xx - 1]) per++;
    if (xx === W - 1 || !mask[yy * W + xx + 1]) per++;
    if (yy === 0 || !mask[(yy - 1) * W + xx]) per++;
    if (yy === H - 1 || !mask[(yy + 1) * W + xx]) per++;
  }
  out.perimeter = per;
  out.edgeComplexity = per / (4 * Math.sqrt(Math.max(1, mass)));

  var probe = Uint8Array.from(mask);
  out.holes = maskApplyHolePolicy(probe, W, H, 'fill', 0);
  return out;
}

/* exact area-weighted resample of a mask to N x M, thresholded at 0.5 */
function areaResampleMask(mask, W, H, N, M, thr) {
  var acc = new Float64Array(N * M);
  for (var y = 0; y < H; y++) {
    var y0 = y * M / H, y1 = (y + 1) * M / H;
    for (var x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      var x0 = x * N / W, x1 = (x + 1) * N / W;
      for (var Y = Math.floor(y0), Ye = Math.min(M, Math.ceil(y1)); Y < Ye; Y++) {
        var wy = Math.min(y1, Y + 1) - Math.max(y0, Y); if (wy <= 0) continue;
        for (var X = Math.floor(x0), Xe = Math.min(N, Math.ceil(x1)); X < Xe; X++) {
          var wx = Math.min(x1, X + 1) - Math.max(x0, X); if (wx <= 0) continue;
          acc[Y * N + X] += wx * wy;
        }
      }
    }
  }
  var out = new Uint8Array(N * M), t = thr == null ? 0.5 : thr;
  for (var i = 0; i < out.length; i++) out[i] = acc[i] >= t ? 1 : 0;
  return out;
}

/* crop to bbox, then area-resample to N x N — the project-wide diversity key */
function coarseSignature(mask, W, H, N) {
  var box = maskBBox(mask, W, H);
  if (!box) return new Uint8Array(N * N);
  var crop = new Uint8Array(box.w * box.h);
  for (var y = 0; y < box.h; y++) for (var x = 0; x < box.w; x++)
    crop[y * box.w + x] = mask[(y + box.y0) * W + (x + box.x0)];
  return areaResampleMask(crop, box.w, box.h, N, N, 0.5);
}

function maskIoU(a, b) {
  var inter = 0, uni = 0;
  for (var i = 0; i < a.length; i++) {
    var p = a[i] ? 1 : 0, q = b[i] ? 1 : 0;
    if (p & q) inter++;
    if (p | q) uni++;
  }
  return uni ? inter / uni : 1;
}

/* ─────────────────────────── the public entry ──────────────────────────── */

function generateMask(rng, opts) {
  var o = shapeOptions(opts);
  var W = o.width, H = o.height;
  var baseSeed = (o.seed != null) ? (o.seed >>> 0) : ((rng() * 4294967296) >>> 0);

  var probeN = Math.max(8, o.probeSize | 0);
  var design = null, attempts = 0, reject = null;
  var best = null, bestScore = -1;

  for (var a = 0; a < Math.max(1, o.maxAttempts | 0); a++) {
    attempts = a + 1;
    var r = makeShapeRng(mixSeed(baseSeed, a));
    var d = buildLogicalDesign(r, o);
    var verdict = acceptDesign(d, o, probeN);
    if (verdict === true) { design = d; reject = null; break; }
    reject = verdict;
    /* keep the least-bad attempt: falling back to one analytic hull would make
       every seed produce the SAME ship whenever the gates are set too tight */
    var score = d.probeMassFraction || 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  var usedFallback = false;
  if (!design && best && bestScore > 0) { design = best; }
  if (!design) { design = fallbackDesign(o); usedFallback = true; }
  var mirrorOut = designHasMirror(design, o);

  /* --- render at the requested size --- */
  var mask = renderDesign(design, o, W, H);
  var minMass = Math.ceil(o.minMassFraction * W * H);
  var ok = cleanupMask(mask, W, H, o, minMass, mirrorOut);

  /* --- rescue: guarantee the invariant at every size --- */
  var rescues = 0;
  if (!ok) {
    if (maskMass(mask) === 0) {
      var fb = fallbackDesign(o);
      mask = renderDesign(fb, o, W, H);
      cleanupMask(mask, W, H, o, 0, true);
      rescues++;
    }
    while (maskMass(mask) < minMass && rescues < o.rescueDilations) {
      dilateMask(mask, W, H, o.padding); rescues++;
    }
    if (maskMass(mask) < minMass) {
      var fb2 = fallbackDesign(o);
      mask = renderDesign(fb2, o, W, H);
      cleanupMask(mask, W, H, o, 0, true);
      while (maskMass(mask) < minMass && rescues < o.rescueDilations * 3) { dilateMask(mask, W, H, o.padding); rescues++; }
    }
    maskLargestBlob(mask, W, H, o.detachedPartMinFraction);
    maskApplyHolePolicy(mask, W, H, o.holePolicy, o.holeMinSize);
  }

  var m = measureMask(mask, W, H);
  return {
    mask: mask, W: W, H: H,
    meta: {
      seed: baseSeed, attempts: attempts, rejectedReason: reject,
      fallback: usedFallback, rescues: rescues,
      envelope: design.envelope, symmetry: design.symmetry,
      radialFolds: design.symmetry === 'radial' ? design.folds : 0,
      elongation: design.elongation, fillDensity: design.fillDensity,
      noseTaper: design.noseTaper, tailWeight: design.tailWeight,
      iterations: design.iterations, smoothingPasses: design.smoothing,
      polarityStrength: design.polarityStrength,
      logicalW: design.W, logicalH: design.H,
      logicalMask: design.mask,
      mass: m.mass, massFraction: m.massFraction, aspect: m.aspect,
      bbox: m.bbox, holes: m.holes,
      polarityWidthRatio: m.polarityWidthRatio,
      polarityMassRatio: m.polarityMassRatio
    }
  };
}

/* size-independent acceptance gate: judge the design by a probe render at the
   smallest supported sprite size, never at the requested size */
function designHasMirror(d, o) {
  return d.symmetry === 'mirrorX' || d.symmetry === 'mirrorXY' ||
    (d.symmetry === 'radial' && !!o.radialMirror);
}

function acceptDesign(d, o, probeN) {
  var lm = maskMass(d.mask);
  if (lm === 0) return 'empty-logical';
  var probe = renderDesign(d, o, probeN, probeN);
  cleanupMask(probe, probeN, probeN, o, 0, designHasMirror(d, o));
  var mm = measureMask(probe, probeN, probeN);
  d.probeMassFraction = mm.massFraction;
  if (mm.empty) return 'empty-probe';
  if (mm.massFraction < o.minMassFraction) return 'mass';
  if (mm.bbox.w < o.minWidthFraction * probeN) return 'width';
  if (mm.bbox.h < o.minHeightFraction * probeN) return 'height';
  if (mm.aspect < o.minAspect || mm.aspect > o.maxAspect) return 'aspect';
  if (d.polarityStrength !== 0 && isFinite(o.maxPolarityWidthRatio) &&
    mm.polarityWidthRatio > o.maxPolarityWidthRatio) return 'polarity';
  /* size-independence gate: a design whose features do not survive the smallest
     sprite is rejected here, not silently mangled at render time */
  if (o.minCrossSizeIoU > 0) {
    var refN = Math.max(probeN + 1, o.referenceSize | 0);
    var ref = renderDesign(d, o, refN, refN);
    cleanupMask(ref, refN, refN, o, 0, designHasMirror(d, o));
    if (!maskMass(ref)) return 'empty-reference';
    var iou = maskIoU(areaResampleMask(probe, probeN, probeN, 64, 64, 0.5),
      areaResampleMask(ref, refN, refN, 64, 64, 0.5));
    if (iou < o.minCrossSizeIoU) return 'cross-size';
  }
  return true;
}

if (typeof module !== 'undefined') module.exports = {
  generateMask: generateMask,
  SHAPE_DEFAULTS: SHAPE_DEFAULTS,
  shapeOptions: shapeOptions,
  makeShapeRng: makeShapeRng,
  mixSeed: mixSeed,
  measureMask: measureMask,
  maskBBox: maskBBox,
  maskMass: maskMass,
  maskIoU: maskIoU,
  maskLargestBlob: maskLargestBlob,
  maskApplyHolePolicy: maskApplyHolePolicy,
  dilateMask: dilateMask,
  symmetrise: symmetrise,
  valueNoiseField: valueNoiseField,
  areaResampleMask: areaResampleMask,
  coarseSignature: coarseSignature,
  envelopeHalfWidth: envelopeHalfWidth,
  buildSymmetryMap: buildSymmetryMap
};
