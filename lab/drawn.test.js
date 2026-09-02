/* drawn.test.js - hand-drawn hulls through the generator pipeline.

   The editor can draw without the mirror (Mirror while drawing, off), so an
   asymmetric mask is now a shape a user can actually hand us. Everything
   downstream was written for a mirrored CA blob, so this pins down that the
   asymmetric case composes, gets mounts and banks instead of throwing.
   Run: node lab/drawn.test.js                                                */
var C = require('./compose.js');
var B = require('./bank.js');
var S = require('./sprite.js');
var fail = 0;
function ok(c, label, detail) {
  if (!c) { fail++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
  else console.log('  ok    ' + label + (detail ? ' (' + detail + ')' : ''));
}

var N = 40;
function blank() { return new Uint8Array(N * N); }
function box(m, x0, y0, x1, y1) {
  for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) m[y * N + x] = 1;
  return m;
}
function mass(m) { var s = 0; for (var i = 0; i < m.length; i++) s += m[i]; return s; }
/* how far the mask is from its own mirror, in pixels */
function asymmetry(m) {
  var d = 0;
  for (var y = 0; y < N; y++) for (var x = 0; x < N; x++)
    if (m[y * N + x] !== m[y * N + (N - 1 - x)]) d++;
  return d;
}

/* a plain fuselage, then the same hull with one wing only */
var sym = box(blank(), 16, 6, 23, 33);
box(sym, 4, 20, 16, 26); box(sym, 23, 20, 35, 26);
var asym = box(blank(), 16, 6, 23, 33);
box(asym, 4, 20, 16, 26);                       /* left wing, nothing on the right */

console.log('\n== fixtures ==');
ok(asymmetry(sym) === 0, 'control hull is mirror-symmetric');
ok(asymmetry(asym) > 100, 'test hull is genuinely asymmetric', asymmetry(asym) + ' px differ');

function compose(mask) {
  return C.composeShip(4242, N, { mask: { data: mask, W: N, H: N },
                                  mounts: { engineCount: 2, gunCount: 2 } });
}

console.log('\n== asymmetric hull composes ==');
var ship = null, err = null;
try { ship = compose(asym); } catch (e) { err = e; }
ok(!err, 'composeShip does not throw on an asymmetric mask', err ? err.message : '');
if (ship) {
  ok(ship.W === N && ship.H === N, 'frame keeps the drawn dimensions', ship.W + 'x' + ship.H);
  var painted = 0;
  for (var i = 0; i < ship.mats.length; i++) if (ship.mats[i]) painted++;
  ok(painted >= mass(asym), 'every drawn pixel survives into the material map',
     painted + ' materials vs ' + mass(asym) + ' drawn');
  ok(ship.mounts.engines.length > 0, 'the asymmetric hull still gets thrusters',
     ship.mounts.engines.length + ' engines');
  ok(ship.mounts.guns.length > 0, 'the asymmetric hull still gets guns',
     ship.mounts.guns.length + ' guns');
  /* Mounts must be anchored to the hull, not floating in the empty half. What
     counts as anchored differs per kind: a gun's y is the muzzle TIP and is
     meant to stick out past the nose (mounts.js:11), so its baseY is the pixel
     that has to be solid; an engine sits at the stern edge, so the row above it
     counts too. */
  function onHull(x, y) {
    x = Math.round(x); y = Math.round(y);
    return x >= 0 && y >= 0 && x < N && y < N && !!asym[y * N + x];
  }
  var off = 0;
  (ship.mounts.guns || []).forEach(function (g) {
    if (!onHull(g.x, g.baseY)) off++;
    if (g.y >= g.baseY) off++;                 /* the muzzle has to point forward */
  });
  (ship.mounts.engines || []).forEach(function (e) {
    if (!onHull(e.x, e.y) && !onHull(e.x, e.y - 1)) off++;
  });
  ok(off === 0, 'every mount is anchored to the drawn hull', off + ' stray mounts');

  /* the empty half must stay empty: nothing may be invented where nothing was drawn */
  var invented = 0;
  (ship.mounts.engines || []).concat(ship.mounts.guns || []).forEach(function (m) {
    var x = Math.round(m.x), y = Math.round(m.baseY !== undefined ? m.baseY : m.y);
    if (x >= 0 && x < N && y >= 0 && y < N && !asym[y * N + x] && !onHull(x, y - 1)) invented++;
  });
  ok(invented === 0, 'no mount is placed in the half that was left blank',
     invented + ' mounts in empty space');
}

console.log('\n== asymmetric hull banks ==');
var poses = null; err = null;
try { poses = B.bankPoses(ship, 5, 40, { heightScale: 1.6 }); } catch (e) { err = e; }
ok(!err, 'bankPoses does not throw on an asymmetric hull', err ? err.message : '');
ok(poses && poses.length === 5, 'five poses come back', poses ? String(poses.length) : 'none');
if (poses) {
  var empty = poses.filter(function (p) {
    for (var i = 0; i < p.mats.length; i++) if (p.mats[i]) return false;
    return true;
  }).length;
  ok(empty === 0, 'no pose comes out blank', empty + ' blank poses');
}

console.log('\n== the symmetric control still works ==');
var ctrl = null; err = null;
try { ctrl = compose(sym); } catch (e) { err = e; }
ok(!err && ctrl && ctrl.mounts.engines.length > 0, 'mirrored hull composes with thrusters',
   err ? err.message : (ctrl ? ctrl.mounts.engines.length + ' engines' : ''));

console.log('\n== the preview fits its box ==');
if (ship) {
  var s = S.fitScale(ship, 212, 176, 1);
  ok(S.frameWidth(ship) * s <= 212 && S.frameHeight(ship) * s <= 176,
     'a drawn hull is previewed at a scale that fits',
     s + 'x -> ' + (S.frameWidth(ship) * s) + 'x' + (S.frameHeight(ship) * s));
}

console.log('\n' + (fail === 0 ? 'ALL CHECKS PASSED' : fail + ' CHECK(S) FAILED') + '\n');
process.exit(fail ? 1 : 0);
