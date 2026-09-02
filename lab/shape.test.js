/* ══════════════════════════════════════════════════════════════════════════════
   pixelship / lab / shape.test.js

   Run:  node /Users/darek/Code/pixelship/lab/shape.test.js
         node .../shape.test.js --preview     (also dumps ASCII silhouettes)

   Every number printed here is measured in this process. The "BEFORE" numbers
   come from a verbatim re-implementation of the prototype's generateA() shape
   stage (prototype-ab.html lines 355-389) so the comparison is apples to apples.
   ══════════════════════════════════════════════════════════════════════════════ */

var S = require('./shape.js');

/* ───────────────── BEFORE: prototype generateA(), shape stage only ────────── */

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

function baselineMask(r, W, H) {
  var g = new Uint8Array(W * H);
  var cx = (W - 1) / 2;
  var rx = W * rr(r, .30, .46);
  var ry = H * rr(r, .36, .47);
  var cy = H * rr(r, .46, .54);
  var bias = rr(r, .80, 1.00);
  var x, y;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    var dx = (x - cx) / rx, dy = (y - cy) / ry;
    var d = Math.sqrt(dx * dx + dy * dy);
    var p = bias - d * 0.78;
    g[y * W + x] = r() < p ? 1 : 0;
  }
  mirrorLR(g, W, H);
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
      g[y * W + x] = n >= 5 ? 1 : (n <= 2 ? 0 : c);
    }
    mirrorLR(g, W, H);
  }
  S.maskLargestBlob(g, W, H, 0);
  return g;
}
function mirrorLR(g, W, H) {
  var half = Math.floor(W / 2);
  for (var y = 0; y < H; y++) for (var x = 0; x < half; x++) g[y * W + (W - 1 - x)] = g[y * W + x];
}

/* ─────────────────────────────── statistics ──────────────────────────────── */

function stats(arr) {
  if (!arr.length) return { n: 0, mean: 0, median: 0, p10: 0, p90: 0, min: 0, max: 0 };
  var a = arr.slice().sort(function (x, y) { return x - y; });
  var q = function (p) { return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))]; };
  var s = 0; for (var i = 0; i < a.length; i++) s += a[i];
  return { n: a.length, mean: s / a.length, median: q(0.5), p10: q(0.10), p90: q(0.90), min: a[0], max: a[a.length - 1] };
}
function f(x, d) { return (x == null || !isFinite(x)) ? 'n/a' : x.toFixed(d == null ? 3 : d); }
function line(t) { console.log(t); }
function head(t) { console.log('\n' + t + '\n' + '─'.repeat(t.length)); }

/* full-sprite normalisation used for every cross-size silhouette comparison:
   area-resample the WHOLE sprite (position, scale-in-frame and aspect are all
   preserved) onto a common 64x64 lattice, threshold at 0.5, then IoU. */
function normed(mask, W, H) { return S.areaResampleMask(mask, W, H, 64, 64, 0.5); }

function meanPairwiseIoU(sigs) {
  var s = 0, c = 0;
  for (var i = 0; i < sigs.length; i++) for (var j = i + 1; j < sigs.length; j++) { s += S.maskIoU(sigs[i], sigs[j]); c++; }
  return c ? s / c : 0;
}

function preview(mask, W, H) {
  var out = [];
  for (var y = 0; y < H; y++) { var r = ''; for (var x = 0; x < W; x++) r += mask[y * W + x] ? '█' : '·'; out.push(r); }
  return out;
}

/* ═════════════════════════════ 1. SIZE INDEPENDENCE ═══════════════════════ */

function testSizeIndependence(seeds) {
  head('1. SIZE INDEPENDENCE  — same seed, different sprite sizes');
  var sizes = [16, 32, 64, 96];
  var pairs = [[16, 32], [16, 96], [32, 64], [32, 96], [64, 96]];
  var accNew = {}, accOld = {};
  pairs.forEach(function (p) { accNew[p.join('v')] = []; accOld[p.join('v')] = []; });

  for (var s = 0; s < seeds; s++) {
    var seed = 1000 + s;
    var mNew = {}, mOld = {};
    sizes.forEach(function (z) {
      mNew[z] = normed(S.generateMask(null, { size: z, seed: seed }).mask, z, z);
      mOld[z] = normed(baselineMask(mulberry32(seed), z, z), z, z);
    });
    pairs.forEach(function (p) {
      accNew[p.join('v')].push(S.maskIoU(mNew[p[0]], mNew[p[1]]));
      accOld[p.join('v')].push(S.maskIoU(mOld[p[0]], mOld[p[1]]));
    });
  }
  line('silhouette IoU across sizes (n=' + seeds + ' seeds, 64x64 common lattice)');
  line('  pair      BEFORE median   AFTER median   AFTER p10   AFTER min');
  pairs.forEach(function (p) {
    var k = p.join('v'), o = stats(accOld[k]), n = stats(accNew[k]);
    line('  ' + (p[0] + 'px vs ' + p[1] + 'px').padEnd(10) +
      f(o.median).padStart(12) + f(n.median).padStart(15) +
      f(n.p10).padStart(12) + f(n.min).padStart(12));
  });
  return { old32v64: stats(accOld['32v64']).median, new32v64: stats(accNew['32v64']).median };
}

/* ═════════════════════════ 2. POLARITY + ASPECT ═══════════════════════════ */

function testPolarity(n, size) {
  head('2. FORE/AFT POLARITY and ASPECT  (n=' + n + ' ships at ' + size + 'px)');
  var pwOld = [], pmOld = [], arOld = [], pwNew = [], pmNew = [], arNew = [];
  for (var i = 0; i < n; i++) {
    var seed = 500000 + i;
    var a = S.measureMask(baselineMask(mulberry32(seed), size, size), size, size);
    if (!a.empty) { pwOld.push(a.polarityWidthRatio); pmOld.push(a.polarityMassRatio); arOld.push(a.aspect); }
    var g = S.generateMask(null, { size: size, seed: seed });
    var b = S.measureMask(g.mask, size, size);
    pwNew.push(b.polarityWidthRatio); pmNew.push(b.polarityMassRatio); arNew.push(b.aspect);
  }
  function row(name, st) {
    line('  ' + name.padEnd(26) + 'median ' + f(st.median) + '   mean ' + f(st.mean) +
      '   p10 ' + f(st.p10) + '   p90 ' + f(st.p90));
  }
  line('polarityWidthRatio = mean hull width in v=[0.10,0.30] / v=[0.70,0.90].  1.0 = disc, <0.7 = ship');
  row('BEFORE widthRatio', stats(pwOld)); row('AFTER  widthRatio', stats(pwNew));
  line('polarityMassRatio = mass in leading 30% of bbox / mass in trailing 30%');
  row('BEFORE massRatio', stats(pmOld)); row('AFTER  massRatio', stats(pmNew));
  var shipLikeOld = pwOld.filter(function (v) { return v < 0.7; }).length / pwOld.length;
  var shipLikeNew = pwNew.filter(function (v) { return v < 0.7; }).length / pwNew.length;
  line('  share with widthRatio < 0.70 :  BEFORE ' + f(shipLikeOld) + '   AFTER ' + f(shipLikeNew));
  var noseHeavyOld = pwOld.filter(function (v) { return v > 1.0; }).length / pwOld.length;
  var noseHeavyNew = pwNew.filter(function (v) { return v > 1.0; }).length / pwNew.length;
  line('  share nose-heavier-than-tail  :  BEFORE ' + f(noseHeavyOld) + '   AFTER ' + f(noseHeavyNew));

  line('\nbbox aspect ratio (width/height)');
  row('BEFORE aspect', stats(arOld)); row('AFTER  aspect', stats(arNew));
  var discOld = arOld.filter(function (v) { return v > 0.95 && v < 1.05; }).length / arOld.length;
  var discNew = arNew.filter(function (v) { return v > 0.95 && v < 1.05; }).length / arNew.length;
  line('  share with aspect in [0.95,1.05] (the "disc" band):  BEFORE ' + f(discOld) + '   AFTER ' + f(discNew));
  var sdOld = Math.sqrt(arOld.reduce(function (a2, v) { var m = stats(arOld).mean; return a2 + (v - m) * (v - m); }, 0) / arOld.length);
  var sdNew = Math.sqrt(arNew.reduce(function (a2, v) { var m = stats(arNew).mean; return a2 + (v - m) * (v - m); }, 0) / arNew.length);
  line('  aspect stddev:  BEFORE ' + f(sdOld) + '   AFTER ' + f(sdNew));
}

/* ═══════════════════════════ 3. NEVER DEGENERATE ══════════════════════════ */

function testDegenerate(seedCount, sizes, minMassFraction) {
  head('3. NEVER DEGENERATE  (' + (seedCount * sizes.length) + ' ships, sizes ' + sizes.join('/') + ')');
  var oldEmpty = 0, oldLow = 0, oldN = 0;
  var newEmpty = 0, newLow = 0, newN = 0, worstMF = 1, attempts = [], fallbacks = 0, rescues = 0;
  var perSizeOldEmpty = {}, perSizeNewMin = {};
  sizes.forEach(function (z) { perSizeOldEmpty[z] = 0; perSizeNewMin[z] = 1; });

  for (var s = 0; s < seedCount; s++) {
    var seed = 7000000 + s;
    for (var k = 0; k < sizes.length; k++) {
      var z = sizes[k];
      var ob = baselineMask(mulberry32(seed), z, z);
      var om = S.maskMass(ob); oldN++;
      if (om === 0) { oldEmpty++; perSizeOldEmpty[z]++; }
      if (om / (z * z) < minMassFraction) oldLow++;

      var g = S.generateMask(null, { size: z, seed: seed, minMassFraction: minMassFraction });
      var mf = g.meta.massFraction; newN++;
      if (g.meta.mass === 0) newEmpty++;
      if (mf < minMassFraction) newLow++;
      if (mf < worstMF) worstMF = mf;
      if (mf < perSizeNewMin[z]) perSizeNewMin[z] = mf;
      attempts.push(g.meta.attempts);
      if (g.meta.fallback) fallbacks++;
      if (g.meta.rescues) rescues++;
    }
  }
  var st = stats(attempts);
  line('minimum mass fraction enforced: ' + minMassFraction);
  line('  BEFORE  ships ' + oldN + '   empty ' + oldEmpty + ' (' + f(100 * oldEmpty / oldN, 2) + '%)' +
    '   below min mass ' + oldLow + ' (' + f(100 * oldLow / oldN, 2) + '%)');
  line('  AFTER   ships ' + newN + '   empty ' + newEmpty + ' (' + f(100 * newEmpty / newN, 2) + '%)' +
    '   below min mass ' + newLow + ' (' + f(100 * newLow / newN, 2) + '%)');
  line('  AFTER   worst observed mass fraction ' + f(worstMF, 4) +
    '   retries: mean ' + f(st.mean, 2) + ' max ' + st.max +
    '   analytic fallbacks ' + fallbacks + '   rescue dilations ' + rescues);
  line('  BEFORE empty ships per size: ' + sizes.map(function (z) { return z + 'px:' + perSizeOldEmpty[z]; }).join('  '));
  line('  AFTER  min mass fraction per size: ' + sizes.map(function (z) { return z + 'px:' + f(perSizeNewMin[z]); }).join('  '));
}

/* ─── 3b. the same guarantee under hostile option sets ─── */

function testDegenerateStress(seedCount) {
  var presets = [
    { name: 'default', o: {} },
    { name: 'symmetry=radial', o: { symmetry: 'radial', radialFolds: 'random' } },
    { name: 'symmetry=mirrorXY', o: { symmetry: 'mirrorXY' } },
    { name: 'symmetry=random', o: { symmetry: 'random' } },
    { name: 'padding=3', o: { padding: 3 } },
    { name: 'logicalSize=16', o: { logicalSize: 16 } },
    { name: 'logicalSize=64', o: { logicalSize: 64 } },
    { name: 'envelopeCore=0 iters=1', o: { envelopeCore: 0, iterations: 1, iterationsJitter: 0 } },
    { name: 'holePolicy=keep core=0', o: { holePolicy: 'keep', envelopeCore: 0, iterations: 1, iterationsJitter: 0 } },
    { name: 'minMassFraction=0.20', o: { minMassFraction: 0.20 } },
    { name: 'fillFraction=0.6', o: { fillFraction: 0.6, minMassFraction: 0.06 } },
    { name: 'maxAttempts=1', o: { maxAttempts: 1 } }
  ];
  var sizes = [16, 32, 64, 96];
  head('3b. NEVER DEGENERATE under hostile options  (' +
    (presets.length * seedCount * sizes.length) + ' ships)');
  var total = 0, empty = 0, low = 0;
  presets.forEach(function (p) {
    var e = 0, l = 0, worst = 1, dist = {}, n = 0;
    for (var s = 0; s < seedCount; s++) for (var k = 0; k < sizes.length; k++) {
      var o = {}; for (var kk in p.o) o[kk] = p.o[kk];
      o.size = sizes[k]; o.seed = 880000 + s;
      var g = S.generateMask(null, o);
      var mn = o.minMassFraction != null ? o.minMassFraction : S.SHAPE_DEFAULTS.minMassFraction;
      n++; total++;
      if (g.meta.mass === 0) { e++; empty++; }
      if (g.meta.massFraction < mn) { l++; low++; }
      if (g.meta.massFraction < worst) worst = g.meta.massFraction;
      if (sizes[k] === 32) dist[Array.prototype.join.call(S.coarseSignature(g.mask, 32, 32, 8), '')] = 1;
    }
    line('  ' + p.name.padEnd(26) + 'ships ' + String(n).padStart(5) +
      '  empty ' + e + '  belowMin ' + l + '  worstMassFrac ' + f(worst, 4) +
      '  distinct32 ' + Object.keys(dist).length + '/' + seedCount);
  });
  line('  TOTAL ' + total + ' ships   empty ' + empty + '   below configured minimum ' + low);
}

/* ═════════════════════════════ 4. DIVERSITY ═══════════════════════════════ */

function testDiversity(batch, size) {
  head('4. SILHOUETTE DIVERSITY  (batch=' + batch + ' at ' + size + 'px, lower IoU = more diverse)');
  var o8 = [], o16 = [], n8 = [], n16 = [];
  for (var i = 0; i < batch; i++) {
    var seed = 31000 + i;
    var ob = baselineMask(mulberry32(seed), size, size);
    if (S.maskMass(ob)) { o8.push(S.coarseSignature(ob, size, size, 8)); o16.push(S.coarseSignature(ob, size, size, 16)); }
    var g = S.generateMask(null, { size: size, seed: seed });
    n8.push(S.coarseSignature(g.mask, size, size, 8)); n16.push(S.coarseSignature(g.mask, size, size, 16));
  }
  var r = {
    old8: meanPairwiseIoU(o8), old16: meanPairwiseIoU(o16),
    new8: meanPairwiseIoU(n8), new16: meanPairwiseIoU(n16)
  };
  line('  coarse8  meanIoU   BEFORE ' + f(r.old8) + '   AFTER ' + f(r.new8));
  line('  coarse16 meanIoU   BEFORE ' + f(r.old16) + '   AFTER ' + f(r.new16));
  return r;
}

/* ══════════════════════ 5. DETAIL SURVIVAL AT 16 px ═══════════════════════ */

function testSmallSize(n) {
  head('5. DETAIL AT SMALL SIZES  (n=' + n + ')');
  var sizes = [16, 24, 32, 64, 96];
  line('  size   massFrac(med)   edgeComplexity(med)   coarse8 meanIoU   distinct coarse8 sigs');
  sizes.forEach(function (z) {
    var mf = [], ec = [], sigs = [], seen = {};
    for (var i = 0; i < n; i++) {
      var g = S.generateMask(null, { size: z, seed: 41000 + i });
      var m = S.measureMask(g.mask, z, z);
      mf.push(m.massFraction); ec.push(m.edgeComplexity);
      var sig = S.coarseSignature(g.mask, z, z, 8);
      if (sigs.length < 120) sigs.push(sig);
      seen[Array.prototype.join.call(sig, '')] = 1;
    }
    line('  ' + (z + 'px').padEnd(7) + f(stats(mf).median).padStart(12) +
      f(stats(ec).median).padStart(22) + f(meanPairwiseIoU(sigs)).padStart(18) +
      (Object.keys(seen).length + '/' + n).padStart(24));
  });
}

/* ═══════════════════════════ 6. DETERMINISM ═══════════════════════════════ */

function testDeterminism() {
  head('6. DETERMINISM');
  var ok = true, same = 0;
  for (var i = 0; i < 200; i++) {
    var a = S.generateMask(null, { size: 48, seed: 900 + i }).mask;
    var b = S.generateMask(null, { size: 48, seed: 900 + i }).mask;
    var eq = a.length === b.length; for (var k = 0; k < a.length && eq; k++) if (a[k] !== b[k]) eq = false;
    if (eq) same++; else ok = false;
  }
  line('  same seed + same opts -> identical mask: ' + same + '/200');
  /* rng is consumed exactly once per call: two calls from one stream differ */
  var r1 = S.makeShapeRng(4242), r2 = S.makeShapeRng(4242);
  var s1 = [S.generateMask(r1, { size: 32 }).meta.seed, S.generateMask(r1, { size: 32 }).meta.seed];
  var s2 = [S.generateMask(r2, { size: 32 }).meta.seed, S.generateMask(r2, { size: 32 }).meta.seed];
  line('  rng-driven stream reproducible: ' + (s1[0] === s2[0] && s1[1] === s2[1]) +
    '   consecutive draws differ: ' + (s1[0] !== s1[1]));
  /* opts changes must change the design */
  var base = S.generateMask(null, { size: 48, seed: 77 });
  var alt = S.generateMask(null, { size: 48, seed: 77, envelope: 'dart' });
  line('  changing an opt changes the mask: ' + (S.maskIoU(base.mask, alt.mask) < 0.999));
  return ok;
}

/* ═══════════════════════════ 7. CONFIGURABILITY ═══════════════════════════ */

function testKnobs() {
  head('7. CONFIGURABILITY — each knob measured, n=60 ships at 48px per cell');
  function run(opts, n) {
    var mf = [], ar = [], pw = [], ec = [], holes = [], sigs = [];
    for (var i = 0; i < (n || 60); i++) {
      var o = {}; for (var k in opts) o[k] = opts[k];
      o.size = 48; o.seed = 60000 + i;
      var g = S.generateMask(null, o);
      var m = S.measureMask(g.mask, 48, 48);
      mf.push(m.massFraction); ar.push(m.aspect); pw.push(m.polarityWidthRatio);
      ec.push(m.edgeComplexity); holes.push(m.holes);
      sigs.push(S.coarseSignature(g.mask, 48, 48, 8));
    }
    var seen = {};
    sigs.forEach(function (s) { seen[Array.prototype.join.call(s, '')] = 1; });
    return {
      mf: stats(mf).median, ar: stats(ar).median, pw: stats(pw).median,
      ec: stats(ec).median, holes: stats(holes).mean, iou: meanPairwiseIoU(sigs),
      distinct: Object.keys(seen).length
    };
  }
  function show(label, opts, n) {
    var r = run(opts, n);
    line('  ' + label.padEnd(34) + 'mass ' + f(r.mf) + '  aspect ' + f(r.ar) +
      '  polarityW ' + f(r.pw) + '  edgeCx ' + f(r.ec) +
      '  holes ' + f(r.holes, 2) + '  div8 ' + f(r.iou) +
      '  distinct ' + r.distinct + '/' + (n || 60));
  }
  line('  (default row first; every other row changes exactly one knob)');
  show('default', {});
  line('');
  S.SHAPE_DEFAULTS.envelopeChoices.forEach(function (e) { show('envelope=' + e, { envelope: e }); });
  line('');
  show('symmetry=mirrorXY', { symmetry: 'mirrorXY' });
  show('symmetry=radial folds=3', { symmetry: 'radial', radialFolds: 3 });
  show('symmetry=radial folds=5', { symmetry: 'radial', radialFolds: 5 });
  show('symmetry=radial cyclic folds=6', { symmetry: 'radial', radialFolds: 6, radialMirror: false });
  show('symmetry=none', { symmetry: 'none' });
  line('');
  show('noseTaper=0.0', { noseTaper: 0, noseTaperJitter: 0 });
  show('noseTaper=0.9', { noseTaper: 0.9, noseTaperJitter: 0 });
  show('tailWeight=0.0', { tailWeight: 0, tailWeightJitter: 0 });
  show('tailWeight=1.0', { tailWeight: 1, tailWeightJitter: 0 });
  show('polarityStrength=0', { polarityStrength: 0 });
  show('polarityStrength=2.5', { polarityStrength: 2.5 });
  line('');
  show('elongation=0.6 (wide)', { elongation: 0.6 });
  show('elongation=1.0', { elongation: 1.0 });
  show('elongation=2.2 (long)', { elongation: 2.2 });
  line('');
  show('envelopeCore=0 (pure CA)', { envelopeCore: 0 });
  show('envelopeCore=1.0 (envelope rules)', { envelopeCore: 1.0 });
  show('coreMinWidth=1.0 (long spikes)', { coreMinWidth: 1.0 });
  show('coreMinWidth=4.0 (blunt nose)', { coreMinWidth: 4.0 });
  show('noiseAmount=0 (smooth rim)', { noiseAmount: 0 });
  show('noiseAmount=1.1 (torn rim)', { noiseAmount: 1.1 });
  show('noiseScale=1.4 (few big lobes)', { noiseScale: 1.4, noiseScaleJitter: 0.2 });
  show('noiseScale=6 (frills)', { noiseScale: 6, noiseScaleJitter: 0.5 });
  show('wingChance=0 (no wings)', { wingChance: 0 });
  show('wingAmount=3.0 (huge wings)', { wingAmount: 3.0 });
  show('wingWidth=0.05 (thin fins)', { wingWidth: 0.05, wingWidthJitter: 0.02 });
  show('wingNegativeChance=1 (waisted)', { wingNegativeChance: 1 });
  line('');
  line('  --- CA knobs, shown with envelopeCore=0 so the automaton owns the whole shape ---');
  var raw = { envelopeCore: 0 };
  function showRaw(label, extra) {
    var o = {}; for (var k in raw) o[k] = raw[k]; for (var k2 in extra) o[k2] = extra[k2];
    show(label, o);
  }
  showRaw('core=0 baseline', {});
  showRaw('core=0 neighborhood=vonneumann', { neighborhood: 'vonneumann' });
  showRaw('core=0 neighborWeightY=1.8', { neighborWeightY: 1.8 });
  showRaw('core=0 birth=4 survive=3 (fat)', { birth: 4, survive: 3, birthJitter: 0, surviveJitter: 0 });
  showRaw('core=0 birth=6 survive=5 (lean)', { birth: 6, survive: 5, birthJitter: 0, surviveJitter: 0 });
  showRaw('core=0 iterations=0 (raw noise)', { iterations: 0, iterationsJitter: 0 });
  showRaw('core=0 iterations=1', { iterations: 1, iterationsJitter: 0 });
  showRaw('core=0 iterations=10', { iterations: 10, iterationsJitter: 0 });
  showRaw('core=0 iters=1 edgeRough=0', { iterations: 1, iterationsJitter: 0, edgeRoughness: 0 });
  showRaw('core=0 iters=1 edgeRough=1', { iterations: 1, iterationsJitter: 0, edgeRoughness: 1 });
  showRaw('core=0 fillDensity=0.40', { fillDensity: 0.40 });
  showRaw('core=0 fillDensity=0.85', { fillDensity: 0.85 });
  showRaw('core=0 edgeSoftness=0.15', { edgeSoftness: 0.15 });
  showRaw('core=0 edgeSoftness=1.2', { edgeSoftness: 1.2 });
  showRaw('core=0 envelopeClamp=1.0', { envelopeClamp: 1.0, edgeSoftness: 1.2 });
  showRaw('core=0 envelopeClamp=3.0', { envelopeClamp: 3.0, edgeSoftness: 1.2 });
  showRaw('core=0 holePolicy=keep', { holePolicy: 'keep', iterations: 1, iterationsJitter: 0, edgeRoughness: 1 });
  showRaw('core=0 holePolicy=keepLarge', { holePolicy: 'keepLarge', holeMinSize: 6, iterations: 1, iterationsJitter: 0, edgeRoughness: 1 });
  showRaw('core=0 detachedParts>=0.10', { detachedPartMinFraction: 0.10, iterations: 1, iterationsJitter: 0, edgeRoughness: 1 });
  line('');
  show('logicalSize=16 (chunky)', { logicalSize: 16 });
  show('logicalSize=48 (fine)', { logicalSize: 48 });
  show('logicalSize=64 (finest)', { logicalSize: 64 });
  show('padding=3', { padding: 3 });
  show('fillFraction=0.7', { fillFraction: 0.7 });
  show('verticalAlign=tail', { verticalAlign: 'tail' });
  show('fitToCanvas=false', { fitToCanvas: false });
  show('minMassFraction=0.25', { minMassFraction: 0.25 });
  show('cleanupRemoveSpurs=false', { cleanupRemoveSpurs: false, edgeRoughness: 1 });
}

/* ══════════════════════════════ 8. PREVIEW ════════════════════════════════ */

function testPreview() {
  head('8. ASCII PREVIEW');
  var cases = [
    { label: 'default 32px', o: { size: 32, seed: 11 } },
    { label: 'default 32px', o: { size: 32, seed: 12 } },
    { label: 'default 32px', o: { size: 32, seed: 13 } },
    { label: 'teardrop 32px', o: { size: 32, seed: 14, envelope: 'teardrop' } },
    { label: 'dart 32px', o: { size: 32, seed: 15, envelope: 'dart', elongation: 1.8 } },
    { label: 'radial5 32px', o: { size: 32, seed: 16, symmetry: 'radial', radialFolds: 5 } },
    { label: 'holes kept 32px', o: { size: 32, seed: 17, holePolicy: 'keep', envelopeCore: 0, iterations: 1, iterationsJitter: 0, edgeRoughness: 1 } },
    { label: 'satellites 32px', o: { size: 32, seed: 18, detachedPartMinFraction: 0.1, envelopeCore: 0, iterations: 1, iterationsJitter: 0, edgeRoughness: 1 } }
  ];
  var rows = cases.map(function (c) {
    var g = S.generateMask(null, c.o);
    return { head: c.label, meta: g.meta, rows: preview(g.mask, g.W, g.H) };
  });
  for (var g0 = 0; g0 < rows.length; g0 += 4) {
    var grp = rows.slice(g0, g0 + 4);
    line('  ' + grp.map(function (r) { return r.head.padEnd(34); }).join(''));
    for (var y = 0; y < 32; y++) line('  ' + grp.map(function (r) { return (r.rows[y] || '').padEnd(34); }).join(''));
    line('  ' + grp.map(function (r) {
      return (r.meta.envelope + '/' + r.meta.symmetry).padEnd(34);
    }).join(''));
  }
  /* same seed at four sizes, side by side */
  head('   same seed 4242 at 16 / 32 / 64 / 96 px');
  [16, 32, 64, 96].forEach(function (z) {
    var g = S.generateMask(null, { size: z, seed: 4242 });
    line('  --- ' + z + 'px  mass ' + f(g.meta.massFraction) + ' aspect ' + f(g.meta.aspect) +
      ' polarityW ' + f(g.meta.polarityWidthRatio) + ' ---');
    preview(g.mask, z, z).forEach(function (r) { line('  ' + r); });
  });
}

/* ═══════════════════════════════ main ════════════════════════════════════ */

var t0 = Date.now();
console.log('pixelship shape core — measured report');
var si = testSizeIndependence(300);
testPolarity(600, 32);
testDegenerate(300, [16, 20, 24, 32, 48, 64, 80, 96], 0.12);
testDegenerateStress(60);
testDiversity(120, 32);
testDiversity(120, 64);
testSmallSize(300);
testDeterminism();
testKnobs();
if (process.argv.indexOf('--preview') >= 0) testPreview();
head('done in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
