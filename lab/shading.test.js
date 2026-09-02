/* ============================================================================
   pixelship / lab / shading.test.js

   Measures the shading pass against the OLD edge-detection shading, on the same
   masks, at 16 / 32 / 64 / 96 px.

   Run:  node /Users/darek/Code/pixelship/lab/shading.test.js
   PNGs: /Users/darek/Code/pixelship/lab/out/
   ========================================================================= */
'use strict';

var SH = require('./shading.js');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var OUT_DIR = path.join(__dirname, 'out');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

var EMPTY = 0, HULL = 1, LIGHT = 2, DARK = 3, OUTLINE = 4,
    COCKPIT = 5, ACCENT = 6, NOZZLE = 7, GUN = 8, LAMP = 9;

/* ---------------------------------------------------------------- rng ---- */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var rr = function (r, a, b) { return a + (b - a) * r(); };
var ri = function (r, a, b) { return Math.floor(a + (b - a + 1) * r()); };
var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

/* =========================================================================
   FIXTURE: the current CA generator's mask + material stamps (port of
   generateA from prototype-ab.html, shading/outline removed).
   ========================================================================= */
function mirrorLeftToRight(g, W, H) {
  var half = Math.floor(W / 2);
  for (var y = 0; y < H; y++) for (var x = 0; x < half; x++) g[y * W + (W - 1 - x)] = g[y * W + x];
}
function keepLargestBlob(g, W, H) {
  var lab = new Int32Array(W * H).fill(-1), stack = [], best = -1, bestSize = 0;
  for (var i = 0; i < W * H; i++) {
    if (!g[i] || lab[i] >= 0) continue;
    var id = i, size = 0; stack.length = 0; stack.push(i); lab[i] = id;
    while (stack.length) {
      var p = stack.pop(); size++;
      var x = p % W, y = (p - x) / W;
      if (x > 0 && g[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack.push(p - 1); }
      if (x < W - 1 && g[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && g[p - W] && lab[p - W] < 0) { lab[p - W] = id; stack.push(p - W); }
      if (y < H - 1 && g[p + W] && lab[p + W] < 0) { lab[p + W] = id; stack.push(p + W); }
    }
    if (size > bestSize) { bestSize = size; best = id; }
  }
  for (var j = 0; j < W * H; j++) if (g[j] && lab[j] !== best) g[j] = EMPTY;
}
function bottomProfile(g, W, H) {
  var b = new Int32Array(W).fill(-1);
  for (var x = 0; x < W; x++) for (var y = H - 1; y >= 0; y--) if (g[y * W + x]) { b[x] = y; break; }
  return b;
}
function topProfile(g, W, H) {
  var t = new Int32Array(W).fill(-1);
  for (var x = 0; x < W; x++) for (var y = 0; y < H; y++) if (g[y * W + x]) { t[x] = y; break; }
  return t;
}
function stampCockpit(g, W, H, cyRatio, rxPx, r) {
  var cx = (W - 1) / 2, ratio = rr(r, 1.2, 1.9);
  var rx0 = Math.max(1, Math.min(Math.round(rxPx), Math.round(W * 0.10)));
  function cells(cx, cy, rx, ry) {
    var out = [];
    for (var y = cy - ry; y <= cy + ry; y++) for (var x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      var dx = (x - cx) / (rx + .3), dy = (y - cy) / (ry + .3);
      if (dx * dx + dy * dy <= 1) out.push(y * W + x);
    }
    return out;
  }
  var maxSlide = Math.max(2, Math.round(H * 0.2));
  for (var rx = rx0; rx >= 1; rx--) {
    var ry = Math.max(1, Math.round(rx * ratio));
    for (var slide = 0; slide <= maxSlide; slide++) {
      var c = cells(cx, Math.round(H * cyRatio) + slide, rx, ry);
      if (!c || c.some(function (i) { return g[i] === EMPTY; })) continue;
      for (var k = 0; k < c.length; k++) g[c[k]] = COCKPIT;
      return true;
    }
  }
  return false;
}
/* returns a material grid: HULL + COCKPIT/NOZZLE/GUN/LAMP, no shading, no outline */
function caShip(seed, W, H) {
  var r = mulberry32(seed);
  var g = new Uint8Array(W * H), cx = (W - 1) / 2;
  var rx = W * rr(r, .30, .46), ry = H * rr(r, .36, .47), cy = H * rr(r, .46, .54);
  var bias = rr(r, .80, 1.00), x, y;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    var dx = (x - cx) / rx, dy = (y - cy) / ry;
    var d = Math.sqrt(dx * dx + dy * dy);
    g[y * W + x] = r() < bias - d * 0.78 ? HULL : EMPTY;
  }
  mirrorLeftToRight(g, W, H);
  var iters = ri(r, 4, 6);
  for (var it = 0; it < iters; it++) {
    var src = Uint8Array.from(g);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var n = 0;
      for (var dy2 = -1; dy2 <= 1; dy2++) for (var dx2 = -1; dx2 <= 1; dx2++) {
        if (!dx2 && !dy2) continue;
        var nx = x + dx2, ny = y + dy2;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (src[ny * W + nx]) n++;
      }
      var c = src[y * W + x];
      g[y * W + x] = n >= 5 ? HULL : (n <= 2 ? EMPTY : c);
    }
    mirrorLeftToRight(g, W, H);
  }
  keepLargestBlob(g, W, H);

  var bot = bottomProfile(g, W, H), top = topProfile(g, W, H);
  var maxY = -1;
  for (x = 0; x < W; x++) if (bot[x] > maxY) maxY = bot[x];
  var tol = Math.max(1, Math.round(H * 0.05));
  var groups = [], cur = null;
  for (x = 0; x < W; x++) {
    if (bot[x] >= maxY - tol) { cur ? cur.x1 = x : cur = { x0: x, x1: x }; }
    else if (cur) { groups.push(cur); cur = null; }
  }
  if (cur) groups.push(cur);
  groups.sort(function (a, b) { return (b.x1 - b.x0) - (a.x1 - a.x0); });
  var maxNozW = Math.max(1, Math.round(W * 0.14));
  var engines = groups.slice(0, 3).map(function (gr) {
    var c = (gr.x0 + gr.x1) / 2;
    return { x: c, y: Math.max(bot[Math.round(c)], maxY - tol), w: Math.min(gr.x1 - gr.x0 + 1, maxNozW) };
  }).filter(function (e) { return e.y >= 0; });
  engines.forEach(function (e) {
    var half = (e.w - 1) / 2;
    for (var x2 = Math.round(e.x - half); x2 <= Math.round(e.x + half); x2++)
      for (var dy = 0; dy < Math.max(1, Math.round(H * 0.04)); dy++) {
        var y2 = e.y - dy;
        if (x2 < 0 || x2 >= W || y2 < 0) continue;
        if (g[y2 * W + x2]) g[y2 * W + x2] = NOZZLE;
      }
  });
  var extreme = -1, exX = -1;
  for (x = 0; x < W; x++) if (top[x] >= 0 && Math.abs(x - cx) > extreme) { extreme = Math.abs(x - cx); exX = x; }
  if (exX >= 0 && extreme > W * 0.12) {
    [exX, Math.round(2 * cx - exX)].forEach(function (gx) {
      var gy = top[clamp(Math.round(gx), 0, W - 1)];
      if (gy < 0) return;
      var len = Math.max(2, Math.round(H * 0.07));
      for (var d = 1; d <= len; d++) { var yy = gy - d; if (yy < 0) break; g[yy * W + clamp(Math.round(gx), 0, W - 1)] = GUN; }
    });
  }
  var cockY = rr(r, .26, .40), rowY = clamp(Math.round(H * cockY), 0, H - 1), runHalf = 0;
  for (x = Math.round(cx); x < W && g[rowY * W + x]; x++) runHalf++;
  stampCockpit(g, W, H, cockY, Math.max(1, runHalf * rr(r, .35, .6)), r);
  var midY = Math.round(H * rr(r, .5, .68));
  for (x = 0; x < W; x++) if (g[midY * W + x]) { g[midY * W + x] = LAMP; break; }
  for (x = W - 1; x >= 0; x--) if (g[midY * W + x]) { g[midY * W + x] = LAMP; break; }
  return g;
}

/* ======================= BEFORE: the old shading pass ==================== */
function legacyShade(src0, W, H, opts) {
  opts = opts || {};
  var g = Uint8Array.from(src0);
  var src = Uint8Array.from(src0);
  var cx = (W - 1) / 2;
  var ridge = opts.ridge === false ? -1 : Math.min(1.2, W * 0.045);
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var i = y * W + x;
    if (src[i] !== HULL) continue;
    var up = y > 0 ? src[i - W] : EMPTY, down = y < H - 1 ? src[i + W] : EMPTY;
    var m = HULL;
    if (Math.abs(x - cx) <= ridge) m = LIGHT;
    if (up === EMPTY) m = LIGHT;
    if (down === EMPTY) m = DARK;
    g[i] = m;
  }
  var src2 = Uint8Array.from(g);
  for (var y2 = 0; y2 < H; y2++) for (var x2 = 0; x2 < W; x2++) {
    var i2 = y2 * W + x2;
    if (src2[i2] !== EMPTY) continue;
    var n = (x2 > 0 && src2[i2 - 1]) || (x2 < W - 1 && src2[i2 + 1]) ||
            (y2 > 0 && src2[i2 - W]) || (y2 < H - 1 && src2[i2 + W]);
    if (n) g[i2] = OUTLINE;
  }
  return g;
}

/* ============================== METRICS ================================== */
/* value key per pixel: for the new grid the packed byte, for legacy the id. */
function shipPixels(grid, W, H) {
  var n = 0;
  for (var i = 0; i < W * H; i++) if (grid[i] !== EMPTY && grid[i] !== OUTLINE) n++;
  return n;
}
function isSolid(v) { return v !== EMPTY && v !== OUTLINE; }

/* fraction of the darkest-ramp pixels that are INTERIOR (no 8-neighbour
   touching OUTLINE or EMPTY, and not on the sprite border) */
function darkestInterior(grid, W, H, stepOf) {
  var darkest = 99, i, x, y;
  for (i = 0; i < W * H; i++) if (isSolid(grid[i])) { var s = stepOf(grid[i]); if (s < darkest) darkest = s; }
  var total = 0, interior = 0;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    i = y * W + x;
    if (!isSolid(grid[i]) || stepOf(grid[i]) !== darkest) continue;
    total++;
    var touches = false;
    for (var dy = -1; dy <= 1 && !touches; dy++) for (var dx = -1; dx <= 1; dx++) {
      var nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) { touches = true; break; }
      if (!isSolid(grid[ny * W + nx])) { touches = true; break; }
    }
    if (!touches) interior++;
  }
  return { total: total, interior: interior, frac: total ? interior / total : 0 };
}

/* largest 4-connected region of one identical value, / ship area */
function largestFlatRegion(grid, W, H) {
  var seen = new Uint8Array(W * H), best = 0, stack = [];
  for (var i0 = 0; i0 < W * H; i0++) {
    if (seen[i0] || !isSolid(grid[i0])) continue;
    var val = grid[i0], size = 0;
    stack.length = 0; stack.push(i0); seen[i0] = 1;
    while (stack.length) {
      var p = stack.pop(); size++;
      var x = p % W, y = (p - x) / W;
      var nb = [];
      if (x > 0) nb.push(p - 1);
      if (x < W - 1) nb.push(p + 1);
      if (y > 0) nb.push(p - W);
      if (y < H - 1) nb.push(p + W);
      for (var k = 0; k < nb.length; k++) { var q = nb[k]; if (!seen[q] && grid[q] === val) { seen[q] = 1; stack.push(q); } }
    }
    if (size > best) best = size;
  }
  var area = shipPixels(grid, W, H);
  return { size: best, frac: area ? best / area : 0 };
}

function stepHistogram(grid, W, H, steps, stepOf) {
  var h = new Array(steps).fill(0), n = 0;
  for (var i = 0; i < W * H; i++) if (isSolid(grid[i])) { h[stepOf(grid[i])]++; n++; }
  return { counts: h, frac: h.map(function (c) { return n ? c / n : 0; }), total: n };
}

/* distinct values used per base material - proves non-HULL is not flat */
function valuesPerMaterial(grid, W, H, matOf, stepOf) {
  var m = {};
  for (var i = 0; i < W * H; i++) {
    if (!isSolid(grid[i])) continue;
    var mat = matOf(grid[i]);
    if (!m[mat]) m[mat] = {};
    m[mat][stepOf(grid[i])] = 1;
  }
  var out = {};
  for (var k in m) out[k] = Object.keys(m[k]).length;
  return out;
}

/* new-grid accessors */
var newStep = function (v) { return v >= SH.SHADE_BASE ? (v & 15) : 0; };
var newMat = function (v) { return v >= SH.SHADE_BASE ? SH.SHADEABLE_MATERIALS[(v >> 4) - 1] : v; };
/* legacy accessors: DARK=0 HULL=1 LIGHT=2 (3 "steps"), materials sit at mid */
var legStep = function (v) { return v === DARK ? 0 : (v === LIGHT ? 2 : 1); };
var legMat = function (v) { return (v === LIGHT || v === DARK) ? HULL : v; };

/* ============================== PNG OUT ================================== */
var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  var c = -1;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePNG(file, rgba, W, H) {
  var raw = Buffer.alloc((W * 4 + 1) * H);
  for (var y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    rgba.copy ? rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4)
              : Buffer.from(rgba.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  var png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

/* DEBUG palette only - the real palette module owns colour. Ramp with a hue
   shift (cool shadow -> warm highlight) so the form is judgeable by eye. */
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  var f = function (n) {
    var k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return [f(0), f(8), f(4)];
}
var DEBUG_HUE = { 1: 214, 5: 190, 6: 30, 7: 220, 8: 225, 9: 45 };
var DEBUG_SAT = { 1: 0.20, 5: 0.55, 6: 0.75, 7: 0.14, 8: 0.12, 9: 0.85 };
function debugColor(mat, step, steps) {
  var f = steps > 1 ? step / (steps - 1) : 0.5;
  var baseH = DEBUG_HUE[mat] != null ? DEBUG_HUE[mat] : 214;
  var baseS = DEBUG_SAT[mat] != null ? DEBUG_SAT[mat] : 0.2;
  var h = baseH + (f - 0.5) * -46;                       /* cool shadow, warm light */
  var s = baseS * (1.25 - 0.5 * f);
  var l = 0.14 + 0.62 * Math.pow(f, 0.85);
  return hsl2rgb(h, s, l);
}
var BG = [16, 24, 40];                                    /* #101828 */
var OUTLINE_RGB = [8, 10, 18];
function gridToRGBA(grid, W, H, steps, scale, stepOf, matOf) {
  var OW = W * scale, OH = H * scale;
  var buf = Buffer.alloc(OW * OH * 4);
  for (var y = 0; y < OH; y++) for (var x = 0; x < OW; x++) {
    var v = grid[Math.floor(y / scale) * W + Math.floor(x / scale)];
    var c;
    if (v === EMPTY) c = BG;
    else if (v === OUTLINE) c = OUTLINE_RGB;
    else c = debugColor(matOf(v), stepOf(v), steps);
    var o = (y * OW + x) * 4;
    buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
  }
  return { buf: buf, W: OW, H: OH };
}
function sheet(tiles, cols, gap) {
  var tw = tiles[0].W, th = tiles[0].H;
  var rows = Math.ceil(tiles.length / cols);
  var W = cols * tw + (cols + 1) * gap, H = rows * th + (rows + 1) * gap;
  var buf = Buffer.alloc(W * H * 4);
  for (var i = 0; i < W * H; i++) { buf[i * 4] = BG[0]; buf[i * 4 + 1] = BG[1]; buf[i * 4 + 2] = BG[2]; buf[i * 4 + 3] = 255; }
  tiles.forEach(function (t, k) {
    var cx = gap + (k % cols) * (tw + gap), cy = gap + Math.floor(k / cols) * (th + gap);
    for (var y = 0; y < th; y++) t.buf.copy(buf, ((cy + y) * W + cx) * 4, y * tw * 4, (y + 1) * tw * 4);
  });
  return { buf: buf, W: W, H: H };
}
function floatToRGBA(f, W, H, scale, lo, hi) {
  var OW = W * scale, OH = H * scale, buf = Buffer.alloc(OW * OH * 4);
  for (var y = 0; y < OH; y++) for (var x = 0; x < OW; x++) {
    var v = f[Math.floor(y / scale) * W + Math.floor(x / scale)];
    var t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    var g = Math.round(t * 255), o = (y * OW + x) * 4;
    buf[o] = g; buf[o + 1] = g; buf[o + 2] = g; buf[o + 3] = 255;
  }
  return { buf: buf, W: OW, H: OH };
}

/* interior = solid pixel whose whole 8-neighbourhood is solid (and not on the
   sprite border). Returns:
     ceiling  interior pixels / ship pixels  (the geometric ceiling: a 16px ship
              is almost all rim, so "dark interior" can never be large there)
     darkFrac interior pixels in the bottom 40% of the ramp / interior pixels
     distinct distinct ramp steps present among interior pixels             */
function interiorStats(grid, W, H, steps, stepOf) {
  var tot = 0, inter = 0, dark = 0, seen = {};
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var i = y * W + x;
    if (!isSolid(grid[i])) continue;
    tot++;
    var touches = false;
    for (var dy = -1; dy <= 1 && !touches; dy++) for (var dx = -1; dx <= 1; dx++) {
      var nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) { touches = true; break; }
      if (!isSolid(grid[ny * W + nx])) { touches = true; break; }
    }
    if (touches) continue;
    inter++;
    var s = stepOf(grid[i]);
    seen[s] = 1;
    if (s / (steps - 1) <= 0.4) dark++;
  }
  return {
    ceiling: tot ? inter / tot : 0,
    interior: inter,
    darkFrac: inter ? dark / inter : 0,
    distinct: Object.keys(seen).length
  };
}
function interiorCeiling(grid, W, H) { return interiorStats(grid, W, H, 6, newStep).ceiling; }

module.exports = {
  caShip: caShip, legacyShade: legacyShade,
  darkestInterior: darkestInterior, largestFlatRegion: largestFlatRegion,
  stepHistogram: stepHistogram, interiorCeiling: interiorCeiling, interiorStats: interiorStats,
  valuesPerMaterial: valuesPerMaterial, isSolid: isSolid, shipPixels: shipPixels,
  newStep: newStep, newMat: newMat, legStep: legStep, legMat: legMat,
  writePNG: writePNG, gridToRGBA: gridToRGBA, sheet: sheet
};
if (require.main !== module) return;   /* CJS top-level return: sweeps can require this file */

/* ============================ MEASUREMENT RUN ============================ */
var SIZES = [16, 32, 64, 96];
var N_SEEDS = 300;
var lines = [];
function say(s) { lines.push(s); console.log(s); }

function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.floor(s.length / 2)]; }
function pct(v) { return (v * 100).toFixed(1) + '%'; }

function runSuite(label, shadeFn, stepOf, matOf, steps) {
  var res = {};
  SIZES.forEach(function (S) {
    var di = [], lf = [], hist = new Array(steps).fill(0), histN = 0, empties = 0;
    var matVals = {}, ceil = [], idark = [], idist = [];
    for (var s = 0; s < N_SEEDS; s++) {
      var base = caShip(1000 + s, S, S);
      var solidN = 0;
      for (var i = 0; i < S * S; i++) if (base[i]) solidN++;
      if (solidN === 0) { empties++; continue; }
      var g = shadeFn(base, S, S);
      var d = darkestInterior(g, S, S, stepOf);
      if (d.total) di.push(d.frac);
      lf.push(largestFlatRegion(g, S, S).frac);
      var h = stepHistogram(g, S, S, steps, stepOf);
      for (var k = 0; k < steps; k++) hist[k] += h.counts[k];
      histN += h.total;
      var vpm = valuesPerMaterial(g, S, S, matOf, stepOf);
      for (var m in vpm) { if (!matVals[m]) matVals[m] = []; matVals[m].push(vpm[m]); }
      var ist = interiorStats(g, S, S, steps, stepOf);
      ceil.push(ist.ceiling);
      if (ist.interior) { idark.push(ist.darkFrac); idist.push(ist.distinct); }
    }
    res[S] = {
      interiorCeiling: mean(ceil),
      interiorDark: mean(idark),
      interiorDistinct: mean(idist),
      darkestInteriorMean: mean(di),
      darkestInteriorMedian: median(di),
      largestFlatMean: mean(lf),
      largestFlatMax: Math.max.apply(null, lf),
      hist: hist.map(function (c) { return histN ? c / histN : 0; }),
      histUsed: hist.filter(function (c) { return c / histN > 0.005; }).length,
      empties: empties,
      matVals: matVals
    };
  });
  return { label: label, res: res, steps: steps };
}

function report(r) {
  say('');
  say('=== ' + r.label + '  (' + r.steps + ' ramp steps, ' + N_SEEDS + ' seeds per size) ===');
  say('size | darkestInterior mean/median | largestFlatRegion mean/max | steps used | histogram');
  SIZES.forEach(function (S) {
    var d = r.res[S];
    say('  ' + String(S).padStart(2) + ' |  ' +
      pct(d.darkestInteriorMean).padStart(6) + ' / ' + pct(d.darkestInteriorMedian).padStart(6) + '        |  ' +
      pct(d.largestFlatMean).padStart(6) + ' / ' + pct(d.largestFlatMax).padStart(6) + '     |  ' +
      (d.histUsed + '/' + r.steps).padStart(5) + '    | [' +
      d.hist.map(function (v) { return (v * 100).toFixed(1); }).join(' ') + ']');
  });
  say('interior detail (interior = 8-neighbourhood fully solid):');
  SIZES.forEach(function (S) {
    var d = r.res[S];
    say('  ' + String(S).padStart(2) + ' | interior is ' + pct(d.interiorCeiling).padStart(6) +
      ' of the ship | of that, ' + pct(d.interiorDark).padStart(6) +
      ' sits in the darkest 40% of the ramp | distinct steps inside: ' + d.interiorDistinct.toFixed(2) + '/' + r.steps);
  });
}

/* ---- BEFORE --------------------------------------------------------- */
var before = runSuite('BEFORE - old applyShading (edge detection)',
  function (base, W, H) { return legacyShade(base, W, H); }, legStep, legMat, 3);
report(before);

/* ---- AFTER (defaults, dither auto) ---------------------------------- */
function afterFn(o) {
  return function (base, W, H) { return SH.shadeMask(base, W, H, o); };
}
var after = runSuite('AFTER - shadeMask() defaults (ditherMode auto)', afterFn({}), newStep, newMat, 6);
report(after);

/* ---- AFTER, dither forced OFF / ON at every size --------------------- */
var afterNoDither = runSuite('AFTER - ditherMode "off" at every size', afterFn({ ditherMode: 'off' }), newStep, newMat, 6);
report(afterNoDither);
var afterDither = runSuite('AFTER - ditherMode "bayer4" at every size', afterFn({ ditherMode: 'bayer4' }), newStep, newMat, 6);
report(afterDither);

/* ---- knob sweeps ----------------------------------------------------- */
say('');
say('=== KNOB SWEEP: rampSteps (defaults otherwise, 96px, 300 seeds) ===');
[3, 4, 5, 6, 8, 10].forEach(function (n) {
  var r = runSuite('steps=' + n, afterFn({ rampSteps: n }), newStep, newMat, n);
  var d = r.res[96];
  say('  rampSteps=' + String(n).padStart(2) + '  darkestInterior ' + pct(d.darkestInteriorMean).padStart(6) +
      '  largestFlat ' + pct(d.largestFlatMean).padStart(6) + '  stepsUsed ' + d.histUsed + '/' + n +
      '  hist [' + d.hist.map(function (v) { return (v * 100).toFixed(1); }).join(' ') + ']');
});

say('');
say('=== KNOB SWEEP: domeStrength (this is what removes the flat interior) ===');
[0, 0.2, 0.4, 0.6, 0.9].forEach(function (v) {
  var r = runSuite('dome=' + v, afterFn({ domeStrength: v }), newStep, newMat, 6);
  say('  domeStrength=' + String(v).padEnd(4) +
      '  largestFlat 16/32/64/96: ' + SIZES.map(function (S) { return pct(r.res[S].largestFlatMean); }).join(' / ') +
      '   darkestInterior 96px: ' + pct(r.res[96].darkestInteriorMean));
});

say('');
say('=== KNOB SWEEP: aoStrength ===');
[0, 0.25, 0.45, 0.7].forEach(function (v) {
  var r = runSuite('ao=' + v, afterFn({ aoStrength: v }), newStep, newMat, 6);
  say('  aoStrength=' + String(v).padEnd(5) +
      '  darkestInterior 16/32/64/96: ' + SIZES.map(function (S) { return pct(r.res[S].darkestInteriorMean); }).join(' / '));
});

say('');
say('=== KNOB SWEEP: rimStrength ===');
[0, 0.35, 0.7].forEach(function (v) {
  var r = runSuite('rim=' + v, afterFn({ rimStrength: v }), newStep, newMat, 6);
  say('  rimStrength=' + String(v).padEnd(5) +
      '  top ramp step share 16/32/64/96: ' +
      SIZES.map(function (S) { return pct(r.res[S].hist[5]); }).join(' / '));
});

say('');
say('=== KNOB SWEEP: thicknessScale (bevel width) ===');
[0.08, 0.12, 0.17, 0.25].forEach(function (v) {
  var r = runSuite('t=' + v, afterFn({ thicknessScale: v }), newStep, newMat, 6);
  say('  thicknessScale=' + String(v).padEnd(5) +
      '  largestFlat 16/32/64/96: ' + SIZES.map(function (S) { return pct(r.res[S].largestFlatMean); }).join(' / '));
});

/* ---- MATERIALS: are non-HULL materials still flat? ------------------- */
say('');
say('=== MATERIAL SHADING: distinct ramp values used per material (mean over seeds) ===');
var MATNAME = { 1: 'HULL', 5: 'COCKPIT', 6: 'ACCENT', 7: 'NOZZLE', 8: 'GUN', 9: 'LAMP' };
[['BEFORE (legacy, max 3)', before], ['AFTER (defaults, max 6)', after]].forEach(function (pair) {
  var lbl = pair[0], r = pair[1];
  SIZES.forEach(function (S) {
    var parts = [];
    Object.keys(MATNAME).forEach(function (m) {
      var arr = r.res[S].matVals[m];
      if (arr && arr.length) parts.push(MATNAME[m] + ' ' + mean(arr).toFixed(2));
    });
    say('  ' + lbl.padEnd(24) + String(S).padStart(3) + 'px: ' + parts.join('  '));
  });
});

/* ---- RIDGE WIDTH: the "2-3px at every size" bug --------------------- */
say('');
say('=== CENTRE RIDGE WIDTH (measured on the real sprites) ===');
say('  measured = width in px of the contiguous run of ridge-affected columns');
say('  through the widest hull row, at 50% of peak ridge strength');
SIZES.forEach(function (S) {
  var legacyW = [], newW = [], newOffW = [];
  for (var s = 0; s < 60; s++) {
    var base = caShip(1000 + s, S, S);
    var solidN = 0; for (var i = 0; i < S * S; i++) if (base[i]) solidN++;
    if (!solidN) continue;
    /* legacy: |x-cx| <= min(1.2, W*0.045)  -> count integer columns in range */
    var lr = Math.min(1.2, S * 0.045), cxA = (S - 1) / 2, cnt = 0;
    for (var x = 0; x < S; x++) if (Math.abs(x - cxA) <= lr) cnt++;
    legacyW.push(cnt);
    /* new: gaussian, half-max at |u| = sqrt(ln2) -> width = 2*ridgeW*sqrt(ln2) */
    var g = SH.shadeMask(base, S, S, { debug: true });
    var half = 0.5 * g.opts.ridgeStrength, best = 0;
    for (var y = 0; y < S; y++) {
      var run = 0;
      for (var x2 = 0; x2 < S; x2++) { if (g.terms.ridge[y * S + x2] >= half) run++; }
      if (run > best) best = run;
    }
    newW.push(best);
    var g2 = SH.shadeMask(base, S, S, { debug: true, ridgeWidthMode: 'off' });
    var mx = 0; for (var j = 0; j < S * S; j++) if (g2.terms.ridge[j] > mx) mx = g2.terms.ridge[j];
    newOffW.push(mx);
  }
  say('  ' + String(S).padStart(3) + 'px  legacy ridge width: ' + median(legacyW) + ' px (' +
      pct(median(legacyW) / S) + ' of sprite)   new "scaled": ' + median(newW) + ' px (' +
      pct(median(newW) / S) + ')   mode "off" max ridge term: ' + Math.max.apply(null, newOffW).toFixed(3));
});

/* ---- DITHER READABILITY --------------------------------------------- */
say('');
say('=== DITHER: isolated-pixel count (readability proxy; lower = cleaner) ===');
say('  isolated = shaded pixel whose 4 solid neighbours all differ in ramp step');
function isolatedFrac(grid, W, H) {
  var iso = 0, tot = 0;
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var i = y * W + x;
    if (!isSolid(grid[i])) continue;
    var st = newStep(grid[i]), same = 0, nb = 0;
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var nx = x + d[0], ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
      var j = ny * W + nx;
      if (!isSolid(grid[j])) return;
      nb++; if (newStep(grid[j]) === st) same++;
    });
    if (nb > 0) { tot++; if (same === 0) iso++; }
  }
  return tot ? iso / tot : 0;
}
SIZES.forEach(function (S) {
  var off = [], on = [], auto = [];
  for (var s = 0; s < 120; s++) {
    var base = caShip(1000 + s, S, S);
    var solidN = 0; for (var i = 0; i < S * S; i++) if (base[i]) solidN++;
    if (!solidN) continue;
    off.push(isolatedFrac(SH.shadeMask(base, S, S, { ditherMode: 'off' }), S, S));
    on.push(isolatedFrac(SH.shadeMask(base, S, S, { ditherMode: 'bayer4' }), S, S));
    auto.push(isolatedFrac(SH.shadeMask(base, S, S, {}), S, S));
  }
  say('  ' + String(S).padStart(3) + 'px  off ' + pct(mean(off)).padStart(6) +
      '   bayer4 ' + pct(mean(on)).padStart(6) +
      '   auto(default) ' + pct(mean(auto)).padStart(6) +
      '   auto resolves to: ' + (S >= SH.DEFAULTS.ditherMinSize ? SH.DEFAULTS.ditherAutoMatrix : 'off'));
});

/* ---- SANITY --------------------------------------------------------- */
say('');
say('=== SANITY ===');
(function () {
  var base = caShip(1234, 64, 64);
  var a = SH.shadeMask(base, 64, 64, {});
  var b = SH.shadeMask(base, 64, 64, {});
  var same = true;
  for (var i = 0; i < 64 * 64; i++) if (a[i] !== b[i]) { same = false; break; }
  say('  determinism (same input twice, byte identical): ' + same);

  var raw = fs.readFileSync(path.join(__dirname, 'shading.js'), 'utf8');
  var src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');  /* strip comments */
  say('  code (comments stripped) contains Math.random: ' + /Math\.random/.test(src));
  say('  code (comments stripped) contains Date/new Date: ' + /\bDate\b/.test(src));
  say('  code contains import/export keyword: ' + /^\s*(import|export)\s/m.test(src));
  say('  module has module.exports guard: ' + /typeof module !== 'undefined'/.test(raw.replace(/"/g, "'")));

  /* browser load: no `module`, no ES syntax, exports on window */
  var vm = require('vm');
  var sandbox = { window: {}, Math: Math, Uint8Array: Uint8Array, Float32Array: Float32Array,
                  Float64Array: Float64Array, Object: Object, Array: Array };
  vm.createContext(sandbox);
  vm.runInContext(raw, sandbox);
  say('  loads as a browser <script> (no `module`): ' +
      (typeof sandbox.window.PixelshipShading === 'object' &&
       typeof sandbox.window.PixelshipShading.shadeMask === 'function'));

  var empty = new Uint8Array(16 * 16);
  var e = SH.shadeMask(empty, 16, 16, {});
  var nonZero = 0; for (var j = 0; j < 256; j++) if (e[j]) nonZero++;
  say('  empty mask -> non-zero pixels: ' + nonZero + ' (expect 0), length ' + e.length);

  var binary = new Uint8Array(32 * 32);
  for (var y = 8; y < 24; y++) for (var x = 8; x < 24; x++) binary[y * 32 + x] = 1;
  var sq = SH.shadeMask(binary, 32, 32, {});
  var h = stepHistogram(sq, 32, 32, 6, newStep);
  say('  16x16 solid square in a 32px sprite, step histogram: [' +
      h.counts.join(' ') + ']  bevel thickness ' + sq.thickness.toFixed(2) + 'px, aoRadius ' + sq.aoRadius + 'px');

  var leg = SH.shadeMask(base, 64, 64, { encoding: 'legacy' });
  var ok = true;
  for (var k = 0; k < 64 * 64; k++) if (leg[k] > 9) { ok = false; break; }
  say('  encoding "legacy" produces only ids 0..9: ' + ok);
  say('  round trip toLegacyGrid(packed) equals encoding "legacy": ' +
      Buffer.from(SH.toLegacyGrid(a, 64, 64, 6)).equals(Buffer.from(leg)));
})();

/* ---- ASCII sample ---------------------------------------------------- */
say('');
say('=== ASCII ramp map, 32px, seed 1007 (space=void, comma=outline, .:-=+*#%@ = dark..light) ===');
(function () {
  var base = caShip(1007, 32, 32);
  var g = SH.shadeMask(base, 32, 32, {});
  say(SH.toAscii(g, 32, 32));
  say('  --- same ship, BEFORE (old applyShading) ---');
  var l = legacyShade(base, 32, 32);
  var chars = { 0: ' ', 4: ',', 1: '=', 2: '@', 3: '.', 5: 'c', 6: 'a', 7: 'n', 8: 'g', 9: 'l' };
  var out = [];
  for (var y = 0; y < 32; y++) { var s = ''; for (var x = 0; x < 32; x++) s += chars[l[y * 32 + x]] || '?'; out.push(s); }
  say(out.join('\n'));
})();

/* ============================== PNG RENDER =============================== */
var SEEDS = [1000, 1001, 1002, 1003, 1004, 1006, 1007, 1011];
SIZES.forEach(function (S) {
  var scale = Math.max(1, Math.round(320 / S));
  var tiles = [];
  SEEDS.forEach(function (sd) {
    var base = caShip(sd, S, S);
    tiles.push(gridToRGBA(legacyShade(base, S, S), S, S, 3, scale, legStep, legMat));
  });
  SEEDS.forEach(function (sd) {
    var base = caShip(sd, S, S);
    tiles.push(gridToRGBA(SH.shadeMask(base, S, S, {}), S, S, 6, scale, newStep, newMat));
  });
  var sh = sheet(tiles, SEEDS.length, 8);
  var f = path.join(OUT_DIR, 'shading_before_after_' + S + '.png');
  writePNG(f, sh.buf, sh.W, sh.H);
  say('  wrote ' + f + '  (top row = BEFORE, bottom row = AFTER)');
});

/* dither comparison at 96 and 16 */
[16, 96].forEach(function (S) {
  var scale = Math.max(1, Math.round(320 / S));
  var tiles = [];
  ['off', 'bayer2', 'bayer4', 'bayer8', 'noise'].forEach(function (mode) {
    SEEDS.slice(0, 4).forEach(function (sd) {
      var base = caShip(sd, S, S);
      tiles.push(gridToRGBA(SH.shadeMask(base, S, S, { ditherMode: mode }), S, S, 6, scale, newStep, newMat));
    });
  });
  var sh = sheet(tiles, 4, 8);
  var f = path.join(OUT_DIR, 'shading_dither_' + S + '.png');
  writePNG(f, sh.buf, sh.W, sh.H);
  say('  wrote ' + f + '  (rows: off / bayer2 / bayer4 / bayer8 / noise)');
});

/* debug term maps at 64 */
(function () {
  var S = 64, scale = 5, base = caShip(1002, S, S);
  var g = SH.shadeMask(base, S, S, { debug: true });
  var tiles = [
    floatToRGBA(g.terms.dist, S, S, scale, 0, 12),
    floatToRGBA(g.terms.height, S, S, scale, 0, 14),
    floatToRGBA(g.terms.lum, S, S, scale, 0, 1),
    floatToRGBA(g.terms.ao, S, S, scale, 0, 1),
    floatToRGBA(g.terms.rim, S, S, scale, 0, 1),
    floatToRGBA(g.terms.spec, S, S, scale, 0, 1),
    floatToRGBA(g.terms.ridge, S, S, scale, 0, 0.15),
    gridToRGBA(g, S, S, 6, scale, newStep, newMat)
  ];
  var sh = sheet(tiles, 4, 8);
  var f = path.join(OUT_DIR, 'shading_terms_64.png');
  writePNG(f, sh.buf, sh.W, sh.H);
  say('  wrote ' + f + '  (dist, height, lum, ao / rim, spec, ridge, final)');
})();

/* ramp step count comparison at 64 */
(function () {
  var S = 64, scale = 5, tiles = [];
  [3, 4, 5, 6, 8, 10].forEach(function (n) {
    SEEDS.slice(0, 4).forEach(function (sd) {
      var base = caShip(sd, S, S);
      tiles.push(gridToRGBA(SH.shadeMask(base, S, S, { rampSteps: n }), S, S, n, scale, newStep, newMat));
    });
  });
  var sh = sheet(tiles, 4, 8);
  var f = path.join(OUT_DIR, 'shading_rampsteps_64.png');
  writePNG(f, sh.buf, sh.W, sh.H);
  say('  wrote ' + f + '  (rows: rampSteps 3,4,5,6,8,10)');
})();

/* light direction sweep */
(function () {
  var S = 64, scale = 5, tiles = [];
  [-90, -45, -25, 0, 25, 45].forEach(function (az) {
    SEEDS.slice(0, 4).forEach(function (sd) {
      var base = caShip(sd, S, S);
      tiles.push(gridToRGBA(SH.shadeMask(base, S, S, { lightAzimuthDeg: az }), S, S, 6, scale, newStep, newMat));
    });
  });
  var sh = sheet(tiles, 4, 8);
  var f = path.join(OUT_DIR, 'shading_lightdir_64.png');
  writePNG(f, sh.buf, sh.W, sh.H);
  say('  wrote ' + f + '  (rows: lightAzimuthDeg -90,-45,-25,0,25,45)');
})();

fs.writeFileSync(path.join(OUT_DIR, 'shading_report.txt'), lines.join('\n') + '\n');
console.log('\nfull log -> ' + path.join(OUT_DIR, 'shading_report.txt'));
