/* verify.js - end-to-end checks on the shipped configuration.
   Run: node lab/verify.js                                                    */
var C = require('./compose.js');
var F = require('./families.js');

var SIZES = [16, 24, 32, 48, 64, 96];
var SEEDS = 40;
var fail = 0;

function ok(cond, label, detail) {
  if (!cond) { fail++; console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : '')); }
  else console.log('  ok    ' + label + (detail ? '  (' + detail + ')' : ''));
}

/* normalised 16x16 silhouette for size-independence comparison */
function sig(ship) {
  var W = ship.W, H = ship.H, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var m = ship.mats[y * W + x];
    if (!m || m === 4) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  var bw = x1 - x0 + 1, bh = y1 - y0 + 1, N = 16, out = new Uint8Array(N * N);
  for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
    var sx = x0 + Math.floor(i * bw / N), sy = y0 + Math.floor(j * bh / N);
    var v = ship.mats[sy * W + sx];
    out[j * N + i] = (v && v !== 4) ? 1 : 0;
  }
  return out;
}
function iou(a, b) {
  var inter = 0, uni = 0;
  for (var i = 0; i < a.length; i++) { if (a[i] && b[i]) inter++; if (a[i] || b[i]) uni++; }
  return uni ? inter / uni : 1;
}
function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; }

console.log('\n== 1. every family composes at every size ==');
F.PRESETS.forEach(function (p) {
  var errs = 0, noEng = 0, empty = 0, n = 0;
  SIZES.forEach(function (size) {
    for (var s = 0; s < SEEDS; s++) {
      n++;
      try {
        var ship = C.composeShip((s * 2654435761) | 0, size, p.opts);
        if (!ship.mounts.engines.length) noEng++;
        var mass = 0;
        for (var i = 0; i < ship.mats.length; i++) if (ship.mats[i] && ship.mats[i] !== 4) mass++;
        if (mass < size) empty++;
      } catch (e) { errs++; if (errs === 1) console.log('      first throw: ' + e.message); }
    }
  });
  ok(errs === 0 && noEng === 0 && empty === 0,
     'family ' + p.name, n + ' ships, throws=' + errs + ' noEngine=' + noEng + ' tiny=' + empty);
});

console.log('\n== 2. size independence: same seed, different sizes ==');
F.PRESETS.forEach(function (p) {
  var scores = [];
  for (var s = 0; s < SEEDS; s++) {
    var seed = (s * 2654435761) | 0;
    var base = sig(C.composeShip(seed, 32, p.opts));
    if (!base) continue;
    [16, 64, 96].forEach(function (sz) {
      var o = sig(C.composeShip(seed, sz, p.opts));
      if (o) scores.push(iou(base, o));
    });
  }
  var m = median(scores);
  ok(m >= 0.80, 'family ' + p.name + ' silhouette IoU across sizes', 'median ' + m.toFixed(3));
});

console.log('\n== 3. determinism ==');
var d1 = C.composeShip(4242, 48, {}), d2 = C.composeShip(4242, 48, {});
var identical = d1.mats.length === d2.mats.length;
for (var i = 0; identical && i < d1.mats.length; i++)
  if (d1.mats[i] !== d2.mats[i] || d1.steps[i] !== d2.steps[i]) identical = false;
ok(identical, 'same seed + options gives byte-identical ship');

console.log('\n== 4. undefined / NaN options do not poison the config ==');
var clean = C.composeShip(777, 48, {});
var poisoned = C.composeShip(777, 48, {
  shape: { wingAmount: undefined, elongationMin: NaN },
  shade: { contrast: undefined, rampSteps: NaN },
  mounts: { engineCount: undefined },
});
var same = clean.mats.length === poisoned.mats.length;
for (var j = 0; same && j < clean.mats.length; j++) if (clean.mats[j] !== poisoned.mats[j]) same = false;
ok(same, 'undefined/NaN overrides fall back to defaults');

console.log('\n== 5. mount sanity ==');
var offHull = 0, asym = 0, tot = 0;
SIZES.forEach(function (size) {
  for (var s = 0; s < SEEDS; s++) {
    var ship = C.composeShip((s * 7919 + 13) | 0, size, {});
    tot++;
    var W = ship.W, H = ship.H;
    ship.mounts.engines.forEach(function (e) {
      var x = Math.round(e.x), y = Math.round(e.y);
      if (x < 0 || y < 0 || x >= W || y >= H) { offHull++; return; }
      if (!ship.mats[y * W + x]) offHull++;
    });
    /* engines must be mirror-symmetric as a set */
    var xs = ship.mounts.engines.map(function (e) { return Math.round(e.x * 2); }).sort();
    var mir = ship.mounts.engines.map(function (e) { return Math.round((W - 1 - e.x) * 2); }).sort();
    if (xs.join(',') !== mir.join(',')) asym++;
  }
});
ok(offHull === 0, 'thruster mounts land on hull', tot + ' ships, off-hull ' + offHull);
ok(asym === 0, 'thruster mounts are mirror-symmetric', 'violations ' + asym);

console.log('\n== 6. shading is mirror-symmetric ==');
F.PRESETS.forEach(function (p) {
  var bad = 0, tot = 0;
  SIZES.forEach(function (size) {
    for (var s = 0; s < 12; s++) {
      var ship = C.composeShip((s * 2654435761) | 0, size, p.opts);
      var W = ship.W, H = ship.H;
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var a = y * W + x, b = y * W + (W - 1 - x);
        if (!ship.mats[a] || ship.mats[a] === 4) continue;
        tot++;
        if (ship.mats[a] !== ship.mats[b] || ship.steps[a] !== ship.steps[b]) bad++;
      }
    }
  });
  ok(bad === 0, 'family ' + p.name + ' shading mirror-exact', tot + ' px, mismatches ' + bad);
});

console.log('\n== 7. no cockpit by default ==');
var withCockpit = 0;
SIZES.forEach(function (size) {
  for (var s = 0; s < 20; s++) if (C.composeShip((s * 31 + 7) | 0, size, {}).mounts.cockpit) withCockpit++;
});
ok(withCockpit === 0, 'cockpit is off unless asked for', 'found ' + withCockpit);
var forced = C.composeShip(1234, 48, { mounts: { cockpitWanted: true } });
ok(!!forced.mounts.cockpit, 'cockpit still available when enabled');

console.log('\n== 8. banking poses ==');
var B = require('./bank.js');
var badLevel = 0, holes = 0, offHull = 0, nPose = 0;
SIZES.forEach(function (size) {
  for (var s = 0; s < 10; s++) {
    var ship = C.composeShip((s * 2654435761) | 0, size, {});
    var poses = B.bankPoses(ship, 5, 40, { heightScale: 1.6 });
    nPose += poses.length;
    /* the middle pose must be the untouched original */
    var mid = poses[2], same = true;
    for (var i = 0; i < ship.mats.length && same; i++) if (mid.mats[i] !== ship.mats[i]) same = false;
    if (!same) badLevel++;
    /* a banked hull must stay one solid run per row - no shredding */
    poses.forEach(function (p) {
      var W = ship.W, H = ship.H;
      for (var y = 0; y < H; y++) {
        var runs = 0, inRun = false;
        for (var x = 0; x < W; x++) {
          var m = p.mats[y * W + x], solid = m && m !== 4;
          if (solid && !inRun) runs++;
          inRun = solid;
        }
        if (runs > 3) holes++;      /* 1-3 runs is normal (wings can detach visually) */
      }
      p.mounts.engines.forEach(function (e) {
        if (e.x < -1 || e.x > W + 1) offHull++;
      });
    });
  }
});
ok(badLevel === 0, 'level pose is byte-identical to the unbanked ship', 'deviations ' + badLevel);
ok(holes === 0, 'banked hulls stay solid (no shredding)', nPose + ' poses, bad rows ' + holes);
ok(offHull === 0, 'thruster mounts stay in frame when banked', 'strays ' + offHull);
var b1 = B.bankShip(C.composeShip(99, 48, {}), 0.6, {});
var b2 = B.bankShip(C.composeShip(99, 48, {}), 0.6, {});
var det = true;
for (var bi = 0; bi < b1.mats.length && det; bi++) if (b1.mats[bi] !== b2.mats[bi]) det = false;
ok(det, 'banking is deterministic');

console.log('\n' + (fail === 0 ? 'ALL CHECKS PASSED' : fail + ' CHECK(S) FAILED') + '\n');
process.exit(fail ? 1 : 0);
