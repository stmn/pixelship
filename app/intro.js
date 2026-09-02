/* intro.js - title screen: a procedurally generated fleet flying through space.
   Renders through lab/sprite.js - the project's single pixel renderer. */
(function () {
'use strict';

var C = window.PixelShipCompose;
var ShipView = window.PixelshipSprite.ShipView;
var FAMILIES = window.PixelshipFamilies.PRESETS;

var overlay = document.getElementById('intro');
var canvas = document.getElementById('introCanvas');
var ctx = canvas.getContext('2d');
var ships = [], stars = [], raf = null, running = true, last = 0, seedCounter = 1;
var W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = canvas.clientWidth; H = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(W * DPR));
  canvas.height = Math.max(1, Math.round(H * DPR));
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
  buildStars();
}

/* three parallax layers; the far ones are dim and slow */
function buildStars() {
  stars = [];
  var n = Math.round((W * H) / 5200);
  for (var i = 0; i < n; i++) {
    var layer = i % 3;
    stars.push({
      x: Math.random() * W, y: Math.random() * H,
      size: layer === 2 ? 2 : 1,
      speed: 8 + layer * 22,
      alpha: 0.18 + layer * 0.26,
    });
  }
}

/* A flight is one composed ship plus its motion. Bigger = nearer = faster,
   which is what sells the depth. */
function spawn(atRandomHeight) {
  var fam = FAMILIES[(Math.random() * FAMILIES.length) | 0];
  var depth = Math.random();                    /* 0 = far, 1 = near */
  var size = Math.round(20 + depth * 26);
  var seed = ((seedCounter++) * 2654435761 + ((Math.random() * 1e6) | 0)) | 0;
  var ship;
  try { ship = C.composeShip(seed, size, fam.opts); }
  catch (e) { return null; }

  var view = new ShipView(ship, 1);
  var scale = Math.round(1 + depth * 2);        /* integer scale keeps pixels crisp */
  var w = view.bw * scale, h = view.bh * scale;
  return {
    view: view, scale: scale, w: w, h: h,
    x: Math.random() * Math.max(1, W - w),
    y: atRandomHeight ? Math.random() * (H + h) - h * 0.5 : H + h * (0.2 + Math.random()),
    speed: 26 + depth * 96,
    drift: (Math.random() - 0.5) * 12,
    phase: Math.random(),
    throttle: 0.6 + Math.random() * 0.4,
    /* Distance is sold by size, speed and a push toward the background colour.
       NOT by alpha - semi-transparent pixel art reads as a bug, not as depth. */
    dim: (1 - depth) * 0.5,
  };
}

function populate() {
  ships = [];
  var target = Math.max(6, Math.min(16, Math.round(W / 120)));
  for (var i = 0; i < target; i++) {
    var s = spawn(true);
    if (s) ships.push(s);
  }
}

function frame(now) {
  if (!running) return;
  var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
  last = now;

  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, W, H);

  for (var i = 0; i < stars.length; i++) {
    var st = stars[i];
    st.y += st.speed * dt;
    if (st.y > H) { st.y = -2; st.x = Math.random() * W; }
    ctx.fillStyle = 'rgba(200,220,255,' + st.alpha + ')';
    ctx.fillRect(st.x | 0, st.y | 0, st.size, st.size);
  }

  for (var j = 0; j < ships.length; j++) {
    var s = ships[j];
    s.y -= s.speed * dt;            /* nose is up, so the fleet climbs */
    s.x += s.drift * dt;
    s.phase = (s.phase + dt / 1.15) % 1;
    var qp = Math.floor(s.phase * 8) / 8;
    s.view.drawFrame(qp, s.throttle);
    if (s.dim > 0.02) {
      /* source-atop tints only pixels that are already opaque, so the ship
         darkens toward the void without ever becoming see-through */
      var vc = s.view.canvas.getContext('2d');
      vc.globalCompositeOperation = 'source-atop';
      vc.fillStyle = 'rgba(5,7,12,' + s.dim + ')';
      vc.fillRect(0, 0, s.view.bw, s.view.bh);
      vc.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(s.view.canvas, Math.round(s.x), Math.round(s.y), s.w, s.h);
    if (s.y + s.h < -8) {           /* gone off the top - recycle as a new design */
      var fresh = spawn(false);
      if (fresh) ships[j] = fresh;
    }
  }
  raf = requestAnimationFrame(frame);
}

function stop() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  ships = []; stars = [];
}

/* set the intro copy in the bitmap font */
(function typeset() {
  var F = window.PixelFont;
  var title = document.getElementById('introTitle');
  var tag = document.getElementById('introTag');
  var cta = document.getElementById('introCta');
  title.appendChild(F.render('PIXELSHIP', {
    scale: 7, tracking: 1, color: '#eaf1ff', shadow: { dx: 0, dy: 1, color: '#1b2b4d' },
  }));
  tag.appendChild(F.render('PROCEDURAL PIXEL-ART SPACESHIPS', { scale: 2, color: '#93a2bd' }));
  cta.appendChild(F.render('CLICK TO CONTINUE', { scale: 2, color: '#eaf1ff' }));
})();

var dismissed = false;
function dismiss() {
  if (dismissed) return;
  dismissed = true;
  overlay.classList.add('gone');
  setTimeout(function () { overlay.style.display = 'none'; stop(); }, 500);
}
/* anywhere on the screen, or any key - like a cabinet */
overlay.addEventListener('click', dismiss);
window.addEventListener('keydown', function (e) {
  if (dismissed) return;
  if (e.key === 'Tab') return;                 /* leave keyboard navigation alone */
  dismiss();
});

window.addEventListener('resize', function () {
  if (!running) return;
  resize(); populate();
});

resize();
populate();
raf = requestAnimationFrame(frame);

window.PixelshipIntro = { stop: stop, dismiss: dismiss, ships: function () { return ships; } };
})();
