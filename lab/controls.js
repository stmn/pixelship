/* controls.js - the control-panel schema.
   Shared so lab/knobs.test.js can prove every knob actually does something. */
(function (root) {
'use strict';

var CONTROLS = [
  { group: 'Output', icon: 'image', open: true, items: [
    { key: 'size', target: 'app', type: 'range', min: 16, max: 96, step: 1, def: 40,
      label: 'Sprite size', hint: 'Design is size-independent: the same seed gives the same ship at any size.' },
    { key: 'count', target: 'app', type: 'range', min: 4, max: 40, step: 1, def: 8, label: 'Fleet size' },
    { key: 'frames', target: 'app', type: 'range', min: 2, max: 16, step: 1, def: 8, label: 'Animation frames' },
    { key: 'throttle', target: 'app', type: 'range', min: 0, max: 100, step: 1, def: 75, label: 'Throttle %' },
    { key: 'diverseSampling', target: 'app', type: 'bool', label: 'Diverse sampling',
      hint: 'Randomize tries 5 candidates per slot and keeps the one least like the rest. Costs ~90ms, cuts silhouette overlap 10-18%.' },
  ]},
  { group: 'Silhouette', icon: 'triangle', items: [
    { key: 'elongationMin', target: 'shape', type: 'range', min: 0.4, max: 3, step: 0.05, label: 'Elongation min' },
    { key: 'elongationMax', target: 'shape', type: 'range', min: 0.4, max: 3, step: 0.05, label: 'Elongation max' },
    { key: 'fillDensity', target: 'shape', type: 'range', min: 0.3, max: 0.95, step: 0.01, label: 'Fill density' },
    { key: 'noseTaper', target: 'shape', type: 'range', min: 0, max: 1, step: 0.02, label: 'Nose taper' },
    { key: 'tailWeight', target: 'shape', type: 'range', min: 0, max: 1, step: 0.02, label: 'Tail weight' },
    { key: 'coreMinWidth', target: 'shape', type: 'range', min: 1, max: 6, step: 0.5, label: 'Min hull width',
      hint: 'Low values grow 1px needles off the nose.' },
  ]},
  { group: 'Wings', icon: 'move-horizontal', items: [
    { key: 'wingAmount', target: 'shape', type: 'range', min: 0, max: 5, step: 0.1, label: 'Wing span' },
    { key: 'wingWidth', target: 'shape', type: 'range', min: 0.02, max: 0.25, step: 0.005, label: 'Wing chord' },
    { key: 'wingCount', target: 'shape', type: 'range', min: 1, max: 4, step: 1, label: 'Max wing pairs' },
    { key: 'wingNegativeChance', target: 'shape', type: 'range', min: 0, max: 1, step: 0.05, label: 'Notch chance',
      hint: 'Turns a bulge into a bite out of the hull - waisted shapes.' },
  ]},
  { group: 'Cellular automaton', icon: 'grid-3x3', items: [
    { key: 'logicalSize', target: 'shape', type: 'range', min: 12, max: 64, step: 1, label: 'Logical grid',
      hint: 'The real detail scale. Small = chunky, large = fine.' },
    { key: 'iterations', target: 'shape', type: 'range', min: 1, max: 8, step: 1, label: 'Smoothing steps' },
    { key: 'birth', target: 'shape', type: 'range', min: 3, max: 8, step: 1, label: 'Birth threshold' },
    { key: 'survive', target: 'shape', type: 'range', min: 1, max: 6, step: 1, label: 'Survive threshold' },
    { key: 'noiseAmount', target: 'shape', type: 'range', min: 0, max: 1.4, step: 0.05, label: 'Rim noise' },
    { key: 'noiseScale', target: 'shape', type: 'range', min: 1, max: 7, step: 0.1, label: 'Noise scale' },
    { key: 'envelopeCore', target: 'shape', type: 'range', min: 0, max: 1, step: 0.05, label: 'Envelope authority',
      hint: '0 = pure CA (fatter, blander). 1 = envelope rules.' },
    { key: 'symmetry', target: 'shape', type: 'select', options: ['vertical', 'both', 'radial'], label: 'Symmetry' },
  ]},
  { group: 'Shading', icon: 'sun', items: [
    { key: 'rampSteps', target: 'shade', type: 'range', min: 3, max: 8, step: 1, label: 'Ramp steps' },
    { key: 'contrast', target: 'shade', type: 'range', min: 0.7, max: 2, step: 0.05, label: 'Contrast' },
    { key: 'lightAzimuthDeg', target: 'shade', type: 'range', min: -180, max: 180, step: 5, label: 'Light angle',
      hint: 'Only 0 and 180 keep the shading mirror-symmetric. Any other angle breaks symmetry.' },
    { key: 'aoStrength', target: 'shade', type: 'range', min: 0, max: 1, step: 0.02, label: 'Ambient occlusion' },
    { key: 'rimStrength', target: 'shade', type: 'range', min: 0, max: 1, step: 0.02, label: 'Rim light' },
    { key: 'thicknessShape', target: 'shade', type: 'range', min: 0.1, max: 1, step: 0.02, label: 'Volume bulge',
      hint: 'Low = flat plating. High domes the hull and it starts reading as terrain.' },
    { key: 'ditherMode', target: 'shade', type: 'select',
      options: ['off', 'auto', 'bayer2', 'bayer4', 'bayer8', 'noise'], label: 'Dither',
      hint: 'auto only kicks in at 48px and above.' },
  ]},
  { group: 'Banking', icon: 'rotate-cw', items: [
    { key: 'bankPoses', target: 'app', type: 'range', min: 1, max: 7, step: 2, label: 'Bank poses',
      hint: 'Turn frames per ship, level pose included. 1 disables banking.' },
    { key: 'bankAngle', target: 'app', type: 'range', min: 0, max: 70, step: 5, label: 'Bank angle',
      hint: 'Rotation about the ship\'s long axis. Past ~55 degrees the hull stops reading.' },
    { key: 'bankHeight', target: 'app', type: 'range', min: 0.4, max: 3, step: 0.1, label: 'Bank relief',
      hint: 'How much the height field pushes the near wing sideways.' },
  ]},
  { group: 'Hardpoints', icon: 'crosshair', items: [
    { key: 'engineCount', target: 'mounts', type: 'range', min: 1, max: 3, step: 1, label: 'Thrusters' },
    { key: 'gunCount', target: 'mounts', type: 'range', min: 0, max: 4, step: 2, label: 'Guns',
      hint: 'Guns are placed as mirrored pairs, so odd values round down to the pair below.' },
    { key: 'cockpitWanted', target: 'mounts', type: 'bool', label: 'Cockpit',
      hint: 'Off by default - the stamped canopy reads as an egg glued on.' },
  ]},
  { group: 'Colour', icon: 'palette', items: [
    { key: 'rampName', target: 'palette', type: 'select', options: null, label: 'Ramp',
      nullAt: 'random', hint: 'Pick one and the whole fleet uses it.' },
    { key: 'hueRotation', target: 'palette', type: 'range', min: -180, max: 180, step: 5, label: 'Hue rotation',
      nullAt: 0, nullLabel: 'auto',
      hint: 'Forces one exact rotation on every ship. At 0 each ship keeps its own random rotation.' },
    { key: 'hueRotationMax', target: 'palette', type: 'range', min: 0, max: 180, step: 5, label: 'Hue variation',
      hint: 'Per-ship colour spread. Set to 0 and the whole fleet shares one colourway.' },
    { key: 'saturationScale', target: 'palette', type: 'range', min: 0.2, max: 2, step: 0.05, label: 'Saturation' },
    { key: 'lightnessOffset', target: 'palette', type: 'range', min: -0.25, max: 0.25, step: 0.01, label: 'Lightness' },
  ]},
];

if (typeof module !== 'undefined' && module.exports) module.exports = { CONTROLS: CONTROLS };
else root.PixelshipControls = { CONTROLS: CONTROLS };
})(typeof self !== 'undefined' ? self : this);
