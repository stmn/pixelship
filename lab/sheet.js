/* Contact-sheet renderer: composes shape + mounts + shading + palette into a PNG.
   Node-only dev tool (not part of the browser bundle). Usage:
     node lab/sheet.js [out.png] [size] [cols] [rows] [seedBase]                */

var zlib = require('zlib');
var fs = require('fs');
var C = require('./compose.js');

/* ---------- minimal PNG writer (RGBA8, filter 0) ---------- */
function crc32(buf) {
  var t = crc32.table;
  if (!t) {
    t = crc32.table = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
  }
  var crc = -1;
  for (var i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function writePNG(path, W, H, rgba) {
  var raw = Buffer.alloc(H * (W * 4 + 1));
  for (var y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/* one ship -> array of RGB pixels (composition + colour rules live in compose.js) */
function renderShip(seed, size, opts) {
  var ship = C.composeShip(seed, size, opts || {});
  var px = new Array(ship.W * ship.H);
  for (var q = 0; q < ship.W * ship.H; q++) {
    var m = ship.mats[q];
    px[q] = m === 0 ? null : C.colorFor(m, ship.steps[q], ship.pal, ship.rampSteps);
  }
  return { px: px, W: ship.W, H: ship.H, mounts: ship.mounts, meta: ship.meta };
}

/* ---------- contact sheet ---------- */
function sheet(opts) {
  var size = opts.size, cols = opts.cols, rows = opts.rows, scale = opts.scale || 4;
  var pad = 6, cell = size * scale + pad * 2;
  var SW = cols * cell, SH_ = rows * cell;
  var buf = Buffer.alloc(SW * SH_ * 4);
  for (var i = 0; i < SW * SH_; i++) {
    buf[i * 4] = 8; buf[i * 4 + 1] = 10; buf[i * 4 + 2] = 16; buf[i * 4 + 3] = 255;
  }
  var stats = { zeroEngines: 0, n: 0 };
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
    var seed = (opts.seedBase + (r * cols + c) * 2654435761) | 0;
    var ship = renderShip(seed, size, opts.ship || {});
    stats.n++;
    if (!ship.mounts.engines.length) stats.zeroEngines++;
    var ox = c * cell + pad, oy = r * cell + pad;
    for (var y = 0; y < ship.H; y++) for (var x = 0; x < ship.W; x++) {
      var col = ship.px[y * ship.W + x];
      if (!col) continue;
      for (var sy = 0; sy < scale; sy++) for (var sx = 0; sx < scale; sx++) {
        var X = ox + x * scale + sx, Y = oy + y * scale + sy;
        if (X < 0 || Y < 0 || X >= SW || Y >= SH_) continue;
        var o = (Y * SW + X) * 4;
        buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255;
      }
    }
  }
  writePNG(opts.out, SW, SH_, buf);
  return stats;
}

if (require.main === module) {
  var out = process.argv[2] || 'lab/out/sheet.png';
  var size = parseInt(process.argv[3] || '40', 10);
  var cols = parseInt(process.argv[4] || '8', 10);
  var rows = parseInt(process.argv[5] || '4', 10);
  var seedBase = parseInt(process.argv[6] || '1337', 10);
  var st = sheet({ out: out, size: size, cols: cols, rows: rows, seedBase: seedBase,
                   scale: Math.max(2, Math.round(160 / size)) });
  console.log('wrote', out, JSON.stringify(st));
}

if (typeof module !== 'undefined') module.exports = { renderShip: renderShip, sheet: sheet, writePNG: writePNG };
