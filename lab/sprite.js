/* sprite.js - the ONE pixel renderer in the project.

   Everything that turns a composed ship into pixels lives here: the animated
   materials (LAMP pulse, COCKPIT glow, NOZZLE heat), the engine exhaust, and
   the canvas-owning ShipView convenience wrapper the tool and the intro use.
   The mini game renders through this file too, so there is never a second,
   quietly diverging copy of the shading maths.

   LOOPING: every oscillator is an integer harmonic of `phase` (0..1), so a
   strip baked at f/frames closes seamlessly. Do not introduce a term whose
   period is not 1 in phase.

   Loads as a classic <script> (browser) and via require() (node). The buffer
   helpers are DOM-free; only ShipView touches a canvas.                      */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./compose.js'));
  else root.PixelshipSprite = factory(root.PixelShipCompose);
})(typeof self !== 'undefined' ? self : this, function (C) {
'use strict';

var MAT = C.MATERIALS;

/* ══════════════════════════ buffer geometry ══════════════════════════
   A sprite frame is the hull plus a strip of empty rows underneath for the
   flame. Both the live view and the baked strip use the same geometry, so a
   frame exported from the tool drops straight into the game.                 */
function flameZone(H) { return Math.max(6, Math.round(H * 0.55)); }
function frameWidth(ship) { return ship.W; }
function frameHeight(ship) { return ship.H + flameZone(ship.H); }

/* A paint target is anything with { width, height, data } - an ImageData in
   the browser, or this plain object under node / in a worker. */
function makeSpriteBuffer(W, H, zone) {
  if (zone === undefined || zone === null) zone = flameZone(H);
  var bw = W, bh = H + zone;
  var Buf = typeof Uint8ClampedArray !== 'undefined' ? Uint8ClampedArray : Uint8Array;
  return { width: bw, height: bh, zone: zone, data: new Buf(bw * bh * 4) };
}

/* ══════════════════════════ looping oscillators ══════════════════════════ */
function loopNoise(phase, k) {
  var t = 2 * Math.PI * phase;
  return Math.sin(t + k * 0.83) * 0.55 + Math.sin(2 * t + k * 2.31) * 0.30 + Math.sin(3 * t + k * 4.11) * 0.15;
}
function clamp255(v) { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; }
function mulRGB(c, k, add) { add = add || 0;
  return [clamp255(c[0] * k + add), clamp255(c[1] * k + add), clamp255(c[2] * k + add)]; }

function px(img, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  var i = (y * img.width + x) * 4, d = img.data;
  d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
}

/* ══════════════════════════ poses ══════════════════════════
   A ship may carry a bank set (lab/bank.js). Index 0 is the hardest left turn,
   the middle entry is level; an unbanked ship behaves as a single level pose. */
function poseList(ship) {
  return ship.poses || [{ mats: ship.mats, steps: ship.steps, mounts: ship.mounts }];
}
function poseCount(ship) { return poseList(ship).length; }
function levelPoseIndex(ship) { return (poseCount(ship) - 1) / 2 | 0; }
function poseAt(ship, poseIndex) {
  var poses = poseList(ship);
  var i = poseIndex === undefined ? ((poses.length - 1) / 2 | 0) : poseIndex;
  return poses[Math.max(0, Math.min(poses.length - 1, i))];
}

/* ══════════════════════════ painting ══════════════════════════ */
/* One animation frame of `ship` in `pose`, at `phase` (0..1) and `throttle`
   (0..1), into the paint target `img`. Clears the target first. */
function paintFrame(img, ship, pose, phase, throttle, pal) {
  pal = pal || ship.pal;
  var W = ship.W, H = ship.H, steps = ship.rampSteps;
  img.data.fill(0);

  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var p = y * W + x, m = pose.mats[p];
    if (m === MAT.EMPTY) continue;
    var c = C.colorFor(m, pose.steps[p], pal, steps);
    if (m === MAT.LAMP) {
      var k = 0.35 + 0.65 * Math.pow(Math.sin(2 * Math.PI * phase + x * 0.7) * 0.5 + 0.5, 3);
      c = mulRGB(c, k, 22);
    } else if (m === MAT.COCKPIT) {
      c = mulRGB(c, 0.88 + 0.12 * Math.sin(2 * Math.PI * phase));
    } else if (m === MAT.NOZZLE && throttle > 0) {
      var heat = throttle * (0.6 + 0.4 * (loopNoise(phase, x) * 0.5 + 0.5));
      c = [clamp255(c[0] + (pal.glow[0] - c[0]) * heat),
           clamp255(c[1] + (pal.glow[1] - c[1]) * heat),
           clamp255(c[2] + (pal.glow[2] - c[2]) * heat)];
    }
    px(img, x, y, c);
  }

  if (throttle > 0.02) paintExhaust(img, ship, pose, phase, throttle, pal);
  return img;
}

/* Flames hang off the pose's own engine mounts, so a banked ship's exhaust
   follows the wing it belongs to. */
function paintExhaust(img, ship, pose, phase, thr, pal) {
  pal = pal || ship.pal;
  var H = ship.H;
  var core = [255, 250, 232], mid = pal.glow, acc = pal.accent;
  var tail = [Math.round(acc[0] * 0.75), Math.round(acc[1] * 0.4), Math.round(acc[2] * 0.42)];
  var maxLen = H * 0.42 * thr;
  var frame = Math.round(phase * 64);
  var engines = ((pose && pose.mounts) ? pose.mounts : ship.mounts).engines;
  for (var e = 0; e < engines.length; e++) {
    var en = engines[e];
    var half = (en.width - 1) / 2;
    for (var x = Math.round(en.x - half); x <= Math.round(en.x + half); x++) {
      var off = half > 0 ? Math.abs(x - en.x) / (half + 0.5) : 0;
      var L = maxLen * (1 - off * off * 0.85) * (0.72 + 0.34 * loopNoise(phase, e * 3.1 + x * 0.9));
      for (var i = 0; i < L; i++) {
        var f = i / Math.max(1, L);
        if (f > 0.62 && ((x + i + frame) % 2)) continue;
        if (f > 0.85 && ((x * 2 + i) % 3)) continue;
        px(img, x, en.y + 1 + i, f < 0.18 ? core : f < 0.5 ? mid : tail);
      }
    }
  }
}

/* ══════════════════════════ sheet geometry ══════════════════════════
   A baked strip is a grid: column = animation frame, row = bank pose, so it is
   poseCount(ship) rows tall - not one. A fleet sheet stacks whole strips, and
   the cell heights have to follow, or every ship is overpainted by the next
   one's level pose and the sheet comes out as a collage. DOM-free so the
   layout can be tested under node. */
function sheetLayout(ships, frames) {
  var cells = [], W = 0, y = 0;
  for (var i = 0; i < ships.length; i++) {
    var s = ships[i];
    var w = frameWidth(s) * frames, h = frameHeight(s) * poseCount(s);
    cells.push({ x: 0, y: y, w: w, h: h });
    if (w > W) W = w;
    y += h;
  }
  return { w: W, h: y, cells: cells };
}

/* Largest whole scale that keeps a whole frame inside boxW x boxH. Whole
   numbers only - a fractional scale resamples pixel art into mush. `min` is the
   floor for a box that has not been measured yet (clientWidth 0 before layout);
   an honest 1x beats a clipped ship, so callers pass 1 unless they know better. */
function fitScale(ship, boxW, boxH, min) {
  min = min || 1;
  var w = frameWidth(ship), h = frameHeight(ship);
  if (!(boxW > 0) || !(boxH > 0) || !w || !h) return min;
  var s = Math.min(Math.floor(boxW / w), Math.floor(boxH / h));
  return s < min ? min : s;
}

/* ══════════════════════════ ShipView ══════════════════════════
   Owns a 1:1 canvas and its ImageData, and scales through CSS so the pixels
   stay crisp. Browser only - everything above it works headless.             */
function ShipView(ship, scale) {
  this.ship = ship;
  this.zone = flameZone(ship.H);
  this.bw = frameWidth(ship); this.bh = frameHeight(ship);
  this.canvas = document.createElement('canvas');
  this.canvas.width = this.bw; this.canvas.height = this.bh;
  this.setScale(scale);
  this.ctx = this.canvas.getContext('2d');
  this.img = this.ctx.createImageData(this.bw, this.bh);
}
ShipView.prototype.setScale = function (s) {
  this.canvas.style.width = (this.bw * s) + 'px';
  this.canvas.style.height = (this.bh * s) + 'px';
};
ShipView.prototype.drawFrame = function (phase, throttle, poseIndex) {
  this.pose = poseAt(this.ship, poseIndex);
  paintFrame(this.img, this.ship, this.pose, phase, throttle, this.ship.pal);
  this.ctx.putImageData(this.img, 0, 0);
};

return {
  ShipView: ShipView,
  makeSpriteBuffer: makeSpriteBuffer,
  paintFrame: paintFrame,
  paintExhaust: paintExhaust,
  flameZone: flameZone,
  frameWidth: frameWidth,
  frameHeight: frameHeight,
  poseAt: poseAt,
  poseCount: poseCount,
  sheetLayout: sheetLayout,
  fitScale: fitScale,
  levelPoseIndex: levelPoseIndex,
  loopNoise: loopNoise,
  px: px,
};
});
