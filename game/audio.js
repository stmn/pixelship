/* audio.js - the game's sound, synthesised rather than loaded.
   Everything else in this project is generated, so the sound is too: there are
   no audio files, no fetch, and the bundle does not grow by a single byte.

   Browsers refuse to start an AudioContext before a user gesture, so the
   context is created lazily on the first key press and every call is a no-op
   until then. Nothing here throws if Web Audio is missing.                    */
(function (root) {
'use strict';

var AC = root.AudioContext || root.webkitAudioContext;
var ctx = null, master = null;

function ready() {
  if (!AC) return false;
  if (!ctx) {
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
  return true;
}

/* one oscillator with an exponential fall, optionally sliding in pitch */
function tone(o) {
  if (!ready()) return;
  var t = ctx.currentTime;
  var osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = o.type || 'square';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain || 0.2, t + Math.min(0.012, o.dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + o.dur + 0.02);
}

/* filtered white noise - the whole percussion section */
function noise(o) {
  if (!ready()) return;
  var t = ctx.currentTime;
  var n = Math.max(1, Math.floor(ctx.sampleRate * o.dur));
  var buf = ctx.createBuffer(1, n, ctx.sampleRate);
  var d = buf.getChannelData(0);
  for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  var src = ctx.createBufferSource(); src.buffer = buf;
  var lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(o.freq || 2200, t);
  if (o.to) lp.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t + o.dur);
  var g = ctx.createGain();
  g.gain.setValueAtTime(o.gain || 0.3, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(lp); lp.connect(g); g.connect(master);
  src.start(t); src.stop(t + o.dur + 0.02);
}

var lastShot = 0;
var API = {
  /* the player fires constantly, so this one is throttled and quiet or it
     turns into a buzzsaw */
  shoot: function () {
    var now = ready() ? ctx.currentTime : 0;
    if (!now || now - lastShot < 0.055) return;
    lastShot = now;
    tone({ freq: 880, to: 300, dur: 0.09, type: 'square', gain: 0.10 });
  },
  enemyShoot: function () {
    tone({ freq: 300, to: 130, dur: 0.12, type: 'sawtooth', gain: 0.07 });
  },
  /* size 0..1 - a fighter pops, a dreadnought thuds */
  boom: function (size) {
    var s = Math.max(0, Math.min(1, size === undefined ? 0.5 : size));
    noise({ dur: 0.16 + s * 0.34, freq: 1800 + s * 900, to: 90, gain: 0.20 + s * 0.22 });
    tone({ freq: 150 - s * 60, to: 40, dur: 0.20 + s * 0.25, type: 'triangle', gain: 0.12 + s * 0.12 });
  },
  hit: function () {
    noise({ dur: 0.5, freq: 1400, to: 70, gain: 0.34 });
    tone({ freq: 220, to: 45, dur: 0.55, type: 'sawtooth', gain: 0.18 });
  },
  wave: function (n) {
    var base = 440, step = 0;
    [0, 4, 7].forEach(function (semi) {
      var f = base * Math.pow(2, semi / 12);
      setTimeout(function () { tone({ freq: f, dur: 0.13, type: 'square', gain: 0.09 }); }, step);
      step += 70;
    });
  },
  gameOver: function () {
    var step = 0;
    [523, 440, 349, 262].forEach(function (f) {
      setTimeout(function () { tone({ freq: f, to: f * 0.94, dur: 0.30, type: 'triangle', gain: 0.16 }); }, step);
      step += 150;
    });
  },
  newFleet: function () {
    tone({ freq: 300, to: 900, dur: 0.16, type: 'square', gain: 0.10 });
  },
  /* called from the first keydown so the context starts inside a gesture */
  unlock: function () { ready(); },
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.PixelshipAudio = API;
})(typeof self !== 'undefined' ? self : this);
