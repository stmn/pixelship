/* press.js - renders the panels used by the itch.io page infographics.
   Every panel is a REAL intermediate stage of the generator, not a mock-up.
   Run: node lab/press.js                                                     */
var fs = require('fs');
var path = require('path');
var S = require('./shape.js');
var C = require('./compose.js');
var M = require('./mounts.js');
var B = require('./bank.js');
var F = require('./families.js');
var sheet = require('./sheet.js');

var OUT = path.join(__dirname, '..', 'press');
fs.mkdirSync(OUT, { recursive: true });

/* itch renders the description panel at #131721; panels bake the same colour so
   the infographics sit on the page with no visible box around them */
var BG = [0x13, 0x17, 0x21];

function blank(w, h) {
  var buf = Buffer.alloc(w * h * 4);
  for (var i = 0; i < w * h; i++) {
    buf[i * 4] = BG[0]; buf[i * 4 + 1] = BG[1]; buf[i * 4 + 2] = BG[2]; buf[i * 4 + 3] = 255;
  }
  return buf;
}
function put(buf, W, H, x, y, scale, color) {
  for (var sy = 0; sy < scale; sy++) for (var sx = 0; sx < scale; sx++) {
    var X = x * scale + sx, Y = y * scale + sy;
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    var o = (Y * W + X) * 4;
    buf[o] = color[0]; buf[o + 1] = color[1]; buf[o + 2] = color[2]; buf[o + 3] = 255;
  }
}

/* --- panel: a raw occupancy mask, one flat colour --- */
function panelMask(file, mask, w, h, scale, color) {
  var W = w * scale, H = h * scale, buf = blank(W, H);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++)
    if (mask[y * w + x]) put(buf, W, H, x, y, scale, color);
  sheet.writePNG(path.join(OUT, file), W, H, buf);
}

/* --- panel: material grid, each material its own flat colour --- */
var MATCOL = { 1: [96, 116, 150], 4: [14, 18, 28], 7: [255, 176, 92], 8: [122, 196, 255], 9: [255, 220, 120] };
function panelMaterials(file, ship, scale) {
  var W = ship.W * scale, H = ship.H * scale, buf = blank(W, H);
  for (var y = 0; y < ship.H; y++) for (var x = 0; x < ship.W; x++) {
    var m = ship.mats[y * ship.W + x];
    if (!m) continue;
    put(buf, W, H, x, y, scale, MATCOL[m] || [96, 116, 150]);
  }
  sheet.writePNG(path.join(OUT, file), W, H, buf);
}

/* --- panel: shading steps as a grey ramp --- */
function panelSteps(file, ship, scale) {
  var W = ship.W * scale, H = ship.H * scale, buf = blank(W, H);
  var maxStep = ship.rampSteps - 1;
  for (var y = 0; y < ship.H; y++) for (var x = 0; x < ship.W; x++) {
    var m = ship.mats[y * ship.W + x];
    if (!m) continue;
    if (m === 4) { put(buf, W, H, x, y, scale, [14, 18, 28]); continue; }
    var v = Math.round(40 + 200 * (ship.steps[y * ship.W + x] / maxStep));
    put(buf, W, H, x, y, scale, [v, v, v]);
  }
  sheet.writePNG(path.join(OUT, file), W, H, buf);
}

/* --- panel: the finished, coloured sprite --- */
function panelFinal(file, ship, scale) {
  var W = ship.W * scale, H = ship.H * scale, buf = blank(W, H);
  for (var y = 0; y < ship.H; y++) for (var x = 0; x < ship.W; x++) {
    var m = ship.mats[y * ship.W + x];
    if (!m) continue;
    put(buf, W, H, x, y, scale, C.colorFor(m, ship.steps[y * ship.W + x], ship.pal, ship.rampSteps));
  }
  sheet.writePNG(path.join(OUT, file), W, H, buf);
}

/* ═══════════ 1. pipeline: the same seed at every stage ═══════════ */
var SEED = 1337, SIZE = 48, SCALE = 6;
var opts = { shape: { size: SIZE } };

/* CA snapshots are taken at envelopeCore 0 - with the shipped 0.88 the envelope
   pins the interior and the automaton only nibbles the rim, so a 0..4 strip at
   default settings would show four identical frames and imply work that is not
   happening. This is the automaton actually doing the shaping. */
[0, 1, 2, 5].forEach(function (it, i) {
  var r = S.generateMask(S.makeShapeRng(C.roleSeed(SEED, 0x51ED270B)),
    C.merge(C.SHAPE_TUNING, { size: SIZE, iterations: it, envelopeCore: 0, edgeSoftness: 1.0,
                              minCrossSizeIoU: 0, minMassFraction: 0, maxAttempts: 1 }));
  panelMask('ca_' + i + '.png', r.mask, r.W, r.H, SCALE, [86, 104, 136]);
});

var ship = C.composeShip(SEED, SIZE, {});
var maskOnly = new Uint8Array(ship.W * ship.H);
for (var i = 0; i < maskOnly.length; i++) maskOnly[i] = (ship.mats[i] && ship.mats[i] !== 4) ? 1 : 0;
panelMask('p1_mask.png', maskOnly, ship.W, ship.H, SCALE, [86, 104, 136]);
panelMaterials('p2_mounts.png', ship, SCALE);
panelSteps('p3_shading.png', ship, SCALE);
panelFinal('p4_final.png', ship, SCALE);

/* ═══════════ 2. size independence: one seed, four resolutions ═══════════ */
[16, 32, 64, 96].forEach(function (sz) {
  var s = C.composeShip(SEED, sz, {});
  panelFinal('size_' + sz + '.png', s, Math.max(1, Math.round(192 / sz)));
});

/* ═══════════ 3. families ═══════════ */
F.PRESETS.forEach(function (p) {
  var cells = [];
  for (var c = 0; c < 4; c++) cells.push(C.composeShip((909 + c * 2654435761) | 0, 44, p.opts));
  var sc = 4, pad = 6, cell = 44 * sc + pad * 2;
  var W = cell * 4, H = cell, buf = blank(W, H);
  cells.forEach(function (sh, ci) {
    for (var y = 0; y < sh.H; y++) for (var x = 0; x < sh.W; x++) {
      var m = sh.mats[y * sh.W + x];
      if (!m) continue;
      var col = C.colorFor(m, sh.steps[y * sh.W + x], sh.pal, sh.rampSteps);
      for (var sy = 0; sy < sc; sy++) for (var sx = 0; sx < sc; sx++) {
        var X = ci * cell + pad + x * sc + sx, Y = pad + y * sc + sy;
        if (X >= W || Y >= H) continue;
        var o = (Y * W + X) * 4;
        buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255;
      }
    }
  });
  sheet.writePNG(path.join(OUT, 'fam_' + p.name.toLowerCase() + '.png'), W, H, buf);
});

/* ═══════════ 4. banking poses ═══════════ */
(function () {
  var sh = C.composeShip(1337, 48, {});
  var poses = B.bankPoses(sh, 5, 40, { heightScale: 1.6 });
  var sc = 5, pad = 6, cell = 48 * sc + pad * 2;
  var W = cell * poses.length, H = cell, buf = blank(W, H);
  poses.forEach(function (p, pi) {
    for (var y = 0; y < sh.H; y++) for (var x = 0; x < sh.W; x++) {
      var m = p.mats[y * sh.W + x];
      if (!m) continue;
      var col = C.colorFor(m, p.steps[y * sh.W + x], sh.pal, sh.rampSteps);
      for (var sy = 0; sy < sc; sy++) for (var sx = 0; sx < sc; sx++) {
        var X = pi * cell + pad + x * sc + sx, Y = pad + y * sc + sy;
        if (X >= W || Y >= H) continue;
        var o = (Y * W + X) * 4;
        buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255;
      }
    }
  });
  sheet.writePNG(path.join(OUT, 'bank_poses.png'), W, H, buf);
})();

/* ═══════════ 5. a wide fleet band for the cover ═══════════ */
(function () {
  var sc = 4, pad = 4, cell = 40 * sc + pad * 2, cols = 14, rows = 3;
  var W = cell * cols, H = cell * rows, buf = blank(W, H);
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
    var fam = F.PRESETS[(r * cols + c) % F.PRESETS.length];
    var sh = C.composeShip((5150 + (r * cols + c) * 2654435761) | 0, 40, fam.opts);
    for (var y = 0; y < sh.H; y++) for (var x = 0; x < sh.W; x++) {
      var m = sh.mats[y * sh.W + x];
      if (!m) continue;
      var col = C.colorFor(m, sh.steps[y * sh.W + x], sh.pal, sh.rampSteps);
      for (var sy = 0; sy < sc; sy++) for (var sx = 0; sx < sc; sx++) {
        var X = c * cell + pad + x * sc + sx, Y = r * cell + pad + y * sc + sy;
        if (X >= W || Y >= H) continue;
        var o = (Y * W + X) * 4;
        buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255;
      }
    }
  }
  sheet.writePNG(path.join(OUT, 'fleet_band.png'), W, H, buf);
})();

console.log('press panels written to ' + OUT);
console.log(fs.readdirSync(OUT).filter(function (f) { return /\.png$/.test(f); }).length + ' PNG files');
