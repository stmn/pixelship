/* ===========================================================================
   pixelship / palette.js
   Hue-shifted colour ramps for the procedural pixel-art spaceship generator.

   Loads both as a browser <script> tag and via node require().
   No imports, no dependencies, no ES module syntax, no Math.random, no Date.

   WHY THIS EXISTS
   ---------------
   The prototype palette was a pure value ramp: one hue, three lightnesses. The
   audit measured a 1.28 degree hue spread across LIGHT/HULL/DARK; re-running the
   prototype's own makePalette over 3000 seeds here measures 15.0 degrees median
   with an HSL-hue estimator (the prototype hardcodes h, h+5, h-10, so 15 is the
   ceiling that construction can ever reach). Either number says the same thing:
   the ramp is a value ramp, it reads as plastic, and the eye gets no chromatic
   information about form. The outline was drawn at L=0.07 with the hull hue,
   which against a #0b0e14 space background measures dE2000 6.5 / Rec.709 luma
   delta 4.4 - i.e. invisible.

   The fix a pixel artist would use:
     * hue shifting - shadows rotate toward blue/violet, highlights rotate
       toward yellow/warm, so a single material carries a chromatic arc,
     * saturation peaking in the mid-dark steps and falling off at the top step
       so the highlight cools toward near-white instead of turning into neon,
     * ramps AUTHORED BY HAND, not sampled from a random hue, so the output
       does not look procedurally generated,
     * a bounded global hue rotation per generation, so each authored ramp is a
       family of related colourways rather than one fixed look,
     * accent / glow chosen in a controlled harmonic relationship to the hull
       hue with an enforced minimum perceptual contrast,
     * an outline whose contrast is enforced against BOTH the space background
       and the hull, because those are the two things it has to separate.

   COLOUR MATH
   -----------
   All perceptual measurements use CIE Lab (D65, 2 degree observer) computed
   from sRGB. Two distance metrics are implemented from scratch:
     deltaE76   - plain euclidean distance in Lab, cheap, slightly over-weights
                  saturated blues,
     deltaE2000 - CIEDE2000, the default, used for every constraint in here.

   =========================================================================== */

/* material ids from the shared contract (kept in an object, NOT as bare
   top-level consts, so this file cannot collide with another module that
   declares EMPTY/HULL/... at script scope in the browser) */
var PALETTE_MATERIALS = {
  EMPTY: 0, HULL: 1, LIGHT: 2, DARK: 3, OUTLINE: 4,
  COCKPIT: 5, ACCENT: 6, NOZZLE: 7, GUN: 8, LAMP: 9
};

/* ---------------------------------------------------------------------------
   THE HAND-AUTHORED RAMPS
   ---------------------------------------------------------------------------
   Each ramp is an array of [hue_deg, saturation_0_1, lightness_0_1], ordered
   value-first: index 0 is the deepest shadow, index N-1 is the highlight.

   Read any row down the lightness column and it climbs monotonically.
   Read the hue column and it swings: cold (blue/violet) at the bottom, warm
   (amber/yellow) at the top. Read the saturation column and it arches: it
   peaks at step 1 or 2 (the mid-darks, where chroma is most legible) and drops
   at the last step so the highlight desaturates toward near-white.

   These 12 names are the UI dropdown.

   DESIGN BUDGET (verified by palette.test.js over 12 ramps x 500 seeds):
     adjacent-step CIEDE2000 stays inside [6, 36] for every ramp at the default
     6 steps. Below 6 two steps stop reading as different pixels; above ~36 the
     ramp bands. The one deliberate exception to "even spacing" is the last step
     of each ramp, which is a warm near-white highlight and is allowed to sit at
     the top of that budget - that pop is the point.
   --------------------------------------------------------------------------- */
var PALETTE_RAMPS = {

  /* cold industrial steel - the default "human military" look */
  gunmetal:  [[252,0.30,0.09],[240,0.38,0.18],[224,0.31,0.30],[208,0.20,0.44],[188,0.12,0.61],[ 46,0.14,0.82]],

  /* insect carapace: deep violet body, amber sheen */
  chitin:    [[280,0.46,0.07],[292,0.58,0.15],[318,0.52,0.26],[340,0.44,0.39],[  8,0.48,0.55],[ 40,0.38,0.76]],

  /* rusted iron, salvage hull */
  oxide:     [[266,0.34,0.09],[300,0.48,0.17],[350,0.58,0.28],[ 16,0.56,0.41],[ 32,0.48,0.57],[ 46,0.32,0.78]],

  /* glacial blue, a warm kiss of sun only on the top step */
  ice:       [[244,0.40,0.12],[230,0.50,0.23],[212,0.44,0.36],[196,0.34,0.53],[184,0.22,0.71],[ 50,0.12,0.90]],

  /* polished brass / gold */
  brass:     [[292,0.34,0.10],[330,0.50,0.19],[  8,0.56,0.30],[ 30,0.54,0.44],[ 45,0.46,0.62],[ 56,0.30,0.85]],

  /* low-key stealth hull, almost black, violet bias.
     Deliberately the hardest ramp for the outline: its mid value is dark, so it
     is the worst case every measurement below is reported against. */
  "void":    [[262,0.38,0.07],[248,0.48,0.15],[232,0.42,0.26],[216,0.32,0.38],[196,0.20,0.53],[ 44,0.13,0.74]],

  /* oxidised copper */
  verdigris: [[250,0.34,0.09],[224,0.44,0.17],[190,0.44,0.27],[168,0.40,0.40],[150,0.30,0.57],[ 58,0.24,0.82]],

  /* pale ceramic / ivory, civilian hulls */
  bone:      [[268,0.24,0.15],[296,0.32,0.27],[340,0.28,0.42],[ 12,0.26,0.57],[ 36,0.22,0.73],[ 52,0.14,0.92]],

  /* blood red, high-contrast raider */
  crimson:   [[280,0.42,0.09],[314,0.56,0.17],[346,0.60,0.28],[  4,0.58,0.41],[ 20,0.52,0.58],[ 38,0.34,0.80]],

  /* deep saturated blue, navy */
  cobalt:    [[270,0.46,0.10],[256,0.58,0.19],[238,0.54,0.31],[222,0.46,0.45],[204,0.32,0.63],[ 44,0.16,0.86]],

  /* dark green lacquer */
  jade:      [[256,0.36,0.08],[218,0.46,0.16],[180,0.46,0.26],[158,0.44,0.37],[138,0.32,0.54],[ 62,0.22,0.80]],

  /* toxic yellow-green, hazard hull */
  sulphur:   [[288,0.36,0.09],[322,0.48,0.18],[ 12,0.54,0.29],[ 36,0.50,0.42],[ 60,0.44,0.60],[ 82,0.28,0.84]]
};

var PALETTE_RAMP_NAMES = Object.keys(PALETTE_RAMPS);

/* Faction hues for team recolouring. Values are absolute hue degrees; the
   special value null means "desaturate to neutral". */
var PALETTE_TEAM_PRESETS = {
  red: 2, orange: 28, yellow: 52, lime: 92, green: 132, teal: 174,
  cyan: 190, blue: 214, indigo: 250, violet: 282, magenta: 320, neutral: null
};

/* ---------------------------------------------------------------------------
   DEFAULT OPTIONS - every tunable lives here, flat, English, documented.
   --------------------------------------------------------------------------- */
var PALETTE_DEFAULTS = {

  /* --- ramp selection ---------------------------------------------------- */
  rampName: null,            /* string|null  force a named ramp; null = pick with rng */
  rampNames: null,           /* string[]|null  subset to pick from; null = all 12 */
  steps: 6,                  /* int    number of output ramp steps (>=3). Authored
                                length is 6; other values are resampled along the
                                authored hue path (hues are unwrapped first, so a
                                ramp that sweeps 252->46 is followed, not short-arced) */

  /* --- per-generation colourway variation -------------------------------- */
  hueRotation: null,         /* number|null  force an exact global rotation in degrees;
                                null = draw uniformly from +/- hueRotationMax */
  hueRotationMax: 24,        /* number degrees. 0 disables variation entirely */
  hueRotationSnap: 0,        /* number degrees. >0 quantises the rotation (e.g. 12 gives
                                a discrete set of colourways per ramp) */
  saturationJitterMax: 0.12, /* number  multiplicative, +/- this fraction */
  lightnessJitterMax: 0.04,  /* number  additive, +/- this, weighted toward mid steps
                                so the endpoints do not clip */
  saturationScale: 1.0,      /* number  deterministic global saturation multiplier */
  lightnessOffset: 0.0,      /* number  deterministic global lightness offset */
  contrastBoost: 1.0,        /* number  >1 pushes steps away from the ramp mean L,
                                <1 flattens the ramp */

  /* --- where the three hull materials sit on the ramp (0..1 positions) ---- */
  darkPosition: 0.22,        /* number  DARK material sample position */
  hullPosition: 0.50,        /* number  HULL material sample position */
  lightPosition: 0.78,       /* number  LIGHT material sample position */

  /* --- accent (stripes, panels, insignia) -------------------------------- */
  accentMode: "split",       /* "split" | "complement" | "triad" | "analogous" | "fixed" */
  accentHue: null,           /* number|null  absolute hue, only used by accentMode "fixed" */
  accentHueJitter: 8,        /* number degrees of rng wobble on the harmonic offset */
  accentSaturation: 0.78,    /* number 0..1 */
  accentLightness: 0.54,     /* number 0..1 */
  minAccentHullDeltaE: 28,   /* number  enforced CIEDE2000 vs the HULL colour */

  /* --- glow (lamps, engine core, cockpit tint source) --------------------- */
  glowMode: "accent",        /* "accent" | "complement" | "warm" | "fixed" */
  glowHue: null,             /* number|null  absolute hue for glowMode "fixed" */
  glowHueOffset: 10,         /* number degrees applied on top of the chosen glow hue */
  glowSaturation: 0.92,      /* number 0..1 */
  glowLightness: 0.66,       /* number 0..1  starting lightness */
  glowLightnessMax: 0.93,    /* number 0..1  ceiling while satisfying its contrasts */
  glowHueEscapeStep: 18,     /* number degrees rotated per retry when brightening alone
                                cannot separate the glow from the accent */
  minGlowHullDeltaE: 34,     /* number  enforced vs HULL */
  minGlowAccentDeltaE: 12,   /* number  enforced vs ACCENT so lamps read on top of stripes */

  /* --- outline ------------------------------------------------------------ */
  background: "#0b0e14",     /* string|[r,g,b]  the space background it must read against */
  outlineMode: "hueBlack",   /* "hueBlack" | "black" | "rampDark"
                                hueBlack  - near-black carrying the shadow hue (default)
                                black     - pure #000
                                rampDark  - darkest ramp step, further darkened */
  outlineLightness: 0.09,    /* number  starting L for "hueBlack" */
  outlineLightnessMax: 0.26, /* number  ceiling while satisfying background contrast */
  outlineContrastPriority: "background", /* "background" | "hull" | "balanced"
                                which constraint gives way when a very low-key ramp
                                cannot satisfy both at once */
  outlineSaturationScale: 1.15, /* number  chroma multiplier vs the shadow step */
  outlineHueShift: 0,        /* number degrees off the shadow hue */
  outlineDarken: 0.45,       /* number  L multiplier for "rampDark" */
  outlineEnforceContrast: true, /* bool  lift L until minOutlineBgDeltaE is met */
  minOutlineBgDeltaE: 12,    /* number  enforced vs `background` (CIEDE2000) */
  minOutlineBgLumaDelta: 8,  /* number 0..255  ALSO enforced vs `background`, on Rec.709
                                luma. dE2000 alone can be satisfied by chroma at equal
                                brightness, which does not hold up at 1px on a dark
                                background - this forces a real value step as well */
  minOutlineHullDeltaE: 18,  /* number  enforced vs HULL (outline must not vanish INTO the ship) */

  /* --- cockpit ------------------------------------------------------------ */
  cockpitMode: "glow",       /* "glow" | "accent" | "complement" | "ramp" */
  cockpitHueOffset: 0,       /* number degrees */
  cockpitSaturation: 0.62,   /* number 0..1 */
  cockpitLightness: 0.44,    /* number 0..1  glassy, darker than the lamp */
  minCockpitHullDeltaE: 24,  /* number  enforced vs HULL */

  /* --- nozzle / gun (dark mechanical bits) -------------------------------- */
  nozzleDarken: 0.55,        /* number  L multiplier off the darkest ramp step */
  gunDesaturate: 0.45,       /* number  S multiplier for gun metal */
  gunLightness: null,        /* number|null  absolute L; null = ramp step 1 lightness */
  minPartOutlineDeltaE: 6,   /* number  keeps NOZZLE/GUN from being pixel-identical to OUTLINE */
  minGunNozzleDeltaE: 6,     /* number  keeps the gun barrel readable next to a nozzle */

  /* --- team colour -------------------------------------------------------- */
  teamIndices: null,         /* int[]|null  ramp indices swappable for faction recolour.
                                null = auto: the mid band, indices 2..N-2 */
  teamSaturationScale: 1.0,  /* number  applied when recolouring */
  teamRecolorAccent: false,  /* bool    also drag the accent with the team hue */

  /* --- measurement -------------------------------------------------------- */
  deltaMetric: "de2000"      /* "de2000" | "de76" */
};

/* ===========================================================================
   COLOUR MATH
   =========================================================================== */

function paletteClamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

function paletteWrapHue(h) { return ((h % 360) + 360) % 360; }

/* HSL -> sRGB, h in degrees, s/l in 0..1, out [0..255] ints */
function hsl2rgb(h, s, l) {
  h = paletteWrapHue(h) / 360;
  s = paletteClamp(s, 0, 1);
  l = paletteClamp(l, 0, 1);
  var a = s * Math.min(l, 1 - l);
  function f(n) {
    var k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  }
  return [f(0), f(8), f(4)];
}

/* sRGB -> HSL, out [h_deg, s, l] */
function rgb2hsl(rgb) {
  var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  var l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
  if (d > 1e-9) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [paletteWrapHue(h), s, l];
}

function hexToRgb(hex) {
  if (Array.isArray(hex)) return [hex[0], hex[1], hex[2]];
  var s = String(hex).replace("#", "");
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function rgbToHex(rgb) {
  function h(v) { var s = paletteClamp(Math.round(v), 0, 255).toString(16); return s.length < 2 ? "0" + s : s; }
  return "#" + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
}

/* Rec.709 luma computed on the GAMMA-ENCODED sRGB bytes, 0..255. This is the
   "luminance" the original audit quoted when it measured a delta of 3.4 between
   the outline and the background, so the before/after numbers stay comparable. */
function srgbLuma(rgb) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/* relative luminance, WCAG style (linear-light), used for the contrast ratio */
function relativeLuminance(rgb) {
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

function contrastRatio(a, b) {
  var la = relativeLuminance(a), lb = relativeLuminance(b);
  var hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* sRGB -> CIE Lab, D65 / 2 degree observer, implemented here so the module has
   zero dependencies. */
function rgb2lab(rgb) {
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
  var X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) * 100;
  var Y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) * 100;
  var Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) * 100;
  var Xn = 95.047, Yn = 100.0, Zn = 108.883;
  function f(t) { return t > 0.008856451679 ? Math.pow(t, 1 / 3) : (7.787037037 * t + 16 / 116); }
  var fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE76(a, b) {
  var la = rgb2lab(a), lb = rgb2lab(b);
  var dL = la[0] - lb[0], da = la[1] - lb[1], db = la[2] - lb[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

/* CIEDE2000 - Sharma/Wu/Dalal formulation. Lab in, so it can be checked
   directly against the published test data. */
function deltaE2000Lab(A, B) {
  var L1 = A[0], a1 = A[1], b1 = A[2];
  var L2 = B[0], a2 = B[1], b2 = B[2];
  var kL = 1, kC = 1, kH = 1;
  var C1 = Math.sqrt(a1 * a1 + b1 * b1), C2 = Math.sqrt(a2 * a2 + b2 * b2);
  var Cbar = (C1 + C2) / 2;
  var Cbar7 = Math.pow(Cbar, 7);
  var G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 6103515625)));  /* 25^7 */
  var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  var C1p = Math.sqrt(a1p * a1p + b1 * b1), C2p = Math.sqrt(a2p * a2p + b2 * b2);
  var DEG = 180 / Math.PI;
  var h1p = (a1p === 0 && b1 === 0) ? 0 : paletteWrapHue(Math.atan2(b1, a1p) * DEG);
  var h2p = (a2p === 0 && b2 === 0) ? 0 : paletteWrapHue(Math.atan2(b2, a2p) * DEG);
  var dLp = L2 - L1;
  var dCp = C2p - C1p;
  var dhp;
  if (C1p * C2p === 0) dhp = 0;
  else {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  }
  var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) / DEG);
  var Lbp = (L1 + L2) / 2;
  var Cbp = (C1p + C2p) / 2;
  var hbp;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else hbp = (h1p + h2p < 360) ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  var T = 1 - 0.17 * Math.cos((hbp - 30) / DEG) + 0.24 * Math.cos((2 * hbp) / DEG)
            + 0.32 * Math.cos((3 * hbp + 6) / DEG) - 0.20 * Math.cos((4 * hbp - 63) / DEG);
  var dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  var Cbp7 = Math.pow(Cbp, 7);
  var Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625));
  var Lbp50 = (Lbp - 50) * (Lbp - 50);
  var Sl = 1 + (0.015 * Lbp50) / Math.sqrt(20 + Lbp50);
  var Sc = 1 + 0.045 * Cbp;
  var Sh = 1 + 0.015 * Cbp * T;
  var Rt = -Math.sin((2 * dTheta) / DEG) * Rc;
  var tL = dLp / (kL * Sl), tC = dCp / (kC * Sc), tH = dHp / (kH * Sh);
  return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH);
}

function deltaE2000(rgbA, rgbB) {
  return deltaE2000Lab(rgb2lab(rgbA), rgb2lab(rgbB));
}

function paletteDeltaE(a, b, metric) {
  return metric === "de76" ? deltaE76(a, b) : deltaE2000(a, b);
}

/* Smallest circular arc (in degrees) that contains every hue in the list.
   This is the same statistic the audit reported as 1.28 degrees. */
function hueRange(hues) {
  if (!hues.length) return 0;
  var h = hues.map(paletteWrapHue).sort(function (a, b) { return a - b; });
  if (h.length < 2) return 0;
  var maxGap = (h[0] + 360) - h[h.length - 1];
  for (var i = 1; i < h.length; i++) maxGap = Math.max(maxGap, h[i] - h[i - 1]);
  return 360 - maxGap;
}

/* ===========================================================================
   RAMP PLUMBING
   =========================================================================== */

/* Follow the authored hue path instead of short-arcing it: turn [252,240,...,46]
   into a monotone-ish unwrapped sequence so interpolation walks the intended way
   round the wheel. */
function unwrapRampHues(ramp) {
  var out = [ramp[0][0]], prev = ramp[0][0];
  for (var i = 1; i < ramp.length; i++) {
    var d = ((ramp[i][0] - prev + 540) % 360) - 180;
    prev = prev + d;
    out.push(prev);
  }
  return out;
}

/* Resample an authored ramp (array of [h,s,l], hues already unwrapped) to n steps. */
function resampleRamp(hsl, hues, n) {
  var src = hsl.length;
  if (n === src) {
    return hsl.map(function (c, i) { return [hues[i], c[1], c[2]]; });
  }
  var out = [];
  for (var i = 0; i < n; i++) {
    var p = (n === 1) ? 0 : i / (n - 1);
    var f = p * (src - 1);
    var i0 = Math.floor(f), i1 = Math.min(src - 1, i0 + 1), t = f - i0;
    out.push([
      hues[i0] + (hues[i1] - hues[i0]) * t,
      hsl[i0][1] + (hsl[i1][1] - hsl[i0][1]) * t,
      hsl[i0][2] + (hsl[i1][2] - hsl[i0][2]) * t
    ]);
  }
  return out;
}

/* Nudge an HSL colour along L until it is at least minDE away from refRgb. */
function enforceDeltaE(hsl, refRgb, minDE, metric, limits) {
  limits = limits || {};
  var lMin = limits.lMin == null ? 0.03 : limits.lMin;
  var lMax = limits.lMax == null ? 0.97 : limits.lMax;
  var step = limits.step == null ? 0.01 : limits.step;
  var cur = [hsl[0], hsl[1], hsl[2]];
  var refL = rgb2lab(refRgb)[0];
  var dir = (rgb2lab(hsl2rgb(cur[0], cur[1], cur[2]))[0] >= refL) ? 1 : -1;
  for (var i = 0; i < 160; i++) {
    if (paletteDeltaE(hsl2rgb(cur[0], cur[1], cur[2]), refRgb, metric) >= minDE) break;
    var nl = paletteClamp(cur[2] + dir * step, lMin, lMax);
    if (nl === cur[2]) {
      dir = -dir;
      nl = paletteClamp(cur[2] + dir * step, lMin, lMax);
      if (nl === cur[2]) break;
    }
    cur[2] = nl;
  }
  return cur;
}

function positionToIndex(p, n) {
  return paletteClamp(Math.round(p * (n - 1)), 0, n - 1);
}

/* ===========================================================================
   makePalette
   ===========================================================================
   makePalette(rng, opts) -> {
     ramp:    [[r,g,b] x steps]   value-first, dark -> light
     accent:  [r,g,b]
     glow:    [r,g,b]
     outline: [r,g,b]
     materials: [r,g,b|null] indexed by material id (EMPTY is null)
     hsl:     [[h,s,l] x steps]   the ramp before quantisation to bytes
     meta:    { ...names, knob values actually used, and measurements }
   }
   `rng` is a zero-arg function returning [0,1). Passing null gives the
   deterministic centre of every random range (useful for a UI preview).
   =========================================================================== */
function makePalette(rng, opts) {
  var o = {};
  var k;
  for (k in PALETTE_DEFAULTS) o[k] = PALETTE_DEFAULTS[k];
  if (opts) for (k in opts) if (opts[k] !== undefined) o[k] = opts[k];

  var r = (typeof rng === "function") ? rng : function () { return 0.5; };
  var metric = o.deltaMetric;
  var bg = hexToRgb(o.background);

  /* -- 1. pick the ramp ---------------------------------------------------- */
  var names = o.rampNames && o.rampNames.length ? o.rampNames.slice() : PALETTE_RAMP_NAMES.slice();
  names = names.filter(function (n) { return !!PALETTE_RAMPS[n]; });
  if (!names.length) names = PALETTE_RAMP_NAMES.slice();
  var name = (o.rampName && PALETTE_RAMPS[o.rampName]) ? o.rampName
           : names[Math.min(names.length - 1, Math.floor(r() * names.length))];
  var authored = PALETTE_RAMPS[name];

  /* -- 2. resample to the requested step count ----------------------------- */
  var steps = Math.max(3, Math.round(o.steps));
  var hsl = resampleRamp(authored, unwrapRampHues(authored), steps);

  /* -- 3. colourway variation --------------------------------------------- */
  var rot;
  if (o.hueRotation != null) rot = o.hueRotation;
  else rot = (r() * 2 - 1) * o.hueRotationMax;
  if (o.hueRotationSnap > 0) rot = Math.round(rot / o.hueRotationSnap) * o.hueRotationSnap;

  var satJitter = 1 + (r() * 2 - 1) * o.saturationJitterMax;
  var lgtJitter = (r() * 2 - 1) * o.lightnessJitterMax;

  var meanL = 0;
  for (var i = 0; i < steps; i++) meanL += hsl[i][2];
  meanL /= steps;

  for (i = 0; i < steps; i++) {
    var p = steps === 1 ? 0 : i / (steps - 1);
    var mid = 1 - Math.abs(2 * p - 1);          /* 0 at the ends, 1 in the middle */
    var h = hsl[i][0] + rot;
    var s = paletteClamp(hsl[i][1] * satJitter * o.saturationScale, 0, 1);
    var l = hsl[i][2] + lgtJitter * mid + o.lightnessOffset;
    l = meanL + (l - meanL) * o.contrastBoost;
    hsl[i] = [paletteWrapHue(h), s, paletteClamp(l, 0.02, 0.99)];
  }

  var ramp = hsl.map(function (c) { return hsl2rgb(c[0], c[1], c[2]); });

  /* -- 4. material sample points on the ramp ------------------------------ */
  var iDark = positionToIndex(o.darkPosition, steps);
  var iHull = positionToIndex(o.hullPosition, steps);
  var iLight = positionToIndex(o.lightPosition, steps);
  var hullHsl = hsl[iHull];
  var hullRgb = ramp[iHull];
  var hullHue = hullHsl[0];

  /* -- 5. accent: a harmonic of the HULL hue, not an independent random hue -- */
  var accentOffset;
  switch (o.accentMode) {
    case "complement": accentOffset = 180; break;
    case "triad":      accentOffset = (r() < 0.5 ? 120 : 240); break;
    case "analogous":  accentOffset = (r() < 0.5 ? 32 : -32); break;
    case "fixed":      accentOffset = null; break;
    default:           accentOffset = (r() < 0.5 ? 150 : 210); break;  /* split-complementary */
  }
  var accentHue;
  if (o.accentMode === "fixed" && o.accentHue != null) accentHue = o.accentHue;
  else accentHue = hullHue + accentOffset + (r() * 2 - 1) * o.accentHueJitter;
  accentHue = paletteWrapHue(accentHue);

  var accentHsl = enforceDeltaE(
    [accentHue, o.accentSaturation, o.accentLightness],
    hullRgb, o.minAccentHullDeltaE, metric, { lMin: 0.12, lMax: 0.92 });
  var accent = hsl2rgb(accentHsl[0], accentHsl[1], accentHsl[2]);

  /* -- 6. glow: tied to the accent by default, always the brightest thing --- */
  var glowBaseHue;
  switch (o.glowMode) {
    case "complement": glowBaseHue = hullHue + 180; break;
    case "warm":       glowBaseHue = 34; break;
    case "fixed":      glowBaseHue = (o.glowHue == null ? accentHue : o.glowHue); break;
    default:           glowBaseHue = accentHue; break;
  }
  /* The glow is the brightest thing on the ship, so both of its constraints are
     solved by brightening only - never by darkening back toward the hull, which
     is how a naive "enforce A, then enforce B" pass loses the first constraint.
     If brightening alone cannot separate it from the accent (the accent is bright
     too), the hue is rotated away instead. */
  var glowHsl = [paletteWrapHue(glowBaseHue + o.glowHueOffset), o.glowSaturation, o.glowLightness];
  for (var gi = 0; gi < 32; gi++) {
    for (var gj = 0; gj < 200; gj++) {
      var gRgb = hsl2rgb(glowHsl[0], glowHsl[1], glowHsl[2]);
      var okHull = paletteDeltaE(gRgb, hullRgb, metric) >= o.minGlowHullDeltaE;
      var okAcc = paletteDeltaE(gRgb, accent, metric) >= o.minGlowAccentDeltaE;
      if (okHull && okAcc) break;
      if (glowHsl[2] >= o.glowLightnessMax) break;
      glowHsl[2] = Math.min(o.glowLightnessMax, glowHsl[2] + 0.005);
    }
    var gRgb2 = hsl2rgb(glowHsl[0], glowHsl[1], glowHsl[2]);
    if (paletteDeltaE(gRgb2, hullRgb, metric) >= o.minGlowHullDeltaE &&
        paletteDeltaE(gRgb2, accent, metric) >= o.minGlowAccentDeltaE) break;
    glowHsl[0] = paletteWrapHue(glowHsl[0] + o.glowHueEscapeStep);
    glowHsl[2] = Math.max(o.glowLightness, glowHsl[2] - 0.05);
  }
  var glow = hsl2rgb(glowHsl[0], glowHsl[1], glowHsl[2]);

  /* -- 7. outline ----------------------------------------------------------
     Three strategies, all knobbed:
       "black"     max separation from the hull, but on a #0b0e14 background it
                   is nearly invisible - the sprite loses its edge against space.
       "rampDark"  keeps the ramp identity but on a low-key ramp ("void") it is
                   also too close to the background.
       "hueBlack"  DEFAULT: a near-black that carries the shadow hue, then has
                   its lightness lifted until it clears minOutlineBgDeltaE. This
                   is the only one of the three that is guaranteed readable
                   against BOTH space and the hull, which is why it is default.
     ---------------------------------------------------------------------- */
  var outlineHsl;
  if (o.outlineMode === "black") {
    outlineHsl = [hsl[0][0], 0, 0.0];
  } else if (o.outlineMode === "rampDark") {
    outlineHsl = [hsl[0][0], hsl[0][1], hsl[0][2] * o.outlineDarken];
  } else {
    outlineHsl = [
      paletteWrapHue(hsl[0][0] + o.outlineHueShift),
      paletteClamp(hsl[0][1] * o.outlineSaturationScale, 0, 1),
      o.outlineLightness
    ];
  }
  if (o.outlineEnforceContrast) {
    /* Step 1: lift (never darken) until it separates from the BACKGROUND.
       This is job #1 - an outline that vanishes into space costs the sprite its
       silhouette, which is worse than an outline that reads a little soft
       against the hull. */
    var t, oRgb;
    for (t = 0; t < 400; t++) {
      oRgb = hsl2rgb(outlineHsl[0], outlineHsl[1], outlineHsl[2]);
      if (paletteDeltaE(oRgb, bg, metric) >= o.minOutlineBgDeltaE &&
          Math.abs(srgbLuma(oRgb) - srgbLuma(bg)) >= o.minOutlineBgLumaDelta) break;
      if (outlineHsl[2] >= o.outlineLightnessMax) break;
      outlineHsl[2] = Math.min(o.outlineLightnessMax, outlineHsl[2] + 0.004);
    }
    var bgFloor = outlineHsl[2];   /* never go below this again */

    /* Step 2: darken toward the hull constraint, but only down to bgFloor when
       outlineContrastPriority is "background". On a low-key ramp (see "void")
       the two constraints genuinely conflict; the priority knob says which one
       gives way instead of silently letting the last loop win. */
    var floor = (o.outlineContrastPriority === "hull") ? 0.02
              : (o.outlineContrastPriority === "balanced") ? Math.max(0.02, bgFloor - 0.05)
              : bgFloor;
    for (t = 0; t < 400; t++) {
      if (paletteDeltaE(hsl2rgb(outlineHsl[0], outlineHsl[1], outlineHsl[2]), hullRgb, metric) >= o.minOutlineHullDeltaE) break;
      if (outlineHsl[2] <= floor) break;
      outlineHsl[2] = Math.max(floor, outlineHsl[2] - 0.004);
    }
    /* Step 3: if darkening could not open the hull gap (dark ramp, dark hull),
       open it with chroma instead of value - push the outline hue away from the
       hull hue and saturate it. Costs nothing against the background. */
    for (t = 0; t < 24; t++) {
      if (paletteDeltaE(hsl2rgb(outlineHsl[0], outlineHsl[1], outlineHsl[2]), hullRgb, metric) >= o.minOutlineHullDeltaE) break;
      var away = ((outlineHsl[0] - hullHue + 540) % 360) - 180;
      var trial = [
        paletteWrapHue(outlineHsl[0] + (away >= 0 ? 6 : -6)),
        paletteClamp(outlineHsl[1] + 0.03, 0, 1),
        outlineHsl[2]
      ];
      /* never let the chroma escape undo the background separation won in step 1 */
      var tRgb = hsl2rgb(trial[0], trial[1], trial[2]);
      if (paletteDeltaE(tRgb, bg, metric) < o.minOutlineBgDeltaE ||
          Math.abs(srgbLuma(tRgb) - srgbLuma(bg)) < o.minOutlineBgLumaDelta) break;
      outlineHsl = trial;
    }
  }
  var outline = hsl2rgb(outlineHsl[0], outlineHsl[1], outlineHsl[2]);

  /* -- 8. cockpit ---------------------------------------------------------- */
  var cockpitBaseHue;
  switch (o.cockpitMode) {
    case "accent":     cockpitBaseHue = accentHsl[0]; break;
    case "complement": cockpitBaseHue = hullHue + 180; break;
    case "ramp":       cockpitBaseHue = hullHue; break;
    default:           cockpitBaseHue = glowHsl[0]; break;
  }
  var cockpitHsl = enforceDeltaE(
    [paletteWrapHue(cockpitBaseHue + o.cockpitHueOffset), o.cockpitSaturation, o.cockpitLightness],
    hullRgb, o.minCockpitHullDeltaE, metric, { lMin: 0.10, lMax: 0.90 });
  var cockpit = hsl2rgb(cockpitHsl[0], cockpitHsl[1], cockpitHsl[2]);

  /* -- 9. nozzle + gun ----------------------------------------------------- */
  var nozzleHsl = enforceDeltaE(
    [hsl[0][0], hsl[0][1], hsl[0][2] * o.nozzleDarken],
    outline, o.minPartOutlineDeltaE, metric, { lMin: 0.02, lMax: 0.35 });
  var nozzle = hsl2rgb(nozzleHsl[0], nozzleHsl[1], nozzleHsl[2]);

  var gunSrc = hsl[Math.min(1, steps - 1)];
  var gunHsl = [gunSrc[0], gunSrc[1] * o.gunDesaturate, (o.gunLightness == null ? gunSrc[2] : o.gunLightness)];
  gunHsl = enforceDeltaE(gunHsl, outline, o.minPartOutlineDeltaE, metric, { lMin: 0.05, lMax: 0.45 });
  /* the gun barrel sits next to the nozzle on a lot of silhouettes; brighten it
     (never darken, that walks it back into the outline) until they separate */
  for (var qi = 0; qi < 200; qi++) {
    if (paletteDeltaE(hsl2rgb(gunHsl[0], gunHsl[1], gunHsl[2]), nozzle, metric) >= o.minGunNozzleDeltaE) break;
    if (gunHsl[2] >= 0.50) break;
    gunHsl[2] = Math.min(0.50, gunHsl[2] + 0.005);
  }
  var gun = hsl2rgb(gunHsl[0], gunHsl[1], gunHsl[2]);

  /* -- 10. materials table (ready for a renderer to index by material id) --- */
  var materials = [];
  materials[PALETTE_MATERIALS.EMPTY]   = null;
  materials[PALETTE_MATERIALS.HULL]    = ramp[iHull];
  materials[PALETTE_MATERIALS.LIGHT]   = ramp[iLight];
  materials[PALETTE_MATERIALS.DARK]    = ramp[iDark];
  materials[PALETTE_MATERIALS.OUTLINE] = outline;
  materials[PALETTE_MATERIALS.COCKPIT] = cockpit;
  materials[PALETTE_MATERIALS.ACCENT]  = accent;
  materials[PALETTE_MATERIALS.NOZZLE]  = nozzle;
  materials[PALETTE_MATERIALS.GUN]     = gun;
  materials[PALETTE_MATERIALS.LAMP]    = glow;

  /* -- 11. team colour indices --------------------------------------------- */
  var teamIndices;
  if (o.teamIndices) teamIndices = o.teamIndices.slice();
  else {
    teamIndices = [];
    for (i = 2; i <= steps - 2; i++) teamIndices.push(i);
    if (!teamIndices.length) teamIndices = [Math.floor(steps / 2)];
  }

  /* -- 12. measurements ---------------------------------------------------- */
  var adjacent = [];
  for (i = 1; i < steps; i++) adjacent.push(paletteDeltaE(ramp[i - 1], ramp[i], metric));

  var meta = {
    rampName: name,
    steps: steps,
    hueRotation: rot,
    saturationJitter: satJitter,
    lightnessJitter: lgtJitter,
    hullIndex: iHull,
    lightIndex: iLight,
    darkIndex: iDark,
    accentMode: o.accentMode,
    accentHue: accentHsl[0],
    accentOffsetFromHull: paletteWrapHue(accentHsl[0] - hullHue),
    glowMode: o.glowMode,
    glowHue: glowHsl[0],
    outlineMode: o.outlineMode,
    teamIndices: teamIndices,
    background: rgbToHex(bg),
    deltaMetric: metric,
    measurements: {
      hueSpreadRamp: hueRange(ramp.map(function (c) { return rgb2hsl(c)[0]; })),
      hueSpreadLightHullDark: hueRange([ramp[iLight], ramp[iHull], ramp[iDark]].map(function (c) { return rgb2hsl(c)[0]; })),
      adjacentDeltaE: adjacent,
      minAdjacentDeltaE: Math.min.apply(null, adjacent),
      maxAdjacentDeltaE: Math.max.apply(null, adjacent),
      outlineVsBackgroundDeltaE: paletteDeltaE(outline, bg, metric),
      outlineVsBackgroundLuminanceDelta: Math.abs(srgbLuma(outline) - srgbLuma(bg)),
      outlineVsBackgroundContrastRatio: contrastRatio(outline, bg),
      outlineVsHullDeltaE: paletteDeltaE(outline, hullRgb, metric),
      accentVsHullDeltaE: paletteDeltaE(accent, hullRgb, metric),
      glowVsHullDeltaE: paletteDeltaE(glow, hullRgb, metric),
      glowVsAccentDeltaE: paletteDeltaE(glow, accent, metric),
      cockpitVsHullDeltaE: paletteDeltaE(cockpit, hullRgb, metric),
      nozzleVsOutlineDeltaE: paletteDeltaE(nozzle, outline, metric),
      gunVsOutlineDeltaE: paletteDeltaE(gun, outline, metric)
    }
  };

  return {
    ramp: ramp,
    hsl: hsl,
    accent: accent,
    glow: glow,
    outline: outline,
    cockpit: cockpit,
    nozzle: nozzle,
    gun: gun,
    materials: materials,
    meta: meta
  };
}

/* ===========================================================================
   TEAM COLOUR
   ===========================================================================
   Faction recolouring swaps only the ramp indices listed in meta.teamIndices
   (by default the mid band, which is where the visible hull mass lives). The
   endpoints - the deepest shadow and the highlight - are deliberately NOT
   swapped: keeping them anchors the material identity, so a red and a blue
   fleet still read as the same metal, and the outline never has to move.

   recolorTeam(palette, team, opts) -> a NEW palette object (input untouched).
   `team` is a hue in degrees, a name from PALETTE_TEAM_PRESETS, or null
   (desaturate the team band to neutral).
   =========================================================================== */
function recolorTeam(palette, team, opts) {
  var o = {};
  var k;
  for (k in PALETTE_DEFAULTS) o[k] = PALETTE_DEFAULTS[k];
  if (opts) for (k in opts) if (opts[k] !== undefined) o[k] = opts[k];

  var hue = team;
  var neutral = false;
  if (typeof team === "string") {
    if (!(team in PALETTE_TEAM_PRESETS)) throw new Error("unknown team preset: " + team);
    hue = PALETTE_TEAM_PRESETS[team];
  }
  if (hue == null) { neutral = true; hue = 0; }

  var idx = (o.teamIndices || palette.meta.teamIndices).slice();
  var hsl = palette.hsl.map(function (c) { return [c[0], c[1], c[2]]; });

  /* preserve the internal hue shift inside the team band: measure each swapped
     step's offset from the band's own centre, then re-hang the band on `hue` */
  var centre = hsl[idx[Math.floor(idx.length / 2)]][0];
  for (var i = 0; i < idx.length; i++) {
    var j = idx[i];
    if (j < 0 || j >= hsl.length) continue;
    var rel = ((hsl[j][0] - centre + 540) % 360) - 180;
    hsl[j] = [
      paletteWrapHue(hue + rel),
      neutral ? hsl[j][1] * 0.15 : paletteClamp(hsl[j][1] * o.teamSaturationScale, 0, 1),
      hsl[j][2]
    ];
  }

  var ramp = hsl.map(function (c) { return hsl2rgb(c[0], c[1], c[2]); });
  var out = {
    ramp: ramp,
    hsl: hsl,
    accent: palette.accent,
    glow: palette.glow,
    outline: palette.outline,
    cockpit: palette.cockpit,
    nozzle: palette.nozzle,
    gun: palette.gun,
    materials: palette.materials.slice(),
    meta: JSON.parse(JSON.stringify(palette.meta))
  };

  if (o.teamRecolorAccent && !neutral) {
    var a = rgb2hsl(palette.accent);
    var accentHsl = enforceDeltaE([paletteWrapHue(hue + 180), a[1], a[2]],
      ramp[palette.meta.hullIndex], o.minAccentHullDeltaE, o.deltaMetric, { lMin: 0.12, lMax: 0.92 });
    out.accent = hsl2rgb(accentHsl[0], accentHsl[1], accentHsl[2]);
    out.meta.accentHue = accentHsl[0];
  }

  out.materials[PALETTE_MATERIALS.HULL]   = ramp[palette.meta.hullIndex];
  out.materials[PALETTE_MATERIALS.LIGHT]  = ramp[palette.meta.lightIndex];
  out.materials[PALETTE_MATERIALS.DARK]   = ramp[palette.meta.darkIndex];
  out.materials[PALETTE_MATERIALS.ACCENT] = out.accent;
  out.meta.team = (typeof team === "string") ? team : hue;
  out.meta.measurements.hueSpreadRamp = hueRange(ramp.map(function (c) { return rgb2hsl(c)[0]; }));
  out.meta.measurements.hueSpreadLightHullDark = hueRange(
    [ramp[palette.meta.lightIndex], ramp[palette.meta.hullIndex], ramp[palette.meta.darkIndex]]
      .map(function (c) { return rgb2hsl(c)[0]; }));
  return out;
}

/* Convenience for a UI dropdown: name + hex swatches at neutral settings. */
function listRamps(opts) {
  return PALETTE_RAMP_NAMES.map(function (n) {
    var o = { rampName: n, hueRotation: 0, saturationJitterMax: 0, lightnessJitterMax: 0 };
    if (opts) for (var k in opts) o[k] = opts[k];
    var p = makePalette(null, o);
    return {
      name: n,
      swatches: p.ramp.map(rgbToHex),
      accent: rgbToHex(p.accent),
      glow: rgbToHex(p.glow),
      outline: rgbToHex(p.outline),
      hueSpread: p.meta.measurements.hueSpreadRamp
    };
  });
}

if (typeof module !== 'undefined') module.exports = {
  makePalette: makePalette,
  recolorTeam: recolorTeam,
  listRamps: listRamps,
  PALETTE_RAMPS: PALETTE_RAMPS,
  PALETTE_RAMP_NAMES: PALETTE_RAMP_NAMES,
  PALETTE_TEAM_PRESETS: PALETTE_TEAM_PRESETS,
  PALETTE_DEFAULTS: PALETTE_DEFAULTS,
  PALETTE_MATERIALS: PALETTE_MATERIALS,
  hsl2rgb: hsl2rgb,
  rgb2hsl: rgb2hsl,
  rgb2lab: rgb2lab,
  deltaE76: deltaE76,
  deltaE2000: deltaE2000,
  deltaE2000Lab: deltaE2000Lab,
  hueRange: hueRange,
  hexToRgb: hexToRgb,
  rgbToHex: rgbToHex,
  relativeLuminance: relativeLuminance,
  srgbLuma: srgbLuma,
  contrastRatio: contrastRatio
};
