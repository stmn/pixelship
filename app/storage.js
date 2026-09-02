/* storage.js - persistence for the session state and the saved-ship library.
   Ships are stored as RECIPES (seed + options), never as pixels: a recipe is a
   few hundred bytes and regenerates in about 2ms, so localStorage is the right
   tool and IndexedDB would be ceremony for nothing.

   Every read is validated and every write is guarded: localStorage throws on
   access in some privacy modes, and setItem throws on quota. Neither may take
   the app down.                                                               */
(function (root) {
'use strict';

var STATE_KEY = 'pixelship.state.v1';
var LIB_KEY = 'pixelship.library.v1';
var LIB_MAX = 300;

var available = (function () {
  try {
    var k = '__pixelship_probe__';
    root.localStorage.setItem(k, '1');
    root.localStorage.removeItem(k);
    return true;
  } catch (e) { return false; }
})();

function readJSON(key, fallback) {
  if (!available) return fallback;
  try {
    var raw = root.localStorage.getItem(key);
    if (raw === null || raw === '') return fallback;
    var v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch (e) { return fallback; }       /* corrupt entry must not brick the app */
}

function writeJSON(key, value) {
  if (!available) return { ok: false, reason: 'unavailable' };
  try {
    root.localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (e) {
    var quota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
    return { ok: false, reason: quota ? 'quota' : 'error' };
  }
}

/* ---- session state ----
   Only known keys of the expected type survive a read, so a stale or
   hand-edited entry degrades to defaults instead of poisoning the config. */
var SCALARS = {
  seed: 'number', size: 'number', count: 'number', frames: 'number',
  throttle: 'number', bankPoses: 'number', bankAngle: 'number', bankHeight: 'number',
  preset: 'string', selected: 'number', drawnSelected: 'number', diverseSampling: 'boolean',
};
var OVERRIDE_GROUPS = ['shape', 'shade', 'mounts', 'palette'];

/* typeHints maps 'group.knob' -> 'number'|'string'|'boolean'. Anything not in
   the map is an unknown knob and is dropped; a wrong type is dropped too. The
   panel builds the map from its own schema, so the two cannot drift apart. */
function sanitizeState(raw, typeHints) {
  var out = null, k;
  if (!raw || typeof raw !== 'object') return null;
  out = {};
  for (k in SCALARS) {
    var v = raw[k];
    if (typeof v !== SCALARS[k]) continue;
    if (SCALARS[k] === 'number' && !isFinite(v)) continue;
    out[k] = v;
  }
  if (raw.over && typeof raw.over === 'object') {
    out.over = {};
    OVERRIDE_GROUPS.forEach(function (g) {
      out.over[g] = {};
      var src = raw.over[g];
      if (!src || typeof src !== 'object') return;
      for (var key in src) {
        if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
        var val = src[key];
        var t = typeof val;
        if (val === null) { out.over[g][key] = null; continue; }   /* null = "generator picks" */
        if (t !== 'number' && t !== 'string' && t !== 'boolean') continue;
        if (t === 'number' && !isFinite(val)) continue;
        if (typeHints) {
          var want = typeHints[g + '.' + key];
          if (!want || want !== t) continue;                        /* unknown knob or wrong type */
        }
        out.over[g][key] = val;
      }
    });
  }
  if (Array.isArray(raw.drawn)) {
    out.drawn = raw.drawn.filter(function (d) {
      return d && typeof d === 'object' && typeof d.bits === 'string' &&
             typeof d.W === 'number' && typeof d.H === 'number' &&
             isFinite(d.W) && isFinite(d.H) && d.W > 0 && d.H > 0 &&
             d.W * d.H <= 96 * 96 * 4;
    }).map(function (d) {
      var o = { W: d.W, H: d.H, bits: d.bits };
      if (d.mounts && typeof d.mounts === 'object') {
        o.mounts = {};
        if (typeof d.mounts.engineCount === 'number' && isFinite(d.mounts.engineCount))
          o.mounts.engineCount = d.mounts.engineCount;
        if (typeof d.mounts.gunCount === 'number' && isFinite(d.mounts.gunCount))
          o.mounts.gunCount = d.mounts.gunCount;
      }
      return o;
    }).slice(0, 24);
  }
  ['locks', 'picks'].forEach(function (field) {
    if (!raw[field] || typeof raw[field] !== 'object') return;
    out[field] = {};
    for (var key in raw[field]) {
      if (!Object.prototype.hasOwnProperty.call(raw[field], key)) continue;
      var slot = parseInt(key, 10), seed = raw[field][key];
      if (isFinite(slot) && slot >= 0 && typeof seed === 'number' && isFinite(seed)) out[field][slot] = seed | 0;
    }
  });
  return out;
}

function loadState(typeHints) { return sanitizeState(readJSON(STATE_KEY, null), typeHints); }
function saveState(state) {
  var slim = { over: {}, locks: {}, picks: {}, drawn: [] }, k;
  for (k in SCALARS) if (state[k] !== undefined) slim[k] = state[k];
  OVERRIDE_GROUPS.forEach(function (g) { slim.over[g] = state.over && state.over[g] ? state.over[g] : {}; });
  slim.drawn = Array.isArray(state.drawn) ? state.drawn.slice(0, 24) : [];
  ['locks', 'picks'].forEach(function (field) {
    var src = state[field] || {};
    for (var key in src) if (Object.prototype.hasOwnProperty.call(src, key)) slim[field][key] = src[key];
  });
  return writeJSON(STATE_KEY, slim);
}
function clearState() { if (available) { try { root.localStorage.removeItem(STATE_KEY); } catch (e) {} } }

/* ---- saved ship library ---- */
function loadLibrary() {
  var raw = readJSON(LIB_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(function (e) {
    return e && typeof e === 'object' &&
           typeof e.id === 'string' && typeof e.seed === 'number' && isFinite(e.seed) &&
           typeof e.size === 'number' && isFinite(e.size);
  });
}
function saveLibrary(list) {
  var trimmed = list.slice(-LIB_MAX);          /* oldest entries drop out first */
  var res = writeJSON(LIB_KEY, trimmed);
  return { ok: res.ok, reason: res.reason, dropped: list.length - trimmed.length };
}

/* Deterministic id so the same ship saved twice does not duplicate. */
function recipeId(seed, size, preset, opts) {
  var s = seed + '|' + size + '|' + preset + '|' + JSON.stringify(opts || {});
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'r' + ((h >>> 0).toString(36));
}

var API = {
  available: available,
  loadState: loadState, saveState: saveState, clearState: clearState,
  loadLibrary: loadLibrary, saveLibrary: saveLibrary,
  recipeId: recipeId,
  STATE_KEY: STATE_KEY, LIB_KEY: LIB_KEY, LIB_MAX: LIB_MAX,
  _sanitizeState: sanitizeState,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.PixelshipStorage = API;
})(typeof self !== 'undefined' ? self : this);
