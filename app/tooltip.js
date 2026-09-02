/* tooltip.js - styled tooltips, because the native ones take a second to show,
   cannot be styled, and look like OS chrome inside an itch iframe.

   No library: this page must open straight off the disk with no build step and
   no network, and the whole thing is under 60 lines anyway.

   Anything carrying `title` gets one. The attribute is moved to `data-tip` on
   first hover so the browser never draws its own on top of ours.             */
(function (root) {
'use strict';

var el = null, timer = null, current = null;
var DELAY = 90;

function box() {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'tip';
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);
  return el;
}

function textFor(node) {
  var t = node.getAttribute('data-tip');
  if (t) return t;
  t = node.getAttribute('title');
  if (t) {
    /* move it out of `title` so the native tooltip stops competing */
    node.setAttribute('data-tip', t);
    node.removeAttribute('title');
  }
  return t;
}

/* A tooltip that repeats a label you can already read is noise. The toolbar
   hides its <span> with CSS at narrow widths - only then is the tip useful. */
function labelVisible(node, text) {
  var spans = node.getElementsByTagName('span');
  for (var i = 0; i < spans.length; i++) {
    if (spans[i].textContent.trim() !== text) continue;
    if (spans[i].offsetParent === null) continue;              /* display:none */
    if (spans[i].offsetWidth === 0 && spans[i].offsetHeight === 0) continue;
    return true;
  }
  return false;
}

function show(node) {
  var text = textFor(node);
  if (!text) return;
  if (labelVisible(node, text)) return;
  var b = box();
  b.textContent = text;
  b.classList.add('on');

  var r = node.getBoundingClientRect();
  var w = b.offsetWidth, h = b.offsetHeight, gap = 8;
  var x = r.left + r.width / 2 - w / 2;
  var y = r.top - h - gap;
  var below = y < 4;
  if (below) y = r.bottom + gap;
  /* keep it on screen - the panel hugs the left edge and the toolbar the right */
  x = Math.max(6, Math.min(x, root.innerWidth - w - 6));
  b.classList.toggle('below', below);
  b.style.left = Math.round(x) + 'px';
  b.style.top = Math.round(y) + 'px';
}

function hide() {
  if (timer) { clearTimeout(timer); timer = null; }
  current = null;
  if (el) el.classList.remove('on');
}

function target(node) {
  while (node && node !== document.body) {
    if (node.getAttribute && (node.getAttribute('data-tip') || node.getAttribute('title'))) return node;
    node = node.parentNode;
  }
  return null;
}

document.addEventListener('mouseover', function (ev) {
  var t = target(ev.target);
  if (!t || t === current) return;
  hide();
  current = t;
  timer = setTimeout(function () { if (current === t) show(t); }, DELAY);
});
document.addEventListener('mouseout', function (ev) {
  var t = target(ev.target);
  if (t && t === current) hide();
});
/* a tooltip left hanging after a click that rebuilt the DOM looks broken */
document.addEventListener('mousedown', hide, true);
root.addEventListener('blur', hide);
root.addEventListener('scroll', hide, true);

root.PixelshipTooltip = { hide: hide, show: show };
})(typeof self !== 'undefined' ? self : this);
