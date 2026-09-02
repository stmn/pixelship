/* ============================================================================
 * pixelship / lab / mounts.test.js
 *
 * Measures lab/mounts.js over real cellular-automata blobs taken from the
 * existing prototype (generateA), across sizes 16..96.
 *
 *   node /Users/darek/Code/pixelship/lab/mounts.test.js
 *
 * The CA masks come from the prototype itself (no re-implementation): the
 * <script> body of prototype-ab.html up to "METODA B" is evaluated in a
 * sandboxed Function, and the pre-mount silhouette is recovered from the
 * returned material grid (OUTLINE only paints EMPTY, GUN only paints above the
 * column top, everything else paints in place -> mask = m !== EMPTY/OUTLINE/GUN).
 * ==========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');
const { detectMounts, validateMounts, MOUNT_DEFAULTS } = require('./mounts.js');

const PROTO = path.join(__dirname, '..', 'prototype-ab.html');

/* ------------------------------------------------ load generateA from the HTML */
function loadPrototype() {
  const html = fs.readFileSync(PROTO, 'utf8');
  const start = html.indexOf('function mulberry32');
  const end = html.indexOf('METODA B');
  if (start < 0 || end < 0) throw new Error('cannot locate prototype script body');
  const src = html.slice(start, html.lastIndexOf('/*', end));
  const factory = new Function(
    src + '\nreturn { mulberry32, makePalette, generateA, EMPTY, OUTLINE, GUN, COCKPIT };'
  );
  return factory();
}
const P = loadPrototype();

/* silhouette of the CA blob, before any mount was stamped */
function maskOf(ship) {
  const { g, W, H } = ship;
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const v = g[i];
    m[i] = (v !== P.EMPTY && v !== P.OUTLINE && v !== P.GUN) ? 1 : 0;
  }
  return m;
}

function bottomProfile(mask, W, H) {
  const bot = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++)
    for (let y = H - 1; y >= 0; y--) if (mask[y * W + x]) { bot[x] = y; break; }
  return bot;
}

/* ------------------------------------------------------------------ corpus */
const SIZES = [16, 20, 24, 32, 40, 48, 64, 80, 96];
const PER_SIZE = 200;                      /* 9 * 200 = 1800 masks */

function buildCorpus() {
  const corpus = [];
  for (const S of SIZES) {
    for (let s = 0; s < PER_SIZE; s++) {
      const r = P.mulberry32(0x9E37 + s * 2654435761 + S * 40503);
      const pal = P.makePalette(r);
      const ship = P.generateA(r, S, S, pal);
      corpus.push({ size: S, seed: s, ship, mask: maskOf(ship) });
    }
  }
  return corpus;
}

/* ------------------------------------------------------------- aggregation */
function newTally() {
  return {
    n: 0, empty: 0,
    zeroEngines: 0, engineTotal: 0, engineOffHull: 0,
    engBottomStrict: 0, engBottomTolerant: 0,
    multiEngineShips: 0, mergedShips: 0,
    gunTotal: 0, gunOffHull: 0, shipsWithGuns: 0,
    cockpitFail: 0, cockpitOffHull: 0, cockpitPixels: 0, cockpitAreaFracSum: 0, cockpitN: 0,
    lampTotal: 0, lampOffHull: 0, shipsWithLamps: 0,
    symViol: 0, symViolOnSymMask: 0, asymMasks: 0, nozzleWidthSum: 0,
    fallbacks: {}
  };
}
function addTally(t, mask, W, H, res, v) {
  t.n++;
  if (res.meta.empty) { t.empty++; return; }
  const asym = res.meta.symmetryBroken;
  if (asym) t.asymMasks++; else t.symViolOnSymMask += v.symmetryViolations;
  for (const e of res.engines) t.nozzleWidthSum += e.width;
  if (res.engines.length === 0) t.zeroEngines++;
  t.engineTotal += v.engineTotal;
  t.engineOffHull += v.engineOffHull;
  t.engBottomStrict += v.engineBottomStrict;
  t.engBottomTolerant += v.engineBottomTolerant;
  if (res.engines.length > 1) { t.multiEngineShips++; if (v.mergedNozzlePairs > 0) t.mergedShips++; }
  t.gunTotal += res.guns.length;
  t.gunOffHull += v.gunOffHull;
  if (res.guns.length) t.shipsWithGuns++;
  if (!res.cockpit) t.cockpitFail++;
  else {
    t.cockpitOffHull += v.cockpitOffHull;
    t.cockpitPixels += res.cockpit.pixels;
    t.cockpitAreaFracSum += res.cockpit.pixels / Math.max(1, res.meta.area);
    t.cockpitN++;
  }
  t.lampTotal += res.lamps.length;
  t.lampOffHull += v.lampOffHull;
  if (res.lamps.length) t.shipsWithLamps++;
  t.symViol += v.symmetryViolations;
  const fb = res.meta.engineFallback;
  t.fallbacks[fb] = (t.fallbacks[fb] || 0) + 1;
}

function pct(a, b) { return b === 0 ? '  n/a ' : (100 * a / b).toFixed(2).padStart(6) + '%'; }

/* --------------------------------------------------------------- test runs */
function run(corpus, opts, label) {
  const perSize = new Map(SIZES.map(s => [s, newTally()]));
  const all = newTally();
  const t0 = process.hrtime.bigint();
  for (const c of corpus) {
    const res = detectMounts(c.mask, c.size, c.size, opts);
    const v = validateMounts(c.mask, c.size, c.size, res, opts);
    addTally(perSize.get(c.size), c.mask, c.size, c.size, res, v);
    addTally(all, c.mask, c.size, c.size, res, v);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { label, opts, perSize, all, ms };
}

function printRun(r) {
  const a = r.all, live = a.n - a.empty;
  console.log('\n### ' + r.label);
  console.log('  masks .................. ' + a.n + '  (empty CA blobs: ' + a.empty + ')');
  console.log('  zero-engine ships ...... ' + a.zeroEngines + ' / ' + live + '   ' + pct(a.zeroEngines, live));
  console.log('  engines placed ......... ' + a.engineTotal);
  console.log('  engine mounts off-hull . ' + a.engineOffHull + '   ' + pct(a.engineOffHull, a.engineTotal));
  console.log('  NOT on bottom edge (A strict: every nozzle column ends exactly at the silhouette bottom)');
  console.log('                           ' + (a.engineTotal - a.engBottomStrict) + '   ' + pct(a.engineTotal - a.engBottomStrict, a.engineTotal));
  console.log('  NOT on bottom edge (B tolerant: hull extends <=1px below the nozzle exit)');
  console.log('                           ' + (a.engineTotal - a.engBottomTolerant) + '   ' + pct(a.engineTotal - a.engBottomTolerant, a.engineTotal));
  console.log('  merged nozzles (count>1) ' + a.mergedShips + ' / ' + a.multiEngineShips + '   ' + pct(a.mergedShips, a.multiEngineShips));
  console.log('  guns placed / off-hull . ' + a.gunTotal + ' / ' + a.gunOffHull + '   ' + pct(a.gunOffHull, a.gunTotal));
  console.log('  lamps placed / off-hull  ' + a.lampTotal + ' / ' + a.lampOffHull + '   ' + pct(a.lampOffHull, a.lampTotal));
  console.log('  cockpit off-hull ....... ' + a.cockpitOffHull);
  console.log('  mean cockpit size ...... ' + (a.cockpitPixels / Math.max(1, a.cockpitN)).toFixed(1) + ' px = ' + (100 * a.cockpitAreaFracSum / Math.max(1, a.cockpitN)).toFixed(1) + '% of hull area');
  console.log('  mean nozzle width ...... ' + (a.nozzleWidthSum / Math.max(1, a.engineTotal)).toFixed(2) + ' px');
  console.log('  one-sided (non-mirror) masks ... ' + a.asymMasks);
  console.log('  symmetry violations .... ' + a.symViol + '  (on mirror-symmetric masks: ' + a.symViolOnSymMask + ')');
  console.log('  engine fallback usage .. ' + JSON.stringify(a.fallbacks));
  console.log('  runtime ................ ' + r.ms.toFixed(0) + ' ms for ' + a.n + ' masks (' + (r.ms / a.n).toFixed(3) + ' ms/mask)');
  console.log('  per size:');
  console.log('    size  live  zeroEng  cockpitFail  engNotBottomA  merged  guns/ship  lamps/ship  symViol');
  for (const S of SIZES) {
    const t = r.perSize.get(S), l = t.n - t.empty;
    console.log('    ' + String(S).padStart(4) + '  ' + String(l).padStart(4) +
      '  ' + pct(t.zeroEngines, l) +
      '   ' + pct(t.cockpitFail, l) +
      '      ' + pct(t.engineTotal - t.engBottomStrict, t.engineTotal) +
      '   ' + pct(t.mergedShips, t.multiEngineShips) +
      '   ' + (t.gunTotal / Math.max(1, l)).toFixed(2).padStart(6) +
      '     ' + (t.lampTotal / Math.max(1, l)).toFixed(2).padStart(6) +
      '     ' + String(t.symViol).padStart(4));
  }
}

/* ------------------------------------------------------- baseline (current) */
function runBaseline(corpus) {
  const perSize = new Map(SIZES.map(s => [s, { n: 0, empty: 0, zero: 0, eng: 0, notBottomA: 0, notBottomB: 0, off: 0, merged: 0, multi: 0, cockFail: 0, sym: 0, gunOff: 0, gunN: 0, lampOff: 0, lampN: 0 }]));
  for (const c of corpus) {
    const W = c.size, H = c.size, t = perSize.get(W);
    t.n++;
    let any = false;
    for (let i = 0; i < c.mask.length; i++) if (c.mask[i]) { any = true; break; }
    if (!any) { t.empty++; continue; }
    const bot = bottomProfile(c.mask, W, H);
    const eng = c.ship.engines || [];
    if (eng.length === 0) t.zero++;
    const spans = [];
    for (const e of eng) {
      t.eng++;
      const a = Math.round(e.x - (e.w - 1) / 2), b = a + e.w - 1;
      spans.push({ a, b });
      let strict = true, tol = true, on = true;
      for (let x = a; x <= b; x++) {
        if (x < 0 || x >= W || e.y < 0 || e.y >= H || !c.mask[e.y * W + x]) { on = false; break; }
        if (bot[x] !== e.y) strict = false;
        if (bot[x] - e.y > 1) tol = false;
      }
      if (!on) t.off++;
      if (!on || !strict) t.notBottomA++;
      if (!on || !tol) t.notBottomB++;
    }
    spans.sort((p, q) => p.a - q.a);
    if (eng.length > 1) {
      t.multi++;
      for (let i = 1; i < spans.length; i++) if (spans[i].a - spans[i - 1].b - 1 < 1) { t.merged++; break; }
    }
    /* baseline symmetry: engine centre set must mirror */
    const key = new Set(eng.map(e => (Math.round(e.x * 2) + ':' + e.y)));
    for (const e of eng) if (!key.has(Math.round((2 * ((W - 1) / 2) - e.x) * 2) + ':' + e.y)) t.sym++;
    /* baseline cockpit: did stampCockpit actually write anything? */
    let hasCock = false;
    for (let i = 0; i < c.ship.g.length; i++) if (c.ship.g[i] === P.COCKPIT) { hasCock = true; break; }
    if (!hasCock) t.cockFail++;
    /* baseline guns / lamps on hull */
    for (const g of (c.ship.guns || [])) {
      t.gunN++;
      const bx = Math.round(g.x);
      let baseY = -1;
      for (let y = 0; y < H; y++) if (c.mask[y * W + bx]) { baseY = y; break; }
      if (baseY < 0) t.gunOff++;
    }
    for (const l of (c.ship.lamps || [])) {
      t.lampN++;
      if (!c.mask[l.y * W + l.x]) t.lampOff++;
    }
    /* baseline gun symmetry */
    const gs = (c.ship.guns || []).map(g => Math.round(g.x));
    const gset = new Set(gs);
    for (const gx of gs) if (!gset.has(W - 1 - gx)) t.sym++;
  }
  console.log('\n### BASELINE - mount logic currently inside generateA()');
  console.log('    size  live  zeroEng  engNotBottomA  engNotBottomB  engOffHull  merged  cockpitFail  gunOff  lampOff  symViol');
  let A = { n: 0, empty: 0, zero: 0, eng: 0, nbA: 0, nbB: 0, off: 0, merged: 0, multi: 0, cf: 0, sym: 0, gunOff: 0, gunN: 0, lampOff: 0, lampN: 0 };
  for (const S of SIZES) {
    const t = perSize.get(S), l = t.n - t.empty;
    A.n += t.n; A.empty += t.empty; A.zero += t.zero; A.eng += t.eng; A.nbA += t.notBottomA;
    A.nbB += t.notBottomB; A.off += t.off; A.merged += t.merged; A.multi += t.multi;
    A.cf += t.cockFail; A.sym += t.sym; A.gunOff += t.gunOff; A.gunN += t.gunN;
    A.lampOff += t.lampOff; A.lampN += t.lampN;
    console.log('    ' + String(S).padStart(4) + '  ' + String(l).padStart(4) +
      '  ' + pct(t.zero, l) + '      ' + pct(t.notBottomA, t.eng) + '       ' + pct(t.notBottomB, t.eng) +
      '     ' + pct(t.off, t.eng) + '  ' + pct(t.merged, t.multi) + '     ' + pct(t.cockFail, l) +
      '  ' + pct(t.gunOff, t.gunN) + '  ' + pct(t.lampOff, t.lampN) + '   ' + String(t.sym).padStart(4));
  }
  const live = A.n - A.empty;
  console.log('    ALL   ' + String(live).padStart(4) + '  ' + pct(A.zero, live) + '      ' + pct(A.nbA, A.eng) +
    '       ' + pct(A.nbB, A.eng) + '     ' + pct(A.off, A.eng) + '  ' + pct(A.merged, A.multi) +
    '     ' + pct(A.cf, live) + '  ' + pct(A.gunOff, A.gunN) + '  ' + pct(A.lampOff, A.lampN) + '   ' + String(A.sym).padStart(4));
  console.log('    (empty CA blobs excluded from "live": ' + A.empty + ')');
  return A;
}

/* ---------------------------------------------------------- determinism check */
function determinismCheck(corpus) {
  let mismatch = 0;
  for (let i = 0; i < 200; i++) {
    const c = corpus[i * 9 % corpus.length];
    const a = JSON.stringify(detectMounts(c.mask, c.size, c.size, {}));
    const b = JSON.stringify(detectMounts(c.mask, c.size, c.size, {}));
    if (a !== b) mismatch++;
  }
  return mismatch;
}

/* ------------------------------------------------- engine-count fidelity check */
function countFidelity(corpus, n) {
  const hist = {};
  let live = 0;
  for (const c of corpus) {
    const res = detectMounts(c.mask, c.size, c.size, { engineCount: n });
    if (res.meta.empty) continue;
    live++;
    hist[res.engines.length] = (hist[res.engines.length] || 0) + 1;
  }
  return { n, live, hist };
}

/* ============================================================== main ====== */
console.log('pixelship / mount detection test');
console.log('corpus: generateA (CA) at sizes ' + SIZES.join(',') + ' x ' + PER_SIZE + ' seeds = ' + SIZES.length * PER_SIZE + ' masks');

const corpus = buildCorpus();
let live = 0, emptyN = 0;
for (const c of corpus) {
  let any = false;
  for (let i = 0; i < c.mask.length; i++) if (c.mask[i]) { any = true; break; }
  if (any) live++; else emptyN++;
}
console.log('non-empty masks: ' + live + ', empty CA blobs: ' + emptyN);

runBaseline(corpus);

const runs = [
  run(corpus, {}, 'DEFAULTS (engineCount=2, gunCount=2, lampCount=2, cockpit on)'),
  run(corpus, { nozzleBotSpread: 2 }, 'nozzleBotSpread=2  (wider nozzles, looser bottom contact)'),
  run(corpus, { engineCount: 1 }, 'engineCount=1'),
  run(corpus, { engineCount: 3 }, 'engineCount=3'),
  run(corpus, { gunCount: 0, cockpitWanted: false, lampCount: 0 }, 'alien profile: no guns, no cockpit, no lamps'),
  run(corpus, { gunCount: 4, minSizeGuns: 16, minSizeCockpit: 0, minSizeLamps: 0 }, 'all features forced on at every size, gunCount=4')
];
runs.forEach(printRun);

console.log('\n### engine-count fidelity (how many nozzles actually came out)');
for (const n of [1, 2, 3]) {
  const f = countFidelity(corpus, n);
  const parts = Object.keys(f.hist).sort().map(k => k + ':' + f.hist[k] + ' (' + (100 * f.hist[k] / f.live).toFixed(1) + '%)');
  console.log('  engineCount=' + n + ' -> ' + parts.join('  '));
}

console.log('\n### determinism');
console.log('  repeated detectMounts mismatches over 200 masks: ' + determinismCheck(corpus));

console.log('\n### knob count');
console.log('  tunable options exposed: ' + Object.keys(MOUNT_DEFAULTS).length);

/* --------------------------------------------------------------- assertions */
const D = runs[0].all, Dlive = D.n - D.empty;
const checks = [
  ['zero engines on non-empty masks == 0', D.zeroEngines === 0, D.zeroEngines],
  ['engine mounts off-hull == 0', D.engineOffHull === 0, D.engineOffHull],
  ['gun mounts off-hull == 0', D.gunOffHull === 0, D.gunOffHull],
  ['lamp mounts off-hull == 0', D.lampOffHull === 0, D.lampOffHull],
  ['cockpit off-hull == 0', D.cockpitOffHull === 0, D.cockpitOffHull],
  ['symmetry violations on mirror-symmetric masks == 0', D.symViolOnSymMask === 0, D.symViolOnSymMask],
  ['merged nozzles == 0', D.mergedShips === 0, D.mergedShips],
  ['engines within <=1px of bottom edge (criterion B) == 100%', D.engBottomTolerant === D.engineTotal, D.engineTotal - D.engBottomTolerant],
  ['deterministic', determinismCheck(corpus) === 0, 0]
];
console.log('\n### assertions');
let fail = 0;
for (const [name, ok, v] of checks) {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '   (got ' + v + ')'));
  if (!ok) fail++;
}
console.log(fail === 0 ? '\nALL ASSERTIONS PASS' : '\n' + fail + ' ASSERTION(S) FAILED');
process.exit(fail === 0 ? 0 : 1);
