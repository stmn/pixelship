/* sprite.test.js - sheet geometry. A fleet sheet stacks whole strips, and a
   strip is poseCount(ship) rows tall, not one. Getting this wrong overpaints
   every ship with the next one's level pose.
   Run: node lab/sprite.test.js                                               */
var C = require('./compose.js');
var B = require('./bank.js');
var S = require('./sprite.js');
var fail = 0;
function ok(c, label, detail) {
  if (!c) { fail++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
  else console.log('  ok    ' + label + (detail ? ' (' + detail + ')' : ''));
}

var FRAMES = 8, POSES = 5, SIZE = 40;
var fleet = [];
for (var i = 0; i < 6; i++) {
  var ship = C.composeShip((1337 + i * 2654435761) | 0, SIZE, {});
  ship.poses = B.bankPoses(ship, POSES, 40, { heightScale: 1.6 });
  fleet.push(ship);
}

console.log('\n== sheet layout ==');
var L = S.sheetLayout(fleet, FRAMES);
ok(L.cells.length === fleet.length, 'one cell per ship', L.cells.length + ' cells');

var expectH = 0, expectW = 0, allRows = 0;
fleet.forEach(function (s) {
  expectH += S.frameHeight(s) * S.poseCount(s);
  expectW = Math.max(expectW, S.frameWidth(s) * FRAMES);
  allRows += S.poseCount(s);
});
ok(L.h === expectH, 'sheet is tall enough for every pose of every ship',
   L.h + ' vs ' + expectH + ' (' + allRows + ' rows)');
ok(L.w === expectW, 'sheet is wide enough for every frame', L.w + ' vs ' + expectW);

var overlap = 0, gap = 0, cursor = 0;
L.cells.forEach(function (c, k) {
  if (c.y < cursor) overlap++;
  if (c.y > cursor) gap++;
  cursor = c.y + c.h;
  if (c.h !== S.frameHeight(fleet[k]) * S.poseCount(fleet[k])) overlap++;
});
ok(overlap === 0, 'no ship overpaints another', overlap + ' overlapping cells');
ok(gap === 0, 'no wasted rows between ships', gap + ' gaps');
ok(cursor === L.h, 'cells fill the sheet exactly', cursor + ' vs ' + L.h);

console.log('\n== fit scale ==');
/* The editor preview lives in a fixed 250px box; whatever comes back has to fit
   in BOTH axes at every hull size, or the ship is clipped. */
var BOX_W = 212, BOX_H = 176;
var big = C.composeShip(1337, 96, {});      /* frame 96 x 149 */
var small = C.composeShip(1337, 40, {});    /* frame 40 x 62  */
ok(S.frameHeight(big) === 149, 'sanity: a 96px hull frames at 149px', String(S.frameHeight(big)));

var sBig = S.fitScale(big, BOX_W, BOX_H, 1);
ok(sBig === 1, '96px hull scales to 1x, not the old hardcoded 2x', sBig + 'x');
ok(S.frameHeight(big) * sBig <= BOX_H, '96px hull fits the box vertically',
   (S.frameHeight(big) * sBig) + ' <= ' + BOX_H);

var sSmall = S.fitScale(small, BOX_W, BOX_H, 1);
ok(S.frameHeight(small) * sSmall <= BOX_H && S.frameHeight(small) * (sSmall + 1) > BOX_H,
   '40px hull takes the largest scale that still fits', sSmall + 'x -> ' + (S.frameHeight(small) * sSmall) + 'px');

/* a wide hull must be capped by width, not by height */
var wide = { W: 200, H: 20, poses: null };
ok(S.fitScale(wide, BOX_W, BOX_H, 1) === 1, 'width caps the scale of a wide hull',
   String(S.fitScale(wide, BOX_W, BOX_H, 1)));

ok(S.fitScale(big, 10, 10, 1) === 1, 'never returns 0 for a box too small to fit');
ok(S.fitScale(big, 0, 0, 2) === 2, 'an unmeasured box falls back to the minimum', String(S.fitScale(big, 0, 0, 2)));
ok(S.fitScale(small, BOX_W, BOX_H, 1) >= 1 && S.fitScale(small, BOX_W, BOX_H, 1) % 1 === 0,
   'scale is a whole number, so pixels stay square');

console.log('\n== single-pose fleet ==');
var flat = fleet.map(function (s) { var o = Object.create(s); o.poses = null; return o; });
var F = S.sheetLayout(flat, FRAMES);
ok(F.h === S.frameHeight(fleet[0]) * flat.length, 'unbanked ships stack one row each',
   F.h + ' vs ' + (S.frameHeight(fleet[0]) * flat.length));

console.log('\n' + (fail === 0 ? 'ALL CHECKS PASSED' : fail + ' CHECK(S) FAILED') + '\n');
process.exit(fail ? 1 : 0);
