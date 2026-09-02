/* ===========================================================================
   pixelship / palette.test.js
   Run:  node /Users/darek/Code/pixelship/lab/palette.test.js
   Every number printed here is measured at run time. Nothing is hardcoded
   except the CIEDE2000 reference data (Sharma/Wu/Dalal) and the baseline
   re-implementation of the prototype palette we are replacing.
   =========================================================================== */

var P = require('./palette.js');

var makePalette = P.makePalette, recolorTeam = P.recolorTeam;
var hsl2rgb = P.hsl2rgb, rgb2hsl = P.rgb2hsl, rgb2lab = P.rgb2lab;
var deltaE2000 = P.deltaE2000, deltaE2000Lab = P.deltaE2000Lab, deltaE76 = P.deltaE76;
var hueRange = P.hueRange, hexToRgb = P.hexToRgb, rgbToHex = P.rgbToHex;
var relativeLuminance = P.relativeLuminance, contrastRatio = P.contrastRatio, srgbLuma = P.srgbLuma;
var NAMES = P.PALETTE_RAMP_NAMES;

/* ---- tiny harness ------------------------------------------------------- */
var pass = 0, fail = 0, failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(label + (detail ? '  [' + detail + ']' : '')); }
}
function f(n, d) { return Number(n).toFixed(d == null ? 2 : d); }
function line(s) { console.log(s); }
function head(s) { console.log('\n' + s + '\n' + '-'.repeat(s.length)); }

/* ---- deterministic rng (same mulberry32 as the prototype) ---------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function median(arr) {
  var a = arr.slice().sort(function (x, y) { return x - y; });
  var m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function pct(arr, p) {
  var a = arr.slice().sort(function (x, y) { return x - y; });
  return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
}

var BG = '#0b0e14';
var BG_RGB = hexToRgb(BG);

/* =========================================================================
   0. COLOUR MATH SANITY - if this is wrong every other number is worthless
   ========================================================================= */
head('0. colour math self-check');

var labWhite = rgb2lab([255, 255, 255]);
var labGray = rgb2lab([128, 128, 128]);
var labRed = rgb2lab([255, 0, 0]);
line('rgb2lab(#ffffff) = L ' + f(labWhite[0], 3) + '  a ' + f(labWhite[1], 3) + '  b ' + f(labWhite[2], 3) + '   (ref L=100, a=0, b=0)');
line('rgb2lab(#808080) = L ' + f(labGray[0], 3) + '  a ' + f(labGray[1], 3) + '  b ' + f(labGray[2], 3) + '   (ref L=53.585)');
line('rgb2lab(#ff0000) = L ' + f(labRed[0], 3) + '  a ' + f(labRed[1], 3) + '  b ' + f(labRed[2], 3) + '   (ref L=53.241, a=80.092, b=67.203)');
ok(Math.abs(labWhite[0] - 100) < 0.01 && Math.abs(labWhite[1]) < 0.01, 'Lab white');
ok(Math.abs(labGray[0] - 53.585) < 0.02, 'Lab mid gray L');
ok(Math.abs(labRed[0] - 53.241) < 0.02 && Math.abs(labRed[1] - 80.092) < 0.05 && Math.abs(labRed[2] - 67.203) < 0.05, 'Lab red');

/* Sharma / Wu / Dalal CIEDE2000 reference pairs (Lab1, Lab2, expected dE00) */
var SHARMA = [
  [[50.0000, 2.6772, -79.7751], [50.0000, 0.0000, -82.7485], 2.0425],
  [[50.0000, 3.1571, -77.2803], [50.0000, 0.0000, -82.7485], 2.8615],
  [[50.0000, 2.8361, -74.0200], [50.0000, 0.0000, -82.7485], 3.4412],
  [[50.0000, -1.3802, -84.2814], [50.0000, 0.0000, -82.7485], 1.0000],
  [[50.0000, -1.1848, -84.8006], [50.0000, 0.0000, -82.7485], 1.0000],
  [[50.0000, -0.9009, -85.5211], [50.0000, 0.0000, -82.7485], 1.0000],
  [[50.0000, 0.0000, 0.0000], [50.0000, -1.0000, 2.0000], 2.3669],
  [[50.0000, -1.0000, 2.0000], [50.0000, 0.0000, 0.0000], 2.3669],
  [[50.0000, 2.4900, -0.0010], [50.0000, -2.4900, 0.0009], 7.1792],
  [[50.0000, 2.5000, 0.0000], [50.0000, 0.0000, -2.5000], 4.3065],
  [[50.0000, 2.5000, 0.0000], [73.0000, 25.0000, -18.0000], 27.1492],
  [[50.0000, 2.5000, 0.0000], [50.0000, 3.1736, 0.5854], 1.0000],
  [[50.0000, 2.5000, 0.0000], [50.0000, 3.2972, 0.0000], 1.0000],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.2630],
  [[61.2901, 3.7196, -5.3901], [61.4292, 2.2480, -4.9620], 1.8731],
  [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
  [[22.7233, 20.0904, -46.6940], [23.0331, 14.9730, -42.5619], 2.0373],
  [[36.4612, 47.8580, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
  [[90.8027, -2.0831, 1.4410], [91.1528, -1.6435, 0.0447], 1.4441],
  [[2.0776, 0.0795, -1.1350], [0.9033, -0.0636, -0.5514], 0.9082]
];
var worstSharma = 0;
for (var si = 0; si < SHARMA.length; si++) {
  var got = deltaE2000Lab(SHARMA[si][0], SHARMA[si][1]);
  worstSharma = Math.max(worstSharma, Math.abs(got - SHARMA[si][2]));
}
line('CIEDE2000 vs ' + SHARMA.length + ' Sharma reference pairs: worst absolute error ' + f(worstSharma, 5));
ok(worstSharma < 0.0002, 'CIEDE2000 matches reference data', 'worst err ' + worstSharma);

/* =========================================================================
   1. BASELINE - reproduce the prototype palette so the before/after is real
   ========================================================================= */
head('1. baseline: the prototype value-ramp palette (3000 seeds)');

function rr(r, a, b) { return a + (b - a) * r(); }
function oldPalette(r) {                       /* verbatim port of prototype-ab.html */
  var h = r() * 360;
  var s = rr(r, 0.05, 0.30);
  var shadowShift = -10;
  return {
    HULL: hsl2rgb(h, s, 0.50),
    LIGHT: hsl2rgb(h + 5, s * 0.75, 0.70),
    DARK: hsl2rgb(h + shadowShift, s, 0.31),
    OUTLINE: hsl2rgb(h + shadowShift, Math.min(1, s * 1.6), 0.07)
  };
}

var N_BASE = 3000;
var oldSpread = [], oldOutBgDe = [], oldOutBgLum = [], oldAdjMin = [];
for (var i = 0; i < N_BASE; i++) {
  var op = oldPalette(mulberry32(i ^ 0x9e3779b9));
  oldSpread.push(hueRange([op.LIGHT, op.HULL, op.DARK].map(function (c) { return rgb2hsl(c)[0]; })));
  oldOutBgDe.push(deltaE2000(op.OUTLINE, BG_RGB));
  oldOutBgLum.push(Math.abs(srgbLuma(op.OUTLINE) - srgbLuma(BG_RGB)));
  oldAdjMin.push(Math.min(deltaE2000(op.DARK, op.HULL), deltaE2000(op.HULL, op.LIGHT)));
}
line('OLD hue spread LIGHT/HULL/DARK   median ' + f(median(oldSpread)) + ' deg   p95 ' + f(pct(oldSpread, 0.95)) + ' deg');
line('OLD outline vs ' + BG + '        median dE2000 ' + f(median(oldOutBgDe)) + '   median luminance delta ' + f(median(oldOutBgLum)));
line('OLD adjacent step dE2000 (min of the 2 gaps)  median ' + f(median(oldAdjMin)));

/* =========================================================================
   2. NEW: hue spread, per ramp, at neutral settings
   ========================================================================= */
head('2. new palette: hue spread per authored ramp (no rotation, no jitter)');

var NEUTRAL = { hueRotation: 0, saturationJitterMax: 0, lightnessJitterMax: 0, background: BG };
line('ramp        full-ramp spread   LIGHT/HULL/DARK spread   swatches');
var worstFullSpread = 1e9, worstLHDSpread = 1e9;
for (var n = 0; n < NAMES.length; n++) {
  var p = makePalette(null, Object.assign({ rampName: NAMES[n] }, NEUTRAL));
  var m = p.meta.measurements;
  worstFullSpread = Math.min(worstFullSpread, m.hueSpreadRamp);
  worstLHDSpread = Math.min(worstLHDSpread, m.hueSpreadLightHullDark);
  line(NAMES[n].padEnd(12) + f(m.hueSpreadRamp, 1).padStart(10) + ' deg' +
       f(m.hueSpreadLightHullDark, 1).padStart(20) + ' deg   ' +
       p.ramp.map(rgbToHex).join(' '));
}
line('\nWORST CASE full-ramp hue spread      ' + f(worstFullSpread, 1) + ' deg');
line('WORST CASE LIGHT/HULL/DARK spread    ' + f(worstLHDSpread, 1) + ' deg   (baseline median was ' + f(median(oldSpread)) + ')');
ok(worstFullSpread > 60, 'every ramp spreads > 60 deg of hue', f(worstFullSpread, 1));
ok(worstLHDSpread > 20, 'every LIGHT/HULL/DARK triple spreads > 20 deg', f(worstLHDSpread, 1));

/* =========================================================================
   3. NEW: full sweep, all ramps x many seeds. WORST CASE everywhere.
   ========================================================================= */
head('3. new palette: full sweep, 12 ramps x 500 seeds = 6000 palettes');

var SEEDS = 500;
var acc = {
  lhdSpread: [], fullSpread: [], adjMin: [], adjMax: [],
  outBg: [], outBgLum: [], outBgCR: [], outHull: [],
  accHull: [], glowHull: [], glowAcc: [], cockHull: [],
  nozOut: [], gunOut: [], gunNoz: [], lightHull: [], darkHull: []
};
var perRamp = {};
for (n = 0; n < NAMES.length; n++) {
  perRamp[NAMES[n]] = { adjMin: [], outBg: [], outHull: [], accHull: [], glowHull: [], lhd: [] };
  for (var s = 0; s < SEEDS; s++) {
    var rng = mulberry32((n * 7919 + s * 2654435761) | 0);
    var pal = makePalette(rng, { rampName: NAMES[n], background: BG });
    var mm = pal.meta.measurements;
    var hull = pal.materials[P.PALETTE_MATERIALS.HULL];
    acc.lhdSpread.push(mm.hueSpreadLightHullDark);
    acc.fullSpread.push(mm.hueSpreadRamp);
    acc.adjMin.push(mm.minAdjacentDeltaE);
    acc.adjMax.push(mm.maxAdjacentDeltaE);
    acc.outBg.push(mm.outlineVsBackgroundDeltaE);
    acc.outBgLum.push(mm.outlineVsBackgroundLuminanceDelta);
    acc.outBgCR.push(mm.outlineVsBackgroundContrastRatio);
    acc.outHull.push(mm.outlineVsHullDeltaE);
    acc.accHull.push(mm.accentVsHullDeltaE);
    acc.glowHull.push(mm.glowVsHullDeltaE);
    acc.glowAcc.push(mm.glowVsAccentDeltaE);
    acc.cockHull.push(mm.cockpitVsHullDeltaE);
    acc.nozOut.push(mm.nozzleVsOutlineDeltaE);
    acc.gunOut.push(mm.gunVsOutlineDeltaE);
    acc.gunNoz.push(deltaE2000(pal.gun, pal.nozzle));
    acc.lightHull.push(deltaE2000(pal.materials[P.PALETTE_MATERIALS.LIGHT], hull));
    acc.darkHull.push(deltaE2000(pal.materials[P.PALETTE_MATERIALS.DARK], hull));
    perRamp[NAMES[n]].adjMin.push(mm.minAdjacentDeltaE);
    perRamp[NAMES[n]].outBg.push(mm.outlineVsBackgroundDeltaE);
    perRamp[NAMES[n]].outHull.push(mm.outlineVsHullDeltaE);
    perRamp[NAMES[n]].accHull.push(mm.accentVsHullDeltaE);
    perRamp[NAMES[n]].glowHull.push(mm.glowVsHullDeltaE);
    perRamp[NAMES[n]].lhd.push(mm.hueSpreadLightHullDark);
  }
}
var TOTAL = NAMES.length * SEEDS;

function report(label, arr, mode) {
  var lo = Math.min.apply(null, arr), hi = Math.max.apply(null, arr);
  line(label.padEnd(38) + 'min ' + f(lo).padStart(8) + '   median ' + f(median(arr)).padStart(8) + '   max ' + f(hi).padStart(8));
  return { lo: lo, hi: hi, med: median(arr) };
}

line('metric                                (over ' + TOTAL + ' palettes)');
var rLhd = report('hue spread LIGHT/HULL/DARK (deg)', acc.lhdSpread);
var rFull = report('hue spread full ramp (deg)', acc.fullSpread);
var rAdjMin = report('adjacent ramp step dE2000 (min)', acc.adjMin);
var rAdjMax = report('adjacent ramp step dE2000 (max)', acc.adjMax);
var rOutBg = report('outline vs ' + BG + ' dE2000', acc.outBg);
var rOutLum = report('outline vs bg Rec.709 luma delta', acc.outBgLum);
var rOutCR = report('outline vs bg WCAG contrast ratio', acc.outBgCR);
var rOutHull = report('outline vs HULL dE2000', acc.outHull);
var rAccHull = report('ACCENT vs HULL dE2000', acc.accHull);
var rGlowHull = report('LAMP/glow vs HULL dE2000', acc.glowHull);
var rGlowAcc = report('LAMP/glow vs ACCENT dE2000', acc.glowAcc);
var rCockHull = report('COCKPIT vs HULL dE2000', acc.cockHull);
var rNozOut = report('NOZZLE vs OUTLINE dE2000', acc.nozOut);
var rGunOut = report('GUN vs OUTLINE dE2000', acc.gunOut);
var rGunNoz = report('GUN vs NOZZLE dE2000', acc.gunNoz);
var rLightHull = report('LIGHT vs HULL dE2000', acc.lightHull);
var rDarkHull = report('DARK vs HULL dE2000', acc.darkHull);

ok(rLhd.lo > 15, 'worst-case LIGHT/HULL/DARK hue spread > 15 deg', f(rLhd.lo, 1));
ok(rAdjMin.lo >= 6, 'no two adjacent ramp steps closer than 6 dE2000', f(rAdjMin.lo));
ok(rAdjMax.hi <= 36, 'no adjacent ramp step gap wider than 36 dE2000', f(rAdjMax.hi));
ok(rOutBg.lo >= 11.9, 'outline always >= ~12 dE2000 from the space background', f(rOutBg.lo));
ok(rOutLum.lo >= 7.9, 'outline always >= ~8 luma from the space background', f(rOutLum.lo));
ok(rOutHull.lo >= 17.9, 'outline always >= ~18 dE2000 from the hull', f(rOutHull.lo));
ok(rAccHull.lo >= 27.9, 'accent always >= ~28 dE2000 from the hull', f(rAccHull.lo));
ok(rGlowHull.lo >= 33.9, 'glow always >= ~34 dE2000 from the hull', f(rGlowHull.lo));
ok(rGlowAcc.lo >= 11.9, 'glow always >= ~12 dE2000 from the accent', f(rGlowAcc.lo));
ok(rCockHull.lo >= 23.9, 'cockpit always >= ~24 dE2000 from the hull', f(rCockHull.lo));
ok(rNozOut.lo >= 5.9 && rGunOut.lo >= 5.9, 'nozzle/gun never identical to outline', f(rNozOut.lo) + '/' + f(rGunOut.lo));
ok(rGunNoz.lo >= 5.9, 'gun distinguishable from nozzle', f(rGunNoz.lo));

/* per-ramp worst case table - the average hides the ramp that ships badly */
head('3b. worst case PER RAMP (500 seeds each)');
line('ramp        minAdjDE   out|bg   out|hull   acc|hull   glow|hull   LHD hue');
for (n = 0; n < NAMES.length; n++) {
  var pr = perRamp[NAMES[n]];
  line(NAMES[n].padEnd(12) +
    f(Math.min.apply(null, pr.adjMin)).padStart(7) +
    f(Math.min.apply(null, pr.outBg)).padStart(9) +
    f(Math.min.apply(null, pr.outHull)).padStart(11) +
    f(Math.min.apply(null, pr.accHull)).padStart(11) +
    f(Math.min.apply(null, pr.glowHull)).padStart(12) +
    f(Math.min.apply(null, pr.lhd), 1).padStart(10) + ' deg');
}

/* =========================================================================
   4. OUTLINE MODE COMPARISON - justify the default with numbers
   ========================================================================= */
head('4. outline mode comparison (worst case over 12 ramps x 200 seeds)');

var MODES = ['black', 'rampDark', 'hueBlack'];
line('mode                     enforce   worst dE vs bg   worst lum delta   worst dE vs hull');
var hueBlackWorstBg = 0, blackWorstBg = 0;
for (var mi = 0; mi < MODES.length; mi++) {
  for (var e = 0; e < 2; e++) {
    var enforce = e === 1;
    var wBg = 1e9, wLum = 1e9, wHull = 1e9;
    for (n = 0; n < NAMES.length; n++) {
      for (s = 0; s < 200; s++) {
        var pp = makePalette(mulberry32((n * 104729 + s * 31) | 0), {
          rampName: NAMES[n], background: BG, outlineMode: MODES[mi], outlineEnforceContrast: enforce
        });
        var mmm = pp.meta.measurements;
        wBg = Math.min(wBg, mmm.outlineVsBackgroundDeltaE);
        wLum = Math.min(wLum, mmm.outlineVsBackgroundLuminanceDelta);
        wHull = Math.min(wHull, mmm.outlineVsHullDeltaE);
      }
    }
    line((MODES[mi]).padEnd(25) + String(enforce).padEnd(10) +
      f(wBg).padStart(12) + f(wLum).padStart(18) + f(wHull).padStart(19));
    if (MODES[mi] === 'hueBlack' && enforce) hueBlackWorstBg = wBg;
    if (MODES[mi] === 'black' && !enforce) blackWorstBg = wBg;
  }
}
line('\npure black vs ' + BG + ': dE2000 ' + f(deltaE2000([0, 0, 0], BG_RGB)) +
     ', luminance delta ' + f(Math.abs(srgbLuma([0, 0, 0]) - srgbLuma(BG_RGB))) +
     ', contrast ratio ' + f(contrastRatio([0, 0, 0], BG_RGB), 3));
ok(hueBlackWorstBg > blackWorstBg, 'default hueBlack+enforce beats raw black on background separation',
   f(hueBlackWorstBg) + ' vs ' + f(blackWorstBg));

/* =========================================================================
   5. HUE ROTATION actually produces a family of colourways
   ========================================================================= */
head('5. colourway variation from the bounded global hue rotation');

var rotHues = [], rots = [];
for (i = 0; i < 400; i++) {
  var pr2 = makePalette(mulberry32(i * 48271 + 7), { rampName: 'gunmetal', background: BG });
  rots.push(pr2.meta.hueRotation);
  rotHues.push(rgb2hsl(pr2.materials[P.PALETTE_MATERIALS.HULL])[0]);
}
line('gunmetal, 400 seeds: hue rotation range ' + f(Math.min.apply(null, rots), 1) + ' .. ' + f(Math.max.apply(null, rots), 1) + ' deg');
line('resulting HULL hue range              ' + f(hueRange(rotHues), 1) + ' deg');
ok(Math.max.apply(null, rots) <= 24.0001 && Math.min.apply(null, rots) >= -24.0001, 'rotation stays inside hueRotationMax');
ok(hueRange(rotHues) > 30, 'hull hue actually varies across seeds', f(hueRange(rotHues), 1));

var snapped = {};
for (i = 0; i < 200; i++) {
  var ps = makePalette(mulberry32(i * 12345 + 1), { rampName: 'ice', hueRotationSnap: 12, background: BG });
  snapped[Math.round(ps.meta.hueRotation)] = 1;
}
line('hueRotationSnap:12 over 200 seeds -> distinct rotations: ' + Object.keys(snapped).sort(function (a, b) { return a - b; }).join(', '));
ok(Object.keys(snapped).length <= 5, 'snap quantises the colourway set', Object.keys(snapped).length + ' values');

/* =========================================================================
   6. DETERMINISM + CONTRACT
   ========================================================================= */
head('6. determinism and contract');

var a1 = makePalette(mulberry32(1234), { background: BG });
var a2 = makePalette(mulberry32(1234), { background: BG });
ok(JSON.stringify(a1.ramp) === JSON.stringify(a2.ramp) &&
   JSON.stringify(a1.materials) === JSON.stringify(a2.materials), 'same seed -> identical palette');
var a3 = makePalette(mulberry32(9999), { background: BG });
ok(JSON.stringify(a1.ramp) !== JSON.stringify(a3.ramp), 'different seed -> different palette');
line('seed 1234 -> ' + a1.meta.rampName + '  ' + a1.ramp.map(rgbToHex).join(' ') +
     '  accent ' + rgbToHex(a1.accent) + '  glow ' + rgbToHex(a1.glow) + '  outline ' + rgbToHex(a1.outline));
line('seed 9999 -> ' + a3.meta.rampName + '  ' + a3.ramp.map(rgbToHex).join(' ') +
     '  accent ' + rgbToHex(a3.accent) + '  glow ' + rgbToHex(a3.glow) + '  outline ' + rgbToHex(a3.outline));

ok(a1.materials.length === 10 && a1.materials[0] === null, 'materials table covers ids 0..9 with EMPTY null');
var allBytes = true;
for (i = 1; i < a1.materials.length; i++) {
  var c = a1.materials[i];
  if (!c || c.length !== 3) { allBytes = false; break; }
  for (var q = 0; q < 3; q++) if (!(c[q] >= 0 && c[q] <= 255 && c[q] === Math.round(c[q]))) allBytes = false;
}
ok(allBytes, 'every material colour is an integer [r,g,b] triple in 0..255');

/* no Math.random / Date anywhere in the module source */
var rawSrc = require('fs').readFileSync(__dirname + '/palette.js', 'utf8');
var src = rawSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok(src.indexOf('Math.random') === -1, 'module never calls Math.random');
ok(!/[^a-zA-Z]Date\s*[.(]/.test(src), 'module never uses Date');
ok(rawSrc.indexOf('module.exports') > 0 && rawSrc.indexOf('import ') === -1, 'module exports via the shared contract guard');

/* step-count resampling */
head('6b. steps knob (resampling the authored ramp)');
var stepCounts = [3, 4, 5, 6, 8, 12];
var worstResampleAdj = 1e9;
for (var sc = 0; sc < stepCounts.length; sc++) {
  var lo = 1e9, hi = 0, spread = 1e9;
  for (n = 0; n < NAMES.length; n++) {
    var pz = makePalette(null, Object.assign({ rampName: NAMES[n], steps: stepCounts[sc] }, NEUTRAL));
    lo = Math.min(lo, pz.meta.measurements.minAdjacentDeltaE);
    hi = Math.max(hi, pz.meta.measurements.maxAdjacentDeltaE);
    spread = Math.min(spread, pz.meta.measurements.hueSpreadRamp);
  }
  line('steps=' + String(stepCounts[sc]).padEnd(3) + ' worst adjacent dE ' + f(lo).padStart(6) + ' .. ' + f(hi).padStart(6) +
       '   worst full hue spread ' + f(spread, 1).padStart(6) + ' deg');
  if (stepCounts[sc] <= 6) worstResampleAdj = Math.min(worstResampleAdj, lo);
}
ok(worstResampleAdj >= 6, 'resampled ramps (3..6 steps) keep adjacent steps >= 6 dE', f(worstResampleAdj));

/* =========================================================================
   7. TEAM COLOUR
   ========================================================================= */
head('7. team colour swap');

var base = makePalette(mulberry32(777), { rampName: 'gunmetal', background: BG });
line('team indices for a 6-step ramp: [' + base.meta.teamIndices.join(', ') + ']  (endpoints stay anchored)');
line('base        ' + base.ramp.map(rgbToHex).join(' '));
var teamNames = Object.keys(P.PALETTE_TEAM_PRESETS);
var teamHullHues = [], worstTeamAdj = 1e9, worstTeamOutHull = 1e9;
for (var ti = 0; ti < teamNames.length; ti++) {
  var tp = recolorTeam(base, teamNames[ti]);
  var hullC = tp.materials[P.PALETTE_MATERIALS.HULL];
  teamHullHues.push(rgb2hsl(hullC)[0]);
  var adj = 1e9;
  for (i = 1; i < tp.ramp.length; i++) adj = Math.min(adj, deltaE2000(tp.ramp[i - 1], tp.ramp[i]));
  worstTeamAdj = Math.min(worstTeamAdj, adj);
  worstTeamOutHull = Math.min(worstTeamOutHull, deltaE2000(tp.outline, hullC));
  line(teamNames[ti].padEnd(12) + tp.ramp.map(rgbToHex).join(' ') +
       '   hull hue ' + f(rgb2hsl(hullC)[0], 1).padStart(6) + '   minAdjDE ' + f(adj).padStart(6));
}
line('\ndistinct hull hues across ' + teamNames.length + ' factions, circular range ' + f(hueRange(teamHullHues.slice(0, teamHullHues.length - 1)), 1) + ' deg');
line('worst adjacent dE after recolour  ' + f(worstTeamAdj));
line('worst outline vs hull after recolour ' + f(worstTeamOutHull));
ok(worstTeamAdj >= 5, 'team recolour does not collapse the ramp', f(worstTeamAdj));
ok(worstTeamOutHull >= 15, 'outline still separates the hull after recolour', f(worstTeamOutHull));

/* pairwise separation of the 11 chromatic factions at the hull step */
var worstPair = 1e9, worstPairName = '';
var chrom = teamNames.filter(function (t) { return P.PALETTE_TEAM_PRESETS[t] != null; });
for (i = 0; i < chrom.length; i++) for (var j = i + 1; j < chrom.length; j++) {
  var pa = recolorTeam(base, chrom[i]).materials[P.PALETTE_MATERIALS.HULL];
  var pb = recolorTeam(base, chrom[j]).materials[P.PALETTE_MATERIALS.HULL];
  var d = deltaE2000(pa, pb);
  if (d < worstPair) { worstPair = d; worstPairName = chrom[i] + '/' + chrom[j]; }
}
line('closest pair of factions at HULL: ' + worstPairName + ' dE2000 ' + f(worstPair));
ok(worstPair >= 5, 'all faction pairs telling apart at the hull step', f(worstPair) + ' ' + worstPairName);

/* =========================================================================
   8. SATURATION ARCH + HUE DIRECTION of the authored ramps
   ========================================================================= */
head('8. authored ramp shape check (saturation arch, cool shadow -> warm light)');

var archOk = 0, coolWarmOk = 0;
line('ramp        S profile                         S peak idx   shadow hue -> light hue');
for (n = 0; n < NAMES.length; n++) {
  var authored = P.PALETTE_RAMPS[NAMES[n]];
  var sArr = authored.map(function (c) { return c[1]; });
  var peak = sArr.indexOf(Math.max.apply(null, sArr));
  var topDrop = sArr[sArr.length - 1] < sArr[peak];
  var lMono = true;
  for (i = 1; i < authored.length; i++) if (authored[i][2] <= authored[i - 1][2]) lMono = false;
  var shadowH = authored[0][0], lightH = authored[authored.length - 1][0];
  var isCoolShadow = shadowH >= 180 && shadowH <= 320;
  var isWarmLight = (lightH <= 100) || (lightH >= 340);
  if (peak >= 1 && peak <= 2 && topDrop && lMono) archOk++;
  if (isCoolShadow && isWarmLight) coolWarmOk++;
  line(NAMES[n].padEnd(12) + sArr.map(function (v) { return f(v); }).join(' ').padEnd(34) +
       String(peak).padStart(6) + '        ' + f(shadowH, 0).padStart(4) + ' -> ' + f(lightH, 0).padStart(4) +
       (isCoolShadow && isWarmLight ? '   cool->warm' : '   !!'));
}
line('\nramps with S peaking at index 1-2, dropping at the top, L monotone: ' + archOk + '/' + NAMES.length);
line('ramps with cool (180-320) shadow and warm (<100 or >340) highlight:  ' + coolWarmOk + '/' + NAMES.length);
ok(archOk === NAMES.length, 'every authored ramp has the saturation arch and monotone value', archOk + '/' + NAMES.length);
ok(coolWarmOk === NAMES.length, 'every authored ramp is cool-shadow / warm-highlight', coolWarmOk + '/' + NAMES.length);

/* =========================================================================
   9. ACCENT HARMONY - it is a harmonic of the hull hue, not a random hue
   ========================================================================= */
head('9. accent harmony');

var modes = ['split', 'complement', 'triad', 'analogous'];
for (var mo = 0; mo < modes.length; mo++) {
  var offs = [];
  for (i = 0; i < 600; i++) {
    var pm = makePalette(mulberry32(i * 2654435761 + mo), { accentMode: modes[mo], background: BG });
    offs.push(pm.meta.accentOffsetFromHull);
  }
  var band = {};
  offs.forEach(function (v) { band[Math.round(v / 30) * 30] = (band[Math.round(v / 30) * 30] || 0) + 1; });
  line(modes[mo].padEnd(12) + 'offset-from-hull buckets(30deg): ' +
    Object.keys(band).sort(function (a, b) { return a - b; }).map(function (kk) { return kk + ':' + band[kk]; }).join('  '));
}
var randomLike = [];
for (i = 0; i < 600; i++) randomLike.push(makePalette(mulberry32(i), { accentMode: 'split', background: BG }).meta.accentOffsetFromHull);
var inBand = randomLike.filter(function (v) { return (v > 135 && v < 165) || (v > 195 && v < 225); }).length;
line('\nsplit-complementary: ' + inBand + '/600 accents land inside 150+/-15 or 210+/-15 degrees of the hull hue');
ok(inBand === 600, 'accent is always a controlled harmonic, never an independent random hue', inBand + '/600');

/* =========================================================================
   SUMMARY
   ========================================================================= */
head('SUMMARY');
line('assertions passed: ' + pass + '   failed: ' + fail);
if (fail) { failures.forEach(function (x) { line('  FAIL  ' + x); }); }
line('');
line('KEY BEFORE / AFTER');
line('  hue spread LIGHT/HULL/DARK   before ' + f(median(oldSpread)) + ' deg (median, 3000 seeds)  ->  after worst-case ' + f(rLhd.lo, 1) + ' deg, median ' + f(rLhd.med, 1) + ' deg');
line('  outline vs ' + BG + ' dE2000  before median ' + f(median(oldOutBgDe)) + '  ->  after worst-case ' + f(rOutBg.lo));
line('  outline vs bg luminance delta before median ' + f(median(oldOutBgLum)) + '  ->  after worst-case ' + f(rOutLum.lo));
process.exit(fail ? 1 : 0);
