// Falling-sand presets for examples/: each is an ordinary pixelforge-powder source built on the starter table
// (`base: "sandbox"`); scripts/generate-examples.js writes them as examples/<name>.powder.json and
// showcase/powder/build.mjs renders their GIFs.
const source = (name, width, height, seed, fields) => ({ format: 'pixelforge-powder', version: 1, name, base: 'sandbox', width, height, seed, ...fields });

// A wooden hut on a pier over a pool: a beam from the bank to a stone pillar, an oil slick under it, a sand bank
// that slumps in and moss on the pool floor. A heat stroke lights a corner of the hut's floor; the fire climbs the walls
// and roof and runs along the beams, and once it has cut them at both ends the burning hut drops into the pool, throws
// water out from under it and floats there as the water puts it out. On the far cliff, lava burns through a moss lip
// and pours down into the pool, which quenches it to stone in clouds of steam.
const HUT = [
  '............rrrr............',
  '..........rrrrrrrr..........',
  '........rrrrrrrrrrrr........',
  '......rrrrrrrrrrrrrrrr......',
  '....rrrrrrrrrrrrrrrrrrrr....',
  '..rrrrrrrrrrrrrrrrrrrrrrrr..',
  'rrrrrrrrrrrrrrrrrrrrrrrrrrrr',
  '..ww....................ww..',
  '..ww....................ww..',
  '..ww...wwwww............ww..',
  '..ww...w...w.....wwww...ww..',
  '..ww...w...w.....w..w...ww..',
  '..ww...wwwww.....w..w...ww..',
  '..ww.............w..w...ww..',
  '..ww.............w..w...ww..',
  'wwwwwwwwwwwwwwwwwwwwwwwwwwww'
];
const hutFire = (() => {
  const W = 192, H = 108, ground = H - 6, water = ground - 18, pier = water - 14, [hx, hy] = [44, pier - HUT.length];
  return source('hut-fire', W, H, 3, {
    scene: [
      { material: 'stone', rect: [0, ground, W, 6] },
      { material: 'stone', rect: [0, pier + 2, 26, ground - pier - 2] },
      { material: 'stone', rect: [70, pier + 2, 4, ground - pier - 2] },
      { material: 'stone', rect: [W - 30, water - 28, 30, ground - water + 28] },
      { material: 'water', rect: [26, water, W - 56, ground - water] },
      { material: 'oil', rect: [30, water - 2, 38, 2] },
      { material: 'sand', rect: [2, pier - 12, 22, 14], fill: 0.97 },
      { material: 'moss', rect: [26, ground - 2, 64, 2], fill: 0.6 },
      { material: 'wood', rect: [20, pier, 54, 2] },
      { rows: HUT, at: [hx, hy], legend: { r: 'wood', w: 'wood' } },
      { material: 'stone', rect: [W - 30, water - 30, 30, 2] },
      { material: 'lava', rect: [W - 24, water - 41, 22, 11] },
      { material: 'moss', rect: [W - 30, water - 43, 6, 13] },
      { material: 'stone', rect: [W - 2, water - 44, 2, 14] }
    ],
    inputs: [{ frame: 20, heat: { x: 58, y: pier - 1, radius: 2.5, amount: 900 } }],
    clips: { 'hut-fire': { frames: 150, every: 5 } }
  });
})();

// A lava pocket on a high ledge burns through its moss plug and pours off the edge into a pool: the stream breaks into
// drops, the pool boils off in steam that billows up, and the lava crusts into stone where it lands.
const lavaFalls = (() => {
  const W = 128, H = 96;
  return source('lava-falls', W, H, 7, {
    // Runnier lava than the starter's, so it pours as a stream rather than dripping.
    materials: {
      lava: {
        state: 'liquid', density: 30, spread: 4, viscosity: 0.2, drag: 0.85, conduct: 0.2, temperature: 1200, shimmer: 120,
        colors: ['#ff7b1c', '#ff6418', '#ff9a30', '#f05514'], top: '#ffc85a', below: { temperature: 550, into: 'stone', chance: 0.02 }
      }
    },
    scene: [
      { material: 'stone', rect: [0, H - 4, W, 4] },
      { material: 'stone', rect: [0, 26, 76, 5] }, { material: 'stone', rect: [0, 0, 4, 31] },
      { material: 'lava', rect: [4, 12, 66, 14] },
      { material: 'moss', rect: [70, 10, 6, 16] },
      { material: 'stone', rect: [54, 62, 4, 30] }, { material: 'stone', rect: [124, 62, 4, 30] },
      { material: 'water', rect: [58, 64, 66, 28] },
      { material: 'sand', rect: [4, 80, 46, 12], fill: 0.95 }
    ],
    inputs: [{ frame: 0, heat: { x: 72, y: 18, radius: 3, amount: 300 } }],
    clips: { 'lava-falls': { frames: 120, every: 4 } }
  });
})();

// A quarry floor of sand around a pond: a blast at the foot of the face throws sand, water and ash high, they rain
// back down in arcs, splash into the pond and slump into new heaps.
const quarryBlast = (() => {
  const W = 128, H = 80;
  return source('quarry-blast', W, H, 11, {
    scene: [
      { material: 'stone', rect: [0, H - 4, W, 4] },
      { material: 'stone', rect: [100, 30, 28, 46] }, { material: 'stone', rect: [92, 50, 8, 26] },
      { material: 'sand', rect: [40, 58, 52, 18] }, { material: 'ash', rect: [56, 54, 20, 4], fill: 0.8 },
      { material: 'stone', rect: [4, 66, 4, 10] }, { material: 'stone', rect: [34, 66, 4, 10] },
      { material: 'water', rect: [8, 64, 26, 12] }
    ],
    inputs: [{ frame: 12, burst: { x: 66, y: 66, radius: 16, strength: 5 } }],
    clips: { 'quarry-blast': { frames: 60, every: 3 } }
  });
})();

// A campfire in a light breeze: the smoke leans downwind and ash drifts off it. Then rain sets in, the drops that hit
// the flames and the burning logs hiss into steam, the fire goes out and the last smoke blows away.
const rainOnFire = (() => {
  const W = 112, H = 72, rain = [];
  for (let k = 0; k < 4; k++) rain.push({ frames: [180, 420], every: 2, paint: { material: 'water', x: 2.5 + k * 28, x2: 27.5 + k * 28, y: 1.5, y2: 1.5, radius: 0.5, fill: 0.05 } });
  return source('rain-on-fire', W, H, 5, {
    air: { flow: { wind: [0.35, 0] } },
    reactions: [
      { a: 'water', b: 'fire', into: ['steam', 'steam'], chance: 0.5 },
      { a: 'water', b: 'wood', burning: 'b', douse: 'b', into: ['steam', null], chance: 0.3 }
    ],
    scene: [
      { material: 'stone', rect: [0, H - 4, W, 4] }, { material: 'sand', rect: [0, H - 7, W, 3] },
      { material: 'stone', rect: [30, H - 10, 3, 3] }, { material: 'stone', rect: [55, H - 10, 3, 3] },
      { rows: ['....ww...ww....', '..wwwwwwwwwww..', 'wwwwwwwwwwwwwww'], at: [36, H - 10], legend: { w: 'wood' } },
      { material: 'wood', rect: [37, H - 8, 14, 1], burning: true }
    ],
    inputs: rain,
    clips: { 'rain-on-fire': { frames: 120, every: 4 } }
  });
})();

// A tall hut on stilts over a pool, its pieces tumbling (pieces: "tumble"): one stilt burns at the waterline, the hut
// leans onto the stub, then topples over into the water with a splash and lies there on its side, still burning, while
// a raft rocks in the waves. Nothing is scripted after the first frame.
const STILT_HUT = [
  '........rrrrrr........',
  '......rrrrrrrrrr......',
  '....rrrrrrrrrrrrrr....',
  '..rrrrrrrrrrrrrrrrrr..',
  'rrrrrrrrrrrrrrrrrrrrrr',
  '.ww................ww.',
  '.ww....wwww........ww.',
  '.ww....w..w....www.ww.',
  '.ww....wwww....w.w.ww.',
  '.ww............w.w.ww.',
  'wwwwwwwwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwwwwwwwww'
];
const stiltHut = (() => {
  const W = 128, H = 80, ground = H - 4, water = 56, hx = 30, floor = water - 24;
  return source('stilt-hut', W, H, 5, {
    pieces: 'tumble',
    scene: [
      { material: 'stone', rect: [0, ground, W, 4] },
      { material: 'stone', rect: [0, water - 6, 12, ground - water + 6] }, { material: 'sand', rect: [0, water - 12, 10, 6], fill: 0.95 },
      { material: 'stone', rect: [W - 14, water - 10, 14, ground - water + 10] },
      { material: 'water', rect: [12, water, W - 26, ground - water] },
      { material: 'moss', rect: [12, ground - 2, 40, 2], fill: 0.5 },
      { rows: STILT_HUT, at: [hx, floor - STILT_HUT.length + 2], legend: { r: 'wood', w: 'wood' } },
      { material: 'wood', rect: [hx + 1, floor + 2, 2, ground - floor - 2] }, { material: 'wood', rect: [hx + 19, floor + 2, 2, ground - floor - 2] },
      { material: 'wood', rect: [hx + 19, water - 3, 2, 3], burning: true },
      { material: 'wood', rect: [84, water - 2, 14, 2] }
    ],
    clips: { 'stilt-hut': { start: 160, frames: 90, every: 4 } }
  });
})();

export const powderPresets = { 'hut-fire': hutFire, 'lava-falls': lavaFalls, 'quarry-blast': quarryBlast, 'rain-on-fire': rainOnFire, 'stilt-hut': stiltHut };
