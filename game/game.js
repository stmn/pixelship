/* game.js - "Pixelship sprites demonstration", a small vertical shooter that runs entirely on the
   generator's own metadata.

   The point of this demo is that nothing here is hand-authored art or
   hand-placed hardpoints:
     - shots leave ship.mounts.guns (per pose, so a banked wing's gun moves),
     - exhaust comes from ship.mounts.engines via lab/sprite.js paintExhaust,
     - steering left/right selects the matching pose from lab/bank.js,
     - explosions are coloured from the dead ship's own palette.

   PERFORMANCE: lab/sprite.js paints ImageData, which is far too slow to do per
   entity per frame. Every ship is baked ONCE at startup into a single sheet
   canvas (columns = animation phase, rows = pose x throttle bucket) and the
   game loop only ever blits sub-rectangles of that sheet.

   Classic <script>, ES5, no modules, no deps. Seeded: the same ?seed= gives the
   same fleet.                                                                */
(function (root) {
'use strict';

var C = root.PixelShipCompose, BANK = root.PixelshipBank, FAM = root.PixelshipFamilies,
    SPR = root.PixelshipSprite, PF = root.PixelFont;

var VW = 320, VH = 400;          /* logical pixels; the canvas is CSS-scaled */
var PHASES = 8;                  /* baked animation frames per pose/throttle */
var THR_P = [0, 0.30, 0.62, 1.0];/* player throttle buckets */
var THR_E = [0.7];               /* enemies cruise at a fixed throttle */
/* 20 degrees made the intermediate poses shading-only: measured, poses 1 and 3
   had a silhouette byte-identical to level. 38 gives every step real
   foreshortening while staying under the ~55 where the hull stops reading. */
var POSE_STEPS = 5, POSE_DEG = 38;
var SFX = root.PixelshipAudio || { shoot:function(){}, enemyShoot:function(){}, boom:function(){},
  hit:function(){}, wave:function(){}, gameOver:function(){}, newFleet:function(){},
  unlock:function(){} };

/* ───────────────────────────── seeded rng ───────────────────────────── */
function mulberry32(a) {
  return function () {
    a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ───────────────────────────── baking ─────────────────────────────
   One canvas per ship type. Frame (phase f, pose p, throttle t) lives at
   sx = f*bw, sy = (p*THR.length + t)*bh.                                    */
function bakeShip(ship, thr) {
  var poses = SPR.poseCount(ship), bw = SPR.frameWidth(ship), bh = SPR.frameHeight(ship);
  var cv = document.createElement('canvas');
  cv.width = bw * PHASES; cv.height = bh * poses * thr.length;
  var ctx = cv.getContext('2d');
  var img = ctx.createImageData(bw, bh);
  var masks = [], p, t, f;
  for (p = 0; p < poses; p++) {
    var pose = SPR.poseAt(ship, p);
    for (t = 0; t < thr.length; t++) for (f = 0; f < PHASES; f++) {
      SPR.paintFrame(img, ship, pose, f / PHASES, thr[t]);
      ctx.putImageData(img, f * bw, (p * thr.length + t) * bh);
    }
    /* collision mask: hull pixels of THIS pose, full frame height so the flame
       strip is simply empty. Bullets are tested against it directly. */
    var mask = new Uint8Array(bw * bh);
    for (var y = 0; y < ship.H; y++) for (var x = 0; x < bw; x++)
      mask[y * bw + x] = pose.mats[y * ship.W + x] ? 1 : 0;
    masks.push(mask);
  }
  var pal = ship.pal;
  var cols = [];
  for (var i = 0; i < pal.ramp.length; i++) cols.push(rgb(pal.ramp[i]));
  cols.push(rgb(pal.glow), rgb(pal.accent), rgb(pal.glow));
  return { ship: ship, cv: cv, bw: bw, bh: bh, poses: poses, thr: thr,
           masks: masks, colors: cols, shot: rgb(pal.glow) };
}
function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

/* ───────────────────────────── entities ───────────────────────────── */
/* x,y is the TOP-LEFT of the sprite frame, so a mount at (m.x, m.y) is simply
   at (x + m.x, y + m.y) in world space. Enemies are drawn vertically flipped
   (they fly the other way), which maps a mount to y + bh - 1 - m.y.          */
function mountWorld(e, m) {
  return e.flip ? { x: e.x + m.x, y: e.y + e.type.bh - 1 - m.y }
                : { x: e.x + m.x, y: e.y + m.y };
}
function poseMounts(type, poseIdx) { return SPR.poseAt(type.ship, poseIdx).mounts; }

function solidAt(e, wx, wy) {
  var lx = Math.round(wx - e.x), ly = Math.round(wy - e.y);
  if (e.flip) ly = e.type.bh - 1 - ly;
  if (lx < 0 || ly < 0 || lx >= e.type.bw || ly >= e.type.bh) return false;
  return !!e.type.masks[e.poseIdx][ly * e.type.bw + lx];
}

/* ───────────────────────────── the game ───────────────────────────── */
function Game(canvas, seed) {
  this.cv = canvas; this.ctx = canvas.getContext('2d');
  this.ctx.imageSmoothingEnabled = false;
  this.seed = seed;
  this.paused = false;
  this.textCache = {}; this.textCacheN = 0;
  this.build();
  this.reset();
}

/* A fresh seed means a fresh fleet, so the sprites have to be re-baked. Costs
   about 70ms, which is fine on a keypress and impossible to notice. */
Game.prototype.newRun = function (seed) {
  this.seed = (seed === undefined || seed === null) ? ((Math.random() * 2e9) | 0) : (seed | 0);
  this.build();
  this.reset();
};

Game.prototype.build = function () {
  var t0 = (root.performance || Date).now();
  var rnd = mulberry32(this.seed);
  var gunFams = ['Raider', 'Interceptor', 'Dreadnought', 'Manta', 'Shard'];

  /* player: banked, four throttle buckets */
  var pf = FAM.byName(gunFams[(rnd() * gunFams.length) | 0]);
  var pship = C.composeShip((rnd() * 1e9) | 0, 30, pf.opts);
  pship.poses = BANK.bankPoses(pship, POSE_STEPS, POSE_DEG);
  this.playerType = bakeShip(pship, THR_P);
  this.playerFamily = pf.name;

  /* enemies: one baked type per family per size tier. Later waves index into
     the bigger tiers, so wave 6 fields chunkier ships than wave 1.           */
  this.tiers = [24, 27, 30, 33];
  this.enemyTypes = [];
  for (var ti = 0; ti < this.tiers.length; ti++) {
    var row = [];
    for (var fi = 0; fi < FAM.PRESETS.length; fi++) {
      var s = C.composeShip((rnd() * 1e9) | 0, this.tiers[ti], FAM.PRESETS[fi].opts);
      s.poses = BANK.bankPoses(s, 3, 16);
      var bk = bakeShip(s, THR_E);
      bk.family = FAM.PRESETS[fi].name;
      row.push(bk);
    }
    this.enemyTypes.push(row);
  }
  this.bakeMs = Math.round((root.performance || Date).now() - t0);

  this.stars = [];
  for (var i = 0; i < 70; i++)
    this.stars.push({ x: rnd() * VW, y: rnd() * VH, v: 8 + rnd() * 46 });
};

Game.prototype.reset = function () {
  this.rnd = mulberry32(this.seed ^ 0x5bf03635);
  this.score = 0; this.lives = 3; this.wave = 0; this.over = false;
  this.overLock = 0; this.restartArmed = false;
  this.phase = 0; this.shotTimer = 0; this.invuln = 0; this.waveDelay = 0.8;
  this.bullets = []; this.enemies = []; this.parts = [];
  var t = this.playerType;
  this.player = { x: (VW - t.bw) / 2, y: VH - t.bh - 14, vx: 0, vy: 0,
                  type: t, poseIdx: SPR.levelPoseIndex(t.ship), turn: 0,
                  thr: 1, thrV: 0.5, flip: false };
};

Game.prototype.spawnWave = function () {
  this.wave++;
  var w = this.wave, r = this.rnd;
  var tier = Math.min(this.tiers.length - 1, ((w - 1) / 2) | 0);
  var n = Math.min(12, 4 + w);
  var speed = Math.min(112, 40 + w * 7);
  var perRow = Math.min(n, 4);
  for (var i = 0; i < n; i++) {
    /* Hive and Radial come out of the generator with no gun mounts, so a
       uniform draw left roughly two of every seven enemies harmless. Prefer
       armed types, but keep an unarmed one in the mix as a rammer. */
    var pool = this.enemyTypes[tier];
    var type = pool[(r() * pool.length) | 0];
    if (!type.ship.mounts.guns.length && r() < 0.75) {
      var armed = [];
      for (var q = 0; q < pool.length; q++) if (pool[q].ship.mounts.guns.length) armed.push(pool[q]);
      if (armed.length) type = armed[(r() * armed.length) | 0];
    }
    var col = i % perRow, row = (i / perRow) | 0;
    this.enemies.push({
      type: type, flip: true, poseIdx: 1,
      x: 8 + (VW - 16 - type.bw) * (perRow > 1 ? col / (perRow - 1) : 0.5),
      y: -type.bh - row * 46 - r() * 22,
      vy: speed * (0.8 + r() * 0.5),
      amp: 12 + r() * 34, w: 0.6 + r() * 1.4, t0: r() * 6.28,
      fire: 0.7 + r() * 2.4, phaseOff: r(),
      hp: 1 + ((type.ship.W - 24) / 6 | 0),
    });
  }
};

/* ───────────────────────────── update ───────────────────────────── */
Game.prototype.update = function (dt, keys) {
  this.phase = (this.phase + dt * 1.6) % 1;
  var P = this.player, t = P.type, i, j, e, b;

  /* Game over: the fire key is almost always still held at the moment you die,
     so restart needs a short lockout AND a fresh press, or you never see the
     screen you just earned. */
  if (this.over) {
    this.overLock -= dt;
    if (this.overLock <= 0) {
      if (!keys[' '] && !keys.r) this.restartArmed = true;
      else if (this.restartArmed) {
        if (keys.r) this.newRun();      /* R: new seed, new fleet */
        else this.reset();              /* space: same fleet, another go */
        return;
      }
    }
    this.stepParts(dt);
    return;
  }

  /* R at any time rolls a whole new fleet. There is no URL to edit on itch -
     everything runs in an iframe - so the seed has to be reachable in-game. */
  if (keys.r) {
    if (!this.rerollLock) { this.rerollLock = true; SFX.newFleet(); this.newRun(); return; }
  } else this.rerollLock = false;

  /* --- steering: horizontal input picks the bank pose from lab/bank.js --- */
  var ax = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  var ay = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  P.vx += (ax * 150 - P.vx) * Math.min(1, dt * 9);
  P.vy += (ay * 130 - P.vy) * Math.min(1, dt * 9);
  P.x = Math.max(0, Math.min(VW - t.bw, P.x + P.vx * dt));
  P.y = Math.max(VH * 0.42, Math.min(VH - t.bh + 4, P.y + P.vy * dt));
  P.turn += (ax - P.turn) * Math.min(1, dt * 7);
  var mid = SPR.levelPoseIndex(t.ship);
  P.poseIdx = Math.max(0, Math.min(t.poses - 1, mid + Math.round(P.turn * mid)));

  /* --- throttle responds to thrust, and the exhaust is baked per bucket --- */
  var want = ay < 0 ? 1.0 : ay > 0 ? 0.14 : 0.5;
  P.thrV = P.thrV === undefined ? want : P.thrV + (want - P.thrV) * Math.min(1, dt * 6);
  P.thr = 0;
  for (i = 0; i < THR_P.length; i++) if (THR_P[i] <= P.thrV + 0.08) P.thr = i;

  /* --- firing: one bullet per REAL gun mount of the current pose. A hull the
         generator gave no guns (Hive, Radial) genuinely cannot shoot. --- */
  this.shotTimer -= dt;
  if (keys[' '] && this.shotTimer <= 0) {
    var guns = poseMounts(t, P.poseIdx).guns;
    for (i = 0; i < guns.length; i++) {
      var gw = mountWorld(P, guns[i]);
      this.bullets.push({ x: gw.x, y: gw.y, vx: P.vx * 0.15, vy: -300, foe: false, c: t.shot });
      SFX.shoot();
    }
    this.shotTimer = 0.16;
  }

  if (this.invuln > 0) this.invuln -= dt;

  /* --- enemies --- */
  if (!this.enemies.length) {
    this.waveDelay -= dt;
    if (this.waveDelay <= 0) { this.spawnWave(); SFX.wave(this.wave); this.waveDelay = 1.6; }
  }
  for (i = this.enemies.length - 1; i >= 0; i--) {
    e = this.enemies[i];
    e.t0 += dt;
    var vx = Math.cos(e.t0 * e.w) * e.amp;
    e.x += vx * dt; e.y += e.vy * dt;
    e.poseIdx = vx < -6 ? 0 : vx > 6 ? 2 : 1;
    if (e.x < 0) e.x = 0; if (e.x > VW - e.type.bw) e.x = VW - e.type.bw;
    if (e.y > VH + 8) { this.enemies.splice(i, 1); continue; }

    e.fire -= dt;
    if (e.fire <= 0 && e.y > 0) {
      var eg = poseMounts(e.type, e.poseIdx).guns;
      for (j = 0; j < eg.length; j++) {
        var ew = mountWorld(e, eg[j]);
        SFX.enemyShoot();
      this.bullets.push({ x: ew.x, y: ew.y, vx: vx * 0.2, vy: 90 + this.wave * 5,
                            foe: true, c: e.type.shot });
      }
      e.fire = 1.1 + this.rnd() * 2.2;
    }
    /* body collision: pixel test over the overlapping rectangle */
    if (this.invuln <= 0 && this.overlapPixels(P, e)) {
      this.kill(e, i); this.hitPlayer(); continue;
    }
  }

  /* --- bullets: substepped so nothing tunnels through a hull --- */
  for (i = this.bullets.length - 1; i >= 0; i--) {
    b = this.bullets[i];
    var dx = b.vx * dt, dy = b.vy * dt;
    var steps = Math.max(1, Math.ceil(Math.abs(dy) / 2));
    var dead = false;
    for (var s = 0; s < steps && !dead; s++) {
      b.x += dx / steps; b.y += dy / steps;
      if (b.y < -4 || b.y > VH + 4 || b.x < -4 || b.x > VW + 4) { dead = true; break; }
      if (b.foe) {
        if (this.invuln <= 0 && solidAt(P, b.x, b.y)) { this.hitPlayer(); dead = true; }
      } else {
        for (j = this.enemies.length - 1; j >= 0; j--) {
          e = this.enemies[j];
          if (!solidAt(e, b.x, b.y)) continue;
          dead = true;
          this.spark(b.x, b.y, e.type, 5);
          if (--e.hp <= 0) { this.score += 40 + e.type.ship.W * 2; this.kill(e, j); }
          break;
        }
      }
    }
    if (dead) this.bullets.splice(i, 1);
  }

  this.stepParts(dt);
  for (i = 0; i < this.stars.length; i++) {
    var st = this.stars[i];
    st.y += st.v * dt;
    if (st.y > VH) { st.y = 0; st.x = this.rnd() * VW; }
  }
};

Game.prototype.overlapPixels = function (a, e) {
  var x0 = Math.max(a.x, e.x), x1 = Math.min(a.x + a.type.bw, e.x + e.type.bw);
  var y0 = Math.max(a.y, e.y), y1 = Math.min(a.y + a.type.bh, e.y + e.type.bh);
  if (x1 <= x0 || y1 <= y0) return false;
  for (var y = y0; y < y1; y += 2) for (var x = x0; x < x1; x += 2)
    if (solidAt(a, x, y) && solidAt(e, x, y)) return true;
  return false;
};

Game.prototype.kill = function (e, idx) {
  this.spark(e.x + e.type.bw / 2, e.y + e.type.ship.H / 2, e.type, 34);
  this.enemies.splice(idx, 1);
};
Game.prototype.hitPlayer = function () {
  var P = this.player;
  this.spark(P.x + P.type.bw / 2, P.y + P.type.ship.H / 2, P.type, 40);
  this.invuln = 1.6;
  SFX.hit();
  if (--this.lives <= 0) {
    this.over = true; this.lives = 0; SFX.gameOver();
    this.overLock = 0.9; this.restartArmed = false;
  }
};
/* particles take their colours from the dying ship's own palette */
Game.prototype.spark = function (x, y, type, n) {
  var cols = type.colors;
  /* bigger hull, deeper boom - n is how many particles the caller asked for,
     which already scales with the ship */
  SFX.boom(Math.min(1, (type.bw * type.bh) / 2600));
  for (var i = 0; i < n; i++) {
    var a = this.rnd() * 6.2832, sp = 12 + this.rnd() * 110;
    this.parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10,
                      life: 0.25 + this.rnd() * 0.65,
                      c: cols[(this.rnd() * cols.length) | 0] });
  }
};
Game.prototype.stepParts = function (dt) {
  for (var i = this.parts.length - 1; i >= 0; i--) {
    var p = this.parts[i];
    p.life -= dt;
    if (p.life <= 0) { this.parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt; p.vx *= 0.97;
  }
};

/* ───────────────────────────── draw ───────────────────────────── */
Game.prototype.blit = function (e, thrIdx, frame) {
  var t = e.type, ctx = this.ctx;
  var sx = frame * t.bw, sy = (e.poseIdx * t.thr.length + thrIdx) * t.bh;
  var dx = Math.round(e.x), dy = Math.round(e.y);
  if (e.flip) {
    ctx.save();
    ctx.translate(dx, dy + t.bh);
    ctx.scale(1, -1);
    ctx.drawImage(t.cv, sx, sy, t.bw, t.bh, 0, 0, t.bw, t.bh);
    ctx.restore();
  } else {
    ctx.drawImage(t.cv, sx, sy, t.bw, t.bh, dx, dy, t.bw, t.bh);
  }
};

Game.prototype.draw = function () {
  var ctx = this.ctx, i, f = (this.phase * PHASES | 0) % PHASES;
  ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, VW, VH);

  for (i = 0; i < this.stars.length; i++) {
    var st = this.stars[i];
    ctx.fillStyle = st.v > 36 ? '#3d4a66' : '#1c2435';
    ctx.fillRect(st.x | 0, st.y | 0, 1, 1);
  }

  for (i = 0; i < this.enemies.length; i++) {
    var e = this.enemies[i];
    this.blit(e, 0, ((this.phase + e.phaseOff) * PHASES | 0) % PHASES);
  }

  var P = this.player;
  if (!this.over && (this.invuln <= 0 || (this.invuln * 12 | 0) % 2)) this.blit(P, P.thr, f);

  for (i = 0; i < this.bullets.length; i++) {
    var b = this.bullets[i];
    ctx.fillStyle = b.c;
    ctx.fillRect(b.x | 0, (b.y | 0) - (b.foe ? 0 : 2), 1, 3);
  }
  for (i = 0; i < this.parts.length; i++) {
    var p = this.parts[i];
    ctx.globalAlpha = Math.min(1, p.life * 2.6);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x | 0, p.y | 0, 1, 1);
  }
  ctx.globalAlpha = 1;

  /* ---- HUD, all of it in the project's 5x7 pixel font ---- */
  this.text('SCORE ' + pad(this.score, 6), 4, 4, 1, '#e2e8f6');
  this.text('WAVE ' + this.wave, 4, 13, 1, '#8794ad');
  this.text('LIVES ' + this.lives, 66, 13, 1, '#8794ad');
  var sd = 'SEED ' + this.seed;
  this.text(sd, VW - 4 - PF.measure(sd, { scale: 1 }).w, 4, 1, '#6ea8ff');
  this.text('ARROWS OR WASD MOVE   SPACE FIRE   R NEW FLEET', 4, VH - 11, 1, '#3d4a66');

  if (this.over) {
    this.centre('GAME OVER', VH / 2 - 30, 3, '#ffb26e');
    this.centre('SCORE ' + pad(this.score, 6), VH / 2 + 4, 1, '#e2e8f6');
    this.centre('WAVE ' + this.wave + ' REACHED', VH / 2 + 16, 1, '#8794ad');
    this.centre('SPACE TO FLY AGAIN    R FOR A NEW FLEET', VH / 2 + 34, 1, '#6ea8ff');
  } else if (!this.enemies.length && this.waveDelay > 0 && this.wave > 0) {
    this.centre('WAVE ' + (this.wave + 1), VH / 2 - 10, 2, '#e2e8f6');
  }
};
/* Rendered strings are cached as canvases; the score line mints a new one on
   every kill, so the cache is dropped wholesale once it gets silly. */
Game.prototype.text = function (s, x, y, scale, col) {
  var k = s + '|' + scale + '|' + col;
  if (this.textCacheN > 400) { this.textCache = {}; this.textCacheN = 0; }
  var cv = this.textCache[k];
  if (!cv) { cv = this.textCache[k] = PF.render(s, { scale: scale, color: col }); this.textCacheN++; }
  this.ctx.drawImage(cv, Math.round(x), Math.round(y));
};
Game.prototype.centre = function (s, y, scale, col) {
  this.text(s, (VW - PF.measure(s, { scale: scale }).w) / 2, y, scale, col);
};
function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

/* ───────────────────────────── input + loop ───────────────────────────── */
var MAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
            a: 'left', d: 'right', w: 'up', s: 'down', A: 'left', D: 'right',
            W: 'up', S: 'down', r: 'r', R: 'r', ' ': ' ' };

function boot() {
  var cv = document.getElementById('screen');
  /* Random every load. itch embeds the page in an iframe, so a ?seed= param is
     not something a player can reach - the seed is shown in the HUD and rolled
     with R instead. */
  var game = new Game(cv, (Math.random() * 2e9) | 0);
  root.PixelshipGame = game;

  var el = document.getElementById('boot');
  if (el) el.parentNode.removeChild(el);

  function fit() {
    var s = Math.max(1, Math.min(Math.floor(root.innerWidth / VW),
                                 Math.floor((root.innerHeight - 8) / VH)));
    cv.style.width = (VW * s) + 'px'; cv.style.height = (VH * s) + 'px';
  }
  fit();
  root.addEventListener('resize', fit);

  var keys = game.keys = {};
  function key(ev, down) {
    var n = MAP[ev.key];
    if (!n) return;
    /* the AudioContext has to be created inside a user gesture or the browser
       leaves it suspended and every sound is silently dropped */
    if (down) SFX.unlock();
    keys[n] = down;
    ev.preventDefault();
  }
  root.addEventListener('keydown', function (e) { key(e, true); });
  root.addEventListener('keyup', function (e) { key(e, false); });

  /* `paused` stops the clock without stopping the draw, so a blurred tab does
     not eat three lives - and the headless harness can step the sim by hand. */
  root.addEventListener('blur', function () {
    game.paused = true;
    /* a key held at blur never delivers its keyup, so the ship would drift and
       fire by itself on the way back - drop the whole map instead */
    for (var k in keys) if (Object.prototype.hasOwnProperty.call(keys, k)) keys[k] = false;
  });
  root.addEventListener('focus', function () { game.paused = false; last = 0; });

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    if (!game.paused) {
      game.update(dt, keys);
      game.draw();
    }
    root.requestAnimationFrame(frame);
  }
  root.requestAnimationFrame(frame);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})(typeof self !== 'undefined' ? self : this);
