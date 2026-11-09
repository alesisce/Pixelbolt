import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject } from '../src/core.js';
import { findPreset, loadPreset, compilePreset } from '../src/presets.js';
import { readSize, resizeRecipe, resizeWarning } from '../src/resize.js';
import { startMCP } from '../src/mcp.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const preset = async name => compilePreset((await loadPreset(await findPreset(name))).source).recipe;

// Pixels of the resized recipe that differ from the same window of the original. Outside the old canvas a recipe with
// a background shows it, and any other shows nothing.
function differing(recipe, resized, [ox, oy]) {
  const before = renderProject(recipe), after = renderProject(resized);
  let count = 0;
  before.frames.forEach((frame, index) => {
    const data = after.frames[index].data;
    for (let y = 0; y < after.height; y++) for (let x = 0; x < after.width; x++) {
      const sx = x + ox, sy = y + oy, inside = sx >= 0 && sy >= 0 && sx < before.width && sy < before.height;
      if (!inside && recipe.background) continue;
      for (let c = 0; c < 4; c++) if ((inside ? frame.data[(sy * before.width + sx) * 4 + c] : 0) !== data[(y * after.width + x) * 4 + c]) { count++; break; }
    }
  });
  return count;
}

const dot = (x, y) => ({ op: 'pixel', x, y, color: 'a' });
const plain = (width, height, ops, more = {}) => ({ version: 1, name: 'plain', width, height, palette: { a: '#ff0000' }, frames: [{ name: 'one', ops, ...more }] });

test('a size is two whole sides within the canvas limit', () => {
  assert.deepEqual(readSize('32x48'), [32, 48]);
  assert.deepEqual(readSize(' 16×16 '), [16, 16]);
  assert.deepEqual(readSize([8, 9]), [8, 9]);
  for (const bad of ['32', '0x8', '32x257', '32 by 32', [32], [1.5, 2], 32, null]) assert.throws(() => readSize(bad), /expected a canvas size such as "32x32"/);
});

test('a smaller canvas is the window with the most drawing, and a larger one centres or keeps a touched edge', () => {
  // Most of the drawing is low and to the right.
  const low = plain(8, 8, [dot(1, 1), { op: 'rect', x: 4, y: 5, w: 3, h: 3, color: 'a' }]);
  const cut = resizeRecipe(low, '4x4');
  assert.deepEqual(cut.resized, { from: [8, 8], offset: [3, 4], cut: 0.1 });
  assert.deepEqual([cut.recipe.width, cut.recipe.height], [4, 4]);
  assert.match(resizeWarning(cut.resized, [4, 4]), /leaves out 10% of what the 8×8 drawing draws/);
  // Nothing touches an edge: margins all round. A floor stays the floor, a ceiling the ceiling, a wall a wall.
  const middle = plain(8, 8, [dot(3, 3)]);
  assert.deepEqual(resizeRecipe(middle, '12x14').resized, { from: [8, 8], offset: [-2, -3], cut: 0 });
  assert.equal(resizeWarning(resizeRecipe(middle, '12x14').resized, [12, 14]), null);
  assert.deepEqual(resizeRecipe(plain(8, 8, [dot(3, 7)]), '12x14').resized.offset, [-2, -6]);
  assert.deepEqual(resizeRecipe(plain(8, 8, [dot(0, 0)]), '12x14').resized.offset, [0, 0]);
  assert.deepEqual(resizeRecipe(plain(8, 8, [dot(7, 3)]), '12x14').resized.offset, [-4, -3]);
  // One axis may shrink while the other grows, and the same size changes nothing.
  assert.deepEqual(resizeRecipe(low, '4x10').resized.offset, [3, -2]);
  assert.deepEqual(resizeRecipe(low, '8x8').recipe.frames[0].ops, low.frames[0].ops.map(op => ({ ...op, x: op.x, y: op.y })));
});

test('everything a frame places moves with the canvas', () => {
  const recipe = {
    version: 1, name: 'all', width: 12, height: 10, palette: { a: '#ff0000', b: '#00ff00' }, anchor: [6, 9], symbols: { s: ['ab', 'ba'] },
    frames: [
      { name: 'one', anchor: [5, 9], points: { hand: [9, 4] }, ops: [{ op: 'line', x: 1, y: 8, x2: 10, y2: 8, color: 'a' }, { op: 'stamp', symbol: 's', x: 9, y: 3, scale: 2 }, { op: 'text', text: 'A', x: 2, y: 1, color: 'b' }],
        layers: [{ name: 'back', ops: [{ op: 'ellipse', x: 2, y: 2, w: 5, h: 5, color: 'b' }, { op: 'grid', rows: ['a.a'] }] }], pixels: [{ x: 0, y: 0, color: 'b' }, { x: 6, y: 8, color: 'b' }] },
      { name: 'two', from: 'one', ops: [{ op: 'clear', x: 0, y: 0, w: 2, h: 2 }, { op: 'copy', symbol: 's', x: 4, y: 4 }] }
    ]
  };
  for (const size of ['9x7', '15x13', '8x12', '16x6']) {
    const { recipe: moved, resized } = resizeRecipe(recipe, size), [ox, oy] = resized.offset;
    assert.equal(differing(recipe, moved, resized.offset), 0, size);
    assert.deepEqual(moved.anchor, [6 - ox, 9 - oy]);
    assert.deepEqual(moved.frames[0].points.hand, [9 - ox, 4 - oy]);
  }
  // The stamp hangs over the right edge, where the old canvas clipped it: a margin there stays empty.
  assert.ok(renderProject(recipe).clipping);
  assert.ok(resizeRecipe(recipe, '15x13').recipe.frames.every(frame => frame.ops.some(op => op.op === 'clear' && op.h === 13)));
});

test('a recipe whose operations read the whole canvas says so instead of drawing something else', () => {
  const refuse = (recipe, pattern) => assert.throws(() => resizeRecipe(recipe, '6x6'), pattern);
  refuse(plain(8, 8, [dot(1, 1), { op: 'outline', color: 'a' }]), /size: frames\[0\]\.ops\[1\] is "outline", which reads the whole canvas.*change the size in its source/);
  refuse(plain(8, 8, [{ op: 'fill', x: 1, y: 1, color: 'a' }]), /"fill"/);
  refuse({ ...plain(8, 8, [dot(1, 1)]), frames: [{ name: 'one', ops: [dot(1, 1)] }, { name: 'two', ops: [{ op: 'copy', from: 'one', x: 2, y: 2 }] }] }, /frames\[1\]\.ops\[0\] is a copy from another frame/);
  refuse(plain(8, 8, [dot(1, 1)], { translate: [1, 0] }), /frames.0..translate is tied to the canvas size/);
  refuse(plain(8, 8, [dot(1, 1)], { flipX: true }), /frames\[0\]\.flipX is tied to the canvas size/);
  assert.throws(() => resizeRecipe({ ...plain(8, 8, [dot(1, 1)]), frames: Array.from({ length: 70 }, (_, index) => ({ name: `f${index}`, ops: [dot(1, 1)] })) }, '256x256'), /size: 70 frames of 256×256 pixels exceed the 4,194,304-pixel limit/);
});

test('presets of every kind move to another canvas pixel for pixel', async () => {
  // A gas on a floor, a rig with anchors, points and corrections, particles and shapes, a wave, and a plain recipe.
  for (const name of ['campfire', 'swing', 'swing-trail', 'interference', 'coin']) {
    const recipe = await preset(name);
    for (const size of [[32, 32], [recipe.width + 7, recipe.height + 5], [recipe.width - 9, recipe.height + 4]]) {
      const { recipe: moved, resized } = resizeRecipe(recipe, size);
      assert.equal(differing(recipe, moved, resized.offset), 0, `${name} at ${size.join('x')}`);
    }
  }
  // The campfire asked for at 32×32 keeps its logs and the floor, and loses only wisps of smoke off the top.
  const { resized } = resizeRecipe(await preset('campfire'), '32x32');
  assert.deepEqual([resized.from, resized.offset], [[32, 48], [0, 16]]);
  assert.ok(resized.cut > 0 && resized.cut < 0.03, `${resized.cut}`);
  // The shrine is drawn with a dither, which another canvas would draw differently.
  assert.throws(() => resizeRecipe(compilePreset(JSON.parse(JSON.stringify({ ...plain(8, 8, [{ op: 'dither', color: 'a' }]) }))).recipe, '4x4'), /"dither"/);
});

test('compile --size and pixel_compile size put a preset on the canvas asked for', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-resize-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), ...args], { encoding: 'utf8' });
  const out = path.join(dir, 'fire.json'), meta = path.join(dir, 'fire.meta.json');
  const made = cli('compile', '--preset', 'campfire', '--size', '32x32', '--out', out, '--metadata', meta), reply = JSON.parse(made.stdout);
  assert.deepEqual([reply.ok, reply.width, reply.height, reply.resized.from, reply.resized.offset], [true, 32, 32, [32, 48], [0, 16]]);
  assert.match(reply.warnings.at(-1), /^The 32×32 canvas leaves out /);
  const recipe = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual(recipe, resizeRecipe(await preset('campfire'), '32x32').recipe);
  // The metadata keeps the source's coordinates and says where the new canvas starts in them.
  assert.deepEqual(JSON.parse(await readFile(meta, 'utf8')).resized, reply.resized);
  for (const [args, pattern] of [
    [['--preset', 'campfire', '--size', 'small'], /--size: expected a canvas size such as \\"32x32\\"/],
    [['--preset', 'shrine', '--size', '32x32'], /--size: .* is \\"dither\\", which reads the whole canvas/],
    [['--preset', 'swing', '--size', '32x32', '--expand'], /--size goes with a compile that writes a recipe/]
  ]) {
    const refused = cli('compile', ...args, '--out', path.join(dir, 'refused.json'));
    assert.equal(refused.status, 1);
    assert.match(refused.stdout + refused.stderr, pattern);
  }

  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', id = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, root: dir, directory: dir }); t.after(() => input.end());
  const call = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'resize-test', version: '1' } });
  const compile = async args => (await call('tools/call', { name: 'pixel_compile', arguments: args })).result;
  const sized = JSON.parse((await compile({ preset: 'campfire', size: '32x32', metadata: true })).content[0].text);
  assert.deepEqual([sized.ok, sized.width, sized.height, sized.resized, sized.metadata.resized], [true, 32, 32, reply.resized, reply.resized]);
  assert.ok(sized.warnings.some(warning => /^The 32×32 canvas leaves out /.test(warning)));
  // Without size a preset compiles as it always has.
  const whole = JSON.parse((await compile({ preset: 'campfire' })).content[0].text);
  assert.deepEqual([whole.width, whole.height, whole.resized], [32, 48, undefined]);
  const refused = await compile({ preset: 'shrine', size: '32x32' });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /which reads the whole canvas/);
  assert.match((await compile({ preset: 'ring-escape', size: '32x32', sequence: { fps: 30 } })).content[0].text, /size goes with a compile that returns a recipe/);
});
