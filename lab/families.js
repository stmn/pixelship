/* families.js - named ship families (presets).
   A preset is a partial options object; anything it does not name falls back to
   the measured tuning in compose.js. Shared by the browser app and node tests. */
(function (root) {
'use strict';

var PRESETS = [
  { name: 'Raider', hint: 'Narrow hull, broad swept wings. The readable default.',
    opts: {} },
  { name: 'Interceptor', hint: 'Long and thin, small fins, single thruster.',
    opts: { shape: { elongationMin: 1.9, elongationMax: 2.9, wingAmount: 2.0, wingWidth: 0.05,
                     fillDensity: 0.62, noiseAmount: 0.35 },
            mounts: { engineCount: 1, gunCount: 2 } } },
  { name: 'Dreadnought', hint: 'Wide, heavy, blunt nose, three thrusters.',
    opts: { shape: { elongationMin: 0.85, elongationMax: 1.35, wingAmount: 1.6, wingWidth: 0.12,
                     coreMinWidth: 5.0, fillDensity: 0.78, noseTaper: 0.35, tailWeight: 0.6 },
            mounts: { engineCount: 3, gunCount: 4 } } },
  { name: 'Manta', hint: 'Low, wide delta - almost all wing.',
    opts: { shape: { elongationMin: 0.6, elongationMax: 1.0, wingAmount: 4.2, wingWidth: 0.16,
                     envelopeChoices: ['teardrop', 'delta', 'ellipse'], noiseAmount: 0.3 },
            mounts: { engineCount: 2, gunCount: 2 } } },
  { name: 'Hive', hint: 'Organic, lumpy, waisted. Reads grown rather than built.',
    opts: { shape: { envelopeChoices: ['ellipse', 'hourglass', 'spindle'],
                     noiseAmount: 1.0, noiseScale: 3.4, noiseOctaves: 3,
                     wingNegativeChance: 0.8, wingAmount: 2.2, envelopeCore: 0.7 },
            shade: { aoStrength: 0.8, rimStrength: 0.4 },
            mounts: { gunCount: 0 } } },
  { name: 'Shard', hint: 'Angular, pierced, spiky. Crystalline debris-craft.',
    opts: { shape: { envelopeChoices: ['diamond', 'cross', 'dart'],
                     noiseAmount: 0.9, noiseScale: 4.4, holePolicy: 'keep',
                     wingAmount: 3.6, wingWidth: 0.045, coreMinWidth: 2.0, edgeRoughness: 0.8 },
            shade: { contrast: 1.6, rampSteps: 5 } } },
  { name: 'Radial', hint: 'N-fold symmetry instead of bilateral. Non-human by construction.',
    opts: { shape: { symmetry: 'radial', radialMirror: true, elongationMin: 0.9, elongationMax: 1.2,
                     wingAmount: 2.8, noiseAmount: 0.6 },
            mounts: { engineCount: 1, gunCount: 0 } } },
];

var API = { PRESETS: PRESETS, byName: function (n) {
  for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].name === n) return PRESETS[i];
  return PRESETS[0];
} };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.PixelshipFamilies = API;
})(typeof self !== 'undefined' ? self : this);
