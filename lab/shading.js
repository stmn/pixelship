/* ============================================================================
   pixelship / lab / shading.js

   SHADING PASS: binary mask (or material grid) -> shaded material grid.

   Replaces the old edge-detection "shading" (up-empty => LIGHT, down-empty =>
   DARK) with a real 2.5D lighting model:

       chamfer distance transform -> height field (bevel + body dome)
                                  -> surface normal
                                  -> lambert + wrap + rim + blinn spec
                                  -> minus ambient occlusion from concavity
                                  -> optional centre ridge (width scales with W)
                                  -> exposure / contrast / gamma
                                  -> ordered-dither quantisation to N ramp steps

   NO colours are produced here. The output carries a RAMP INDEX per pixel and
   the palette module maps (material, step) -> RGB.

   ---------------------------------------------------------------------------
   OUTPUT ENCODING  (opts.encoding, default 'packed')
   ---------------------------------------------------------------------------
   'packed'  Uint8Array, W*H. Values:
                 0            EMPTY
                 4            OUTLINE
                 >= 16        shaded solid pixel, packed as
                                  value = 16 + (materialIndex + 0) * 16 + step
                              i.e.  materialIndex = (value >> 4) - 1
                                    step          = value & 15
                              materialIndex indexes SHADEABLE_MATERIALS.
             Helpers: isShaded(v), shadeStep(v), shadeMaterial(v), pack(mi,step).

   'legacy'  Uint8Array, W*H, using only the original ids
             (EMPTY/HULL/LIGHT/DARK/OUTLINE/COCKPIT/...). HULL pixels are
             collapsed to LIGHT/HULL/DARK by ramp bucket; other materials keep
             their own id. Lossy - for old renderers only.

   The returned array also carries (as expando properties, both encodings):
       .steps      number of ramp steps
       .shade      Uint8Array W*H, ramp step per pixel, 255 for EMPTY/OUTLINE
       .mat        Uint8Array W*H, base material id per pixel, 0 for EMPTY
       .opts       resolved options actually used
   and, when opts.debug is true, .terms = { dist, height, nx, ny, lum, ao,
   rim, spec, ridge } as Float32Array(W*H) for inspection / measurement.

   Deterministic. No Math.random, no Date. Runs in the browser via <script>
   (exports on window.PixelshipShading) and in node via require().
   ========================================================================= */

var PixelshipShading = (function () {
  'use strict';

  /* material ids of the shared contract (local copies, not globals) */
  var M_EMPTY = 0, M_HULL = 1, M_LIGHT = 2, M_DARK = 3, M_OUTLINE = 4,
      M_COCKPIT = 5, M_ACCENT = 6, M_NOZZLE = 7, M_GUN = 8, M_LAMP = 9;

  /* materials that receive shading, in packing order */
  var SHADEABLE_MATERIALS = [M_HULL, M_COCKPIT, M_ACCENT, M_NOZZLE, M_GUN, M_LAMP];
  var MAT_INDEX = {};
  (function () {
    for (var i = 0; i < SHADEABLE_MATERIALS.length; i++) MAT_INDEX[SHADEABLE_MATERIALS[i]] = i;
    /* LIGHT/DARK in an input grid are legacy shading output: treat as HULL */
    MAT_INDEX[M_LIGHT] = 0;
    MAT_INDEX[M_DARK] = 0;
  })();

  var SHADE_BASE = 16;   /* first packed value */
  var MAX_STEPS = 16;    /* stride of the packing, also the hard cap on rampSteps */

  function isShaded(v) { return v >= SHADE_BASE; }
  function shadeStep(v) { return v >= SHADE_BASE ? (v & 15) : -1; }
  function shadeMaterial(v) { return v >= SHADE_BASE ? SHADEABLE_MATERIALS[(v >> 4) - 1] : v; }
  function pack(matIndex, step) { return SHADE_BASE + matIndex * MAX_STEPS + step; }

  /* --------------------------------------------------------------------- */
  /* DEFAULTS - every tunable, with its documented default                  */
  /* --------------------------------------------------------------------- */
  var DEFAULTS = {
    /* --- ramp --------------------------------------------------------- */
    rampSteps: 6,             // number of ramp indices, 2..16. 0 = darkest.
    encoding: 'packed',       // 'packed' | 'legacy'

    /* --- light -------------------------------------------------------- */
    lightAzimuthDeg: -25,     // 0 = light from screen top; negative = to the left
    lightElevationDeg: 38,    // 90 = straight at the viewer, 0 = grazing.
                              // Low-ish, so the specular lobe sits on the upper
                              // slopes, not on the flat top of the hull.
    ambient: 0.18,            // base level added everywhere
    diffuse: 0.86,            // lambert weight
    lightWrap: 0.25,          // half-lambert wrap, softens the terminator
    normalizeFlat: true,      // rescale luminance so a FLAT, viewer-facing hull
                              // pixel lands exactly on flatLevel. Without this
                              // the whole interior saturates at the top ramp
                              // step and only the rim carries any tone.
    flatLevel: 0.55,          // 0..1 ramp position of a flat hull pixel

    /* --- height field ------------------------------------------------- */
    thicknessMode: 'blend',   // 'blend' | 'sprite' | 'shape' | 'fixed'
    thicknessScale: 0.17,     // bevel width as a fraction of min(W,H)  [sprite]
    thicknessShape: 0.85,     // bevel width as a fraction of max distance [shape]
    thicknessPx: null,        // explicit bevel width in px             [fixed]
    domeStrength: 0.75,       // extra whole-body dome, x bevel thickness.
                              // 0 => flat interior (the old failure mode).
    heightProfile: 'round',   // 'round' | 'cosine' | 'linear'
    normalStrength: 1.0,      // slope multiplier before normalisation
    slopeCompensation: 'sqrt',// 'sqrt' | 'off'. The rim slope of a dome of
                              // thickness T is ~sqrt(T/2d), so without this a
                              // 16px sprite reads much flatter than a 96px one
                              // at the same settings. 'sqrt' multiplies the
                              // gradient by sqrt(slopeRefThickness / T) so the
                              // tonal falloff is size invariant.
    slopeRefThickness: 10,    // px, the thickness slopeCompensation aims at
    normalSmooth: null,       // blur radius in px for the height field; null =>
    normalSmoothScale: 0.022, //   round(normalSmoothScale * min(W,H))
    borderOpen: true,         // sprite border counts as empty for the distance TF

    /* --- ambient occlusion (concavity) -------------------------------- */
    aoStrength: 0.45,         // how much occlusion darkens
    aoRadius: null,           // px; null => round(aoRadiusScale * min(W,H))
    aoRadiusScale: 0.13,
    aoRange: 0.22,            // occupancy excess that saturates AO

    /* --- rim / specular ----------------------------------------------- */
    rimStrength: 0.35,
    rimWidth: null,           // px; null => max(rimWidthMinPx, rimWidthScale*min(W,H))
    rimWidthScale: 0.07,
    rimWidthMinPx: 2.0,       // without a floor the rim is sub-pixel at 16px and
                              // the brightest ramp step is never reached there
    rimPower: 1.6,
    rimFollowsLight: true,    // false => rim always from screen top
    specStrength: 0.22,
    specPower: 16,

    /* --- centre ridge (the old bug: constant 2-3px at every size) ------ */
    ridgeWidthMode: 'scaled', // 'scaled' (x sprite width) | 'fixed' | 'off'
    ridgeWidthScale: 0.055,   // half-width as a fraction of W   [scaled]
    ridgeWidthPx: 1.0,        // half-width in px                [fixed]
    ridgeStrength: 0.14,      // 0 disables it as surely as mode 'off'
    ridgeMinThickness: 0.35,  // only where dist >= this x bevel thickness
    ridgeMinSize: 24,         // no ridge at all below this min(W,H): at 16px a
                              // centre highlight is 12% of the sprite, i.e. noise

    /* --- tone --------------------------------------------------------- */
    exposure: 1.0,
    contrast: 1.15,
    gamma: 1.0,

    /* --- dithering ---------------------------------------------------- */
    ditherMode: 'auto',       // 'auto'|'off'|'bayer2'|'bayer4'|'bayer8'|'noise'
    ditherMinSize: 48,        // 'auto' turns dithering ON at min(W,H) >= this
    ditherAutoMatrix: 'bayer4',
    ditherStrength: 0.55,      // 0..1, fraction of one ramp step

    /* --- materials ----------------------------------------------------- */
    materialAmplitude: null,  // {materialId: 0..1} shading amplitude override;
                              // null => MATERIAL_AMPLITUDE below
    shadeAllMaterials: true,  // false => only HULL is shaded (old behaviour)

    /* --- outline ------------------------------------------------------- */
    outline: true,
    outlineDiagonal: false,   // 8-neighbour outline instead of 4-neighbour

    /* --- misc ---------------------------------------------------------- */
    rng: null,                // optional zero-arg rng, only used to jitter the
                              // dither matrix origin per sprite
    debug: false              // attach .terms with the raw float fields
  };

  /* per-material shading amplitude around the ramp mid point.
     1 = full range, 0 = flat. Emissive lamps stay near their own colour. */
  var MATERIAL_AMPLITUDE = {};
  MATERIAL_AMPLITUDE[M_HULL] = 1.00;
  MATERIAL_AMPLITUDE[M_COCKPIT] = 0.85;
  MATERIAL_AMPLITUDE[M_ACCENT] = 0.80;
  MATERIAL_AMPLITUDE[M_NOZZLE] = 0.90;
  MATERIAL_AMPLITUDE[M_GUN] = 0.90;
  MATERIAL_AMPLITUDE[M_LAMP] = 0.35;

  /* --------------------------------------------------------------------- */
  /* small helpers                                                          */
  /* --------------------------------------------------------------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function resolveOpts(opts) {
    var o = {}, k;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) o[k] = DEFAULTS[k];
    if (opts) for (k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    o.rampSteps = Math.round(clamp(o.rampSteps, 2, MAX_STEPS));
    var amp = {};
    for (k in MATERIAL_AMPLITUDE) amp[k] = MATERIAL_AMPLITUDE[k];
    if (o.materialAmplitude) for (k in o.materialAmplitude) amp[k] = o.materialAmplitude[k];
    o.materialAmplitude = amp;
    return o;
  }

  /* --------------------------------------------------------------------- */
  /* 3-4 chamfer distance transform, two passes, result in pixel units      */
  /* --------------------------------------------------------------------- */
  function distanceTransform(solid, W, H, borderOpen) {
    var d = new Float32Array(W * H), i, x, y, v;
    var INF = 1e9;
    for (i = 0; i < W * H; i++) d[i] = solid[i] ? INF : 0;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        if (d[i] === 0) continue;
        v = d[i];
        if (y > 0) {
          if (x > 0 && d[i - W - 1] + 4 < v) v = d[i - W - 1] + 4;
          if (d[i - W] + 3 < v) v = d[i - W] + 3;
          if (x < W - 1 && d[i - W + 1] + 4 < v) v = d[i - W + 1] + 4;
        }
        if (x > 0 && d[i - 1] + 3 < v) v = d[i - 1] + 3;
        if (borderOpen && (x === 0 || y === 0) && v > 3) v = 3;
        d[i] = v;
      }
    }
    for (y = H - 1; y >= 0; y--) {
      for (x = W - 1; x >= 0; x--) {
        i = y * W + x;
        if (d[i] === 0) continue;
        v = d[i];
        if (y < H - 1) {
          if (x < W - 1 && d[i + W + 1] + 4 < v) v = d[i + W + 1] + 4;
          if (d[i + W] + 3 < v) v = d[i + W] + 3;
          if (x > 0 && d[i + W - 1] + 4 < v) v = d[i + W - 1] + 4;
        }
        if (x < W - 1 && d[i + 1] + 3 < v) v = d[i + 1] + 3;
        if (borderOpen && (x === W - 1 || y === H - 1) && v > 3) v = 3;
        d[i] = v;
      }
    }
    for (i = 0; i < W * H; i++) d[i] = d[i] / 3;
    return d;
  }

  /* separable box blur, out-of-bounds treated as 0 (empty space) */
  function boxBlur(src, W, H, r) {
    if (r <= 0) return Float32Array.from(src);
    var tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    var x, y, k, s, n = 2 * r + 1;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        s = 0;
        for (k = -r; k <= r; k++) {
          var xx = x + k;
          if (xx >= 0 && xx < W) s += src[y * W + xx];
        }
        tmp[y * W + x] = s / n;
      }
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        s = 0;
        for (k = -r; k <= r; k++) {
          var yy = y + k;
          if (yy >= 0 && yy < H) s += tmp[yy * W + x];
        }
        out[y * W + x] = s / n;
      }
    }
    return out;
  }

  /* summed-area table of a 0/1 field, (W+1)*(H+1) */
  function summedArea(field, W, H) {
    var sat = new Float64Array((W + 1) * (H + 1));
    for (var y = 0; y < H; y++) {
      var rowSum = 0;
      for (var x = 0; x < W; x++) {
        rowSum += field[y * W + x] ? 1 : 0;
        sat[(y + 1) * (W + 1) + (x + 1)] = sat[y * (W + 1) + (x + 1)] + rowSum;
      }
    }
    return sat;
  }
  function satWindow(sat, W, H, x0, y0, x1, y1) {
    x0 = clamp(x0, 0, W); y0 = clamp(y0, 0, H);
    x1 = clamp(x1, 0, W); y1 = clamp(y1, 0, H);
    var s = W + 1;
    return sat[y1 * s + x1] - sat[y0 * s + x1] - sat[y1 * s + x0] + sat[y0 * s + x0];
  }

  /* --------------------------------------------------------------------- */
  /* ordered dither matrices                                                */
  /* --------------------------------------------------------------------- */
  function bayer(n) {
    if (n === 1) return [[0]];
    var half = bayer(n / 2), m = [], y, x;
    for (y = 0; y < n; y++) { m.push(new Array(n)); }
    for (y = 0; y < n / 2; y++) {
      for (x = 0; x < n / 2; x++) {
        var v = half[y][x] * 4;
        m[y][x] = v;
        m[y][x + n / 2] = v + 2;
        m[y + n / 2][x] = v + 3;
        m[y + n / 2][x + n / 2] = v + 1;
      }
    }
    return m;
  }
  var BAYER = { bayer2: bayer(2), bayer4: bayer(4), bayer8: bayer(8) };

  function resolveDither(o, W, H) {
    var mode = o.ditherMode;
    if (mode === 'auto') mode = Math.min(W, H) >= o.ditherMinSize ? o.ditherAutoMatrix : 'off';
    return mode;
  }

  /* deterministic hash noise in [0,1) */
  function hashNoise(x, y, seed) {
    var h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* --------------------------------------------------------------------- */
  /* height profiles                                                        */
  /* --------------------------------------------------------------------- */
  function profileFn(name) {
    if (name === 'linear') return function (u) { return u; };
    if (name === 'cosine') return function (u) { return 0.5 - 0.5 * Math.cos(Math.PI * u); };
    /* 'round': circular cross section, steep at the rim, flat on top */
    return function (u) { var t = 1 - u; return Math.sqrt(Math.max(0, 1 - t * t)); };
  }

  /* --------------------------------------------------------------------- */
  /* MAIN                                                                   */
  /* --------------------------------------------------------------------- */
  /**
   * shadeMask(mask, W, H, opts) -> Uint8Array (material grid, see header)
   *
   * mask: Uint8Array(W*H). 0 = empty, anything else = solid. If a value is a
   *       material id (COCKPIT/ACCENT/NOZZLE/GUN/LAMP) that material is kept
   *       as the base material of the pixel and IS shaded. OUTLINE in the
   *       input is ignored (treated as empty) and regenerated.
   * opts: see DEFAULTS.
   */
  function shadeMask(mask, W, H, opts) {
    var o = resolveOpts(opts);
    var N = W * H, i, x, y;
    var steps = o.rampSteps;

    /* ---- 1. solidity + base materials --------------------------------- */
    var solid = new Uint8Array(N);
    var baseMat = new Uint8Array(N);
    var anySolid = false;
    for (i = 0; i < N; i++) {
      var v = mask[i];
      if (!v || v === M_OUTLINE) continue;
      solid[i] = 1; anySolid = true;
      baseMat[i] = (MAT_INDEX[v] !== undefined) ? v : M_HULL;
      if (v === M_LIGHT || v === M_DARK) baseMat[i] = M_HULL;
    }

    var out = new Uint8Array(N);
    var shadeField = new Uint8Array(N); shadeField.fill(255);
    if (!anySolid) {
      out.steps = steps; out.shade = shadeField; out.mat = baseMat; out.opts = o;
      if (o.debug) out.terms = emptyTerms(N);
      return out;
    }

    /* ---- 2. distance transform ---------------------------------------- */
    var dist = distanceTransform(solid, W, H, o.borderOpen);
    var maxD = 0;
    for (i = 0; i < N; i++) if (dist[i] > maxD) maxD = dist[i];
    if (maxD <= 0) maxD = 1;

    /* ---- 3. bevel thickness (scales with sprite size) ------------------ */
    var S = Math.min(W, H);
    var tSprite = o.thicknessScale * S;
    var tShape = o.thicknessShape * maxD;
    var T;
    if (o.thicknessMode === 'sprite') T = tSprite;
    else if (o.thicknessMode === 'shape') T = tShape;
    else if (o.thicknessMode === 'fixed') T = (o.thicknessPx != null ? o.thicknessPx : tSprite);
    else T = Math.min(tSprite, tShape);          /* 'blend' */
    T = Math.max(0.75, T);

    /* ---- 4. height field: local bevel + whole-body dome ---------------- */
    var prof = profileFn(o.heightProfile);
    var z = new Float32Array(N);
    for (i = 0; i < N; i++) {
      if (!solid[i]) { z[i] = 0; continue; }
      var d = dist[i];
      var zb = T * prof(clamp(d / T, 0, 1));
      var zd = o.domeStrength * T * prof(clamp(d / maxD, 0, 1));
      z[i] = zb + zd;
    }
    var smoothR = (o.normalSmooth != null) ? Math.round(o.normalSmooth)
                                           : Math.round(o.normalSmoothScale * S);
    var zs = boxBlur(z, W, H, Math.max(0, smoothR));

    /* ---- 5. light vectors --------------------------------------------- */
    var az = o.lightAzimuthDeg * Math.PI / 180, el = o.lightElevationDeg * Math.PI / 180;
    var lx = Math.sin(az) * Math.cos(el);
    var ly = -Math.cos(az) * Math.cos(el);      /* screen y grows downward */
    var lz = Math.sin(el);
    var ln = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    lx /= ln; ly /= ln; lz /= ln;
    /* half vector for blinn-phong, view = (0,0,1) */
    var hx = lx, hy = ly, hz = lz + 1;
    var hn = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
    hx /= hn; hy /= hn; hz /= hn;
    var rx = o.rimFollowsLight ? lx : 0;
    var ry = o.rimFollowsLight ? ly : -1;
    var rz = o.rimFollowsLight ? lz : 0;
    var rn = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    rx /= rn; ry /= rn; rz /= rn;

    /* ---- 6. AO: concavity from local occupancy vs a straight edge ------ */
    var aoR = (o.aoRadius != null) ? Math.round(o.aoRadius)
                                   : Math.max(1, Math.round(o.aoRadiusScale * S));
    var sat = summedArea(solid, W, H);
    var winArea = (2 * aoR + 1) * (2 * aoR + 1);

    /* ---- 7. per-pixel shade ------------------------------------------- */
    var rimW = (o.rimWidth != null) ? o.rimWidth : Math.max(o.rimWidthMinPx, o.rimWidthScale * S);
    var cxAxis = (W - 1) / 2;
    var ridgeW;
    if (o.ridgeWidthMode === 'off' || S < o.ridgeMinSize) ridgeW = 0;
    else if (o.ridgeWidthMode === 'fixed') ridgeW = o.ridgeWidthPx;
    else ridgeW = o.ridgeWidthScale * W;                       /* 'scaled' */

    /* size-invariant tonal falloff: see slopeCompensation in DEFAULTS */
    var slopeComp = o.slopeCompensation === 'sqrt'
      ? Math.sqrt(o.slopeRefThickness / T) : 1;
    var slopeK = 0.5 * o.normalStrength * slopeComp;

    var ditherMode = resolveDither(o, W, H);
    var dm = BAYER[ditherMode] || null;
    var dSize = dm ? dm.length : 0;
    var dJitterX = 0, dJitterY = 0, noiseSeed = 1;
    if (o.rng) {
      dJitterX = Math.floor(o.rng() * 8);
      dJitterY = Math.floor(o.rng() * 8);
      noiseSeed = 1 + Math.floor(o.rng() * 65535);
    }

    var terms = o.debug ? emptyTerms(N) : null;
    var mid = (steps - 1) / 2;

    /* gain that puts a flat, viewer-facing hull pixel on o.flatLevel */
    var gain = 1;
    if (o.normalizeFlat) {
      var diffFlat = clamp((lz + o.lightWrap) / (1 + o.lightWrap), 0, 1);
      var specFlat = Math.pow(clamp(hz, 0, 1), o.specPower);
      var lumFlat = o.ambient + o.diffuse * diffFlat + o.specStrength * specFlat;
      if (lumFlat > 1e-6) gain = o.flatLevel / lumFlat;
    }

    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        if (!solid[i]) continue;
        var d = dist[i];

        /* normal from the gradient of the (smoothed) height field */
        var zl = x > 0 ? zs[i - 1] : 0, zr = x < W - 1 ? zs[i + 1] : 0;
        var zu = y > 0 ? zs[i - W] : 0, zd2 = y < H - 1 ? zs[i + W] : 0;
        var gx = (zr - zl) * slopeK;
        var gy = (zd2 - zu) * slopeK;
        var nx = -gx, ny = -gy, nz = 1;
        var nl2 = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl2; ny /= nl2; nz /= nl2;

        /* diffuse with wrap */
        var ndl = nx * lx + ny * ly + nz * lz;
        var diff = clamp((ndl + o.lightWrap) / (1 + o.lightWrap), 0, 1);

        /* ambient occlusion: occupancy above what a straight edge would give */
        var occ = satWindow(sat, W, H, x - aoR, y - aoR, x + aoR + 1, y + aoR + 1) / winArea;
        var expected = clamp(0.5 + 0.5 * (d / aoR), 0.5, 1);
        var ao = clamp((occ - expected) / o.aoRange, 0, 1);

        /* rim: light-facing surface close to the silhouette */
        var ndr = clamp(nx * rx + ny * ry + nz * rz, 0, 1);
        var edge = clamp(1 - d / rimW, 0, 1);
        var rim = Math.pow(ndr, o.rimPower) * edge;

        /* specular */
        var ndh = clamp(nx * hx + ny * hy + nz * hz, 0, 1);
        var spec = Math.pow(ndh, o.specPower);

        /* centre ridge - width scales with W (mode 'scaled') */
        var ridge = 0;
        if (ridgeW > 0 && o.ridgeStrength !== 0 && d >= o.ridgeMinThickness * T) {
          var u = (x - cxAxis) / ridgeW;
          ridge = o.ridgeStrength * Math.exp(-u * u);
        }

        var lum = o.ambient + o.diffuse * diff
                + o.rimStrength * rim
                + o.specStrength * spec
                + ridge
                - o.aoStrength * ao;

        lum *= gain * o.exposure;
        lum = (lum - 0.5) * o.contrast + 0.5;
        lum = clamp(lum, 0, 1);
        if (o.gamma !== 1) lum = Math.pow(lum, o.gamma);

        /* --- material amplitude: EVERY solid material is shaded --------- */
        var bm = baseMat[i];
        var amp = o.shadeAllMaterials ? (o.materialAmplitude[bm] != null ? o.materialAmplitude[bm] : 1)
                                      : (bm === M_HULL ? 1 : 0);

        /* --- quantise --------------------------------------------------- */
        var t = lum * (steps - 1);
        t = mid + (t - mid) * amp;
        var dith = 0;
        if (dm) {
          var bv = dm[(y + dJitterY) % dSize][(x + dJitterX) % dSize] / (dSize * dSize);
          dith = (bv - 0.5 + 0.5 / (dSize * dSize)) * o.ditherStrength;
        } else if (ditherMode === 'noise') {
          dith = (hashNoise(x, y, noiseSeed) - 0.5) * o.ditherStrength;
        }
        var step = Math.round(t + dith);
        step = clamp(step, 0, steps - 1);

        shadeField[i] = step;
        out[i] = pack(MAT_INDEX[bm] !== undefined ? MAT_INDEX[bm] : 0, step);

        if (terms) {
          terms.dist[i] = d; terms.height[i] = z[i];
          terms.nx[i] = nx; terms.ny[i] = ny;
          terms.lum[i] = lum; terms.ao[i] = ao;
          terms.rim[i] = rim; terms.spec[i] = spec; terms.ridge[i] = ridge;
        }
      }
    }

    /* ---- 8. outline ---------------------------------------------------- */
    if (o.outline) {
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          i = y * W + x;
          if (solid[i]) continue;
          var n4 = (x > 0 && solid[i - 1]) || (x < W - 1 && solid[i + 1]) ||
                   (y > 0 && solid[i - W]) || (y < H - 1 && solid[i + W]);
          if (!n4 && o.outlineDiagonal) {
            n4 = (x > 0 && y > 0 && solid[i - W - 1]) || (x < W - 1 && y > 0 && solid[i - W + 1]) ||
                 (x > 0 && y < H - 1 && solid[i + W - 1]) || (x < W - 1 && y < H - 1 && solid[i + W + 1]);
          }
          if (n4) out[i] = M_OUTLINE;
        }
      }
    }

    var result = out;
    if (o.encoding === 'legacy') result = toLegacyGrid(out, W, H, steps);

    result.steps = steps;
    result.shade = shadeField;
    result.mat = baseMat;
    result.opts = o;
    result.thickness = T;
    result.aoRadius = aoR;
    result.ridgeHalfWidth = ridgeW;
    if (terms) result.terms = terms;
    return result;
  }

  function emptyTerms(N) {
    return {
      dist: new Float32Array(N), height: new Float32Array(N),
      nx: new Float32Array(N), ny: new Float32Array(N),
      lum: new Float32Array(N), ao: new Float32Array(N),
      rim: new Float32Array(N), spec: new Float32Array(N), ridge: new Float32Array(N)
    };
  }

  /* --------------------------------------------------------------------- */
  /* conversions                                                            */
  /* --------------------------------------------------------------------- */

  /* packed -> old 10-material grid (lossy, for legacy renderers) */
  function toLegacyGrid(grid, W, H, steps) {
    steps = steps || grid.steps || DEFAULTS.rampSteps;
    var out = new Uint8Array(W * H);
    for (var i = 0; i < W * H; i++) {
      var v = grid[i];
      if (v < SHADE_BASE) { out[i] = v; continue; }
      var mat = SHADEABLE_MATERIALS[(v >> 4) - 1];
      var step = v & 15;
      if (mat === M_HULL) {
        var f = step / (steps - 1);
        out[i] = f < 0.34 ? M_DARK : (f > 0.66 ? M_LIGHT : M_HULL);
      } else out[i] = mat;
    }
    return out;
  }

  /* packed -> Uint8Array of ramp steps, 255 where not shaded */
  function rampField(grid, W, H) {
    if (grid.shade) return grid.shade;
    var out = new Uint8Array(W * H); out.fill(255);
    for (var i = 0; i < W * H; i++) if (grid[i] >= SHADE_BASE) out[i] = grid[i] & 15;
    return out;
  }

  /* ASCII ramp map, one char per pixel - a human-readable debug view */
  function toAscii(grid, W, H, chars) {
    chars = chars || ' .:-=+*#%@';
    var steps = grid.steps || DEFAULTS.rampSteps;
    var lines = [];
    for (var y = 0; y < H; y++) {
      var s = '';
      for (var x = 0; x < W; x++) {
        var v = grid[y * W + x];
        if (v === M_EMPTY) s += ' ';
        else if (v === M_OUTLINE) s += ',';
        else {
          var step = v >= SHADE_BASE ? (v & 15) : 0;
          var k = Math.round(step / (steps - 1) * (chars.length - 1));
          s += chars[k];
        }
      }
      lines.push(s);
    }
    return lines.join('\n');
  }

  return {
    shadeMask: shadeMask,
    distanceTransform: distanceTransform,
    boxBlur: boxBlur,
    toLegacyGrid: toLegacyGrid,
    rampField: rampField,
    toAscii: toAscii,
    isShaded: isShaded,
    shadeStep: shadeStep,
    shadeMaterial: shadeMaterial,
    pack: pack,
    SHADE_BASE: SHADE_BASE,
    MAX_STEPS: MAX_STEPS,
    SHADEABLE_MATERIALS: SHADEABLE_MATERIALS,
    MATERIAL_AMPLITUDE: MATERIAL_AMPLITUDE,
    DEFAULTS: DEFAULTS
  };
})();

if (typeof module !== 'undefined') module.exports = PixelshipShading;
else if (typeof window !== 'undefined') window.PixelshipShading = PixelshipShading;
