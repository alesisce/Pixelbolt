import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError } from '../src/core.js';
import { compileBodies, createBodyWorld, readBodies, drawBodies, bodiesFrames } from '../src/bodies.js';
import { cosDeg, sinDeg } from '../src/craft.js';
import { startMCP } from '../src/mcp.js';
import { packageFiles } from '../scripts/build-studio.mjs';
import { bodiesPresets } from '../scripts/bodies-presets.mjs';
import { BODIES_SHOWCASE, buildBodiesGIFs } from '../showcase/bodies/build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const GOLDEN = {
  'ring-escape': '732208a10f7603dfd3e5cc447dc62a066f732f626c7b134fde5300af8b5cfe71', 'bouncing-pixel': '22d7b1e4fdeacec4f88ab370e864c20097dab67e2097d538072495f3dc1e2e2e', 'spinning-hoop': '066de7bb6a870cd3148848e00a9f790bd68db5906b63ef7cbdb400dc824a65cb', 'crate-topple': '5c9e52ca11859b586116e0bbed1cf38e5c5ea439ba72ebddafee52c0b4fa81eb', territory: '8745dc5981857cddd5ffb587c3ca0bd5a7e65d19bd8337495af6ca7963fc9025', 'blade-bloom': '7f6a2cf2165d9647884592185d340b3f8f1fc56347a25a6fd30e16a4e93288d2'
};
const example = async name => JSON.parse(await readFile(path.join(root, 'examples', `${name}.bodies.json`), 'utf8'));
const palette = { k: '#111111', w: '#eeeeee', r: '#dd3344', s: '#555566' };
const scene = (effect, extra = {}) => ({ format: 'pixelforge-bodies', version: 1, name: 'bodies', width: 48, height: 32, palette, ...extra, effects: { e: { frames: 40, ...effect } } });
const run = source => { const { recipe, metadata } = compileBodies(source); return { recipe, effect: Object.values(metadata.effects)[0] }; };
const refused = (source, where, pattern) => assert.throws(() => compileBodies(source), error => error instanceof PixelError && error.path === where && pattern.test(error.message), where);
// The highest point (smallest y) a path reaches after `from`, between bounces.
const apexes = path => { const out = []; for (let i = 1; i + 1 < path.length; i++) if (path[i][1] < path[i - 1][1] && path[i][1] <= path[i + 1][1]) out.push(path[i][1]); return out; };

test('bodies sources are read strictly, with paths and the fix in each message', () => {
  refused({ format: 'pixelforge-bodies', version: 2 }, 'bodies', /version-1/);
  refused(scene({ bodies: [{ shape: 'star', at: [8, 8], fill: 'k' }] }), 'bodies.effects.e.bodies[0].shape', /circle, box, polygon, hoop/);
  refused(scene({ bodies: [{ shape: 'hoop', radius: 8, at: [8, 8], fill: 'k' }] }), 'bodies.effects.e.bodies[0].fixed', /container/);
  refused(scene({ bodies: [{ shape: 'box', size: [4, 4], at: [8, 8], fixed: true, density: 2, fill: 'k' }] }), 'bodies.effects.e.bodies[0].density', /moves freely/);
  refused(scene({ bodies: [{ shape: 'circle', radius: 2, at: [8, 8], fill: 'k', symbol: 'x' }] }), 'bodies.effects.e.bodies[0].symbol', /not both/);
  refused(scene({ bodies: [{ shape: 'circle', radius: 2, at: [8, 8] }] }), 'bodies.effects.e.bodies[0].fill', /palette key/);
  refused(scene({ bodies: [{ shape: 'circle', radius: 2, at: [8, 8], fill: 'z' }] }), 'bodies.effects.e.bodies[0].fill', /palette/);
  refused(scene({ bodies: [{ shape: 'polygon', points: [[0, 0], [4, 0], [1, 1], [0, 4]], at: [8, 8], fill: 'k' }] }), 'bodies.effects.e.bodies[0].points', /convex/);
  refused(scene({ bodies: [{ shape: 'box', size: [2, 2], at: [8, 8], fill: 'k', ring: { radius: 40, count: 300 } }] }), 'bodies.effects.e.bodies[0].ring.count', /256/);
  refused(scene({ bodies: [{ shape: 'circle', radius: 2, at: [8, 8], fill: 'k', bouncy: 1 }] }), 'bodies.effects.e.bodies[0].bouncy', /unknown/);
  refused(scene({ obstacles: [{ symbol: 'nope' }], bodies: [{ shape: 'circle', radius: 2, at: [8, 8], fill: 'k' }] }), 'bodies.effects.e.obstacles[0].symbol', /unknown symbol/);
  const warned = compileBodies(scene({ bodies: [{ shape: 'box', size: [6, 6], at: [10, 10], fill: 'k' }, { shape: 'box', size: [6, 6], at: [11, 10], fill: 'w' }] }));
  assert.match(warned.warnings.join('\n'), /starts inside/);
});

test('a ball with bounce 1 keeps its height, one with bounce 0 lands dead, and a damped one comes to rest', () => {
  const ball = (bounce, name) => ({ name, shape: 'circle', radius: 2, at: [name === 'dead' ? 8 : name === 'half' ? 20 : 32, 6], bounce, fill: 'k' });
  const { effect } = run(scene({ frames: 200, walls: ['bottom'], bodies: [ball(1, 'elastic'), ball(0, 'dead'), ball(0.6, 'half')] }));
  const elastic = apexes(effect.paths.elastic);
  assert.ok(elastic.length >= 3, `${elastic.length} bounces`);
  for (const y of elastic) assert.ok(Math.abs(y - 6) <= 1, `the elastic ball rose to ${y}, not 6`);
  // The floor is the canvas bottom: a radius-2 ball rests with its centre at 30.
  const dead = effect.paths.dead, landed = dead.findIndex(p => p[1] >= 29.9);
  assert.ok(landed > 0 && dead.slice(landed).every(p => p[1] >= 29.9), 'the dead ball never leaves the floor once it lands');
  const half = effect.paths.half.slice(-20);
  assert.ok(half.every(p => p[0] === half[0][0] && p[1] === half[0][1]), 'the damped ball has stopped');
});

test('a stack rests, a box slides along a pixel floor without catching, and a fast pixel never passes a thin wall', () => {
  const stack = run(scene({ frames: 60, walls: ['bottom'], bodies: [{ name: 'box', shape: 'box', size: [6, 6], at: [24, 29], fill: 'k', grid: { count: [1, 4], step: [0, -6] } }] })).effect;
  assert.ok(stack.rest !== null && stack.rest < 60, `the stack rests at ${stack.rest}`);
  [0, 1, 2, 3].forEach(k => { const p = stack.paths[`box-${k}`].at(-1); assert.ok(Math.abs(p[0] - 24) < 0.05 && Math.abs(p[1] - (29 - 6 * k)) < 0.1, `box ${k} at ${p}`); });
  // A floor of three symbols side by side: the box slides over every seam at the same height, slowing steadily.
  const floor = { f: ['ssssssssssssssss', 'ssssssssssssssss'] };
  const slide = run(scene({ frames: 50, obstacles: [0, 16, 32].map(x => ({ symbol: 'f', x, y: 28 })), bodies: [{ name: 'box', shape: 'box', size: [4, 4], at: [4, 26], velocity: [1.6, 0], friction: 0.15, fill: 'k' }] }, { symbols: floor })).effect.paths.box;
  for (let i = 1; i < slide.length; i++) {
    assert.ok(Math.abs(slide[i][1] - 26) < 0.05, `frame ${i}: the box rides at ${slide[i][1]}`);
    assert.ok(slide[i][0] >= slide[i - 1][0], `frame ${i}: the box caught on a seam`);
  }
  // A one-pixel wall and a pixel thrown at it at the speed limit.
  const wall = { w: Array.from({ length: 32 }, () => 's') };
  const thrown = run(scene({ frames: 30, gravity: [0, 0], walls: ['left'], obstacles: [{ symbol: 'w', x: 30, y: 0 }], bodies: [{ name: 'pixel', shape: 'circle', radius: 0.5, at: [4.5, 16.5], velocity: [8, 0], bounce: 1, fill: 'w' }] }, { symbols: wall })).effect.paths.pixel;
  assert.ok(thrown.every(p => p[0] < 30), 'the pixel stays on its side of the wall');
  assert.ok(thrown.at(-1)[0] < 20, 'and bounces back');
});

test('an asleep body holds still until hit, a weightless one floats, and a moving fixed body pushes', () => {
  const held = run(scene({ frames: 60, walls: ['bottom'], bodies: [
    { name: 'hanging', shape: 'box', size: [4, 4], at: [24, 8], asleep: true, fill: 'k' },
    { name: 'floating', shape: 'box', size: [4, 4], at: [40, 8], weightless: true, fill: 'k' },
    { name: 'ball', shape: 'circle', radius: 2, at: [24, 1], velocity: [0, 1.5], gravity: undefined, bounce: 0, fill: 'r' }
  ].map(b => { delete b.gravity; return b; }) })).effect;
  assert.deepEqual(held.paths.floating.at(-1), [40, 8, 0], 'the weightless box never moved or turned');
  assert.ok(held.paths.hanging[2][1] === 8 || held.paths.hanging.at(-1)[1] > 20, 'the hit box falls once the ball strikes it');
  assert.ok(held.paths.hanging.at(-1)[1] > 25, 'and lands');
  const untouched = run(scene({ frames: 30, bodies: [{ name: 'hanging', shape: 'box', size: [4, 4], at: [24, 8], asleep: true, fill: 'k' }] })).effect;
  assert.ok(untouched.paths.hanging.every(p => p[0] === 24 && p[1] === 8), 'with nothing to wake it, it hangs in the air');
  // A fixed paddle moving along the floor pushes a box ahead of it and never gives way.
  const pushed = run(scene({ frames: 50, walls: ['bottom'], bodies: [
    { name: 'paddle', shape: 'box', size: [2, 8], at: [4, 28], fixed: true, velocity: [0.5, 0], fill: 'w' },
    { name: 'box', shape: 'box', size: [4, 4], at: [12, 30], friction: 0.3, fill: 'k' }] })).effect;
  const box = pushed.paths.box.at(-1);
  assert.ok(box[0] >= 4 + 0.5 * 49 + 1 + 2 - 0.2, `the box was pushed to ${box}`);
  assert.ok(Math.abs(box[1] - 30) < 0.1, 'along the floor');
});

test('the presets do what they show: the ball escapes the ring, the pixel and the crates come to rest, the balls leave the hoop', () => {
  const ring = run(bodiesPresets['ring-escape']).effect;
  assert.equal(ring.escaped.length, 1);
  assert.equal(ring.escaped[0].body, 'ball');
  assert.ok(ring.escaped[0].frame > 120 && ring.rest !== null, `escaped at ${ring.escaped[0].frame}, at rest from ${ring.rest}`);
  assert.ok(ring.hits > 40, `${ring.hits} hits`);
  // A body that has left keeps a place in its path for every frame: null from the frame it left.
  assert.equal(ring.paths.ball.length, ring.frames);
  assert.equal(ring.paths.ball.findIndex(p => p === null), ring.escaped[0].frame);
  assert.ok(ring.paths.ball.slice(ring.escaped[0].frame).every(p => p === null));
  const pixel = run(bodiesPresets['bouncing-pixel']).effect;
  assert.ok(pixel.rest !== null && pixel.hits >= 8, `the pixel bounced ${pixel.hits} times and rests from ${pixel.rest}`);
  const crates = run(bodiesPresets['crate-topple']).effect;
  assert.ok(crates.rest !== null, 'the crates come to rest');
  // The hoop's centre is [36, 30] and its radius 24: a ball past 27 from the centre is out.
  const hoop = run(bodiesPresets['spinning-hoop']).effect, out = name => hoop.paths[name].some(([x, y]) => (x - 36) ** 2 + (y - 30) ** 2 > 27 * 27);
  assert.ok(['red', 'yellow', 'green'].filter(out).length >= 2, 'at least two balls found the gap and fell out of the hoop');
});

test('the work estimate counts the obstacle faces near each body and the pixels drawn finer, so a heavy source is refused before it runs', () => {
  // A checkerboard has a face on every pixel edge, and a box over one meets a face a pixel. Counting bodies alone, these
  // 8 boxes kept moving over one were 2.7 million updates of the 400 million allowed, and took 10 seconds where the same
  // boxes without it take a third of one.
  const checker = Array.from({ length: 112 }, (_, y) => Array.from({ length: 112 }, (_, x) => ((x + y) % 2 ? 's' : '.')).join(''));
  const board = (obstacles, frames = 256) => ({ format: 'pixelforge-bodies', version: 1, name: 'checker', width: 128, height: 128, palette, symbols: { checker },
    effects: { e: { frames, gravity: [0, 0], walls: ['left', 'right', 'top', 'bottom'], obstacles, bodies: [{ shape: 'box', size: [24, 24], at: [20, 20], grid: { count: [4, 2], step: [28, 28] }, fill: 'r', weightless: true, tireless: true, velocity: [1, 0.5] }] } } });
  const faces = [{ symbol: 'checker', x: 8, y: 8, draw: 'none' }];
  refused(board(faces), 'bodies.effects.e', /need about \d+ million updates, more than 400 million; .*the obstacle faces near them \(a checkerboard has one on every pixel edge\)/);
  assert.throws(() => bodiesFrames(board(faces, 18000)), error => error instanceof PixelError && /the match needs about \d+ million updates, more than 4000 million/.test(error.message));
  assert.equal(bodiesFrames(board([], 18000)).frames, 18000);
  // Drawn 8 times finer, each of 256 boxes visits the whole fine canvas every frame: as a long match that ran for an
  // hour. The same match at whole pixels is within the limit (bodiesFrames simulates nothing until asked for a frame).
  const fine = subpixels => ({ format: 'pixelforge-bodies', version: 1, name: 'heavy', width: 32, height: 32, ...(subpixels > 1 && { subpixels }), palette,
    effects: { e: { frames: 18000, substeps: 1, iterations: 1, gravity: [0, 0], bodies: [{ shape: 'box', size: [40, 40], at: [16, 16], angle: 30, grid: { count: [16, 16], step: [0.001, 0.001] }, asleep: true, fill: 'r', outline: 'k' }] } } });
  assert.equal(bodiesFrames(fine(1)).frames, 18000);
  assert.throws(() => bodiesFrames(fine(8)), error => error instanceof PixelError && error.path === 'bodies.effects.e' && /the match needs about \d+ million updates, more than 4000 million; .*or subpixels/.test(error.message));
});

test('every rigid-body example compiles to its golden recipe and draws only palette keys', async () => {
  for (const name of BODIES_SHOWCASE) {
    const source = await example(name);
    assert.deepEqual(source, JSON.parse(JSON.stringify(bodiesPresets[name])), `examples/${name}.bodies.json is stale; run node scripts/generate-examples.js`);
    const { recipe } = compileBodies(source);
    assert.equal(sha(recipe), GOLDEN[name], `${name} compiled differently; if the change is intended, update GOLDEN and rebuild the GIFs`);
    const keys = new Set(Object.keys(source.palette));
    for (const frame of recipe.frames) for (const op of frame.ops ?? []) {
      // A territory's heads-up display adds text and its boxes and bars.
      assert.ok(['grid', 'stamp', 'rect', 'text'].includes(op.op), `${name} ${frame.name}: ${op.op}`);
      if (op.op === 'grid') for (const row of op.rows) for (const char of row) assert.ok(char === '.' || keys.has(char), `${name} ${frame.name} draws ${char}`);
    }
    renderProject(recipe);
  }
  const { files } = await buildBodiesGIFs();
  for (const [file, bytes] of files) assert.ok(bytes.equals(await readFile(path.join(root, file))), `${file} is stale; run node showcase/bodies/build.mjs --force`);
});

test('the bodies schema lists exactly the fields the compiler reads, and the package ships it', async () => {
  const schema = JSON.parse(await readFile(path.join(root, 'bodies.schema.json'), 'utf8')), effect = schema.properties.effects.additionalProperties, body = effect.properties.bodies.items;
  const unknown = (source, where) => { try { compileBodies(source); return false; } catch (error) { return error.path === where && /unknown or null field/.test(error.message); } };
  const base = () => scene({ bodies: [{ shape: 'circle', radius: 2, at: [8, 8], fill: 'k' }], obstacles: [{ symbol: 'lid' }] }, { symbols: { lid: ['k'] } });
  const levels = [
    [schema.properties, (s, key) => { s[key] = s[key] ?? 0; }, 'bodies'],
    [effect.properties, (s, key) => { s.effects.e[key] = 0; }, 'bodies.effects.e'],
    [body.properties, (s, key) => { s.effects.e.bodies[0][key] = 0; }, 'bodies.effects.e.bodies[0]'],
    [effect.properties.obstacles.items.properties, (s, key) => { s.effects.e.obstacles[0][key] = 0; }, 'bodies.effects.e.obstacles[0]'],
    [body.properties.trail.properties, (s, key) => { s.effects.e.bodies[0].trail = { color: 'k', [key]: 0 }; }, 'bodies.effects.e.bodies[0].trail'],
    [body.properties.ring.properties, (s, key) => { s.effects.e.bodies[0].ring = { radius: 4, count: 2, [key]: 0 }; }, 'bodies.effects.e.bodies[0].ring'],
    [body.properties.grid.properties, (s, key) => { s.effects.e.bodies[0].grid = { count: [1, 1], step: [1, 1], [key]: 0 }; }, 'bodies.effects.e.bodies[0].grid']
  ];
  for (const [properties, set, where] of levels) {
    for (const key of Object.keys(properties)) { const source = base(); set(source, key); assert.ok(!unknown(source, `${where}.${key}`), `${where}.${key} is in the schema but the compiler refuses it`); }
    const source = base(); set(source, 'notAField'); assert.ok(unknown(source, `${where}.notAField`), `${where} accepts a field the schema doesn't list`);
  }
  const files = await packageFiles();
  assert.ok(files.includes('bodies.schema.json') && files.includes('src/bodies.js'));
  for (const name of BODIES_SHOWCASE) assert.ok(files.includes(`examples/${name}.bodies.json`), name);
});

test('MCP and the CLI compile bodies sources and presets', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-bodies-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', id = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, root: dir, directory: dir }); t.after(() => input.end());
  const call = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'bodies-test', version: '1' } });
  const help = await call('tools/call', { name: 'pixel_help', arguments: { topic: 'bodies' } });
  assert.equal(JSON.parse(help.result.content[0].text).title, 'Pixelbolt rigid bodies');
  const source = scene({ frames: 12, walls: ['bottom'], bodies: [{ name: 'ball', shape: 'circle', radius: 2, at: [24, 8], fill: 'r' }] });
  const compiled = JSON.parse((await call('tools/call', { name: 'pixel_compile', arguments: { source, metadata: true } })).result.content[0].text);
  assert.deepEqual([compiled.ok, compiled.frames, compiled.metadata.format], [true, 12, 'pixelforge-bodies-metadata']);
  const preset = JSON.parse((await call('tools/call', { name: 'pixel_compile', arguments: { preset: 'ring-escape' } })).result.content[0].text);
  assert.equal(preset.ok, true);
  const file = path.join(dir, 'drop.bodies.json'), out = path.join(dir, 'drop.json');
  await writeFile(file, JSON.stringify(source));
  const cli = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'compile', file, '--out', out], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).frames.length, 12);
});

test('bodies drawn finer than the world turn as rigid pictures, within the canvas limits', () => {
  const source = (subpixels, extra = {}) => ({ format: 'pixelforge-bodies', version: 1, name: 'fine', width: 32, height: 24, subpixels, palette, symbols: { post: ['ss', 'ss'] },
    effects: { e: { frames: 24, gravity: [0, 0], obstacles: [{ symbol: 'post', x: 2, y: 2 }], bodies: [{ shape: 'box', size: [8, 8], at: [16, 12], fixed: true, spin: 3.75, fill: 'w', outline: 'k' }], ...extra } } });
  const { recipe } = compileBodies(source(4)), fill = { w: 0, k: 0 };
  assert.deepEqual([recipe.width, recipe.height], [128, 96]);
  // The world is drawn in blocks of four: the post's stamp is enlarged and placed four times further out.
  assert.deepEqual(recipe.frames[0].ops.find(op => op.op === 'stamp'), { op: 'stamp', symbol: 'post', x: 8, y: 8, scale: 4 });
  // Every frame draws the same picture turned: 8 × 8 pixels of 4 × 4, the outline a ring 4 fine pixels wide.
  for (const frame of recipe.frames) {
    const grid = frame.ops.find(op => op.op === 'grid'), count = { w: 0, k: 0 };
    for (const row of grid.rows) for (const ch of row) if (ch in count) count[ch]++;
    assert.ok(Math.abs(count.w + count.k - 1024) <= 40, `${frame.name}: ${count.w + count.k} fine pixels for 1024`);
    assert.ok(Math.abs(count.w - 576) <= 40 && Math.abs(count.k - 448) <= 40, `${frame.name}: fill ${count.w} and outline ${count.k}, for 576 and 448`);
    fill.w += count.w; fill.k += count.k;
  }
  assert.equal(renderProject(recipe).frames.length, 24);
  refused({ ...source(9) }, 'bodies.subpixels', /from 1 to 8/);
  refused({ ...source(4), width: 72 }, 'bodies.subpixels', /at most 256 a side, so use subpixels of at most 3/);
  refused({ ...source(4, { frames: 100 }), width: 64, height: 48 }, 'bodies.subpixels', /4,194,304.*lower subpixels to 3/);
});

test('bodies drawn finer than the world hold still while they bob or rock, keep straight sides at rest and turn evenly', () => {
  // One crate, placed and turned by hand frame after frame, drawn 2 (or 3) times finer as compileBodies draws it.
  const symbols = { crate: ['kkkkkkkk', 'kwwwwwwk', 'kwkwwwwk', 'kwwkwwwk', 'kwwwkwwk', 'kwwwwkwk', 'kwwwwwwk', 'kkkkkkkk'] };
  const crate = (n, spin = 0) => {
    const [b] = createBodyWorld({ substeps: 8, iterations: 6, gravity: [0, 0], walls: { left: false, right: false, top: false, bottom: false }, obstacles: [],
      bodies: readBodies([{ shape: 'box', size: [8, 8], at: [16, 12], symbol: 'crate', ...(spin && { fixed: true, spin }) }], 'bodies', { palette, symbols, width: 32, height: 24 }) }, { width: 32, height: 24 }).bodies;
    return { b, draw: (x, y, degrees) => { b.x = x; b.y = y; b.c = cosDeg(degrees); b.s = sinDeg(degrees); const { op } = drawBodies([b], 32, 24, symbols, n); return op; } };
  };
  const cells = op => { const out = new Map(); op.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') out.set(`${op.x + i},${op.y + j}`, row[i]); }); return out; };
  // At rest a hundredth of a degree off square, with its sides where the fine pixels' centres are, it is drawn square:
  // each row of it spans the same fine pixels (sampled on its pixel edges, half of each side was a fine pixel out).
  const rest = crate(2).draw(16.75, 12, 0.06);
  assert.equal(rest.rows.length, 16);
  assert.deepEqual(new Set(rest.rows.map(row => `${row.search(/[^.]/)}:${row.replace(/\./g, '').length}`)), new Set(['0:16']), `a straight-sided crate: ${rest.rows.join('/')}`);
  // Bobbing a tenth of a pixel and rocking a third of a degree, it draws the same pixels every frame.
  const bob = crate(3), first = JSON.stringify(bob.draw(16.4, 12.3, 8.9));
  for (let f = 1; f < 24; f++) assert.equal(JSON.stringify(bob.draw(16.4 + 0.1 * Math.sin(f), 12.3 + 0.1 * Math.cos(f * 1.3), 8.9 + 0.3 * Math.sin(f * 0.7))), first, `frame ${f} holds still`);
  // Sliding at a fixed angle, it moves on a fine pixel at a time, never back, and its picture never changes.
  const slide = crate(3), start = cells(slide.draw(10, 12, 20)), shifted = by => new Map([...start].map(([key, ch]) => { const [x, y] = key.split(',').map(Number); return [`${x + by},${y}`, ch]; }));
  let shift = 0;
  for (let f = 1; f <= 30; f++) {
    const now = cells(slide.draw(10 + f / 9, 12, 20)), next = [shift, shift + 1].find(by => JSON.stringify([...shifted(by)]) === JSON.stringify([...now]));
    assert.ok(next !== undefined, `frame ${f}: the same picture, ${shift} or ${shift + 1} fine pixels on`);
    shift = next;
  }
  assert.ok(Math.abs(shift - 10) <= 1, `it slid 10 fine pixels: ${shift}`);
  // Spinning, it is drawn at its own angle every frame: evenly turned, never held back.
  const spin = crate(3, 4.5), turned = [];
  for (let f = 0; f < 8; f++) turned.push(JSON.stringify(spin.draw(16, 12, 4.5 * f)));
  assert.equal(new Set(turned).size, 8, 'a new picture every frame');
  for (let f = 0; f < 8; f++) assert.equal(turned[f], JSON.stringify(crate(3, 4.5).draw(16, 12, 4.5 * f)), `frame ${f} is drawn at exactly its angle, as a body first drawn there is`);
});

// One body, or several, read and placed as a world places them, for drawing by hand.
const placed = (entries, width = 64, height = 48, symbols = {}) => createBodyWorld({ substeps: 8, iterations: 6, gravity: [0, 0], walls: {}, obstacles: [],
  bodies: readBodies(entries, 'bodies', { palette, symbols, width, height }) }, { width, height }).bodies;
const drawnCells = (bodies, width = 64, height = 48, symbols = {}, n = 1) => {
  const { op } = drawBodies(bodies, width, height, symbols, n), out = [];
  if (op) op.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') out.push([op.x + i, op.y + j, row[i]]); });
  return out;
};

test('a thin ring is one closed line at every size: no pixel missing at its diagonals, no step doubled', () => {
  for (const off of [0, 0.5]) for (let r = 2; r <= 28; r += 0.25) {
    const on = new Set(drawnCells(placed([{ shape: 'hoop', fixed: true, radius: r, at: [32 + off, 32 + off], fill: 'k' }], 64, 64), 64, 64).map(([x, y]) => `${x},${y}`));
    const around = key => { const [x, y] = key.split(',').map(Number), out = []; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if ((i || j) && on.has(`${x + i},${y + j}`)) out.push(`${x + i},${y + j}`); return out; };
    for (const key of on) assert.equal(around(key).length, 2, `radius ${r} at +${off}: pixel ${key} has ${around(key).length} neighbours`);
    const seen = new Set([[...on][0]]), stack = [...seen];
    while (stack.length) for (const next of around(stack.pop())) if (!seen.has(next)) { seen.add(next); stack.push(next); }
    assert.equal(seen.size, on.size, `radius ${r} at +${off}: one piece`);
  }
});

test('drawn at whole pixels, a body moving steadily steps evenly, one rocking on a pixel boundary holds still, and turned pictures sit where the body is', () => {
  const [box] = placed([{ shape: 'box', size: [8, 8], at: [10, 12], fill: 'w', outline: 'k' }]);
  const left = b => Math.min(...drawnCells([b]).map(([x]) => x));
  // A pixel a frame, half a pixel off the grid: held both ways, it was drawn 0, 2, 0, 2 pixels on.
  const xs = [];
  for (let f = 0; f < 30; f++) { box.x = 10.55 + f; xs.push(left(box)); }
  for (let f = 3; f < 30; f++) assert.equal(xs[f] - xs[f - 1], 1, `frame ${f}: ${xs.join(' ')}`);
  const [rocking] = placed([{ shape: 'box', size: [8, 8], at: [10.5, 12], fill: 'w', outline: 'k' }]), still = new Set();
  for (let f = 0; f < 40; f++) { rocking.x = 10.5 + 0.25 * Math.sin(f); still.add(left(rocking)); }
  assert.equal(still.size, 1, 'rocking a quarter pixel about a boundary, it holds still');
  // Turned, at any place, a picture's middle is within half a pixel of the body (it sat a quarter pixel down and right on
  // average, and up to a pixel off).
  for (const angle of [5, 17, 30, 37, 52, 71]) for (let k = 0; k < 10; k++) {
    const [b] = placed([{ shape: 'box', size: [8, 8], at: [20 + k / 10, 15 + k / 7], angle, fill: 'w', outline: 'k' }]), cells = drawnCells([b]);
    const mx = cells.reduce((sum, [x]) => sum + x + 0.5, 0) / cells.length, my = cells.reduce((sum, [, y]) => sum + y + 0.5, 0) / cells.length;
    assert.ok(Math.abs(mx - b.x) <= 0.5 + 1e-9 && Math.abs(my - b.y) <= 0.5 + 1e-9, `at ${angle}°, [${b.x}, ${b.y}] is drawn about [${mx}, ${my}]`);
  }
});

test('a small brick on its side, a right triangle and a resting ball\'s trail are drawn as they are', () => {
  const count = entry => drawnCells(placed([entry])).length;
  // Snapped by its upright sides, a 5 × 4 brick on its side sat on half pixels and was drawn a 26-pixel blob.
  assert.equal(count({ shape: 'box', size: [5, 4], at: [20.3, 15.6], angle: 90, fill: 'w' }), 20);
  assert.equal(count({ shape: 'box', size: [3, 2], at: [20.3, 15.6], angle: 270, fill: 'w' }), 6);
  // A right triangle's centre isn't the middle of its bounds: cut to them, it lost its tips.
  assert.equal(count({ shape: 'polygon', points: [[0, 0], [12, 0], [0, 12]], at: [20, 15], fill: 'w', outline: 'k' }), 78);
  // A ball at rest shows no trail beside it; moving, it leaves one.
  const trail = velocity => run(scene({ frames: 12, gravity: [0, 0], bodies: [{ shape: 'circle', radius: 2, at: [20.3, 15.6], velocity, weightless: true, fill: 'w', trail: { color: 'r', length: 3 } }] }))
    .recipe.frames.map(frame => frame.ops.find(op => op.op === 'grid').rows.join('').split('r').length - 1);
  assert.ok(trail([0, 0]).every(n => n === 0), `resting: ${trail([0, 0]).join(' ')}`);
  assert.ok(trail([1.5, 0]).slice(3).every(n => n > 0), 'moving');
});

test('a box dropped flat lands flat, a tireless box never climbs, and bodies wake when what holds them moves', () => {
  // Bounced one corner at a time, a box dropped flat set itself spinning: most drops with bounce turned, some flipped.
  const flat = run(scene({ frames: 120, walls: ['bottom'], bodies: [0.5, 0.9, 1].map((bounce, k) => ({ name: `b${k}`, shape: 'box', size: [8, 8], at: [8 + 16 * k + 0.3 * k, 8], bounce, fill: 'k' })) })).effect.paths;
  for (const [name, path] of Object.entries(flat)) assert.ok(path.every(([, , a]) => Math.min(a, 360 - a) < 0.5), `${name} stays flat: ${Math.max(...path.map(([, , a]) => Math.min(a, 360 - a)))}°`);
  // Its spin left out of the energy it keeps, a tireless box gained height at every bounce that set it spinning.
  const tireless = run(scene({ frames: 240, walls: ['left', 'right', 'bottom'], bodies: [0, 12, 25, 40].map((angle, k) => ({ name: `t${k}`, shape: 'box', size: [12, 3], at: [6 + 12 * k, 8], angle, bounce: 1, friction: 0.4, tireless: true, fill: 'k' })) }, { width: 64, height: 48 })).effect.paths;
  for (const [name, path] of Object.entries(tireless)) assert.ok(path.every(p => p && p[1] > 6.5), `${name} never rises past where it was dropped: ${Math.min(...path.map(p => (p ? p[1] : -99)))}`);
  // A box asleep on a deck sinking slower than it sleeps follows it down (left asleep, it hung in the air).
  const sinking = run(scene({ frames: 200, bodies: [{ name: 'deck', shape: 'box', size: [20, 2], at: [24, 20], fixed: true, velocity: [0, 0.02], fill: 'w' }, { name: 'box', shape: 'box', size: [4, 4], at: [24, 17], fill: 'k' }] })).effect.paths.box;
  assert.ok(sinking.at(-1)[1] > 17 + 0.02 * 199 - 0.5, `the box rides the deck down to ${sinking.at(-1)[1]}`);
});

test('a plank lying onto a low step rests on it, a bouncy floor beside a dead one keeps its bounce, and few substeps don\'t count rest as hits', () => {
  const ground = { floor: Array.from({ length: 4 }, () => 's'.repeat(64)), step: ['s'.repeat(24), 's'.repeat(24)] };
  // Its centre below the step's top, past the step's end, the plank lost the step's faces and sank into it.
  const plank = run(scene({ frames: 80, obstacles: [{ symbol: 'floor', x: 0, y: 44 }, { symbol: 'step', x: 40, y: 42 }], bodies: [{ name: 'plank', shape: 'box', size: [48, 1], at: [24, 38], fill: 'k' }] }, { width: 64, height: 48, symbols: ground })).effect.paths.plank;
  const [x, y, a] = plank.at(-1), right = x + 24 * cosDeg(a) - 0.5 * sinDeg(a), low = y + 24 * sinDeg(a) + 0.5 * cosDeg(a);
  assert.ok(right > 40 && low <= 42.1, `the plank's end rests on the step: [${right}, ${low}]`);
  // A run of faces took the material of the cell it started on: the bouncy half of the floor didn't bounce.
  const floors = { dead: ['s'.repeat(24)], live: ['s'.repeat(24)] };
  const bounced = run(scene({ frames: 60, obstacles: [{ symbol: 'dead', x: 0, y: 30, bounce: 0 }, { symbol: 'live', x: 24, y: 30, bounce: 1 }], bodies: [{ name: 'ball', shape: 'circle', radius: 2, at: [36, 10], bounce: 0, fill: 'k' }] }, { symbols: floors })).effect.paths.ball;
  const landed = bounced.findIndex(p => p[1] > 26.5);
  assert.ok(landed > 0 && Math.min(...bounced.slice(landed).map(p => p[1])) < 20, 'the ball on the bouncy half bounces high');
  // With one substep, a substep's gravity is past REST_SPEED: a resting box counted a hit every frame and never slept.
  const resting = run(scene({ frames: 60, substeps: 1, gravity: [0, 0.5], walls: ['bottom'], bodies: [{ shape: 'box', size: [4, 4], at: [24, 20], bounce: 0.5, fill: ['k', 'w'] }] })).effect;
  assert.ok(resting.hits <= 3 && resting.rest !== null, `${resting.hits} hits, at rest from ${resting.rest}`);
});

// The cells of colour `key` a frame's grid draws, as [x, y].
const keyCells = (frame, key) => {
  const grid = frame.ops.find(op => op.op === 'grid'), out = [];
  if (grid) grid.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === key) out.push([grid.x + i, grid.y + j]); });
  return out;
};

test('pivots, strikes, fills that step with time, vanishing and smears are read strictly', () => {
  const blade = { name: 'blade', shape: 'box', size: [20, 2], at: [24, 16], fixed: true, spin: 6, fill: 'w' }, ball = { name: 'ball', shape: 'circle', radius: 1, at: [24, 4], fill: ['k', 'w'] };
  refused(scene({ bodies: [{ ...ball, pivot: [1, 0] }] }), 'bodies.effects.e.bodies[0].pivot', /fixed body/);
  refused(scene({ bodies: [{ ...ball, fill: 'k', fillEvery: 4 }] }), 'bodies.effects.e.bodies[0].fillEvery', /list of fills/);
  refused(scene({ bodies: [{ shape: 'hoop', fixed: true, radius: 8, at: [24, 16], fill: 'w', smear: { colors: ['r'] } }] }), 'bodies.effects.e.bodies[0].smear', /hoop/);
  refused(scene({ bodies: [blade, ball], strikes: [{ by: 'nobody', power: 'split' }] }), 'bodies.effects.e.strikes[0].by', /no body is named "nobody"/);
  refused(scene({ bodies: [blade, ball], events: [{ frame: 3, body: 'blade', power: 'split' }] }), 'bodies.effects.e.events[0].body', /can only vanish/);
  refused(scene({ bodies: [blade, ball], most: 5000 }), 'bodies.effects.e.most', /from 2 to 4096/);
  assert.equal(compileBodies(scene({ bodies: [blade, ball], events: [{ frame: 3, body: 'blade', power: 'vanish' }] })).recipe.frames.length, 40);
});

test('a fixed body turns about its pivot, and a smear sweeps behind it', () => {
  // A 20-pixel blade turning 6 degrees a frame about its left end at [32, 24]: its far end is 20 pixels out at its angle.
  const { recipe } = run(scene({ frames: 30, gravity: [0, 0], bodies: [{ name: 'blade', shape: 'box', size: [20, 2], pivot: [-10, 0], at: [32, 24], fixed: true, spin: 6, fill: 'w', smear: { colors: ['r', 's'], frames: 2 } }] }, { width: 64, height: 48 }));
  recipe.frames.forEach((frame, f) => {
    const cells = keyCells(frame, 'w'), far = cells.reduce((best, [x, y]) => (Math.hypot(x + 0.5 - 32, y + 0.5 - 24) > Math.hypot(best[0] + 0.5 - 32, best[1] + 0.5 - 24) ? [x, y] : best), cells[0]);
    assert.ok(cells.some(([x, y]) => Math.abs(x + 0.5 - 32) <= 1.5 && Math.abs(y + 0.5 - 24) <= 1.5), `${frame.name}: the blade stays on its pivot`);
    const a = 6 * f * Math.PI / 180, reach = Math.hypot(far[0] + 0.5 - 32, far[1] + 0.5 - 24);
    assert.ok(Math.abs(reach - 20) < 1.6 && Math.hypot(far[0] + 0.5 - 32 - 20 * Math.cos(a), far[1] + 0.5 - 24 - 20 * Math.sin(a)) < 2.5, `${frame.name}: its far end ${far} at ${6 * f}°`);
    // The smear needs a frame behind it, and then lies behind the blade: turned back from it, not ahead.
    const smear = [...keyCells(frame, 'r'), ...keyCells(frame, 's')];
    if (f === 0) assert.equal(smear.length, 0);
    else {
      assert.ok(smear.length > 10, `${frame.name}: ${smear.length} smear pixels`);
      // (Within a few pixels of the pivot a pixel spans many degrees; past them, the angle tells.)
      for (const [x, y] of smear.filter(([x, y]) => Math.hypot(x + 0.5 - 32, y + 0.5 - 24) > 6)) {
        const behind = ((6 * f - Math.atan2(y + 0.5 - 24, x + 0.5 - 32) * 180 / Math.PI) % 360 + 540) % 360 - 180;
        assert.ok(behind > -8 && behind < 6 * Math.min(f, 2) + 12, `${frame.name}: a smear pixel ${behind.toFixed(1)}° behind the blade`);
      }
    }
  });
});

test('a strike splits what its body pushes, up to most, and copies take the fill of their frame', () => {
  // A blade turning about the centre of a ring with one ball in it: each ball it touches splits in three, at most once
  // every 6 frames, up to 120 bodies; the copies take the colour of the frame they are made in, a step every 20 frames.
  const ring = { name: 'ring', shape: 'hoop', fixed: true, radius: 15, thickness: 2, at: [24, 16], fill: 'w' };
  const blade = { name: 'blade', shape: 'box', size: [14, 2], pivot: [-6, 0], at: [24, 16], fixed: true, spin: 10, fill: 'w' };
  const ball = { name: 'seed', shape: 'circle', radius: 0.5, at: [24, 6], fill: ['k', 'r', 's'], fillEvery: 20 };
  const source = most => scene({ frames: 120, gravity: [0, 0.2], bodies: [ring, blade, ball], most, strikes: [{ by: 'blade', power: 'split', count: 3, spread: 60, rest: 6 }] });
  const { recipe, effect } = run(source(120));
  assert.ok(effect.copies === 117 && effect.strikes >= 39, `${effect.copies} copies from ${effect.strikes} strikes`);
  assert.equal(effect.escaped.length, 0, 'the ring holds them');
  assert.equal(effect.paths.seed.at(-1) !== null, true);
  // Splits stop at most bodies (256 without it).
  assert.equal(run(source(40)).effect.copies, 37);
  assert.ok(run(source(undefined)).effect.copies <= 253);
  const colours = new Set(recipe.frames.at(-1).ops.find(op => op.op === 'grid').rows.join('').replace(/[.w]/g, ''));
  assert.ok(colours.size >= 2, `copies in more than one colour: ${[...colours].join('')}`);
  // A ring that vanishes lets what it held fall out: everything has left the canvas a few seconds later.
  const burst = run(scene({ frames: 120, gravity: [0, 0.2], bodies: [ring, { ...ball, fill: 'k', fillEvery: undefined }], events: [{ frame: 40, body: 'ring', power: 'vanish' }] })).effect;
  assert.ok(burst.paths.seed.slice(0, 40).every(p => p !== null) && burst.escaped.length === 1 && burst.escaped[0].frame > 40, `escaped ${JSON.stringify(burst.escaped)}`);
});

test('the work estimate charges the crowd a strike can make and a smear\'s sweep', () => {
  // 4,096 balls of radius 0.5 over 256 frames would run for minutes; the same source left at the default 256 runs.
  const crowd = most => scene({ frames: 256, bodies: [{ name: 'blade', shape: 'box', size: [40, 2], at: [24, 16], fixed: true, spin: 6, fill: 'w' }, { shape: 'circle', radius: 0.5, at: [24, 4], fill: 'k' }],
    walls: ['left', 'right', 'top', 'bottom'], ...(most && { most }), strikes: [{ by: 'blade', power: 'split', count: 8 }] }, { width: 48, height: 32 });
  refused(crowd(4096), 'bodies.effects.e', /need about \d+ million updates, more than 400 million/);
  assert.ok(run(crowd()).effect.frames === 256);
});
