// Bodies in a liquid, for examples/: pixelforge-fluid sources whose liquid effects carry `bodies` (docs/physics-model.md,
// section 13). scripts/generate-examples.js writes them as examples/<name>.fluid.json and showcase/fluid/build.mjs
// renders their GIFs.
const fluidSource = (name, width, height, palette, effect, symbols) => ({ format: 'pixelforge-fluid', version: 1, name, width, height, palette, ...(symbols && { symbols }), effects: { [name]: effect } });
const shapeRows = (w, h, at) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y) ?? '.').join(''));

// Crate splash: a light crate, a ball and a stone dropped into a pool. Each throws a splash; the crate floats high and
// flat, the ball half out, and the stone sinks to the bottom; the water settles and they rest.
const water = { B: '#1d3f7a', b: '#2f6fc0', c: '#5fb4e8', w: '#dff6ff' };
const waterLook = [{ field: 'density', colors: ['b'], thresholds: [0.5], dither: 0 }, { field: 'depth', colors: ['w', 'c', 'b', 'B'], thresholds: [1, 2, 5, 10], dither: 0 }];
const crateSplash = fluidSource('crate-splash', 64, 48, { ...water, o: '#3b2414', h: '#c98c4f', k: '#14141c', r: '#e0475a', s: '#8a8f99', S: '#5d626b' }, {
  kind: 'liquid', frames: 120, duration: 50, seed: 3, walls: ['left', 'right', 'bottom'], flip: 0.2, drag: 0.08,
  fill: [{ x: 0, y: 30, w: 64, h: 18 }], emitters: [],
  whitewater: [{ impact: 1.5, chance: 0.4, throw: 1.2, spread: 30, life: [10, 18], colors: ['w', 'w', 'c'] }],
  look: waterLook, cleanup: { strays: true },
  bodies: [
    { name: 'crate', shape: 'box', size: [8, 8], at: [14, 14], density: 0.2, fill: 'h', outline: 'o' },
    { name: 'stone', shape: 'box', size: [6, 5], at: [33, 10], angle: 10, density: 2.5, fill: 's', outline: 'S' },
    { name: 'ball', shape: 'circle', radius: 3, at: [51, 16], velocity: [-0.2, 0], density: 0.5, fill: 'r', outline: 'k' }
  ]
});

// Sand slide: a crate stands on a bin of sand behind a board. The board lifts, the sand slumps into a ramp at its
// repose and carries the crate down it; a ball dropped beside the ramp lands dead in the sand. Resting sand holds both
// up as ground, so they come to rest on it.
const sand = { a: '#f6dc9c', b: '#ddb46a', c: '#b8864a', d: '#8a5f34', o: '#5a3c22' };
const sandLook = [
  { field: 'density', colors: ['b'], thresholds: [0.35], dither: 0 },
  { field: 'depth', colors: ['c', 'd'], thresholds: [5, 11], dither: 0.9, pattern: 'noise' },
  { field: 'shadow', colors: ['c'], thresholds: [0.5], dither: 0 },
  { field: 'light', colors: ['a'], thresholds: [0.6], dither: 0 }
];
const SW = 72, SH = 44;
const sandSlide = fluidSource('sand-slide', SW, SH, { ...sand, p: '#8a5a36', P: '#5a3825', G: '#4d4038', K: '#3a302a', h: '#c98c4f', O: '#3b2414', r: '#e0475a', k: '#14141c' }, {
  kind: 'liquid', frames: 110, duration: 50, seed: 5, walls: ['left', 'right', 'bottom'], granular: { repose: 30 },
  obstacles: [{ symbol: 'ground', x: 0, y: SH - 3 }, { symbol: 'board', x: 22, y: 13, keys: [{ frame: 10, y: -24, over: 8 }] }],
  fill: [{ x: 0, y: 17, w: 22, h: 24 }, { x: 24, y: 36, w: 48, h: 5 }], emitters: [], look: sandLook, outline: 'o', cleanup: { strays: true },
  bodies: [
    { name: 'crate', shape: 'box', size: [8, 8], at: [17, 13], density: 0.8, friction: 0.6, fill: 'h', outline: 'O' },
    { name: 'ball', shape: 'circle', radius: 2.5, at: [58.5, 4.5], velocity: [-0.3, 0], density: 1.5, fill: 'r', outline: 'k' }
  ]
}, { ground: shapeRows(SW, 3, (x, y) => (y ? 'K' : 'G')), board: shapeRows(2, 28, x => (x ? 'P' : 'p')) });

export const fluidBodyPresets = { 'crate-splash': crateSplash, 'sand-slide': sandSlide };
