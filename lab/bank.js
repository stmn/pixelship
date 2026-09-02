/* bank.js - banking / turning poses for a composed ship.
   The shading pass already gives us a height field (chamfer distance transform),
   so a bank is a real rotation about the ship's longitudinal axis rather than a
   horizontal squash:

       x' = cx + (x - cx) * cos(t) + h * sin(t)        screen position
       z  =      (x - cx) * sin(t) - h * cos(t)        depth, for occlusion

   Pixels are splatted with a z-buffer so the near wing correctly covers the far
   one, then a 1px horizontal closing fills the cracks that any rotation opens.

   Loads as a classic <script> and via require().                              */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./shading.js'));
  else root.PixelshipBank = factory(root.PixelshipShading);
})(typeof self !== 'undefined' ? self : this, function (SH) {
'use strict';

var EMPTY = 0, OUTLINE = 4;

var DEFAULTS = {
  heightScale: 1.0,     /* how far the height field pushes pixels sideways */
  lightShift: 1.0,      /* ramp steps gained by the face rotating into the light */
  closeGaps: true,      /* fill 1px cracks the projection opens */
  keepOutline: true,    /* rebuild the silhouette outline after projecting */
};

function merge(a, b) {
  var o = {}, k;
  for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
  for (k in b || {}) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
    var v = b[k];
    if (v === undefined || (typeof v === 'number' && isNaN(v))) continue;
    o[k] = v;
  }
  return o;
}

/* ship: { W, H, mats, steps, rampSteps, mounts, ... }  angle in radians.
   Returns a NEW { mats, steps, mounts } of the same dimensions.              */
function bankShip(ship, angle, opts) {
  var o = merge(DEFAULTS, opts);
  var W = ship.W, H = ship.H, cx = (W - 1) / 2;
  var maxStep = (ship.rampSteps || 6) - 1;

  if (!angle) {
    return { mats: ship.mats, steps: ship.steps, mounts: ship.mounts, angle: 0 };
  }

  /* height field from the solid mask (outline is not part of the body) */
  var solid = new Uint8Array(W * H), i;
  for (i = 0; i < W * H; i++) solid[i] = (ship.mats[i] && ship.mats[i] !== OUTLINE) ? 1 : 0;
  var h = SH.distanceTransform(solid, W, H, true);

  var cos = Math.cos(angle), sin = Math.sin(angle);
  var mats = new Uint8Array(W * H);
  var steps = new Int8Array(W * H);
  var zbuf = new Float32Array(W * H);
  for (i = 0; i < W * H; i++) zbuf[i] = Infinity;

  /* lighting: the face turning toward the light gains steps, the other loses */
  var lightGain = o.lightShift * sin;

  /* Splat SPANS, not points. Two source pixels that are adjacent in x can land
     several pixels apart after rotation; filling the run between them is what
     keeps the hull solid instead of shredding it into stripes.               */
  function put(y, xi, z, mat, step) {
    if (xi < 0 || xi >= W) return;
    var q = y * W + xi;
    if (z >= zbuf[q]) return;                     /* something nearer is already here */
    zbuf[q] = z; mats[q] = mat; steps[q] = step;
  }

  for (var y = 0; y < H; y++) {
    var prevX = -1, prevZ = 0, prevMat = 0, prevStep = 0;
    for (var x = 0; x < W; x++) {
      var p = y * W + x;
      if (!solid[p]) { prevX = -1; continue; }
      var dx = x - cx, hh = h[p] * o.heightScale;
      var xp = cx + dx * cos + hh * sin;
      var z = dx * sin - hh * cos;
      var lit = ship.steps[p] + lightGain * (dx / Math.max(1, W * 0.5));
      var st = Math.max(0, Math.min(maxStep, Math.round(lit)));
      var mat = ship.mats[p];

      if (prevX < 0) {
        put(y, Math.round(xp), z, mat, st);
      } else {
        /* walk every destination column between the previous sample and this one */
        var a = prevX, b = xp;
        var lo = Math.round(Math.min(a, b)), hi = Math.round(Math.max(a, b));
        var span = Math.max(1, hi - lo);
        for (var xi = lo; xi <= hi; xi++) {
          var t = (xi - Math.min(a, b)) / span;
          if (a > b) t = 1 - t;                   /* t always runs prev -> current */
          put(y, xi, prevZ + (z - prevZ) * t,
              t < 0.5 ? prevMat : mat,
              Math.round(prevStep + (st - prevStep) * t));
        }
      }
      prevX = xp; prevZ = z; prevMat = mat; prevStep = st;
    }
  }

  if (o.closeGaps) closeHorizontalGaps(mats, steps, zbuf, W, H);
  if (o.keepOutline) rebuildOutline(mats, W, H);

  return { mats: mats, steps: steps, mounts: projectMounts(ship, h, cx, cos, sin, o, W), angle: angle };
}

/* A rotation samples the source sparsely, leaving single-pixel cracks. Fill any
   empty pixel that has solid neighbours on BOTH sides in the same row.        */
function closeHorizontalGaps(mats, steps, zbuf, W, H) {
  for (var y = 0; y < H; y++) {
    for (var x = 1; x < W - 1; x++) {
      var p = y * W + x;
      if (mats[p] !== EMPTY) continue;
      var a = mats[p - 1], b = mats[p + 1];
      if (!a || !b || a === OUTLINE || b === OUTLINE) continue;
      mats[p] = zbuf[p - 1] <= zbuf[p + 1] ? a : b;
      steps[p] = Math.round((steps[p - 1] + steps[p + 1]) / 2);
      zbuf[p] = Math.min(zbuf[p - 1], zbuf[p + 1]);
    }
  }
}

function rebuildOutline(mats, W, H) {
  var i;
  for (i = 0; i < W * H; i++) if (mats[i] === OUTLINE) mats[i] = EMPTY;
  var src = Uint8Array.from(mats);
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var p = y * W + x;
    if (src[p] !== EMPTY) continue;
    if ((x > 0 && src[p - 1]) || (x < W - 1 && src[p + 1]) ||
        (y > 0 && src[p - W]) || (y < H - 1 && src[p + W])) mats[p] = OUTLINE;
  }
}

/* Mounts have to travel with the hull or the exhaust detaches from the ship. */
function projectMounts(ship, h, cx, cos, sin, o, W) {
  var mo = ship.mounts || {};
  function px(x, y) {
    var xi = Math.max(0, Math.min(W - 1, Math.round(x)));
    var hh = (h[y * W + xi] || 0) * o.heightScale;
    return cx + (x - cx) * cos + hh * sin;
  }
  function mapList(list, extra) {
    return (list || []).map(function (m) {
      var out = { x: px(m.x, m.y), y: m.y };
      for (var k in m) if (k !== 'x' && k !== 'y') out[k] = m[k];
      if (extra && m.width !== undefined) out.width = Math.max(1, m.width * Math.abs(cos) + 0.5);
      return out;
    });
  }
  return {
    engines: mapList(mo.engines, true),
    guns: mapList(mo.guns, false),
    lamps: mapList(mo.lamps, false),
    cockpit: mo.cockpit ? { x: px(mo.cockpit.x, mo.cockpit.y), y: mo.cockpit.y,
                            rx: mo.cockpit.rx * Math.abs(cos), ry: mo.cockpit.ry } : null,
  };
}

/* A symmetric set of poses: [-n .. +n] * step, centre first is NOT assumed -
   index 0 is the hardest left turn, the middle entry is level.               */
function bankPoses(ship, count, maxDegrees, opts) {
  count = Math.max(1, count | 0);
  if (count % 2 === 0) count += 1;                /* always keep a level pose */
  var half = (count - 1) / 2, out = [], i;
  for (i = 0; i < count; i++) {
    var t = half ? (i - half) / half : 0;
    out.push(bankShip(ship, t * maxDegrees * Math.PI / 180, opts));
  }
  return out;
}

return { bankShip: bankShip, bankPoses: bankPoses, BANK_DEFAULTS: DEFAULTS };
});
