/* build.js - assembles the itch.io HTML5 bundles.
   itch serves the zip's index.html inside an iframe, so everything must be
   relative, self-contained, and index.html must sit at the zip root.

   Two targets:
     dist/       the generator     -> pixelship-itch.zip
     dist-game/  the sprite demo   -> pixelship-sprites-demo-itch.zip

   The game lives in game/ and loads ../lab/... during development. A zip has no
   "one level up", so its script paths are rewritten while bundling.

   Run: node build.js                                                          */
var fs = require('fs');
var path = require('path');

var ROOT = __dirname;

var TOOL = {
  name: 'generator',
  out: 'dist',
  zip: 'pixelship-itch.zip',
  entry: 'index.html',
  files: [
    'index.html',
    'lab/shape.js', 'lab/shading.js', 'lab/palette.js', 'lab/mounts.js',
    'lab/compose.js', 'lab/bank.js', 'lab/families.js', 'lab/controls.js',
    'lab/sprite.js',
    'app/storage.js', 'app/icons.js', 'app/tooltip.js', 'app/draw.js', 'app/pixelfont.js', 'app/app.js', 'app/intro.js',
  ],
  rewrite: [],
};

var GAME = {
  name: 'sprites demonstration',
  out: 'dist-game',
  zip: 'pixelship-sprites-demo-itch.zip',
  entry: 'index.html',
  /* [source, destination inside the bundle] */
  files: [
    ['game/index.html', 'index.html'],
    ['game/game.js', 'game.js'],
    ['game/audio.js', 'audio.js'],
    ['lab/shape.js', 'lab/shape.js'], ['lab/shading.js', 'lab/shading.js'],
    ['lab/palette.js', 'lab/palette.js'], ['lab/mounts.js', 'lab/mounts.js'],
    ['lab/compose.js', 'lab/compose.js'], ['lab/bank.js', 'lab/bank.js'],
    ['lab/families.js', 'lab/families.js'], ['lab/sprite.js', 'lab/sprite.js'],
    ['app/pixelfont.js', 'app/pixelfont.js'],
  ],
  /* flatten the development ../ paths onto the zip root */
  rewrite: [[/src="\.\.\//g, 'src="']],
};

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.readdirSync(p).forEach(function (f) {
    var full = path.join(p, f);
    if (fs.statSync(full).isDirectory()) rmrf(full);
    else fs.unlinkSync(full);
  });
  fs.rmdirSync(p);
}

function bundle(target) {
  var dist = path.join(ROOT, target.out);
  rmrf(dist);
  fs.mkdirSync(dist, { recursive: true });

  var total = 0, dests = [];
  target.files.forEach(function (entry) {
    var src = Array.isArray(entry) ? entry[0] : entry;
    var dst = Array.isArray(entry) ? entry[1] : entry;
    var from = path.join(ROOT, src);
    if (!fs.existsSync(from)) throw new Error(target.name + ': missing build input ' + src);
    var buf = fs.readFileSync(from);
    if (/\.html$/.test(dst) && target.rewrite.length) {
      var text = buf.toString('utf8');
      target.rewrite.forEach(function (r) { text = text.replace(r[0], r[1]); });
      buf = Buffer.from(text, 'utf8');
    }
    var to = path.join(dist, dst);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, buf);
    total += buf.length;
    dests.push(dst);
  });

  /* Every <script src> in the entry page must exist in the bundle, or the game
     is a white screen on itch and nobody finds out until a player complains. */
  var html = fs.readFileSync(path.join(dist, target.entry), 'utf8');
  var refs = (html.match(/<script src="([^"]+)"/g) || []).map(function (m) {
    return m.replace(/<script src="/, '').replace(/"$/, '');
  });
  var missing = refs.filter(function (r) { return dests.indexOf(r) < 0; });
  if (missing.length) throw new Error(target.name + ': entry page loads files not in the bundle: ' + missing.join(', '));
  var escapes = refs.filter(function (r) { return r.indexOf('../') === 0 || /^https?:/.test(r); });
  if (escapes.length) throw new Error(target.name + ': paths escape the bundle root: ' + escapes.join(', '));

  console.log('  ' + target.out.padEnd(11) + target.files.length + ' files, ' +
              (total / 1024).toFixed(1) + ' KB, ' + refs.length + ' scripts, all present and local');
  return { dist: dist, zip: target.zip };
}

var built = [TOOL, GAME].map(bundle);
console.log('\n  next, from the project root:');
built.forEach(function (b) {
  console.log('    (cd ' + path.basename(b.dist) + ' && zip -qr ../' + b.zip + ' . -x ".*")');
});
