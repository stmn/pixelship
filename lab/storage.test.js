/* storage.test.js - sanitiser behaviour, run under node (no localStorage needed).
   Run: node lab/storage.test.js                                              */
var S = require('../app/storage.js');
var fail = 0;
function ok(c, label, detail) {
  if (!c) { fail++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
  else console.log('  ok    ' + label + (detail ? ' (' + detail + ')' : ''));
}
var hints = { 'shape.wingAmount': 'number', 'shape.symmetry': 'string', 'mounts.cockpitWanted': 'boolean',
              'palette.rampName': 'string' };

console.log('\n== storage sanitiser ==');
ok(S._sanitizeState(null, hints) === null, 'null input rejected');
ok(S._sanitizeState('garbage', hints) === null, 'non-object rejected');
ok(S._sanitizeState(42, hints) === null, 'number rejected');

var good = S._sanitizeState({ seed: 7, size: 48, preset: 'Shard',
  over: { shape: { wingAmount: 3.2, symmetry: 'radial' }, palette: { rampName: null } },
  locks: { 0: 1234, 2: -99 } }, hints);
ok(good.seed === 7 && good.size === 48 && good.preset === 'Shard', 'valid scalars survive');
ok(good.over.shape.wingAmount === 3.2 && good.over.shape.symmetry === 'radial', 'valid overrides survive');
ok(good.over.palette.rampName === null, 'null survives (means "generator picks")');
ok(good.locks[0] === 1234 && good.locks[2] === -99, 'locks survive');

var bad = S._sanitizeState({ seed: 'text', size: NaN, count: Infinity, preset: 5,
  over: { shape: { wingAmount: 'wide', unknownKnob: 3, symmetry: 7 } },
  locks: { a: 'x', 1: 'y', 2: NaN } }, hints);
ok(bad.seed === undefined, 'string seed dropped');
ok(bad.size === undefined, 'NaN size dropped');
ok(bad.count === undefined, 'Infinity dropped');
ok(bad.preset === undefined, 'wrong-typed preset dropped');
ok(bad.over.shape.wingAmount === undefined, 'string in a numeric knob dropped');
ok(bad.over.shape.symmetry === undefined, 'number in a string knob dropped');
ok(bad.over.shape.unknownKnob === undefined, 'unknown knob dropped');
ok(Object.keys(bad.locks).length === 0, 'malformed locks dropped');

console.log('\n== recipe ids ==');
var a = S.recipeId(1, 40, 'Raider', { shape: { wingAmount: 2 } });
var b = S.recipeId(1, 40, 'Raider', { shape: { wingAmount: 2 } });
var c = S.recipeId(1, 40, 'Raider', { shape: { wingAmount: 3 } });
ok(a === b, 'same recipe gives the same id');
ok(a !== c, 'a changed knob gives a different id', a + ' vs ' + c);
ok(S.recipeId(1, 40, 'Raider', {}) !== S.recipeId(2, 40, 'Raider', {}), 'seed changes the id');

console.log('\n== storage unavailable (node has no localStorage) ==');
ok(S.available === false, 'availability probe returns false instead of throwing');
ok(S.loadState(hints) === null, 'loadState degrades to null');
ok(Array.isArray(S.loadLibrary()) && S.loadLibrary().length === 0, 'loadLibrary degrades to []');
ok(S.saveState({ seed: 1, over: {}, locks: {} }).ok === false, 'saveState reports failure, does not throw');

console.log('\n' + (fail === 0 ? 'ALL CHECKS PASSED' : fail + ' CHECK(S) FAILED') + '\n');
process.exit(fail ? 1 : 0);
