/* knobs.test.js - proves every control in the panel actually changes the output.
   A knob that does nothing is a lie in the UI. Run: node lab/knobs.test.js      */
var C = require('./compose.js');
var CONTROLS = require('./controls.js').CONTROLS;
var P = require('./palette.js');

var SEEDS = 14, SIZE = 44;

/* Everything the renderer can see: geometry, shade steps AND colours. */
function fingerprint(ship) {
  var h = 2166136261, i;
  for (i = 0; i < ship.mats.length; i++) {
    h ^= ship.mats[i]; h = Math.imul(h, 16777619);
    h ^= ship.steps[i] + 3; h = Math.imul(h, 16777619);
  }
  var pal = ship.pal, parts = [pal.accent, pal.glow, pal.outline].concat(pal.ramp);
  for (i = 0; i < parts.length; i++) {
    var c = parts[i] || [0, 0, 0];
    h ^= c[0] + c[1] * 7 + c[2] * 13; h = Math.imul(h, 16777619);
  }
  var mo = ship.mounts;
  h ^= mo.engines.length * 31 + mo.guns.length * 17 + (mo.cockpit ? 5 : 0) + mo.lamps.length;
  return h >>> 0;
}

/* Three probe points, not two: cyclic knobs (hue rotation, light azimuth) have
   min === max in effect, and a two-point probe calls them dead by mistake. */
function probeValues(item) {
  if (item.type === 'range') return [item.min, (item.min + item.max) / 2, item.max];
  if (item.type === 'bool') return [false, true];
  var opts = (item.options || P.PALETTE_RAMP_NAMES).slice();
  if (item.nullAt !== undefined && opts.indexOf(item.nullAt) < 0) opts.unshift(item.nullAt);
  return opts.length > 2 ? [opts[0], opts[1], opts[opts.length - 1]] : opts;
}

function fpAt(item, value, seed) {
  var over = {};
  over[item.target] = {};
  over[item.target][item.key] = (item.nullAt !== undefined && value === item.nullAt) ? null : value;
  return fingerprint(C.composeShip(seed, SIZE, over));
}
/* live if ANY pair of probe points disagrees on ANY seed */
function differs(item, values) {
  var changed = 0;
  for (var s = 0; s < SEEDS; s++) {
    var seed = (s * 2654435761 + 11) | 0, fps = [], i;
    for (i = 0; i < values.length; i++) {
      try { fps.push(fpAt(item, values[i], seed)); }
      catch (e) { return { err: 'throws at ' + values[i] + ': ' + e.message }; }
    }
    for (i = 1; i < fps.length; i++) if (fps[i] !== fps[0]) { changed++; break; }
  }
  return { changed: changed, of: SEEDS };
}

var dead = [], broken = [], live = 0;
console.log('\nprobing every panel control (' + SEEDS + ' seeds each, size ' + SIZE + ')\n');
CONTROLS.forEach(function (grp) {
  grp.items.forEach(function (item) {
    if (item.target === 'app') return;             /* app-level knobs are not composition inputs */
    var v = probeValues(item);
    var r = differs(item, v);
    var label = (grp.group + ' / ' + item.label).padEnd(42);
    if (r.err) { broken.push(item.key); console.log('  BROKEN ' + label + r.err); return; }
    if (r.changed === 0) { dead.push(grp.group + ' / ' + item.label + '  [' + item.target + '.' + item.key + ']');
      console.log('  DEAD   ' + label + '[' + v.join(', ') + '] : no change in ' + r.of + ' ships'); return; }
    live++;
    console.log('  live   ' + label + r.changed + '/' + r.of + ' ships changed');
  });
});

console.log('\nlive ' + live + '  dead ' + dead.length + '  broken ' + broken.length);
if (dead.length) { console.log('\nDEAD KNOBS:'); dead.forEach(function (d) { console.log('  - ' + d); }); }
process.exit(dead.length + broken.length ? 1 : 0);
