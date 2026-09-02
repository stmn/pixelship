/* draw.js - the hand-drawn hull editor.
   Produces exactly what the generator produces: a binary mask. Everything
   downstream (mount detection, shading, palette, banking) is source-agnostic,
   so a drawn hull gets thrusters, guns, lighting and turn poses for free.

   Mirroring is on by default because bilateral symmetry is what the generator
   produces and what reads as a spaceship. It is a default, not an invariant:
   mount detection handles a broken-symmetry silhouette on purpose (see
   symmetrizeMask in lab/mounts.js) and shading is directional, so turning the
   mirror off is safe - see lab/drawn.test.js. */
(function (root) {
'use strict';

var C = root.PixelShipCompose;

var state = {
  open: false, size: 40, mask: null, brush: 1, erasing: false, drawing: false,
  onAccept: null, cell: 12, tool: 'draw', ghost: true,
  mirror: true,                  /* off = free-hand asymmetric hull */
  engineCount: 2, gunCount: 2,   /* stored with the shape, not global */
  compose: null,                 /* shading / palette options from the panel */
  frames: 8, throttle: 0.75,     /* preview animation, matched to the panel */
  view: null, raf: 0, t0: 0,     /* the animated preview and its loop */
  anchor: null,            /* last committed cell, for shift-straight lines */
  undo: [], redo: [],
};
var UNDO_MAX = 40;
var els = {};

function idx(x, y) { return y * state.size + x; }

/* one snapshot per stroke, not per pixel - undo should walk back in the units
   you drew in */
function pushUndo() {
  state.undo.push(Uint8Array.from(state.mask));
  if (state.undo.length > UNDO_MAX) state.undo.shift();
  state.redo.length = 0;
  syncHistory();
}
function undo() {
  if (!state.undo.length) return;
  state.redo.push(Uint8Array.from(state.mask));
  state.mask = state.undo.pop();
  syncHistory(); drawGrid(); drawPreview();
}
function redo() {
  if (!state.redo.length) return;
  state.undo.push(Uint8Array.from(state.mask));
  state.mask = state.redo.pop();
  syncHistory(); drawGrid(); drawPreview();
}
/* no undo buttons: Ctrl+Z is the muscle memory and the hint line says so */
function syncHistory() {}

function mirrorMask() {
  var n = state.size;
  for (var y = 0; y < n; y++) for (var x = 0; x < n / 2; x++)
    state.mask[idx(n - 1 - x, y)] = state.mask[idx(x, y)];
}

/* 4-connected flood fill; mirrored afterwards so symmetry survives it */
function fillAt(x, y, on) {
  var n = state.size, target = state.mask[idx(x, y)];
  if ((on ? 1 : 0) === target) return;
  var stack = [idx(x, y)], seen = new Uint8Array(n * n);
  while (stack.length) {
    var p = stack.pop();
    if (seen[p] || state.mask[p] !== target) continue;
    seen[p] = 1;
    state.mask[p] = on ? 1 : 0;
    var px = p % n, py = (p - px) / n;
    if (px > 0) stack.push(p - 1);
    if (px < n - 1) stack.push(p + 1);
    if (py > 0) stack.push(p - n);
    if (py < n - 1) stack.push(p + n);
  }
  if (state.mirror) mirrorMask();
}

/* Bresenham, so a shift-drag gives a clean edge instead of a wobbly freehand
   one - pixel art lives on straight lines */
function lineTo(x0, y0, x1, y1, on) {
  var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
  for (;;) {
    paintCell(x0, y0, on);
    if (x0 === x1 && y0 === y1) break;
    var e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

function paintCell(x, y, on) {
  var n = state.size, r = state.brush - 1;
  for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
    var px = x + dx, py = y + dy;
    if (px < 0 || py < 0 || px >= n || py >= n) continue;
    state.mask[idx(px, py)] = on ? 1 : 0;
    if (!state.mirror) continue;
    var mx = n - 1 - px;                       /* mirror as you draw */
    if (mx >= 0 && mx < n) state.mask[idx(mx, py)] = on ? 1 : 0;
  }
}

function drawGrid() {
  var n = state.size, c = state.cell, cv = els.grid, ctx = cv.getContext('2d');
  cv.width = n * c; cv.height = n * c;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0a0d15';
  ctx.fillRect(0, 0, cv.width, cv.height);

  /* the current ship, faint, to trace over */
  if (state.ghost && state.seedMask) {
    ctx.fillStyle = 'rgba(110,168,255,.13)';
    for (var gy = 0; gy < n; gy++) for (var gx = 0; gx < n; gx++)
      if (state.seedMask[idx(gx, gy)]) ctx.fillRect(gx * c, gy * c, c, c);
  }
  for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
    if (!state.mask[idx(x, y)]) continue;
    ctx.fillStyle = '#7f93bd';
    ctx.fillRect(x * c, y * c, c, c);
  }
  /* grid lines only when the cells are big enough for them to help */
  if (c >= 8) {
    ctx.strokeStyle = 'rgba(255,255,255,.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      ctx.moveTo(i * c + .5, 0); ctx.lineTo(i * c + .5, n * c);
      ctx.moveTo(0, i * c + .5); ctx.lineTo(n * c, i * c + .5);
    }
    ctx.stroke();
  }
  /* the symmetry axis, so you can see what you are mirroring about - drawing it
     with the mirror off would promise a symmetry that is not being applied */
  if (state.mirror) {
    ctx.strokeStyle = 'rgba(110,168,255,.35)';
    ctx.beginPath();
    ctx.moveTo((n / 2) * c + .5, 0); ctx.lineTo((n / 2) * c + .5, n * c);
    ctx.stroke();
  }
}

/* The preview box is a fixed size (see .drawPrevWrap), so the scale has to come
   from the box, not from a constant: a 96px hull frames 149px tall and used to
   be forced to 2x, which put half the ship outside the box. Measured live,
   because the modal is laid out by CSS and the box is not the same on a phone. */
/* Only used if the box is asked for its size before CSS has laid it out. These
   are the smallest it can be, read off .drawPrevWrap in index.html: width is
   the .drawRight min-width 236 less 2x8 padding; height is the min-height 260
   less that padding, the 8px gap and the 15px caption. Underestimating is the
   safe direction - a scale too small only leaves a margin, one too big clips. */
var PREV_FALLBACK_W = 220, PREV_FALLBACK_H = 221;
function previewScale(ship) {
  var host = els.preview, wrap = host.parentNode;
  /* Width comes from the wrapper, not from the host: the host is centred and
     shrink-wraps its canvas, so its own width FOLLOWS the canvas instead of
     bounding it - measuring it would let a wide hull scale itself out of the
     box. The height is honest, because the host is the flex:1 row. */
  var w = PREV_FALLBACK_W, h = host.clientHeight || PREV_FALLBACK_H;
  if (wrap && wrap.clientWidth) {
    var cs = root.getComputedStyle(wrap);
    w = wrap.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  }
  return root.PixelshipSprite.fitScale(ship, w, h, 1);
}

/* the payoff: the same mask, finished, updated as you let go of the mouse */
function drawPreview() {
  var n = state.size, mass = 0, i;
  for (i = 0; i < n * n; i++) mass += state.mask[i];
  els.mass.textContent = mass + ' px  ' + Math.round(100 * mass / (n * n)) + '%';
  els.accept.disabled = mass < n;               /* refuse to accept a doodle */

  var host = els.preview;
  host.innerHTML = '';
  state.view = null;
  if (mass < n) {
    host.appendChild(document.createTextNode('draw something'));
    return;
  }
  var ship;
  try {
    var co = state.compose || {};
    ship = C.composeShip(state.seed, n, {
      mask: { data: state.mask, W: n, H: n },
      shade: co.shade, palette: co.palette,
      mounts: C.merge(co.mounts, { engineCount: state.engineCount, gunCount: state.gunCount }),
    });
  } catch (e) { host.appendChild(document.createTextNode('could not compose')); return; }

  /* What the hull actually supports can be less than what you asked for - a
     narrow stern has nowhere to put three nozzles. This is written BEFORE the
     canvas is sized: the caption shares the fixed-height box with the preview,
     so measuring while it still holds last frame's text hands back a scale
     three pixels too generous, and the ship gets clipped. */
  var wantE = state.engineCount, gotE = ship.mounts.engines.length;
  var wantG = state.gunCount, gotG = ship.mounts.guns.length;
  els.mounts.textContent =
    'thrusters ' + gotE + (gotE < wantE ? ' of ' + wantE : '') +
    '   guns ' + gotG + (gotG < wantG ? ' of ' + wantG : '');

  var SPR = root.PixelshipSprite;
  var view = new SPR.ShipView(ship, previewScale(ship));
  state.pose = SPR.levelPoseIndex ? SPR.levelPoseIndex(ship) : undefined;
  view.drawFrame(0, state.throttle, state.pose);
  host.appendChild(view.canvas);
  state.view = view;                            /* the loop animates this one */
}

/* Lamps pulse, the cockpit breathes and the exhaust flickers, so a still frame
   undersells what you just drew. The phase is quantised to the panel's frame
   count for the same reason the gallery quantises it: what you watch here is
   frame-for-frame what the exported strip contains. The pose stays level - the
   silhouette must not move while you are judging the shape you are drawing. */
function animate() {
  state.raf = 0;
  if (!state.open) return;
  if (state.view) {
    var t = (Date.now() - state.t0) / 1000;
    var frames = Math.max(1, state.frames | 0);
    var phase = Math.floor(((t / 1.15) % 1) * frames) / frames;
    state.view.drawFrame(phase, state.throttle, state.pose);
  }
  state.raf = root.requestAnimationFrame(animate);
}
function startAnimation() {
  if (state.raf) return;
  state.t0 = Date.now();
  state.raf = root.requestAnimationFrame(animate);
}
function stopAnimation() {
  if (state.raf) root.cancelAnimationFrame(state.raf);
  state.raf = 0;
}

/* The modal is capped at MODAL_MAX_H (see .drawBox) and has to fit the screen,
   so the grid cell comes out of the height budget rather than out of the hull
   size alone: a 96px hull at the old fixed 7px/cell needed 672px of grid and
   pushed the buttons off the bottom of a laptop screen. */
var MODAL_MAX_H = 700;
var MODAL_CHROME = 112;    /* title bar, body padding and the two-line hint */
function cellFor(size) {
  var avail = Math.min(MODAL_MAX_H, (root.innerHeight || MODAL_MAX_H) * 0.96) - MODAL_CHROME;
  return Math.max(4, Math.min(16, Math.floor(avail / size)));
}

function syncMirrorHint() {
  if (!els.mirrorHint) return;
  els.mirrorHint.textContent = state.mirror
    ? ' · the shape is mirrored as you go'
    : ' · mirror off: both halves are drawn by hand';
}

function cellFromEvent(ev) {
  var r = els.grid.getBoundingClientRect();
  var x = Math.floor((ev.clientX - r.left) / (r.width / state.size));
  var y = Math.floor((ev.clientY - r.top) / (r.height / state.size));
  if (x < 0 || y < 0 || x >= state.size || y >= state.size) return null;
  return { x: x, y: y };
}

function build() {
  if (els.root) return;
  var wrap = document.createElement('div');
  wrap.className = 'drawModal';
  wrap.innerHTML =
    '<div class="drawBox">' +
      '<div class="drawHead"><span id="drawTitle"></span>' +
        '<button class="drawX" id="drawClose" title="Close">&times;</button></div>' +
      '<div class="drawBody">' +
        '<div class="drawLeft"><canvas id="drawGrid"></canvas>' +
          '<div class="drawHint">Drag to draw &middot; right-click or Alt to erase &middot; ' +
          'Shift to continue in a straight line &middot; Ctrl+Z to undo' +
          '<span id="drawMirrorHint"></span></div></div>' +
        '<div class="drawRight">' +
          '<div class="drawTools">' +
            '<span>Tool</span><div class="drawSeg" id="drawTool"></div>' +
            '<span>Brush</span><div class="drawSeg" id="drawBrush"></div>' +
            '<span>Thrusters</span><div class="drawSeg" id="drawEng"></div>' +
            '<span>Guns<em>pairs</em></span><div class="drawSeg" id="drawGun"></div>' +
          '</div>' +
          '<div class="drawSeg wide">' +
            '<button id="drawClear">Clear</button>' +
            '<button id="drawSeed">From current ship</button>' +
          '</div>' +
          '<label class="drawGhostLbl"><input type="checkbox" id="drawMirror" checked> ' +
            'Mirror while drawing</label>' +
          '<label class="drawGhostLbl"><input type="checkbox" id="drawGhost" checked> ' +
            'Show current ship underneath</label>' +
          '<div class="drawPrevWrap"><div class="drawPrev" id="drawPreview"></div>' +
            '<div class="drawMeta"><span id="drawMounts"></span><span id="drawMass"></span></div></div>' +
          '<div class="drawActions">' +
            '<button id="drawCancel">Cancel</button>' +
            '<button class="primary" id="drawAccept">Use this shape</button></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);

  els.root = wrap;
  els.grid = wrap.querySelector('#drawGrid');
  els.preview = wrap.querySelector('#drawPreview');
  els.mass = wrap.querySelector('#drawMass');
  els.mounts = wrap.querySelector('#drawMounts');
  els.accept = wrap.querySelector('#drawAccept');
  els.title = wrap.querySelector('#drawTitle');
  els.mirrorBox = wrap.querySelector('#drawMirror');
  els.mirrorHint = wrap.querySelector('#drawMirrorHint');

  ['draw', 'erase', 'fill'].forEach(function (t) {
    var btn = document.createElement('button');
    btn.textContent = t;
    btn.className = t === state.tool ? 'on' : '';
    btn.addEventListener('click', function () {
      state.tool = t;
      wrap.querySelectorAll('#drawTool button').forEach(function (n) { n.className = ''; });
      btn.className = 'on';
    });
    wrap.querySelector('#drawTool').appendChild(btn);
  });
  function counter(hostId, values, key) {
    var host = wrap.querySelector(hostId);
    values.forEach(function (v) {
      var btn = document.createElement('button');
      btn.textContent = v;
      btn.addEventListener('click', function () {
        state[key] = v;
        host.querySelectorAll('button').forEach(function (n) { n.className = ''; });
        btn.className = 'on';
        drawPreview();
      });
      host.appendChild(btn);
    });
  }
  counter('#drawEng', [1, 2, 3], 'engineCount');
  /* Guns are placed as mirrored pairs, so odd counts silently round down:
     asking for 1 gave 0 and asking for 3 gave 2, measured over 80 hulls. Only
     offer what the generator can actually deliver. */
  counter('#drawGun', [0, 2, 4], 'gunCount');
  function syncCounters() {
    [['#drawEng', 'engineCount'], ['#drawGun', 'gunCount']].forEach(function (p) {
      wrap.querySelectorAll(p[0] + ' button').forEach(function (b) {
        b.className = (parseInt(b.textContent, 10) === state[p[1]]) ? 'on' : '';
      });
    });
  }
  els.syncCounters = syncCounters;

  wrap.querySelector('#drawGhost').addEventListener('change', function (e) {
    state.ghost = e.target.checked; drawGrid();
  });
  /* Turning the mirror off leaves the mask alone - it changes what the next
     stroke does, it does not rewrite what you already drew. */
  wrap.querySelector('#drawMirror').addEventListener('change', function (e) {
    state.mirror = e.target.checked;
    syncMirrorHint(); drawGrid();
  });

  [1, 2, 3].forEach(function (b) {
    var btn = document.createElement('button');
    btn.textContent = b;
    btn.className = b === state.brush ? 'on' : '';
    btn.addEventListener('click', function () {
      state.brush = b;
      wrap.querySelectorAll('#drawBrush button').forEach(function (n) { n.className = ''; });
      btn.className = 'on';
    });
    wrap.querySelector('#drawBrush').appendChild(btn);
  });

  function press(ev) {
    var c = cellFromEvent(ev); if (!c) return;
    pushUndo();
    state.erasing = state.tool === 'erase' || ev.button === 2 || ev.altKey;

    if (state.tool === 'fill') {
      fillAt(c.x, c.y, !state.erasing);
      state.anchor = c; drawGrid(); drawPreview();
      ev.preventDefault(); return;
    }
    state.drawing = true;
    /* shift continues from the last point as a straight run */
    if (ev.shiftKey && state.anchor) lineTo(state.anchor.x, state.anchor.y, c.x, c.y, !state.erasing);
    else paintCell(c.x, c.y, !state.erasing);
    state.last = c;
    drawGrid();
    ev.preventDefault();
  }
  function move(ev) {
    if (!state.drawing) return;
    var c = cellFromEvent(ev); if (!c) return;
    /* interpolate: a fast drag skips cells and would leave gaps */
    if (state.last) lineTo(state.last.x, state.last.y, c.x, c.y, !state.erasing);
    else paintCell(c.x, c.y, !state.erasing);
    state.last = c;
    drawGrid();
  }
  function release(ev) {
    if (!state.drawing) return;
    state.drawing = false;
    if (state.last) state.anchor = state.last;
    state.last = null;
    drawPreview();
  }

  els.grid.addEventListener('pointerdown', function (ev) {
    els.grid.setPointerCapture && els.grid.setPointerCapture(ev.pointerId);
    press(ev);
  });
  els.grid.addEventListener('pointermove', move);
  els.grid.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);

  wrap.querySelector('#drawClear').addEventListener('click', function () {
    pushUndo();
    state.mask = new Uint8Array(state.size * state.size);
    drawGrid(); drawPreview();
  });
  wrap.querySelector('#drawSeed').addEventListener('click', function () {
    if (state.seedMask) { pushUndo(); state.mask = Uint8Array.from(state.seedMask); drawGrid(); drawPreview(); }
  });
  wrap.querySelector('#drawCancel').addEventListener('click', close);
  wrap.querySelector('#drawClose').addEventListener('click', close);
  els.accept.addEventListener('click', function () {
    var cb = state.onAccept;
    var m = Uint8Array.from(state.mask), n = state.size;
    var mounts = { engineCount: state.engineCount, gunCount: state.gunCount };
    close();
    if (cb) cb({ data: m, W: n, H: n }, mounts);
  });
  wrap.addEventListener('mousedown', function (ev) { if (ev.target === wrap) close(); });
  root.addEventListener('keydown', function (ev) {
    if (!state.open) return;
    if (ev.key === 'Escape') { close(); return; }
    var mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 'z') {
      if (ev.shiftKey) redo(); else undo();
      ev.preventDefault();
    }
  });
}

function open(opts) {
  build();
  state.size = opts.size || 40;
  state.seed = opts.seed || 1;
  state.onAccept = opts.onAccept || null;
  state.mask = opts.mask ? Uint8Array.from(opts.mask) : new Uint8Array(state.size * state.size);
  state.seedMask = opts.shipMask ? Uint8Array.from(opts.shipMask) : null;
  state.compose = opts.compose || null;
  state.frames = Math.max(1, (opts.frames | 0) || 8);
  state.throttle = (opts.throttle === undefined || opts.throttle === null) ? 0.75 : opts.throttle;
  var mo = opts.mounts || {};
  state.engineCount = mo.engineCount || 2;
  state.gunCount = (mo.gunCount === undefined || mo.gunCount === null) ? 2 : mo.gunCount;
  if (els.syncCounters) els.syncCounters();
  state.cell = cellFor(state.size);
  state.tool = 'draw';           /* always open on the tool you reach for first */
  state.undo.length = 0; state.redo.length = 0; state.anchor = null; state.last = null;
  els.root.querySelectorAll('#drawTool button').forEach(function (b) {
    b.className = (b.textContent === 'draw') ? 'on' : '';
  });
  syncHistory();
  els.title.textContent = 'Draw own shape  -  ' + state.size + ' x ' + state.size;
  els.root.querySelector('#drawSeed').disabled = !state.seedMask;
  /* the mirror is a per-session default, not a per-shape one: it opens on,
     which is what the generator produces and what most hulls want */
  state.mirror = true;
  if (els.mirrorBox) els.mirrorBox.checked = true;
  syncMirrorHint();
  els.root.classList.add('on');
  state.open = true;
  /* the box must be laid out before the preview measures it */
  drawGrid(); drawPreview();
  startAnimation();
}
function close() {
  if (!els.root) return;
  stopAnimation();
  state.view = null;
  els.root.classList.remove('on');
  state.open = false;
  state.drawing = false;
}

root.PixelshipDraw = { open: open, close: close, isOpen: function () { return state.open; } };
})(typeof self !== 'undefined' ? self : this);
