/* ============================================================================
 * pixelship / lab / mounts.js
 *
 * MOUNT DETECTION for arbitrary cellular-automata blobs.
 *
 *   detectMounts(mask, W, H, opts) -> { engines, guns, cockpit, lamps, meta }
 *
 *     engines : [{ x, y, width, span:{a,b}, kind }]   x = fractional centre column
 *                                                     y = last hull row of the nozzle
 *                                                         (exhaust is drawn from y+1 down)
 *     guns    : [{ x, y, baseY, length }]             y = muzzle tip (points UP)
 *     cockpit : { x, y, rx, ry, pixels } | null
 *     lamps   : [{ x, y, phase }]
 *     meta    : diagnostics (stern band, fallbacks, failure reasons, ...)
 *
 * Design notes
 * ------------
 * The blob is produced by a mirrored CA, so nothing marks the "back". This module
 * finds the STERN as a scored, contiguous, bilaterally-symmetric band of columns
 * along the bottom edge, combining four signals: run width, depth, closeness to the
 * symmetry axis, and flatness. Mounts are then expressed as INTEGER COLUMN SPANS,
 * and every span is either axis-centred (a == W-1-b) or emitted together with its
 * exact mirror, which makes symmetry violations structurally impossible rather than
 * merely unlikely.
 *
 * Contract: plain JS, no imports, no dependencies, no Math.random, no Date.
 * Randomness (only used for lamp blink phase) comes from opts.rng, or from a
 * deterministic hash of the mask itself when no rng is supplied.
 * ==========================================================================*/

var PIXELSHIP_MOUNTS = (function () {
'use strict';

/* material ids (kept local so the file can share a page with the prototype) */
var M_EMPTY = 0, M_HULL = 1, M_LIGHT = 2, M_DARK = 3, M_OUTLINE = 4,
    M_COCKPIT = 5, M_ACCENT = 6, M_NOZZLE = 7, M_GUN = 8, M_LAMP = 9;

/* ---------------------------------------------------------------- defaults */

var DEFAULTS = {
  /* ---- global ------------------------------------------------------ */
  /* rng: zero-arg function -> [0,1). Only used for lamp phase. When null a
     deterministic mulberry32 seeded from a hash of the mask is used. */
  rng: null,
  /* symmetry axis in column units. null => (W-1)/2 (the mirror axis the CA uses) */
  axis: null,
  /* Detect on mask AND mirror(mask) instead of the raw mask. Anything found on
     that intersection is on-hull in the original AND has an on-hull mirror, so
     mirrored mounts can never fall into a hole. keepLargestBlob() in the CA
     pipeline can pick one of two mirror-twin blobs and hand us a genuinely
     asymmetric silhouette; this is what keeps that case honest. */
  symmetrizeMask: true,
  /* if the intersection keeps less than this fraction of the mask area the blob
     is not really mirror-symmetric: fall back to the raw mask and flag
     meta.symmetryBroken (mounts are then on-hull but may not be mirrored). */
  symmetrizeMinAreaFrac: 0.35,

  /* ---- feature size gates (compared against min(W,H)) --------------- */
  minSizeEngines: 0,      /* engines are attempted at every size            */
  minSizeGuns: 24,        /* below this, guns are skipped (they read as noise) */
  minSizeCockpit: 12,
  minSizeLamps: 24,

  /* ---- engines ------------------------------------------------------ */
  engineCount: 2,             /* target number of nozzles                     */
  engineCountMax: 3,          /* hard clamp for engineCount                   */
  singleEngineFallbackToPair: true, /* if a centred single engine cannot sit on
                                       hull, use a symmetric pair instead     */
  sternDepthTolerance: 0.10,  /* fraction of H: a column counts as "stern" if its
                                 lowest pixel is within this of the deepest     */
  sternMinThickness: 2,       /* px of solid hull above the bottom pixel needed */
  sternThicknessFrac: 0.03,   /* ...or this fraction of H, whichever is larger  */
  sternWeightWidth: 1.00,     /* run scoring: contiguous width                  */
  sternWeightDepth: 1.20,     /* run scoring: how far aft the run reaches       */
  sternWeightCenter: 0.55,    /* run scoring: closeness to the symmetry axis    */
  sternWeightFlat: 0.70,      /* run scoring: flatness of the bottom edge       */
  sternWeightMass: 0.45,      /* run scoring: mean column mass (avoid thin tails)*/
  engineSpread: 0.62,         /* pair offset as a fraction of the stern half-width */
  nozzleWidthFrac: 0.17,      /* nozzle width as a fraction of W                */
  nozzleWidthMin: 1,
  nozzleWidthMaxFrac: 0.34,   /* cap: nozzle may not exceed this fraction of W  */
  nozzleGap: 1,               /* required non-nozzle columns between nozzles    */
  nozzleBotSpread: 0,         /* max allowed (deepest bottom pixel - mount row)
                                 inside a nozzle span. 0 = every nozzle column
                                 ends exactly on the silhouette bottom, i.e. the
                                 exhaust never emerges from inside the hull.
                                 Raise to 1-2 for wider nozzles on curved sterns */
  nozzleProbeDepth: 3,        /* rows the mount row may climb to find a solid row*/

  /* ---- guns --------------------------------------------------------- */
  gunCount: 2,                /* 0 disables guns entirely                       */
  gunLengthFrac: 0.09,        /* muzzle protrusion as a fraction of H           */
  gunLengthMin: 1,
  gunSupportDepth: 2,         /* px of solid hull below the muzzle base needed   */
  gunSupportFrac: 0.045,      /* ...or this fraction of H, whichever is larger   */
  gunMinLateralFrac: 0.10,    /* required |x-axis| as a fraction of W           */
  gunSeparationFrac: 0.12,    /* min column distance between two guns / W       */
  gunForwardBand: 0.60,       /* only columns whose top lies in the upper this
                                 fraction of the hull bbox may carry a gun      */
  gunWeightForward: 1.00,
  gunWeightLateral: 1.00,
  gunRequireLocalPeak: true,  /* the column must be the forward-most in its window */
  gunPeakWindowFrac: 0.08,    /* that window, as a fraction of W                */

  /* ---- cockpit ------------------------------------------------------ */
  cockpitWanted: true,        /* false => cockpit is null (alien / eye clusters) */
  cockpitBandTop: 0.08,       /* search band, fraction of hull bbox height      */
  cockpitBandBottom: 0.70,
  cockpitMinRx: 0.5,          /* 0.5 = two columns wide on even W / one on odd W */
  cockpitMinRy: 0.5,
  cockpitRyStep: 0.5,         /* ry search granularity                          */
  cockpitMinPixels: 2,        /* smallest canopy worth drawing (2 px reads fine
                                 at 16px; raise to 4-6 for chunkier sprites)    */
  cockpitMaxRxFrac: 0.18,     /* fraction of W                                  */
  cockpitMaxRyFrac: 0.18,     /* fraction of H                                  */
  cockpitMaxAreaFrac: 0.13,   /* cockpit pixels / hull pixels: keeps the canopy a
                                 canopy instead of swallowing a 16px sprite.
                                 Uncapped, the largest inscribed ellipse eats
                                 ~50% of the hull at every size (measured).     */
  cockpitAreaCapFloorPixels: 6, /* the area cap never drops below this, so tiny
                                   16px hulls still get their smallest canopy   */
  cockpitMaxHalfWidthFrac: 0.62, /* rx as a fraction of the hull half-width on the
                                    cockpit's own row: leaves a visible margin  */
  cockpitAspectMin: 0.90,     /* ry/rx                                          */
  cockpitAspectMax: 2.40,
  cockpitPad: 0.30,           /* ellipse rasterisation pad (matches fillEllipse) */
  cockpitGrowSteps: 6,        /* greedy rx expansion attempts beyond the
                                 conservative analytic bound                    */
  cockpitGrowStep: 0.25,
  cockpitForwardBias: 0.06,   /* score bonus per row closer to the nose         */

  /* ---- lamps -------------------------------------------------------- */
  lampCount: 2,               /* total lamps; odd values are floored to pairs   */
  lampBandTop: 0.35,          /* search band, fraction of hull bbox height      */
  lampBandBottom: 0.88,
  lampInset: 0,               /* px pulled inward from the lateral extremity    */
  lampMinLateralFrac: 0.10,   /* required |x-axis| / W                          */
  lampSeparationFrac: 0.18,   /* min row distance between lamp pairs / H        */
  lampPhaseMirror: true       /* true: a mirrored pair blinks in sync           */
};

/* ---------------------------------------------------------------- helpers */

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

function makeOpts(opts) {
  var o = {}, k;
  for (k in DEFAULTS) o[k] = DEFAULTS[k];
  var unknown = [];
  if (opts) for (k in opts) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) o[k] = opts[k];
    else unknown.push(k);
  }
  o.__unknown = unknown;
  return o;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashMask(mask, W, H) {
  var h = 2166136261 >>> 0;
  h = Math.imul(h ^ W, 16777619) >>> 0;
  h = Math.imul(h ^ H, 16777619) >>> 0;
  for (var i = 0; i < mask.length; i++) if (mask[i]) h = Math.imul(h ^ i, 16777619) >>> 0;
  return h >>> 0;
}

/* column profiles of the mask */
function profiles(mask, W, H) {
  var top = new Int32Array(W), bot = new Int32Array(W),
      topRun = new Int32Array(W), botRun = new Int32Array(W),
      colMass = new Int32Array(W);
  var area = 0, x0 = W, x1 = -1, y0 = H, y1 = -1, x, y;
  for (x = 0; x < W; x++) {
    top[x] = -1; bot[x] = -1;
    for (y = 0; y < H; y++) if (mask[y * W + x]) { top[x] = y; break; }
    if (top[x] < 0) continue;
    for (y = H - 1; y >= 0; y--) if (mask[y * W + x]) { bot[x] = y; break; }
    var m = 0;
    for (y = top[x]; y <= bot[x]; y++) if (mask[y * W + x]) m++;
    colMass[x] = m; area += m;
    var r = 0;
    for (y = top[x]; y < H && mask[y * W + x]; y++) r++;
    topRun[x] = r;
    r = 0;
    for (y = bot[x]; y >= 0 && mask[y * W + x]; y--) r++;
    botRun[x] = r;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (top[x] < y0) y0 = top[x];
    if (bot[x] > y1) y1 = bot[x];
  }
  return {
    top: top, bot: bot, topRun: topRun, botRun: botRun, colMass: colMass,
    area: area, bbox: { x0: x0, y0: y0, x1: x1, y1: y1 },
    empty: x1 < 0
  };
}

/* per-row half-width of the solid run that is centred on the symmetry axis.
   -1 means the axis itself is not solid on that row. */
function centreHalfRuns(mask, W, H, cx) {
  var half = new Float64Array(H);
  var even = (W % 2) === 0;
  for (var y = 0; y < H; y++) {
    var row = y * W, h, l, r;
    if (even) {
      var a = Math.floor(cx), b = a + 1;
      if (!mask[row + a] || !mask[row + b]) { half[y] = -1; continue; }
      h = 0.5; l = a - 1; r = b + 1;
    } else {
      var c = Math.round(cx);
      if (!mask[row + c]) { half[y] = -1; continue; }
      h = 0; l = c - 1; r = c + 1;
    }
    while (l >= 0 && r < W && mask[row + l] && mask[row + r]) { h += 1; l--; r++; }
    half[y] = h;
  }
  return half;
}

/* explicit rasterised test: is every pixel of this ellipse on hull?
   returns pixel count, or -1 if any pixel is off-hull / out of bounds. */
function ellipseOnHull(mask, W, H, cx, cy, rx, ry, pad) {
  var n = 0, RX = rx + pad, RY = ry + pad;
  var yA = Math.floor(cy - RY), yB = Math.ceil(cy + RY);
  var xA = Math.floor(cx - RX), xB = Math.ceil(cx + RX);
  for (var y = yA; y <= yB; y++) {
    for (var x = xA; x <= xB; x++) {
      var dx = (x - cx) / RX, dy = (y - cy) / RY;
      if (dx * dx + dy * dy > 1) continue;
      if (x < 0 || y < 0 || x >= W || y >= H) return -1;
      if (!mask[y * W + x]) return -1;
      n++;
    }
  }
  return n;
}

/* =========================================================== STERN / ENGINES */

/* candidate stern columns: deep enough, thick enough, and bilaterally symmetric */
function sternCandidates(mask, W, H, cx, o, prof) {
  var bot = prof.bot, botRun = prof.botRun, x;
  var maxY = -1;
  for (x = 0; x < W; x++) if (bot[x] > maxY) maxY = bot[x];
  if (maxY < 0) return null;

  var tol = Math.max(1, Math.round(H * o.sternDepthTolerance));
  var minTh = Math.max(1, Math.max(o.sternMinThickness, Math.round(H * o.sternThicknessFrac)));

  var cand = null, th;
  for (th = minTh; th >= 1; th--) {                      /* relax thickness if needed */
    cand = new Uint8Array(W);
    var any = 0;
    for (x = 0; x < W; x++)
      if (bot[x] >= maxY - tol && botRun[x] >= th) { cand[x] = 1; any++; }
    if (any) break;
  }

  /* symmetrise: AND with the mirror first (true shared stern), OR as fallback.
     Both operations produce a set that is invariant under x -> W-1-x. */
  var andS = new Uint8Array(W), orS = new Uint8Array(W), nAnd = 0, nOr = 0;
  for (x = 0; x < W; x++) {
    var mx = W - 1 - x;
    andS[x] = (cand[x] && cand[mx]) ? 1 : 0;
    orS[x] = (cand[x] || cand[mx]) ? 1 : 0;
    nAnd += andS[x]; nOr += orS[x];
  }
  var sym = nAnd > 0 ? andS : orS;
  return { cols: sym, maxY: maxY, tol: tol, thickness: th, mode: nAnd > 0 ? 'and' : 'or' };
}

/* score the contiguous runs of candidate columns and keep the winning band
   (plus its mirror when the winner does not straddle the axis) */
function sternBand(W, H, cx, o, prof, cand) {
  var cols = cand.cols, bot = prof.bot, colMass = prof.colMass, x;
  var runs = [], cur = null;
  for (x = 0; x < W; x++) {
    if (cols[x]) { if (cur) cur.b = x; else cur = { a: x, b: x }; }
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  if (!runs.length) return null;

  var maxMass = 1;
  for (x = 0; x < W; x++) if (colMass[x] > maxMass) maxMass = colMass[x];

  var best = null;
  for (var i = 0; i < runs.length; i++) {
    var R = runs[i], sum = 0, mn = 1e9, mx = -1e9, mass = 0, n = R.b - R.a + 1;
    for (x = R.a; x <= R.b; x++) {
      sum += bot[x]; mass += colMass[x];
      if (bot[x] < mn) mn = bot[x];
      if (bot[x] > mx) mx = bot[x];
    }
    var mean = sum / n;
    var width = n / W;
    var depth = (mean - (cand.maxY - cand.tol)) / (cand.tol + 1);
    var centre = 1 - Math.abs((R.a + R.b) / 2 - cx) / (W / 2);
    var flat = 1 - Math.min(1, (mx - mn) / (cand.tol + 1));
    var massS = (mass / n) / maxMass;
    R.score = o.sternWeightWidth * width + o.sternWeightDepth * clamp(depth, 0, 1) +
              o.sternWeightCenter * clamp(centre, 0, 1) + o.sternWeightFlat * flat +
              o.sternWeightMass * clamp(massS, 0, 1);
    if (!best || R.score > best.score) best = R;
  }

  /* keep the winner and, if it is off-axis, its mirror twin */
  var keep = new Uint8Array(W);
  for (x = best.a; x <= best.b; x++) { keep[x] = 1; keep[W - 1 - x] = 1; }
  var a = W, b = -1;
  for (x = 0; x < W; x++) if (keep[x]) { if (x < a) a = x; if (x > b) b = x; }
  return {
    cols: keep, a: a, b: b, score: best.score, runCount: runs.length,
    mirrored: !(best.a <= cx && best.b >= cx)
  };
}

/* can an integer column span [a,b] carry a nozzle? returns the mount row or null */
function spanMount(mask, W, H, o, prof, a, b) {
  if (a < 0 || b >= W || b < a) return null;
  var mn = 1e9, mx = -1e9, x;
  for (x = a; x <= b; x++) {
    var by = prof.bot[x];
    if (by < 0) return null;
    if (by < mn) mn = by;
    if (by > mx) mx = by;
  }
  if (mx - mn > o.nozzleBotSpread) return null;
  var y = mn, guard = 0;
  for (;;) {
    if (y < 0) return null;
    var solid = true;
    for (x = a; x <= b; x++) if (!mask[y * W + x]) { solid = false; break; }
    if (solid) break;
    y--; guard++;
    if (guard > o.nozzleProbeDepth) return null;
  }
  if (mx - y > o.nozzleBotSpread) return null;
  return y;
}

function spansOverlap(spans, gap) {
  spans.sort(function (p, q) { return p.a - q.a; });
  for (var i = 1; i < spans.length; i++)
    if (spans[i].a - spans[i - 1].b - 1 < gap) return true;
  return false;
}

/* build a concrete layout of n nozzles of width w with pair offset d */
function buildLayout(mask, W, H, cx, o, prof, cols, n, w, d) {
  var spans = [], i;
  if (n % 2 === 1) {
    var wa = w;
    if (((W - wa) % 2) !== 0) wa = (wa - 1 >= 1) ? wa - 1 : wa + 1;
    if (((W - wa) % 2) !== 0) return null;
    var aa = (W - wa) / 2;
    spans.push({ a: aa, b: aa + wa - 1, kind: 'centre' });
  }
  var pairs = Math.floor(n / 2);
  for (i = 0; i < pairs; i++) {
    var dk = d * (i + 1) / pairs;
    var a = Math.round(cx - dk - (w - 1) / 2), b = a + w - 1;
    spans.push({ a: a, b: b, kind: 'pair' });
    spans.push({ a: W - 1 - b, b: W - 1 - a, kind: 'pair' });
  }
  if (spansOverlap(spans, o.nozzleGap)) return null;

  var out = [];
  for (i = 0; i < spans.length; i++) {
    var s = spans[i];
    if (s.a < 0 || s.b >= W) return null;
    for (var x = s.a; x <= s.b; x++) if (!cols[x]) return null;
    var y = spanMount(mask, W, H, o, prof, s.a, s.b);
    if (y === null) return null;
    out.push({ x: (s.a + s.b) / 2, y: y, width: s.b - s.a + 1, span: { a: s.a, b: s.b }, kind: s.kind });
  }
  return out;
}

function placeEngines(mask, W, H, cx, o, prof, band, meta) {
  var cols = band ? band.cols : null;
  var target = clamp(Math.round(o.engineCount), 1, Math.max(1, Math.round(o.engineCountMax)));

  /* order of attempted counts: target first, then nearby counts */
  var order = [target], k;
  for (k = 1; k <= 4; k++) {
    if (target - k >= 1) order.push(target - k);
    if (target + k <= o.engineCountMax) order.push(target + k);
  }
  if (target === 1 && !o.singleEngineFallbackToPair) order = [1];

  if (cols) {
    /* half-width of the stern band, and the preferred pair offset */
    var halfW = 0;
    for (var x = 0; x < W; x++) if (cols[x]) halfW = Math.max(halfW, Math.abs(x - cx));
    var dBase = o.engineSpread * halfW;
    var dMax = Math.ceil(cx) + 1;

    /* offsets to try, nearest to dBase first */
    var ds = [];
    for (var t = 0; t <= dMax; t++) {
      var lo = Math.round(dBase) - t, hi = Math.round(dBase) + t;
      if (lo >= 0 && lo <= dMax) ds.push(lo);
      if (t > 0 && hi >= 0 && hi <= dMax) ds.push(hi);
    }

    var wWant = clamp(Math.max(o.nozzleWidthMin, Math.round(W * o.nozzleWidthFrac)),
                      1, Math.max(1, Math.round(W * o.nozzleWidthMaxFrac)));

    for (var oi = 0; oi < order.length; oi++) {
      var n = order[oi];
      for (var w = wWant; w >= 1; w--) {
        for (var di = 0; di < ds.length; di++) {
          var lay = buildLayout(mask, W, H, cx, o, prof, cols, n, w, ds[di]);
          if (lay) {
            meta.engineFallback = (n === target) ? 'none' : 'count:' + n;
            meta.engineWidthUsed = w;
            meta.engineSpreadUsed = ds[di];
            return lay;
          }
        }
      }
    }
  }

  /* ---- guaranteed fallbacks: a non-empty mask always gets an engine ---- */
  var relaxed = { nozzleGap: o.nozzleGap, nozzleBotSpread: Math.max(o.nozzleBotSpread, 3),
                  nozzleProbeDepth: Math.max(o.nozzleProbeDepth, 6) };
  var all = new Uint8Array(W);
  for (var xa = 0; xa < W; xa++) if (prof.bot[xa] >= 0) all[xa] = 1;

  /* (a) axis-centred minimal nozzle */
  var wc = (W % 2 === 0) ? 2 : 1;
  var ac = (W - wc) / 2;
  if (all[ac] && all[ac + wc - 1]) {
    var yc = spanMount(mask, W, H, relaxed, prof, ac, ac + wc - 1);
    if (yc !== null) {
      meta.engineFallback = 'axis';
      return [{ x: (ac + ac + wc - 1) / 2, y: yc, width: wc, span: { a: ac, b: ac + wc - 1 }, kind: 'centre' }];
    }
  }

  /* (b) deepest column in the left half whose MIRROR is also solid at the same
         row -> a 1px symmetric pair that is guaranteed to be on hull */
  var bestX = -1, bestY = -1, xb, my, mirror;
  for (xb = 0; xb <= Math.floor(cx); xb++) {
    mirror = W - 1 - xb;
    if (prof.bot[xb] < 0 || prof.bot[mirror] < 0) continue;
    my = Math.min(prof.bot[xb], prof.bot[mirror]);
    while (my >= 0 && (!mask[my * W + xb] || !mask[my * W + mirror])) my--;
    if (my < 0) continue;
    if (my > bestY) { bestY = my; bestX = xb; }
  }
  if (bestX >= 0) {
    mirror = W - 1 - bestX;
    meta.engineFallback = 'deepest-pair';
    if (mirror === bestX)
      return [{ x: bestX, y: bestY, width: 1, span: { a: bestX, b: bestX }, kind: 'centre' }];
    return [
      { x: bestX, y: bestY, width: 1, span: { a: bestX, b: bestX }, kind: 'pair' },
      { x: mirror, y: bestY, width: 1, span: { a: mirror, b: mirror }, kind: 'pair' }
    ];
  }

  /* (c) last resort: the blob has no mirror-symmetric column at all (a truly
         one-sided silhouette). Stay on hull, drop symmetry, and say so. */
  bestX = -1; bestY = -1;
  for (xb = 0; xb < W; xb++) if (prof.bot[xb] > bestY) { bestY = prof.bot[xb]; bestX = xb; }
  if (bestX >= 0) {
    meta.engineFallback = 'deepest-single';
    meta.symmetryBroken = true;
    return [{ x: bestX, y: bestY, width: 1, span: { a: bestX, b: bestX }, kind: 'single' }];
  }
  meta.engineFallback = 'none-possible';
  return [];
}

/* ==================================================================== GUNS */

function placeGuns(mask, W, H, cx, o, prof, meta) {
  var want = Math.max(0, Math.round(o.gunCount));
  if (want === 0) return [];

  var bb = prof.bbox, bh = bb.y1 - bb.y0 + 1, x;
  var top = prof.top, topRun = prof.topRun;

  var support = Math.max(1, Math.max(o.gunSupportDepth, Math.round(H * o.gunSupportFrac)));
  var minLat = o.gunMinLateralFrac * W;
  var bandY = bb.y0 + o.gunForwardBand * bh;
  var peakW = Math.max(1, Math.round(W * o.gunPeakWindowFrac));

  var topMin = 1e9, topMax = -1e9;
  for (x = 0; x < W; x++) if (top[x] >= 0) { if (top[x] < topMin) topMin = top[x]; if (top[x] > topMax) topMax = top[x]; }
  var span = Math.max(1, topMax - topMin);

  function valid(x, requirePeak, requireLat) {
    if (top[x] < 0) return false;
    if (topRun[x] < support) return false;
    if (top[x] > bandY) return false;
    if (requireLat && Math.abs(x - cx) < minLat) return false;
    if (requirePeak) {
      for (var q = Math.max(0, x - peakW); q <= Math.min(W - 1, x + peakW); q++)
        if (top[q] >= 0 && top[q] < top[x]) return false;
    }
    return true;
  }
  function score(x) {
    var fwd = (topMax - top[x]) / span;
    var lat = Math.abs(x - cx) / (W / 2);
    return o.gunWeightForward * fwd + o.gunWeightLateral * lat;
  }

  var pairs = Math.floor(want / 2);
  var wantCentre = (want % 2 === 1) && (W % 2 === 1);
  if ((want % 2 === 1) && (W % 2 === 0)) meta.gunNote = 'odd gunCount on even W -> floored to pairs';

  var sep = Math.max(1, Math.round(W * o.gunSeparationFrac));
  var len = Math.max(o.gunLengthMin, Math.round(H * o.gunLengthFrac));

  /* progressive relaxation so we rarely return nothing on a valid hull */
  var relaxations = [
    { peak: o.gunRequireLocalPeak, lat: true },
    { peak: false, lat: true },
    { peak: false, lat: false }
  ];

  var chosen = null;
  for (var ri = 0; ri < relaxations.length; ri++) {
    if (chosen && chosen.length >= pairs) break;
    var rl = relaxations[ri];
    var cands = [];
    var lim = (W % 2 === 1) ? Math.floor(cx) - 1 : Math.floor(cx);
    for (x = 0; x <= lim; x++) {
      var mx = W - 1 - x;
      if (!valid(x, rl.peak, rl.lat) || !valid(mx, rl.peak, rl.lat)) continue;
      cands.push({ x: x, s: (score(x) + score(mx)) / 2 });
    }
    cands.sort(function (p, q) { return q.s - p.s || p.x - q.x; });
    var picked = [];
    for (var ci = 0; ci < cands.length && picked.length < pairs; ci++) {
      var ok = true;
      for (var pi = 0; pi < picked.length; pi++)
        if (Math.abs(picked[pi] - cands[ci].x) < sep) { ok = false; break; }
      if (ok) picked.push(cands[ci].x);
    }
    /* keep the richest set seen so far; a partial set beats nothing, but a later,
       looser pass that finds more pairs beats an earlier partial one */
    if (!chosen || picked.length > chosen.length) chosen = picked;
  }
  if (!chosen) chosen = [];
  if (chosen.length < pairs) meta.gunNote = 'wanted ' + pairs + ' pair(s), placed ' + chosen.length;

  var out = [];
  for (var i = 0; i < chosen.length; i++) {
    var gx = chosen[i], gmx = W - 1 - gx;
    out.push({ x: gx, y: Math.max(0, top[gx] - len), baseY: top[gx], length: Math.min(len, top[gx]) });
    out.push({ x: gmx, y: Math.max(0, top[gmx] - len), baseY: top[gmx], length: Math.min(len, top[gmx]) });
  }
  if (wantCentre) {
    var cc = Math.round(cx);
    if (valid(cc, false, false))
      out.push({ x: cc, y: Math.max(0, top[cc] - len), baseY: top[cc], length: Math.min(len, top[cc]) });
  }
  out.sort(function (p, q) { return p.x - q.x; });
  meta.gunsRequested = want;
  return out;
}

/* ================================================================= COCKPIT */

function findCockpit(mask, W, H, cx, o, prof, meta) {
  if (!o.cockpitWanted) { meta.cockpitFail = 'disabled'; return null; }
  var bb = prof.bbox, bh = bb.y1 - bb.y0 + 1;
  var half = centreHalfRuns(mask, W, H, cx);
  var pad = o.cockpitPad;
  var yTop = clamp(Math.round(bb.y0 + o.cockpitBandTop * bh), 0, H - 1);
  var yBot = clamp(Math.round(bb.y0 + o.cockpitBandBottom * bh), 0, H - 1);
  var rxCap = Math.max(o.cockpitMinRx, o.cockpitMaxRxFrac * W);
  var ryCap = Math.max(o.cockpitMinRy, o.cockpitMaxRyFrac * H);
  var areaCap = Math.max(o.cockpitMinPixels, o.cockpitAreaCapFloorPixels,
                         o.cockpitMaxAreaFrac * prof.area);

  var best = null, anyRow = false;

  for (var cy = yTop; cy <= yBot; cy++) {
    if (half[cy] < 0) continue;
    anyRow = true;
    for (var ry = o.cockpitMinRy; ry <= ryCap + 1e-9; ry += o.cockpitRyStep) {
      /* analytic conservative rx: for every constrained row the ellipse must stay
         inside the axis-centred solid run of that row */
      var rxAllow = Infinity, ok = true;
      var RY = ry + pad;
      var yA = Math.ceil(cy - RY), yB = Math.floor(cy + RY);
      for (var y = yA; y <= yB; y++) {
        var t = (y - cy) / RY, s = 1 - t * t;
        if (s <= 0) continue;
        if (y < 0 || y >= H || half[y] < 0) { ok = false; break; }
        var a = half[y] / Math.sqrt(s) - pad;
        if (a < rxAllow) rxAllow = a;
      }
      if (!ok) break;                       /* rows only grow with ry -> safe */
      if (!isFinite(rxAllow) || rxAllow < o.cockpitMinRx) continue;

      /* keep the ellipse inside the requested aspect window instead of letting a
         wide row force a squat rx that then gets rejected: cap rx at ry/aspectMin
         and require at least ry/aspectMax of room. */
      /* the hull-relative cap never shrinks below the minimum viable canopy,
         otherwise 16px hulls (half-width 0.5-1.5) would lose the cockpit entirely */
      var rxHi = Math.min(rxAllow, rxCap, ry / o.cockpitAspectMin,
                          Math.max(o.cockpitMinRx, o.cockpitMaxHalfWidthFrac * half[cy]));
      var rxLo = Math.max(o.cockpitMinRx, ry / o.cockpitAspectMax);
      if (rxHi < rxLo) continue;

      var rx = rxHi;
      var px = ellipseOnHull(mask, W, H, cx, cy, rx, ry, pad);
      if (px < 0) continue;

      /* greedy expansion beyond the conservative analytic bound */
      for (var gsi = 0; gsi < o.cockpitGrowSteps; gsi++) {
        var rx2 = Math.min(rx + o.cockpitGrowStep, rxHi + o.cockpitGrowSteps * o.cockpitGrowStep,
                           rxCap, ry / o.cockpitAspectMin);
        if (rx2 <= rx) break;
        var px2 = ellipseOnHull(mask, W, H, cx, cy, rx2, ry, pad);
        if (px2 < 0 || px2 > areaCap) break;
        rx = rx2; px = px2;
      }
      if (px < o.cockpitMinPixels || px > areaCap) continue;

      var sc = px - o.cockpitForwardBias * (cy - yTop);
      if (!best || sc > best.sc)
        best = { x: cx, y: cy, rx: rx, ry: ry, pixels: px, sc: sc };
    }
  }
  if (!best) { meta.cockpitFail = anyRow ? 'no-fit' : 'axis-not-solid'; return null; }
  meta.cockpitFail = null;
  return { x: best.x, y: best.y, rx: best.rx, ry: best.ry, pixels: best.pixels };
}

/* =================================================================== LAMPS */

function placeLamps(mask, W, H, cx, o, prof, rng, meta) {
  var pairs = Math.floor(Math.max(0, o.lampCount) / 2);
  if (pairs === 0) return [];
  var bb = prof.bbox, bh = bb.y1 - bb.y0 + 1;
  var yTop = clamp(Math.round(bb.y0 + o.lampBandTop * bh), 0, H - 1);
  var yBot = clamp(Math.round(bb.y0 + o.lampBandBottom * bh), 0, H - 1);
  var minLat = o.lampMinLateralFrac * W;
  var sep = Math.max(1, Math.round(H * o.lampSeparationFrac));
  var inset = Math.max(0, Math.round(o.lampInset));

  var rows = [];
  for (var y = yTop; y <= yBot; y++) {
    var xl = -1;
    for (var x = 0; x < W; x++) if (mask[y * W + x]) { xl = x; break; }
    if (xl < 0) continue;
    var xr = -1;
    for (var x2 = W - 1; x2 >= 0; x2--) if (mask[y * W + x2]) { xr = x2; break; }
    /* symmetric extremity: use the pair (xl, W-1-xl) and require both solid */
    var lx = xl + inset, rx = W - 1 - lx;
    if (lx >= rx) continue;
    if (!mask[y * W + lx] || !mask[y * W + rx]) continue;
    if (Math.abs(lx - cx) < minLat) continue;
    rows.push({ y: y, lx: lx, extent: Math.abs(lx - cx) });
  }
  if (!rows.length) { meta.lampFail = 'no-row'; return []; }
  rows.sort(function (p, q) { return q.extent - p.extent || p.y - q.y; });

  var picked = [];
  for (var i = 0; i < rows.length && picked.length < pairs; i++) {
    var ok = true;
    for (var j = 0; j < picked.length; j++)
      if (Math.abs(picked[j].y - rows[i].y) < sep) { ok = false; break; }
    if (ok) picked.push(rows[i]);
  }
  picked.sort(function (p, q) { return p.y - q.y; });

  var out = [];
  for (var k = 0; k < picked.length; k++) {
    var ph = rng() * Math.PI * 2;
    var ph2 = o.lampPhaseMirror ? ph : (ph + Math.PI) % (Math.PI * 2);
    out.push({ x: picked[k].lx, y: picked[k].y, phase: ph });
    out.push({ x: W - 1 - picked[k].lx, y: picked[k].y, phase: ph2 });
  }
  meta.lampFail = null;
  return out;
}

/* ================================================================== PUBLIC */

function detectMounts(mask, W, H, opts) {
  var o = makeOpts(opts);
  var cx = (o.axis === null || o.axis === undefined) ? (W - 1) / 2 : o.axis;
  var size = Math.min(W, H);
  var raw = profiles(mask, W, H);

  var meta = {
    W: W, H: H, size: size, axis: cx,
    area: raw.area, bbox: raw.bbox, empty: raw.empty,
    stern: null, engineFallback: 'none', engineWidthUsed: 0, engineSpreadUsed: 0,
    cockpitFail: null, lampFail: null, gunNote: null, gunsRequested: 0,
    maskAsymmetricPixels: 0, symmetryBroken: false,
    skipped: { engines: false, guns: false, cockpit: false, lamps: false },
    unknownOptions: o.__unknown
  };

  /* work on mask AND mirror(mask): every mount is then on-hull and mirrorable */
  var work = mask, prof = raw;
  if (o.symmetrizeMask && !raw.empty) {
    var ms = new Uint8Array(W * H), areaS = 0, diff = 0;
    for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) {
      var ii = yy * W + xx, jj = yy * W + (W - 1 - xx);
      if ((mask[ii] ? 1 : 0) !== (mask[jj] ? 1 : 0)) diff++;
      if (mask[ii] && mask[jj]) { ms[ii] = 1; areaS++; }
    }
    meta.maskAsymmetricPixels = diff;
    if (areaS >= o.symmetrizeMinAreaFrac * raw.area && areaS > 0) {
      work = ms; prof = profiles(ms, W, H);
    } else if (diff > 0) {
      meta.symmetryBroken = true;   /* one-sided blob: cannot be on-hull AND mirrored */
    }
  }
  mask = work;

  if (prof.empty) {
    meta.skipped = { engines: true, guns: true, cockpit: true, lamps: true };
    meta.cockpitFail = 'empty-mask';
    return { engines: [], guns: [], cockpit: null, lamps: [], meta: meta };
  }

  var rng = o.rng || mulberry32(hashMask(mask, W, H));

  /* ---- engines ---- */
  var engines = [];
  if (size < o.minSizeEngines) meta.skipped.engines = true;
  else {
    var cand = sternCandidates(mask, W, H, cx, o, prof);
    var band = cand ? sternBand(W, H, cx, o, prof, cand) : null;
    if (band) meta.stern = { a: band.a, b: band.b, score: band.score, mirrored: band.mirrored,
                             runs: band.runCount, mode: cand.mode, deepestY: cand.maxY,
                             thickness: cand.thickness };
    engines = placeEngines(mask, W, H, cx, o, prof, band, meta);
  }

  /* ---- guns ---- */
  var guns = [];
  if (size < o.minSizeGuns) meta.skipped.guns = true;
  else guns = placeGuns(mask, W, H, cx, o, prof, meta);

  /* ---- cockpit ---- */
  var cockpit = null;
  if (size < o.minSizeCockpit) { meta.skipped.cockpit = true; meta.cockpitFail = 'below-min-size'; }
  else cockpit = findCockpit(mask, W, H, cx, o, prof, meta);

  /* ---- lamps ---- */
  var lamps = [];
  if (size < o.minSizeLamps) meta.skipped.lamps = true;
  else lamps = placeLamps(mask, W, H, cx, o, prof, rng, meta);

  return { engines: engines, guns: guns, cockpit: cockpit, lamps: lamps, meta: meta };
}

/* -------------------------------------------------------------- validator */
/* Independent re-check of a detectMounts() result against the mask. Written
   without reusing the placement code so tests measure rather than trust. */
function validateMounts(mask, W, H, res, opts) {
  var o = makeOpts(opts);
  var cx = (o.axis === null || o.axis === undefined) ? (W - 1) / 2 : o.axis;
  var prof = profiles(mask, W, H);
  var out = {
    engineOffHull: 0, gunOffHull: 0, lampOffHull: 0, cockpitOffHull: 0,
    engineBottomStrict: 0, engineBottomTolerant: 0, engineTotal: 0,
    mergedNozzlePairs: 0, symmetryViolations: 0
  };
  var i, x, key;

  /* engines on hull + on the bottom edge */
  for (i = 0; i < res.engines.length; i++) {
    var e = res.engines[i];
    var a = e.span ? e.span.a : Math.round(e.x - (e.width - 1) / 2);
    var b = e.span ? e.span.b : (a + e.width - 1);
    out.engineTotal++;
    var onHull = true, strict = true, tol = true;
    for (x = a; x <= b; x++) {
      if (x < 0 || x >= W || e.y < 0 || e.y >= H || !mask[e.y * W + x]) { onHull = false; break; }
      if (prof.bot[x] !== e.y) strict = false;
      if (prof.bot[x] - e.y > 1) tol = false;
    }
    if (!onHull) out.engineOffHull++;
    if (onHull && strict) out.engineBottomStrict++;
    if (onHull && tol) out.engineBottomTolerant++;
  }
  /* merged nozzles: adjacent spans with no separating column */
  var spans = res.engines.map(function (e) {
    var a = e.span ? e.span.a : Math.round(e.x - (e.width - 1) / 2);
    return { a: a, b: e.span ? e.span.b : a + e.width - 1 };
  }).sort(function (p, q) { return p.a - q.a; });
  for (i = 1; i < spans.length; i++)
    if (spans[i].a - spans[i - 1].b - 1 < 1) out.mergedNozzlePairs++;

  /* guns: base must be hull, tip must be above the base and inside the sprite */
  for (i = 0; i < res.guns.length; i++) {
    var g = res.guns[i];
    var by = (g.baseY === undefined) ? g.y : g.baseY;
    if (g.x < 0 || g.x >= W || by < 0 || by >= H || !mask[by * W + g.x] || g.y > by) out.gunOffHull++;
  }

  /* lamps */
  for (i = 0; i < res.lamps.length; i++) {
    var l = res.lamps[i];
    if (l.x < 0 || l.x >= W || l.y < 0 || l.y >= H || !mask[l.y * W + l.x]) out.lampOffHull++;
  }

  /* cockpit */
  if (res.cockpit) {
    var c = res.cockpit;
    if (ellipseOnHull(mask, W, H, c.x, c.y, c.rx, c.ry, o.cockpitPad) < 0) out.cockpitOffHull = 1;
  }

  /* symmetry: every mount set must be invariant under x -> W-1-x */
  function symCheck(list, keyFn) {
    var set = {}, n = 0, k;
    for (var q = 0; q < list.length; q++) { set[keyFn(list[q], false)] = 1; n++; }
    var bad = 0;
    for (q = 0; q < list.length; q++) { k = keyFn(list[q], true); if (!set[k]) bad++; }
    return bad;
  }
  out.symmetryViolations += symCheck(res.engines, function (e, m) {
    var a = e.span ? e.span.a : Math.round(e.x - (e.width - 1) / 2);
    var b = e.span ? e.span.b : a + e.width - 1;
    return m ? ((W - 1 - b) + ':' + (W - 1 - a) + ':' + e.y) : (a + ':' + b + ':' + e.y);
  });
  out.symmetryViolations += symCheck(res.guns, function (g, m) {
    return (m ? (W - 1 - g.x) : g.x) + ':' + g.y;
  });
  out.symmetryViolations += symCheck(res.lamps, function (l, m) {
    return (m ? (W - 1 - l.x) : l.x) + ':' + l.y;
  });
  if (res.cockpit && Math.abs(res.cockpit.x - cx) > 1e-9) out.symmetryViolations++;

  return out;
}

/* ------------------------------------------------ optional: stamp into grid */
/* Convenience for the renderer: paint detected mounts into a material grid. */
function stampMounts(g, W, H, res, opts) {
  var o = makeOpts(opts);
  var i, x, y;
  for (i = 0; i < res.engines.length; i++) {
    var e = res.engines[i];
    var a = e.span ? e.span.a : Math.round(e.x - (e.width - 1) / 2);
    var b = e.span ? e.span.b : a + e.width - 1;
    var depth = Math.max(1, Math.round(H * 0.04));
    for (x = a; x <= b; x++)
      for (var d = 0; d < depth; d++) {
        y = e.y - d;
        if (x < 0 || x >= W || y < 0) continue;
        if (g[y * W + x]) g[y * W + x] = M_NOZZLE;
      }
  }
  for (i = 0; i < res.guns.length; i++) {
    var gu = res.guns[i];
    for (y = gu.y; y <= gu.baseY; y++)
      if (y >= 0 && y < H) g[y * W + gu.x] = M_GUN;
  }
  if (res.cockpit) {
    var c = res.cockpit, RX = c.rx + o.cockpitPad, RY = c.ry + o.cockpitPad;
    for (y = Math.floor(c.y - RY); y <= Math.ceil(c.y + RY); y++)
      for (x = Math.floor(c.x - RX); x <= Math.ceil(c.x + RX); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        var dx = (x - c.x) / RX, dy = (y - c.y) / RY;
        if (dx * dx + dy * dy <= 1 && g[y * W + x]) g[y * W + x] = M_COCKPIT;
      }
  }
  for (i = 0; i < res.lamps.length; i++) {
    var l = res.lamps[i];
    if (g[l.y * W + l.x]) g[l.y * W + l.x] = M_LAMP;
  }
  return g;
}

return {
  detectMounts: detectMounts,
  validateMounts: validateMounts,
  stampMounts: stampMounts,
  MOUNT_DEFAULTS: DEFAULTS
};
})();

var detectMounts   = PIXELSHIP_MOUNTS.detectMounts;
var validateMounts = PIXELSHIP_MOUNTS.validateMounts;
var stampMounts    = PIXELSHIP_MOUNTS.stampMounts;
var MOUNT_DEFAULTS = PIXELSHIP_MOUNTS.MOUNT_DEFAULTS;

if (typeof module !== 'undefined') module.exports = { detectMounts, validateMounts, stampMounts, MOUNT_DEFAULTS };
