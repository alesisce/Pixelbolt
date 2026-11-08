import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createLivePowder, packStrokes, unpackStrokes, replayStrokes, sandboxSource, SANDBOX } from '../src/powder.js';

const digest = live => createHash('sha256').update(live.render().rgba).digest('hex');
const column = (live, x) => Array.from({ length: live.height }, (_, y) => live.at(x, y).material);
const cellsOf = (live, name) => { const id = live.materials.indexOf(name) + 1, out = []; live.cells.mat.forEach((m, c) => { if (m === id) out.push(c); }); return out; };
// A wooden hut on stilts over a pool, by a lava pocket: most of the engine at once.
const hutScene = seed => sandboxSource(96, 64, [
  { material: 'stone', rect: [0, 60, 96, 4] }, { material: 'water', rect: [10, 44, 70, 16] }, { material: 'oil', rect: [20, 42, 20, 2] },
  { material: 'stone', rect: [80, 30, 16, 30] }, { material: 'lava', rect: [82, 22, 12, 8] },
  { material: 'wood', rect: [20, 30, 24, 3] }, { material: 'wood', rect: [20, 20, 24, 2] }, { material: 'wood', rect: [21, 33, 2, 27] }, { material: 'wood', rect: [41, 33, 2, 27] }
], seed);

test('the same source and the same inputs draw the same pixels; another seed differs', () => {
  const run = seed => {
    const live = createLivePowder(hutScene(seed));
    live.step(20).heat({ x: 22, y: 31, radius: 2.5, amount: 900 }).step(140);
    return digest(live);
  };
  assert.equal(run(3), run(3));
  assert.notEqual(run(3), run(4));
});

test('recorded strokes replay exactly through the packed form', () => {
  const source = sandboxSource(64, 48, [{ material: 'stone', rect: [0, 44, 64, 4] }, { material: 'wood', rect: [40, 30, 10, 14] }]);
  const live = createLivePowder(source, { record: true });
  for (let f = 0; f < 90; f++) {
    if (f < 30) live.paint({ material: 'sand', x: 10.3 + f / 4, y: 4.7, x2: 10 + f / 5, y2: 5.2, radius: 2.25, fill: 0.4 });
    if (f === 10) live.wall({ x: 20, y: 30, x2: 34, y2: 34, radius: 1.5 });
    if (f >= 20 && f < 50) live.paint({ material: 'water', x: 30, y: 3, radius: 2, fill: 0.5 });
    if (f === 40) live.heat({ x: 45, y: 40, radius: 3, amount: 700 });
    if (f === 60) live.erase({ x: 20.5, y: 32, radius: 3 });
    if (f === 70) live.paint({ material: 'lava', x: 50, y: 5, radius: 3, replace: true });
    if (f === 75) live.push({ x: 30, y: 20, x2: 40, y2: 18, radius: 6, vx: 1.5, vy: -0.75 });
    if (f === 80) live.burst({ x: 15, y: 40, radius: 5, strength: 2.5 });
    live.step();
  }
  const bytes = packStrokes(live.strokes, live.frame), { frames, strokes } = unpackStrokes(bytes);
  assert.equal(frames, 90);
  assert.deepEqual(strokes, live.strokes);
  const again = replayStrokes(createLivePowder(source), strokes, frames);
  assert.equal(digest(again), digest(live));
  assert.deepEqual(again.cells.temp, live.cells.temp);
});

test('heavier sinks through lighter: sand under water under oil', () => {
  const live = createLivePowder(sandboxSource(8, 40, [
    { material: 'oil', rect: [0, 0, 8, 6] }, { material: 'water', rect: [0, 6, 8, 6] }, { material: 'sand', rect: [0, 12, 8, 6] }
  ]));
  // Upside down: oil on top falls first, then water, then sand; they must sort by density.
  const flipped = createLivePowder(sandboxSource(8, 40, [
    { material: 'sand', rect: [0, 0, 8, 6] }, { material: 'water', rect: [0, 6, 8, 6] }, { material: 'oil', rect: [0, 12, 8, 6] }
  ]));
  for (const run of [live, flipped]) {
    run.step(600);
    const order = column(run, 4).filter(name => name !== 'empty');
    const firstOf = name => order.indexOf(name), lastOf = name => order.lastIndexOf(name);
    assert.ok(lastOf('oil') < firstOf('water') + 2, `oil floats on water: ${order.join(' ')}`);
    assert.ok(lastOf('water') < firstOf('sand') + 2, `sand sinks under water: ${order.join(' ')}`);
  }
});

test('water meeting lava becomes steam and stone; fire spreads through wood and leaves ash or nothing', () => {
  const live = createLivePowder(sandboxSource(48, 40, [
    { material: 'stone', rect: [0, 36, 48, 4] }, { material: 'water', rect: [2, 26, 16, 10] }, { material: 'lava', rect: [6, 10, 6, 4] },
    { material: 'wood', rect: [30, 20, 6, 16] }, { material: 'wood', rect: [30, 33, 6, 3], burning: true }
  ]));
  const before = live.measure().counts;
  live.step(120);
  const mid = live.measure();
  assert.ok(mid.burning > 30, `the lit wood burns and lights more (${mid.burning} burning)`);
  assert.ok((mid.counts.fire ?? 0) > 0, 'burning wood gives off fire');
  live.step(480);
  const after = live.measure().counts;
  assert.ok(after.stone > before.stone, 'lava quenched by water leaves stone');
  assert.ok((after.lava ?? 0) < before.lava);
  assert.ok((after.wood ?? 0) < before.wood / 2, 'most of the wood burned');
  assert.ok((after.ash ?? 0) > 0, 'burnt wood leaves ash');
});

test('conduction moves heat exactly: with no cooling and no sources, total heat never changes', () => {
  const source = { format: 'pixelforge-powder', width: 24, height: 16, air: { conduct: 0.3, cool: 0 }, materials: { stone: { state: 'solid', conduct: 1, colors: ['#666666'] }, wool: { state: 'solid', conduct: 0.05, colors: ['#ffffff'] } },
    scene: [{ material: 'stone', rect: [0, 8, 24, 8] }, { material: 'wool', rect: [4, 2, 6, 6] }, { material: 'stone', disc: [12, 12, 3], temperature: 900 }] };
  const live = createLivePowder(source), total = () => live.cells.temp.reduce((sum, v) => sum + v, 0), start = total();
  const hot = live.at(12, 12).temperature;
  live.step(200);
  assert.equal(total(), start);
  assert.ok(live.at(12, 12).temperature < hot, 'the hot spot spread out');
  assert.ok(live.at(0, 15).temperature > 20, 'and warmed the far corner');
});

test('latent heat: a hot stone boils only a few cells of water', () => {
  const live = createLivePowder(sandboxSource(16, 20, [{ material: 'water', rect: [0, 8, 16, 12] }, { material: 'stone', rect: [6, 14, 4, 4], temperature: 1000 }]));
  const water = live.measure().counts.water;
  live.step(400);
  assert.ok(live.measure().counts.water > water - 30, `boiled ${water - live.measure().counts.water} cells`);
});

test('mistakes in the table are named by path', () => {
  const bad = (change, pattern) => {
    const source = sandboxSource(16, 16);
    change(source);
    assert.throws(() => createLivePowder(source), pattern);
  };
  bad(s => { s.materials.sand.state = 'goo'; }, /materials\.sand\.state: expected one of powder/);
  bad(s => { s.reactions.push({ a: 'water', b: 'mud' }); }, /reactions\[8\]\.b: no material named "mud"/);
  bad(s => { s.materials.water.above.into = 'water'; }, /water\.above\.into: a material cannot change into itself/);
  bad(s => { s.materials.stone.density = 20; }, /stone\.density: fixed solids do not move/);
  bad(s => { s.materials.sand.falls = true; }, /sand\.falls: only solids fall as pieces/);
  bad(s => { s.wall = 'wood'; }, /powder\.wall: the wall material must be a fixed solid/);
  bad(s => { s.materials.water.colorBy = 'density'; }, /water\.colorBy: "density" draws a gas or flame/);
  bad(s => { s.materials.smoke.haze = '#000000'; }, /smoke\.haze: a gas drawn by density makes its own haze/);
  bad(s => { s.materials.stone.streak = '#ffffff'; }, /stone\.streak: a streak trails falling powders and liquids/);
  bad(s => { s.gravity = 2; }, /powder\.gravity: expected a number from 0\.02 to 1/);
  bad(s => { s.air.flow.cell = 1; }, /powder\.air\.flow\.cell: expected a whole number from 2 to 16/);
  bad(s => { s.air.flow.wind = [3, 0]; }, /powder\.air\.flow\.wind\[0\]: expected a number from -2 to 2/);
  bad(s => { s.air.flow.gusts = 1; }, /powder\.air\.flow\.gusts: unknown field/);
  assert.throws(() => createLivePowder({ ...sandboxSource(16, 16), air: {} }).push({ x: 4, y: 4, vx: 1 }), /push: the source has no moving air; set air\.flow/);
  bad(s => { s.reactions.push({ a: 'lava', b: 'water' }); }, /lava and water already react/);
  bad(s => { s.materials.sand.colors = ['#ff000080']; }, /sand\.colors\[0\]: materials are drawn opaque/);
});

test('the engine draws no random numbers or trigonometry of its own', async () => {
  const code = await readFile(new URL('../src/powder.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /Math\.(random|sin|cos|tan|atan2?|exp|log|pow)\s*\(/);
});

test('render keys name a palette colour per pixel, "." where nothing is', () => {
  const live = createLivePowder(sandboxSource(12, 8, [{ material: 'sand', rect: [0, 6, 12, 2] }]));
  const { keys } = live.render();
  assert.equal(keys.length, 8);
  assert.equal(keys[0], '.'.repeat(12));
  for (const key of keys[7]) assert.ok(Object.hasOwn(live.palette, key));
  assert.ok(SANDBOX.materials.sand.colors.includes(live.palette[keys[7][0]]));
});

test('falls speed up: a dropped grain covers more ground each frame, up to a top speed', () => {
  const live = createLivePowder(sandboxSource(8, 200, [{ material: 'sand', rect: [3, 0, 1, 1] }]));
  const depth = () => Math.floor(cellsOf(live, 'sand')[0] / 8);
  live.step(10);
  const early = depth();
  live.step(10);
  const later = depth() - early;
  assert.ok(early >= 10 && later > early + 5, `fell ${early} pixels in the first 10 frames and ${later} in the next 10`);
  live.step(10);
  assert.ok(live.at(3, depth()).velocity[1] <= 6, 'never faster than 6 pixels a frame');
});

test('a block of water dropped on a floor splashes up and surges sideways, then comes to rest', () => {
  const live = createLivePowder(sandboxSource(96, 48, [{ material: 'stone', rect: [0, 44, 96, 4] }, { material: 'water', rect: [40, 2, 16, 8] }]));
  let rose = 0, widest = 0;
  for (let f = 0; f < 90; f++) {
    live.step();
    rose += live.cells.vy.filter((v, c) => v < 0 && live.cells.mat[c]).length;
    const xs = cellsOf(live, 'water').map(c => c % 96);
    widest = Math.max(widest, Math.max(...xs) - Math.min(...xs));
  }
  assert.ok(rose > 0, 'some water was thrown back up');
  assert.ok(widest > 60, `the landing spread the water ${widest} pixels wide`);
  live.step(600);
  const before = Uint8Array.from(live.cells.mat);
  live.step(60);
  assert.deepEqual(live.cells.mat, before, 'a puddle comes to rest');
});

test('a pool levels to rest: water poured in stops moving', () => {
  const live = createLivePowder(sandboxSource(64, 40, [{ material: 'stone', rect: [0, 36, 64, 4] }, { material: 'stone', rect: [0, 16, 2, 20] }, { material: 'stone', rect: [62, 16, 2, 20] }]));
  for (let f = 0; f < 120; f++) live.paint({ material: 'water', x: 20.5, y: 2.5, radius: 1.5, fill: 0.6 }).step();
  live.step(900);
  const before = Uint8Array.from(live.cells.mat);
  live.step(60);
  assert.deepEqual(live.cells.mat, before);
  // The surface is flat but for one strip at most: no column of water is two or more pixels higher than another.
  const tops = [];
  for (let x = 2; x < 62; x++) tops.push(column(live, x).indexOf('water'));
  assert.ok(Math.max(...tops) - Math.min(...tops) <= 1, `surface rows ${[...new Set(tops)].join(', ')}`);
});

test('solids that fall: a loose piece drops as one, floats on water if lighter, and a fixed solid stays put', () => {
  const live = createLivePowder(sandboxSource(48, 48, [
    { material: 'stone', rect: [0, 44, 48, 4] }, { material: 'water', rect: [0, 30, 48, 14] },
    { material: 'wood', rect: [10, 4, 8, 3] }, { material: 'stone', rect: [30, 4, 8, 3] },
    // A beam held by a post that stands on the floor.
    { material: 'wood', rect: [26, 12, 16, 2] }, { material: 'wood', rect: [40, 14, 2, 30] }
  ]));
  const raft = () => cellsOf(live, 'wood').filter(c => c % 48 < 20);
  const shape = cells => cells.map(c => c - cells[0]).join();
  const start = shape(raft());
  live.step(60);
  assert.equal(shape(raft()), start, 'the raft kept its shape');
  const rows = raft().map(c => Math.floor(c / 48));
  assert.ok(Math.max(...rows) <= 30 && Math.max(...rows) >= 28, `the raft floats on the water (rows ${Math.min(...rows)} to ${Math.max(...rows)})`);
  assert.equal(live.at(30, 4).material, 'stone', 'fixed stone stays where it is drawn');
  assert.equal(live.at(26, 12).material, 'wood', 'the beam is held by its post');
  // Take the post away: the beam falls to the water. (Cut only partway, it would settle on the stub.)
  live.erase({ x: 41, y: 14, x2: 41, y2: 44, radius: 1.5 }).step(40);
  assert.notEqual(live.at(26, 12).material, 'wood');
  assert.ok(cellsOf(live, 'wood').some(c => c % 48 === 26 && Math.floor(c / 48) >= 27), 'the beam fell to the water');
});

test('drawing: fast drops trail streaks, gases draw as clouds and a lone gas cell is not drawn', () => {
  const live = createLivePowder(sandboxSource(16, 80, [{ material: 'water', rect: [8, 0, 1, 1] }]));
  live.step(24);
  const drop = cellsOf(live, 'water')[0], keys = live.render().keys, { palette } = live, x = drop % 16, y = Math.floor(drop / 16);
  assert.ok(live.at(x, y).velocity[1] >= 2);
  assert.equal(palette[keys[y - 1][x]], SANDBOX.materials.water.streak, 'a streak above the falling drop');
  const still = createLivePowder(sandboxSource(16, 80, [{ material: 'smoke', rect: [0, 70, 6, 6] }, { material: 'steam', rect: [12, 74, 1, 1] }]));
  const fresh = still.render().keys, smoke = SANDBOX.materials.smoke.colors;
  assert.equal(still.palette[fresh[73][2]], smoke.at(-1), 'the middle of a full cloud is its thickest colour');
  assert.ok(smoke.includes(still.palette[fresh[69][2]]), 'the pixel above the cloud is hazed');
  assert.equal(fresh[74][12], '.', 'the lone steam cell is not drawn');
});

test('settled regions: a quiet scene stops costing steps, a poke wakes what it reaches, and heat crosses into sleeping chunks', () => {
  const live = createLivePowder(sandboxSource(128, 96, [
    { material: 'stone', rect: [0, 88, 128, 8] }, { material: 'sand', rect: [4, 60, 40, 28] },
    { material: 'stone', rect: [60, 56, 4, 32] }, { material: 'stone', rect: [124, 56, 4, 32] }, { material: 'water', rect: [64, 64, 60, 24] }
  ]));
  live.step(300);
  assert.deepEqual(live.measure().chunks, { stepped: 0, of: 48 }, 'everything has settled');
  live.paint({ material: 'sand', x: 100.5, y: 8.5, radius: 2 }).step();
  const woken = live.measure().chunks.stepped;
  assert.ok(woken >= 1 && woken <= 4, `the poke woke ${woken} chunks`);
  live.step(300);
  assert.equal(live.measure().chunks.stepped, 0, 'and the sand sank into the pool and settled again');
  // A hot spot in a settled slab: the heat spreads over chunk edges, exactly.
  const slab = createLivePowder({ format: 'pixelforge-powder', width: 64, height: 48, air: { conduct: 0, cool: 0 }, materials: { stone: { state: 'solid', conduct: 1, colors: ['#666666'] } }, scene: [{ material: 'stone', rect: [0, 0, 64, 48] }] });
  slab.step(2);
  assert.equal(slab.measure().chunks.stepped, 0);
  const total = () => slab.cells.temp.reduce((sum, v) => sum + v, 0);
  slab.heat({ x: 8, y: 8, radius: 3, amount: 1500 }).step();
  const start = total();
  slab.step(400);
  assert.equal(total(), start);
  assert.ok(slab.at(34, 8).temperature > 20 && slab.at(30, 30).temperature > 20, 'two chunks away warmed');
});

test('moving air: heat lifts it, the wind carries smoke and ash, a push stirs it and gases leave through the open top', () => {
  const windy = wind => { const source = sandboxSource(96, 64, [{ material: 'stone', rect: [0, 60, 96, 4] }, { material: 'smoke', rect: [20, 30, 8, 8] }]); source.air.flow.wind = wind; return createLivePowder(source); };
  const meanX = live => { const xs = cellsOf(live, 'smoke').map(c => c % 96); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  const calm = windy([0, 0]), breezy = windy([1, 0]);
  calm.step(40); breezy.step(40);
  assert.ok(meanX(breezy) > meanX(calm) + 12, `the wind carried the smoke (${meanX(calm).toFixed(1)} still, ${meanX(breezy).toFixed(1)} in the wind)`);
  // A fire under open air makes an updraft above it, and none inside the stone floor.
  const fire = createLivePowder(sandboxSource(64, 64, [{ material: 'stone', rect: [0, 56, 64, 8] }, { material: 'wood', rect: [24, 48, 16, 8], burning: true }]));
  fire.step(60);
  assert.ok(fire.at(32, 36).air[1] < -0.2, `air above the fire rises (${fire.at(32, 36).air[1].toFixed(2)} pixels a frame)`);
  assert.deepEqual(fire.at(10, 61).air, [0, 0], 'no air moves inside the floor');
  // A push sweeps smoke along.
  const pushed = windy([0, 0]), before = meanX(pushed);
  for (let f = 0; f < 10; f++) pushed.push({ x: 24, y: 34, radius: 10, vx: 2, vy: 0 }).step();
  assert.ok(meanX(pushed) > before + 6, 'the push moved the smoke');
  // Smoke that reaches the open top leaves.
  const rising = createLivePowder(sandboxSource(32, 24, [{ material: 'smoke', rect: [8, 2, 16, 4] }]));
  rising.step(60);
  assert.ok((rising.measure().counts.smoke ?? 0) < 20, 'the smoke rose out of the top');
});

test('a burst blows loose powders and liquids outward and leaves solids where they are', () => {
  const live = createLivePowder(sandboxSource(96, 64, [{ material: 'stone', rect: [0, 56, 96, 8] }, { material: 'sand', rect: [36, 44, 24, 12] }, { material: 'stone', rect: [46, 40, 4, 4] }]));
  const sand = () => cellsOf(live, 'sand').map(c => c % 96);
  const before = sand(), spread = xs => Math.max(...xs) - Math.min(...xs);
  live.burst({ x: 48, y: 52, radius: 10, strength: 4 }).step(40);
  assert.ok(spread(sand()) > spread(before) + 16, `the heap was thrown wider (${spread(before)} to ${spread(sand())} pixels)`);
  assert.equal(live.at(47, 41).material, 'stone');
});

test('air sealed in a pocket of stone stays still and finite', () => {
  const live = createLivePowder(sandboxSource(48, 48, [{ material: 'stone', rect: [0, 0, 48, 48] }, { material: 'smoke', rect: [20, 20, 4, 4] }, { material: 'fire', rect: [24, 20, 2, 2] }]));
  live.step(30);
  for (const value of live.at(22, 22).air ?? [0, 0]) assert.ok(Number.isFinite(value));
  live.erase({ x: 22, y: 22, radius: 10 }).step(30);
  for (const value of live.at(22, 22).air) assert.ok(Number.isFinite(value));
});
