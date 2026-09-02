/* Pixelship - application layer.
   Owns presets, the control panel and export. Ship composition lives in
   lab/compose.js and the pixel renderer in lab/sprite.js, so node, the browser
   tool and the game all share one copy of each. */
(function () {
'use strict';

var C = window.PixelShipCompose;
var SPRITE = window.PixelshipSprite;
var ShipView = SPRITE.ShipView;   /* the only renderer - see lab/sprite.js */

/* ══════════════════════════ presets ══════════════════════════
   A preset is a partial options object. Everything not named here falls back
   to the measured tuning in compose.js.                                      */
var PRESETS = window.PixelshipFamilies.PRESETS;

/* ══════════════════════════ control schema ══════════════════════════ */
var CONTROLS = window.PixelshipControls.CONTROLS;

/* ══════════════════════════ state ══════════════════════════ */
var state = {
  seed: 1337, size: 40, count: 8, frames: 8, throttle: 0.75,
  bankPoses: 5, bankAngle: 40, bankHeight: 1.6,
  diverseSampling: true,
  preset: 'Raider',
  over: { shape: {}, shade: {}, mounts: {}, palette: {} },
  selected: 0,
  locks: {},        /* slot index -> pinned seed. Randomize leaves these alone. */
  drawn: [],        /* hand-drawn hulls: packed masks, kept out of the re-roll */
  drawnSelected: -1, /* index into drawn, or -1 when a generated ship is selected */
  picks: {},        /* slot index -> seed chosen by the diverse-fleet sampler */
};
function seedForSlot(i) {
  if (state.locks[i] !== undefined) return state.locks[i];
  if (state.picks[i] !== undefined) return state.picks[i];
  return (state.seed + i * 2654435761) | 0;
}
/* captured before the session is restored, so Reset has something true to
   fall back to */
var DEFAULT_STATE = JSON.parse(JSON.stringify(state));

var fleet = [], views = [], heroView = null;
var drawnShips = [];              /* composed hand-drawn hulls, parallel to state.drawn */

/* One notion of "the selected ship" so the hero, the exports and the mount
   file all agree, whether it came out of the generator or out of the editor. */
function selectedShip() {
  if (state.drawnSelected >= 0 && drawnShips[state.drawnSelected]) return drawnShips[state.drawnSelected];
  return fleet[state.selected];
}
var STORE = window.PixelshipStorage;
var library = STORE.loadLibrary();
var libraryOpen = false;

/* restore the previous session before anything is built */
/* type map straight from the panel schema, so storage validation and the UI
   can never disagree about what a knob is */
var TYPE_HINTS = (function () {
  var m = {};
  CONTROLS.forEach(function (grp) {
    grp.items.forEach(function (item) {
      if (item.target === 'app') return;
      m[item.target + '.' + item.key] =
        item.type === 'range' ? 'number' : item.type === 'bool' ? 'boolean' : 'string';
    });
  });
  return m;
})();

(function restoreState() {
  var saved = STORE.loadState(TYPE_HINTS);
  if (!saved) return;
  for (var k in saved) {
    if (k === 'over' || k === 'locks') continue;
    if (Object.prototype.hasOwnProperty.call(saved, k)) state[k] = saved[k];
  }
  if (saved.over) state.over = saved.over;
  if (saved.locks) state.locks = saved.locks;
})();

var saveTimer = null, storageNote = '';
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    saveTimer = null;
    var r = STORE.saveState(state);
    storageNote = r.ok ? '' : (r.reason === 'quota' ? 'storage full' : 'storage unavailable');
  }, 400);
}

function presetByName(n) {
  for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].name === n) return PRESETS[i];
  return PRESETS[0];
}
function effectiveOpts() {
  var p = presetByName(state.preset).opts;
  return {
    shape: C.merge(p.shape, state.over.shape),
    shade: C.merge(p.shade, state.over.shade),
    mounts: C.merge(p.mounts, state.over.mounts),
    palette: C.merge(p.palette, state.over.palette),
  };
}
function defaultFor(item) {
  if (item.target === 'app') return state[item.key];
  var p = presetByName(state.preset).opts[item.target] || {};
  if (p[item.key] !== undefined) return p[item.key];
  var tuning = item.target === 'shape' ? C.SHAPE_TUNING
             : item.target === 'shade' ? C.SHADE_TUNING
             : item.target === 'mounts' ? C.MOUNT_TUNING : {};
  if (tuning[item.key] !== undefined) return tuning[item.key];
  var mod = item.target === 'shape' ? window.SHAPE_DEFAULTS
          : item.target === 'shade' ? window.DEFAULTS
          : item.target === 'mounts' ? window.MOUNT_DEFAULTS
          : window.PALETTE_DEFAULTS;
  return mod ? mod[item.key] : undefined;
}
function currentValue(item) {
  if (item.target === 'app') return state[item.key];
  var o = state.over[item.target];
  return o[item.key] !== undefined ? o[item.key] : defaultFor(item);
}

/* ══════════════════════════ build + render ══════════════════════════ */
function scaleFor(size) { return Math.max(1, Math.round(120 / size)); }

function rebuildFleet() {
  var opts = effectiveOpts();
  fleet = []; views = [];
  var gal = document.getElementById('gallery');
  gal.innerHTML = '';
  var errs = 0;
  gal.appendChild(makeDrawTile());
  drawnShips.length = 0;
  state.drawn.forEach(function (rec, di) { addDrawnTile(gal, rec, di); });
  if (state.drawnSelected >= state.drawn.length) state.drawnSelected = -1;

  for (var i = 0; i < state.count; i++) {
    var seed = seedForSlot(i);
    var ship;
    try {
      ship = C.composeShip(seed, state.size, opts);
      ship.poses = buildPoses(ship);
    }
    catch (err) { errs++; continue; }
    fleet.push(ship);
    var v = new ShipView(ship, scaleFor(state.size));
    views.push(v);
    var tile = document.createElement('div');
    tile.setAttribute('data-slot', String(i));
    tile.className = 'tile' + (i === state.selected ? ' sel' : '') +
                     (state.locks[i] !== undefined ? ' locked' : '');
    tile.appendChild(v.canvas);
    var tools = document.createElement('div');
    tools.className = 'tileTools';

    var savedNow = isSaved(ship, opts);
    if (savedNow) tile.classList.add('saved');
    var starBtn = document.createElement('button');
    starBtn.className = 'tool star';
    starBtn.appendChild(window.Icons.icon('bookmark', 13));
    starBtn.title = savedNow ? 'Saved to library - click to remove' : 'Save to library';
    (function (sh) {
      starBtn.addEventListener('click', function (ev) { ev.stopPropagation(); toggleSave(sh); });
    })(ship);
    tools.appendChild(starBtn);

    var isLocked = state.locks[i] !== undefined;
    var lockBtn = document.createElement('button');
    lockBtn.className = 'tool lock';
    lockBtn.appendChild(window.Icons.icon(isLocked ? 'lock' : 'lock-open', 13));
    lockBtn.title = isLocked ? 'Locked - Randomize and Diverse fleet skip it' : 'Lock so re-rolls skip it';
    (function (idx, sd) {
      lockBtn.addEventListener('click', function (ev) { ev.stopPropagation(); toggleLock(idx, sd); });
    })(i, seed);
    tools.appendChild(lockBtn);

    tile.appendChild(tools);

    (function (idx) { tile.addEventListener('click', function () { select(idx); }); })(i);
    gal.appendChild(tile);
  }
  if (state.selected >= fleet.length) state.selected = 0;
  buildHero();
  if (errs) notify(errs + ' ship' + (errs > 1 ? 's' : '') + ' failed to generate', true);
  else if (storageNote) { notify(storageNote, true); storageNote = ''; }
  persist();
}
function buildHero() {
  var wrap = document.getElementById('hero').parentNode;
  var ship = selectedShip();
  if (!ship) return;
  var scale = Math.max(2, Math.floor(300 / SPRITE.frameHeight(ship)));
  heroView = new ShipView(ship, scale);
  heroView.canvas.id = 'hero';
  var old = document.getElementById('hero');
  old.parentNode.replaceChild(heroView.canvas, old);
  var m = ship.meta || {};
  document.getElementById('heroMeta').innerHTML =
    (m.custom ? '<b>hand-drawn hull</b>' : 'seed <b>' + ship.seed + '</b>') +
    ' &middot; <b>' + ship.W + '&times;' + ship.H + '</b><br>' +
    'thrusters <b>' + ship.mounts.engines.length + '</b> &middot; guns <b>' + ship.mounts.guns.length +
    '</b> &middot; cockpit <b>' + (ship.mounts.cockpit ? 'yes' : 'no') + '</b><br>' +
    'mass <b>' + (m.massFraction != null ? (m.massFraction * 100).toFixed(1) + '%' : '-') +
    '</b> &middot; aspect <b>' + (m.aspect != null ? m.aspect.toFixed(2) : '-') + '</b>';
}
/* Bank poses are expensive to project, so each ship keeps its own set and the
   renderer just indexes into it. Index 0 is the hardest left turn. */
function buildPoses(ship) {
  var n = Math.max(1, state.bankPoses | 0);
  if (n < 2 || state.bankAngle <= 0) return [{ mats: ship.mats, steps: ship.steps, mounts: ship.mounts, angle: 0 }];
  return window.PixelshipBank.bankPoses(ship, n, state.bankAngle, { heightScale: state.bankHeight });
}

/* ══════════════════════════ saved-ship library ══════════════════════════
   A saved ship is a RECIPE, not an image: seed + size + preset + options.
   A few hundred bytes, and it regenerates in about 2ms.                     */
function recipeOf(ship, opts) {
  return {
    id: STORE.recipeId(ship.seed, state.size, state.preset, opts),
    seed: ship.seed, size: state.size, preset: state.preset,
    opts: opts, savedAt: Date.now(),
  };
}
function isSaved(ship, opts) {
  var id = STORE.recipeId(ship.seed, state.size, state.preset, opts);
  for (var i = 0; i < library.length; i++) if (library[i].id === id) return true;
  return false;
}
/* The animation loop draws whatever is in `views`. rebuildFleet() clears that
   array, so calling it AFTER renderLibrary() silently orphans the library
   canvases and they stop being painted - that is the "ship turns black" bug.
   Everything now goes through here so the order cannot be got wrong again. */
/* Anything that produces a NEW fleet has to bring the fleet back into view -
   otherwise it quietly rebuilds a hidden gallery and looks broken. */
function showFleet() {
  if (libraryOpen) setLibraryOpen(false);   /* this rebuilds on the way out */
  else rebuildFleet();
}

function refreshView() {
  if (libraryOpen) { views.length = 0; renderLibrary(); }
  else rebuildFleet();
}

function toggleSave(ship) {
  var opts = effectiveOpts();
  var rec = recipeOf(ship, opts);
  var at = -1, i;
  for (i = 0; i < library.length; i++) if (library[i].id === rec.id) { at = i; break; }
  if (at >= 0) library.splice(at, 1); else library.push(rec);
  var r = STORE.saveLibrary(library);
  if (!r.ok) storageNote = r.reason === 'quota' ? 'storage full' : 'storage unavailable';
  else if (r.dropped > 0) { library = library.slice(-STORE.LIB_MAX); storageNote = 'oldest ' + r.dropped + ' dropped'; }
  refreshView();
}
function deleteSaved(id) {
  library = library.filter(function (e) { return e.id !== id; });
  STORE.saveLibrary(library);
  refreshView();
}
/* Loading a saved ship restores the whole recipe, not just the seed - otherwise
   you get the same seed under different knobs, which is a different ship. */
function loadSaved(rec) {
  state.seed = rec.seed;
  state.size = rec.size;
  state.preset = rec.preset;
  state.over = {
    shape: rec.opts.shape || {}, shade: rec.opts.shade || {},
    mounts: rec.opts.mounts || {}, palette: rec.opts.palette || {},
  };
  state.locks = {};
  document.getElementById('seed').value = String(state.seed);
  buildPanel();
  setLibraryOpen(false);
  rebuildFleet();
}
function renderLibrary() {
  var box = document.getElementById('library');
  box.innerHTML = '';
  if (!library.length) {
    var e = document.createElement('div');
    e.className = 'empty';
    e.textContent = STORE.available
      ? 'Nothing saved yet. Hover a ship and hit the bookmark to keep it - the seed and every slider are stored, so it comes back exactly.'
      : 'Browser storage is unavailable here, so ships cannot be saved.';
    box.appendChild(e);
    return;
  }
  for (var i = library.length - 1; i >= 0; i--) {
    (function (rec) {
      var ship;
      try { ship = C.composeShip(rec.seed, rec.size, rec.opts); ship.poses = buildPoses(ship); }
      catch (err) { return; }
      var v = new ShipView(ship, scaleFor(rec.size));
      views.push(v);
      var tile = document.createElement('div');
      tile.className = 'tile saved';
      tile.title = rec.preset + ' - seed ' + rec.seed + ' at ' + rec.size + 'px';
      tile.appendChild(v.canvas);
      tile.addEventListener('click', function () { loadSaved(rec); });
      var tools = document.createElement('div');
      tools.className = 'tileTools';
      var del = document.createElement('button');
      del.className = 'tool danger';
      del.appendChild(window.Icons.icon('trash-2', 13));
      del.title = 'Remove from library';
      del.addEventListener('click', function (ev) { ev.stopPropagation(); deleteSaved(rec.id); });
      tools.appendChild(del);
      tile.appendChild(tools);
      box.appendChild(tile);
    })(library[i]);
  }
}
function setLibraryOpen(open) {
  libraryOpen = open;
  document.getElementById('gallery').hidden = open;
  document.getElementById('library').hidden = !open;
  refreshView();
}

/* ══════════════════════════ diverse fleet ══════════════════════════
   Independent random seeds cluster: a batch of 16 contains near-duplicates.
   Mitchell best-candidate fixes that cheaply - for each slot generate K
   candidates and keep the one least similar to everything already accepted. */
var DIVERSE_CANDIDATES = 5;


/* Recomputes which seeds fill the unlocked slots. Deterministic in state.seed,
   so calling it twice with the same seed gives the same fleet - that is why it
   is NOT a button. It runs when the seed, preset or fleet size changes. */
function refreshPicks() {
  state.picks = {};
  if (!state.diverseSampling) return;
  var opts = effectiveOpts();
  var accepted = [], i, k;
  for (i = 0; i < state.count; i++) {
    if (state.locks[i] !== undefined) {                 /* locked ships are fixed points */
      try { accepted.push(C.silhouette(C.composeShip(state.locks[i], state.size, opts), 8)); }
      catch (e) { /* skip */ }
      continue;
    }
    var bestSeed = null, bestSig = null, bestScore = Infinity;
    for (k = 0; k < DIVERSE_CANDIDATES; k++) {
      var cand = (state.seed + i * 2654435761 + k * 40503 * (i + 7)) | 0;
      var sig;
      try { sig = C.silhouette(C.composeShip(cand, state.size, opts), 8); }
      catch (e) { continue; }
      var worst = 0;
      for (var a2 = 0; a2 < accepted.length; a2++) {
        var v = C.silhouetteIoU(sig, accepted[a2]);
        if (v > worst) worst = v;
      }
      if (worst < bestScore) { bestScore = worst; bestSeed = cand; bestSig = sig; }
    }
    if (bestSeed !== null) { state.picks[i] = bestSeed; accepted.push(bestSig); }
  }
}

/* ══════════════════════════ hand-drawn hulls ══════════════════════════
   A drawn hull is just a mask, and everything downstream is source-agnostic,
   so it gets mount detection, shading, palette and bank poses like any other. */
/* A ship reduced to its outline - reads as an empty hull waiting for you.
   The canvas matches a real tile's frame exactly (hull plus exhaust strip) so
   this tile is the same size as every other one in the gallery. */
function skeletonCanvas(size, scale) {
  var SPR = window.PixelshipSprite;
  var cv = document.createElement('canvas');
  var ship;
  try { ship = C.composeShip(20260809, size, {}); } catch (e) { return cv; }
  var fw = ship.W, fh = SPR ? SPR.frameHeight(ship) : ship.H;
  cv.width = fw; cv.height = fh;
  var ctx = cv.getContext('2d');
  var img = ctx.createImageData(fw, fh);

  /* Centre the outline in the frame. The hull only occupies the top part of a
     sprite frame - the rest is the exhaust strip - so drawing it at its native
     position leaves it stuck to the top of the tile. */
  var y0 = 1e9, y1 = -1, x, y;
  for (y = 0; y < ship.H; y++) for (x = 0; x < fw; x++) {
    if (ship.mats[y * ship.W + x] !== C.MATERIALS.OUTLINE) continue;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  /* nudged up a little: the label overlays the bottom of the tile */
  var dy = y1 < 0 ? 0 : Math.round((fh - (y1 - y0 + 1)) / 2 - y0 - fh * 0.06);

  for (y = 0; y < ship.H; y++) for (x = 0; x < fw; x++) {
    if (ship.mats[y * ship.W + x] !== C.MATERIALS.OUTLINE) continue;
    var ty = y + dy;
    if (ty < 0 || ty >= fh) continue;
    var o = (ty * fw + x) * 4;
    img.data[o] = 90; img.data[o + 1] = 106; img.data[o + 2] = 138; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  cv.style.width = (fw * scale) + 'px';
  cv.style.height = (fh * scale) + 'px';
  return cv;
}

function makeDrawTile() {
  var tile = document.createElement('div');
  tile.className = 'tile draw';
  tile.title = 'Draw a hull by hand - it gets thrusters, guns, shading and turn poses like any generated ship';
  tile.appendChild(skeletonCanvas(state.size, scaleFor(state.size)));
  var lbl = document.createElement('div');
  lbl.className = 'lbl';
  lbl.textContent = 'Draw own shape';
  tile.appendChild(lbl);
  /* wrapped: a bare listener would hand the MouseEvent to openDrawEditor as if
     it were the starting mask */
  tile.addEventListener('click', function () { openDrawEditor(); });
  return tile;
}

function currentShipMask() {
  var ship = selectedShip();
  if (!ship || ship.W !== state.size) return null;
  var m = new Uint8Array(ship.W * ship.H);
  for (var i = 0; i < m.length; i++) m[i] = (ship.mats[i] && ship.mats[i] !== C.MATERIALS.OUTLINE) ? 1 : 0;
  return m;
}

function openDrawEditor(existing, mounts, replaceIndex) {
  if (!(existing instanceof Uint8Array)) existing = null;
  var o = effectiveOpts();
  window.PixelshipDraw.open({
    size: state.size,
    seed: state.seed,
    mask: existing || null,
    shipMask: currentShipMask(),
    /* the preview animates on the panel's own frame count and throttle, so it
       loops exactly like the strip this shape will be exported as */
    frames: state.frames,
    throttle: state.throttle,
    /* the preview must use the same shading and palette as the finished tile,
       or it lies about what you are about to get */
    compose: { shade: o.shade, palette: o.palette, mounts: o.mounts },
    mounts: mounts || o.mounts,
    onAccept: function (m, chosen) {
      var rec = C.packMask(m.data, m.W, m.H);
      rec.mounts = { engineCount: chosen.engineCount, gunCount: chosen.gunCount };
      if (replaceIndex >= 0) { state.drawn[replaceIndex] = rec; state.drawnSelected = replaceIndex; }
      else { state.drawn.unshift(rec); state.drawnSelected = 0; }
      if (state.drawn.length > 24) state.drawn.length = 24;
      rebuildFleet();
      notify(replaceIndex >= 0 ? 'shape updated' : 'shape added - it survives Randomize');
    },
  });
}

function addDrawnTile(gal, rec, di) {
  var un = C.unpackMask(rec);
  if (!un) return;
  var ship;
  try {
    /* shading, palette and mounts still follow the panel; only the silhouette
       comes from the drawing */
    var o = effectiveOpts();
    ship = C.composeShip(state.seed + di, un.W, {
      mask: un, shade: o.shade, palette: o.palette,
      /* hardpoint counts travel with the shape you drew */
      mounts: C.merge(o.mounts, rec.mounts),
    });
    ship.poses = buildPoses(ship);
  } catch (e) { return; }

  drawnShips[di] = ship;
  var v = new ShipView(ship, scaleFor(un.W));
  views.push(v);
  var tile = document.createElement('div');
  tile.setAttribute('data-drawn', String(di));
  tile.className = 'tile drawn' + (state.drawnSelected === di ? ' sel' : '');
  tile.title = 'Hand-drawn hull';
  tile.appendChild(v.canvas);
  tile.addEventListener('click', function () { selectDrawn(di); });

  var tools = document.createElement('div');
  tools.className = 'tileTools';
  var edit = document.createElement('button');
  edit.className = 'tool';
  edit.appendChild(window.Icons.icon('layers', 13));
  edit.title = 'Edit this shape';
  edit.addEventListener('click', function (ev) {
    ev.stopPropagation(); openDrawEditor(un.data, rec.mounts, di);
  });
  tools.appendChild(edit);
  var del = document.createElement('button');
  del.className = 'tool danger';
  del.appendChild(window.Icons.icon('trash-2', 13));
  del.title = 'Delete this shape';
  del.addEventListener('click', function (ev) {
    ev.stopPropagation();
    state.drawn.splice(di, 1);
    if (state.drawnSelected === di) state.drawnSelected = -1;
    else if (state.drawnSelected > di) state.drawnSelected--;
    rebuildFleet();
  });
  tools.appendChild(del);
  tile.appendChild(tools);
  gal.appendChild(tile);
}

function toggleLock(i, seed) {
  if (state.locks[i] !== undefined) delete state.locks[i];
  else state.locks[i] = seed;
  rebuildFleet();
}
function select(i) {
  state.selected = i;
  state.drawnSelected = -1;
  persist();
  paintSelection();
  buildHero();
}
function selectDrawn(i) {
  state.drawnSelected = i;
  persist();
  paintSelection();
  buildHero();
}
function paintSelection() {
  /* Match on the slot the tile carries, not on its position in the DOM: the
     gallery also holds the draw tile and any hand-drawn hulls, so index and
     position stopped agreeing. And toggle the one class instead of rewriting
     className, which used to wipe draw/drawn/locked/saved off the others. */
  var g = document.querySelectorAll('#gallery .tile[data-slot]'), k;
  for (k = 0; k < g.length; k++)
    g[k].classList.toggle('sel', state.drawnSelected < 0 &&
      parseInt(g[k].getAttribute('data-slot'), 10) === state.selected);
  var d = document.querySelectorAll('#gallery .tile[data-drawn]');
  for (k = 0; k < d.length; k++)
    d[k].classList.toggle('sel',
      parseInt(d[k].getAttribute('data-drawn'), 10) === state.drawnSelected);
}
function notify(msg, warn) {
  var el = document.getElementById('notice');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'notice' + (msg ? ' on' : '') + (warn ? ' warn' : '');
  if (notify.timer) clearTimeout(notify.timer);
  if (msg) notify.timer = setTimeout(function () { el.className = 'notice'; }, 4500);
}

var startTime = Date.now();
/* Slow left-right weave so the turn poses are actually visible in the preview. */
function bankIndexAt(t, poseCount, offset) {
  if (poseCount < 2) return 0;
  var half = (poseCount - 1) / 2;
  var s = Math.sin(2 * Math.PI * (t / 3.4 + offset));
  return Math.round(half + half * s);
}
function tick() {
  var now = (Date.now() - startTime) / 1000;
  var phase = (now / 1.15) % 1;
  var qp = Math.floor(phase * state.frames) / state.frames;   /* quantised: preview = export */
  for (var i = 0; i < views.length; i++) {
    var n = SPRITE.poseCount(views[i].ship);
    views[i].drawFrame(qp, state.throttle, bankIndexAt(now, n, i * 0.11));
  }
  if (heroView) {
    var hn = SPRITE.poseCount(heroView.ship);
    heroView.drawFrame(qp, state.throttle, bankIndexAt(now, hn, state.selected * 0.11));
  }
  requestAnimationFrame(tick);
}

/* ══════════════════════════ export ══════════════════════════ */
/* rows = bank poses (hardest left first), columns = animation frames */
function bakeStrip(ship, frames, throttle) {
  var v = new ShipView(ship, 1);
  var poses = SPRITE.poseCount(ship);
  var cv = document.createElement('canvas');
  cv.width = v.bw * frames; cv.height = v.bh * poses;
  var ctx = cv.getContext('2d');
  for (var p = 0; p < poses; p++) {
    for (var f = 0; f < frames; f++) {
      v.drawFrame(f / frames, throttle, p);
      ctx.drawImage(v.canvas, f * v.bw, p * v.bh);
    }
  }
  return { canvas: cv, fw: v.bw, fh: v.bh, poses: poses };
}
function download(name, url) {
  var a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
function exportPng() {
  var ship = selectedShip(); if (!ship) return;
  var r = bakeStrip(ship, state.frames, state.throttle);
  download('ship_' + ship.seed + '.png', r.canvas.toDataURL('image/png'));
}
/* The sprite sheet alone does not tell you where the guns are, and with five
   bank poses the barrel moves per pose - measuring that by hand is 20 numbers
   per ship. This is the file the demo reads to fire from the actual barrels. */
function exportMounts() {
  var ship = selectedShip();
  if (!ship) return;
  var poses = ship.poses || [{ mounts: ship.mounts, angle: 0 }];
  var zone = window.PixelshipSprite ? window.PixelshipSprite.frameHeight(ship) - ship.H : 0;

  function pt(m) {
    var o = { x: Math.round(m.x * 100) / 100, y: Math.round(m.y * 100) / 100 };
    if (m.width !== undefined) o.width = Math.round(m.width * 100) / 100;
    return o;
  }
  var doc = {
    generator: 'pixelship',
    /* The instructions travel inside the file on purpose: this is where someone
       looks at the moment they are wondering what the numbers mean. */
    readme: [
      'Coordinates are pixels inside ONE FRAME of the sprite sheet, origin at the frame top-left.',
      'The sheet is a grid: column = animation frame, row = bank pose. poses[i].row is that row.',
      'To fire from the real barrels, draw pose N and spawn bullets at its guns:',
      '',
      '  var pose = data.poses[poseRow];',
      '  pose.guns.forEach(function (g) {',
      '    spawnBullet(ship.x + g.x, ship.y + g.y);   // ship.x/y = frame top-left on screen',
      '  });',
      '',
      'Engines are where exhaust belongs; engine.width is the nozzle width in pixels.',
      'If you draw a sprite flipped vertically (a descending enemy), mirror the y of every',
      'mount too: y -> frame.h - 1 - y. Flipping the image without flipping the mounts is',
      'the usual reason bullets come out of the wrong end.',
      'A hull with an empty guns array genuinely has no guns - it was generated that way.',
      'See it working: https://stmn.itch.io/pixelship-sprites-demonstration',
    ],
    seed: ship.seed,
    preset: state.preset,
    /* frame geometry, so the coordinates below line up with the PNG strip:
       row = pose, column = animation frame, origin at the frame's top-left */
    frame: { w: ship.W, h: ship.H + zone, hullHeight: ship.H, exhaustZone: zone },
    sheet: { columns: state.frames, rows: poses.length,
             w: ship.W * state.frames, h: (ship.H + zone) * poses.length },
    poses: poses.map(function (p, i) {
      var m = p.mounts || ship.mounts;
      return {
        row: i,
        bankDegrees: Math.round((p.angle || 0) * 180 / Math.PI),
        guns: (m.guns || []).map(pt),
        engines: (m.engines || []).map(pt),
        lamps: (m.lamps || []).map(pt),
        cockpit: m.cockpit ? pt(m.cockpit) : null,
      };
    }),
    /* everything needed to regenerate this exact ship */
    options: ship.opts,
  };
  download('ship_' + ship.seed + '_mounts.json',
    'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(doc, null, 2)));
}

/* Each ship contributes a whole strip - poseCount(ship) rows, not one - so the
   sheet geometry comes from sprite.js and the cells never overlap. */
function exportSheet() {
  if (!fleet.length) return;
  var frames = state.frames;
  var layout = SPRITE.sheetLayout(fleet, frames);
  var cv = document.createElement('canvas');
  cv.width = layout.w; cv.height = layout.h;
  var ctx = cv.getContext('2d');
  for (var i = 0; i < fleet.length; i++) {
    var r = bakeStrip(fleet[i], frames, state.throttle);
    ctx.drawImage(r.canvas, layout.cells[i].x, layout.cells[i].y);
  }
  download('fleet_' + state.seed + '.png', cv.toDataURL('image/png'));
}

/* ══════════════════════════ control panel ══════════════════════════ */
function buildPanel() {
  var panel = document.getElementById('panel');
  panel.innerHTML = '';

  /* preset picker first */
  var pd = document.createElement('details');
  pd.className = 'group'; pd.open = true;
  pd.appendChild(makeSummary('Preset', 'layers'));
  var pb = document.createElement('div'); pb.className = 'body';
  var prow = document.createElement('div'); prow.className = 'row';
  var psel = document.createElement('select');
  PRESETS.forEach(function (p) {
    var o = document.createElement('option');
    o.value = p.name; o.textContent = p.name;
    if (p.name === state.preset) o.selected = true;
    psel.appendChild(o);
  });
  var phint = document.createElement('div'); phint.className = 'hint';
  phint.textContent = presetByName(state.preset).hint;
  psel.addEventListener('change', function () {
    state.preset = psel.value;
    state.over = { shape: {}, shade: {}, mounts: {}, palette: {} };  /* preset wins over stale knobs */
    buildPanel(); refreshPicks(); showFleet();
  });
  prow.appendChild(psel); pb.appendChild(prow); pb.appendChild(phint);
  pd.appendChild(pb); panel.appendChild(pd);

  CONTROLS.forEach(function (grp) {
    var d = document.createElement('details');
    d.className = 'group'; d.open = !!grp.open;
    d.appendChild(makeSummary(grp.group, grp.icon));
    var body = document.createElement('div'); body.className = 'body';
    grp.items.forEach(function (item) { body.appendChild(makeControl(item)); });
    d.appendChild(body); panel.appendChild(d);
  });
}
function makeSummary(label, iconName) {
  var s = document.createElement('summary');
  if (iconName) s.appendChild(window.Icons.icon(iconName, 13));
  var t = document.createElement('span');
  t.textContent = label;
  s.appendChild(t);
  return s;
}
function makeControl(item) {
  var wrap = document.createElement('div');
  var row = document.createElement('div'); row.className = 'row' + (item.type === 'bool' ? ' inline' : '');
  var lab = document.createElement('label'); lab.textContent = item.label;
  row.appendChild(lab);
  var val = currentValue(item);
  var input;

  if (item.type === 'range') {
    var out = document.createElement('span'); out.className = 'val';
    var shown = item.target === 'app' && item.key === 'throttle' ? Math.round(state.throttle * 100) : val;
    if (shown === null || shown === undefined) shown = item.nullAt !== undefined ? item.nullAt : item.min;
    out.textContent = labelFor(item, shown);
    row.appendChild(out);
    input = document.createElement('input');
    input.type = 'range'; input.min = item.min; input.max = item.max; input.step = item.step;
    input.value = shown;
    input.addEventListener('input', function () {
      var n = parseFloat(input.value);
      out.textContent = labelFor(item, n);
      applyChange(item, n);
    });
  } else if (item.type === 'select') {
    input = document.createElement('select');
    var opts = (item.options || rampNames()).slice();
    /* nullAt is the UI label for "let the generator pick" (module value null) */
    if (item.nullAt !== undefined && opts.indexOf(item.nullAt) < 0) opts.unshift(item.nullAt);
    if (val === null || val === undefined) val = item.nullAt;
    opts.forEach(function (o) {
      var el = document.createElement('option');
      el.value = o; el.textContent = o;
      if (String(o) === String(val)) el.selected = true;
      input.appendChild(el);
    });
    input.addEventListener('change', function () { applyChange(item, input.value); });
  } else {
    input = document.createElement('input');
    input.type = 'checkbox'; input.checked = !!val;
    input.addEventListener('change', function () { applyChange(item, input.checked); });
  }
  row.appendChild(input);
  wrap.appendChild(row);
  if (item.hint) {
    var h = document.createElement('div'); h.className = 'hint'; h.textContent = item.hint;
    wrap.appendChild(h);
  }
  return wrap;
}
function fmt(n) {
  if (typeof n !== 'number') return String(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
function labelFor(item, v) {
  if (item.nullAt !== undefined && v === item.nullAt) return item.nullLabel || String(item.nullAt);
  return fmt(v);
}
function rampNames() {
  return window.PALETTE_RAMP_NAMES || (window.listRamps ? window.listRamps() : ['default']);
}
var pending = null;
function applyChange(item, v) {
  if (item.target === 'app') {
    if (item.key === 'throttle') state.throttle = v / 100;
    else state[item.key] = v;
    /* only discrete changes re-run the sampler; doing it on every drag frame
       would cost ~90ms per frame and make the sliders stutter */
    if (item.key === 'count' || item.key === 'diverseSampling') refreshPicks();
  } else {
    /* the module's "pick one for me" value is null, not the UI sentinel */
    state.over[item.target][item.key] = (item.nullAt !== undefined && v === item.nullAt) ? null : v;
  }
  /* Coalesce rapid slider input. setTimeout rather than rAF: rAF is paused in
     background tabs, which would silently swallow a knob change. */
  if (pending) clearTimeout(pending);
  pending = setTimeout(function () { pending = null; showFleet(); }, 0);
}

/* ══════════════════════════ wiring ══════════════════════════ */
function readSeed() {
  var raw = document.getElementById('seed').value.trim();
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10) | 0;
  var h = 2166136261;
  for (var i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}
document.getElementById('seed').addEventListener('change', function () {
  state.seed = readSeed(); refreshPicks(); showFleet();
});
document.getElementById('reroll').addEventListener('click', function () {
  var s = (Math.random() * 2e9) | 0;
  document.getElementById('seed').value = String(s);
  state.seed = s; storageNote = ''; refreshPicks(); showFleet();
});
document.getElementById('showLib').addEventListener('click', function () { setLibraryOpen(!libraryOpen); });
document.getElementById('expPng').addEventListener('click', exportPng);
document.getElementById('expMounts').addEventListener('click', exportMounts);
document.getElementById('expSheet').addEventListener('click', exportSheet);

/* ══════════════════════════ reset ══════════════════════════
   Two-step rather than a modal: one click arms it, a second within 4s commits.
   Everything here is persisted, so a stray click would otherwise wipe a tuned
   setup. The saved library is deliberately NOT touched.                     */
var resetArmed = false, resetTimer = null;
function paintReset() {
  var btn = document.getElementById('resetAll');
  btn.className = resetArmed ? 'armed' : '';
  window.Icons.decorate(btn, 'rotate-ccw', resetArmed ? 'Click again to confirm' : 'Reset to defaults');
}
function doReset() {
  var keepSeed = state.seed;                 /* the one thing worth not losing */
  var fresh = JSON.parse(JSON.stringify(DEFAULT_STATE));
  for (var k in fresh) if (Object.prototype.hasOwnProperty.call(fresh, k)) state[k] = fresh[k];
  state.seed = keepSeed;
  STORE.clearState();
  document.getElementById('seed').value = String(state.seed);
  buildPanel();
  showFleet();
  notify('reset to defaults - seed and ' + library.length + ' saved ship' +
         (library.length === 1 ? '' : 's') + ' kept');
}
document.getElementById('resetAll').addEventListener('click', function () {
  if (resetArmed) {
    clearTimeout(resetTimer); resetArmed = false; paintReset(); doReset();
    return;
  }
  resetArmed = true; paintReset();
  resetTimer = setTimeout(function () { resetArmed = false; paintReset(); }, 4000);
});
paintReset();

/* the sidebar wears the same bitmap face as the intro */
(function brandSidebar() {
  var F = window.PixelFont, head = document.getElementById('brand');
  if (!F || !head) return;
  head.textContent = '';
  head.appendChild(F.render('PIXELSHIP', { scale: 3, color: '#eaf1ff', shadow: { dx: 0, dy: 1, color: '#16203a' } }));
  var sub = document.createElement('div');
  sub.className = 'brandSub';
  sub.appendChild(F.render('PROCEDURAL PIXEL-ART SPACESHIPS', { scale: 1, color: '#8794ad' }));
  sub.appendChild(F.render('CELLULAR AUTOMATA', { scale: 1, color: '#63708a' }));
  head.appendChild(sub);

})();

/* toolbar iconography */
(function decorateToolbar() {
  var I = window.Icons;
  I.decorate(document.getElementById('reroll'), 'shuffle', 'Randomize');
  I.decorate(document.getElementById('showLib'), 'bookmark', 'Saved');
  I.decorate(document.getElementById('expPng'), 'download', 'PNG strip');
  I.decorate(document.getElementById('expMounts'), 'crosshair', 'Mounts');
  I.decorate(document.getElementById('expSheet'), 'layout-grid', 'Fleet sheet');
})();

buildPanel();
document.getElementById('seed').value = String(state.seed);
refreshPicks();
rebuildFleet();
tick();

window.PixelshipApp = {
  state: state, fleet: function () { return fleet; }, rebuild: rebuildFleet,
  seedForSlot: seedForSlot, toggleLock: toggleLock,
  ShipView: ShipView,          /* alias for press pages - lives in lab/sprite.js */
};
})();
