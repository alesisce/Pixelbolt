// What the craft notes and a tile set's compile reply hand an agent to start from has to work as written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileAutotile } from '../src/authoring.js';
import { tilemapEntry } from '../src/autotile.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { createBundle, describeAnimations } from '../src/export.js';
import { findPreset, loadPreset, compilePreset } from '../src/presets.js';

const example = async name => JSON.parse(await readFile(new URL(`../examples/${name}`, import.meta.url), 'utf8'));

test('a compiled tile set says how a map names its tiles, and a set of several materials says nothing', async () => {
  const meadow = compileAutotile(await example('meadow.autotile.json')).recipe;
  assert.deepEqual(tilemapEntry(meadow), { tile: [16, 16], legend: { frames: ['meadow-{mask}-a', 'meadow-{mask}-b', 'meadow-{mask}-c', 'meadow-{mask}-flowers'], weights: [4, 4, 4, 1], autotile: 'blob' } });
  // Every name the entry stands for is a frame of the set.
  const names = new Set(meadow.frames.map(frame => frame.name));
  for (const mask of [0, 28, 255]) for (const pattern of tilemapEntry(meadow).legend.frames) assert.ok(names.has(pattern.replace('{mask}', mask)), pattern);
  // A set without variants names one frame; a layered set, whose tiles belong to several terrains, is written by hand.
  const plain = { ...await example('meadow.autotile.json'), frame: 'meadow-{mask}' }; delete plain.variants;
  assert.deepEqual(tilemapEntry(compileAutotile(plain).recipe).legend, { frame: 'meadow-{mask}', autotile: 'blob' });
  assert.equal(tilemapEntry(compileAutotile(await example('shore.autotile.json')).recipe), null);
  assert.equal(tilemapEntry(await example('coin.json')), null);
});

test('the two-layer tile set the craft notes give to start from compiles: both plain tiles, every meeting, a Godot TileSet', async () => {
  const notes = await readFile(new URL('../docs/agent-craft.md', import.meta.url), 'utf8');
  const source = JSON.parse(/To start from: `(\{"format": "pixelforge-autotile".*?\})`\. An upper layer/s.exec(notes)[1]);
  const { recipe, warnings = [], preview } = compileAutotile(source);
  assert.deepEqual([recipe.frames.length, recipe.width, warnings, Boolean(preview)], [16, 16, [], true]);
  const bundle = await createBundle(recipe);
  assert.ok(bundle.files.has('snow.tileset.tres') && bundle.files.has('snow.tsx'));
  assert.match(bundle.files.get('snow.tileset.tres').toString(), /terrain_set_0\/terrain_0\/name = "rock"[\s\S]*terrain_set_0\/terrain_1\/name = "snow"/);
  // A still tile set has no animation to describe in a reply.
  assert.deepEqual(describeAnimations(bundle.project, recipe), {});
});

test('the scene the craft notes give to start from draws: a floor from the tile set, a fire, a lit character', async () => {
  const notes = await readFile(new URL('../docs/agent-craft.md', import.meta.url), 'utf8');
  const scene = JSON.parse(/To start from: `(\{"format": "pixelforge-scene".*?\})`\. Assets are/s.exec(notes)[1]);
  assert.deepEqual(Object.keys(scene.assets), ['grass', 'fire', 'spirit']);
  // The notes name files an agent has compiled; here they are the recipes themselves.
  const meadow = compileAutotile(await example('meadow.autotile.json')).recipe, entry = tilemapEntry(meadow).legend;
  assert.deepEqual(scene.instances[0].tilemap.legend.g.frames.every(name => entry.frames.includes(name)), true);
  scene.assets = { grass: meadow, fire: compilePreset((await loadPreset(await findPreset('campfire'))).source).recipe, spirit: { recipe: await example('forest-spirit.json'), normal: await example('forest-spirit-normal.json') } };
  const frame = renderScene(prepareScene(scene), { time: 0 });
  assert.deepEqual([frame.width, frame.height, frame.placements.length, frame.warnings], [96, 64, 3, []]);
  // scope "all" darkens the unlit grass at night, and lit: false leaves the fire its own colours.
  const unlit = renderScene(prepareScene({ ...scene, lighting: undefined }), { time: 0 });
  const sum = (image, x0, y0, w, h) => { let total = 0; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const at = (y * image.width + x) * 4; total += image.data[at] + image.data[at + 1] + image.data[at + 2]; } return total; };
  assert.ok(sum(frame, 0, 34, 16, 16) < sum(unlit, 0, 34, 16, 16) * 0.8, 'the far grass is darker under the night lighting');
  assert.equal(sum(frame, 62, 20, 16, 12), sum(unlit, 62, 20, 16, 12), 'the fire keeps its colours');
});
