// What the craft notes and a tile set's compile reply hand an agent to start from has to work as written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileAutotile } from '../src/authoring.js';
import { tilemapEntry, tilemapOf } from '../src/autotile.js';
import { renderProject } from '../src/core.js';
import { compileFluid } from '../src/fluid.js';
import { compileEffects } from '../src/fx.js';
import { compileBodies } from '../src/bodies.js';
import { patchRecipe } from '../src/patch.js';
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
  // What a reply carries is a tilemap to give rows: the legend by character, and for a set with slopes the whole
  // legend its maps use with a map of every slope, which a scene draws as written.
  assert.deepEqual(tilemapOf(meadow), { tile: [16, 16], legend: { '#': tilemapEntry(meadow).legend } });
  const ground = compileAutotile(await example('ground.autotile.json')), pasted = tilemapOf(ground.recipe, ground.metadata);
  assert.deepEqual([pasted.tile, Object.keys(pasted.legend).join(''), pasted.rows], [[16, 16], '#/\\uUDd', ground.metadata.slopes.map]);
  const view = prepareScene({ format: 'pixelforge-scene', version: 1, name: 'hills', width: 256, height: 80, assets: { ground: ground.recipe }, instances: [{ asset: 'ground', at: [0, 0], tilemap: { ...pasted, outside: 'match' } }] });
  assert.equal(view.instances[0].tilemap.cells.length > 60, true);
  // The whole sample map, 24 cells of 16 pixels, is one scene; a view past the limits says a map may be larger than it.
  const whole = renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'hills', width: 384, height: 80, assets: { ground: ground.recipe }, instances: [{ asset: 'ground', at: [0, 0], tilemap: { ...pasted, outside: 'match' } }] }), { lit: false });
  assert.deepEqual([whole.width, whole.height, whole.placements[0].tiles > 60], [384, 80, true]);
  const empty = { format: 'pixelforge-scene', version: 1, name: 'hills', assets: {}, instances: [] };
  assert.throws(() => prepareScene({ ...empty, width: 1025, height: 80 }), /scene\.width: expected an integer from 1 to 1024: a scene is one view; a tilemap may be larger/);
  assert.throws(() => prepareScene({ ...empty, width: 1024, height: 257 }), /scene: 1024×257 is 263,168 pixels, and a scene holds at most 262,144/);
  assert.equal(prepareScene({ ...empty, width: 1024, height: 256 }).width, 1024);
  assert.equal(tilemapOf(await example('coin.json')), null);
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

test('a symbol or grid with a miscounted row names the row and both widths, in every format', async () => {
  const rows = ['kkk', 'kk', 'kkk', 'k'], said = /\[1\]: all rows must be 3 characters wide, as row 0 is: row 1 has 2, row 3 has 1$/;
  const torch = await example('torch.fluid.json'), sparks = await example('effects.fx.json'), drop = await example('ring-escape.bodies.json');
  assert.throws(() => compileFluid({ ...torch, symbols: { ...torch.symbols, bad: rows } }), { path: 'fluid.symbols.bad[1]', message: said });
  assert.throws(() => compileEffects({ ...sparks, symbols: { ...sparks.symbols, bad: rows } }), { path: 'fx.symbols.bad[1]', message: said });
  assert.throws(() => compileBodies({ ...drop, symbols: { ...drop.symbols, bad: rows } }), { path: 'bodies.symbols.bad[1]', message: said });
  const coin = await example('coin.json');
  assert.throws(() => patchRecipe(coin, [{ grid: `frames[${coin.frames[0].name}]`, value: { x: 0, y: 0, rows } }]), { message: said });
});

test('a template draws a level of its own rows in place of the test map, as a scene draws the same map', async () => {
  const ground = await example('ground.autotile.json'), meadow = await example('meadow.autotile.json');
  const rows = ['............................', '..../##\\........uU####Dd....', '.../####\\.....uU########Dd..', '################...#########', '################...#########'];
  const made = compileAutotile({ ...ground, preview: { background: '#8fd3ff', rows } }), level = made.preview;
  assert.deepEqual([level.width, level.height, level.frames.length, level.frames[0].ops.at(-1).rows], [28 * 16, 5 * 16, 1, rows]);
  // The set itself is what it is without the rows: they change the picture, never the tiles.
  assert.deepEqual(made.recipe, compileAutotile(ground).recipe);
  // 448 pixels wide: one scene, drawn from the reply's tilemap with the same rows, shows the same level.
  const drawn = renderProject(level).frames[0].data;
  const scene = renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'level', width: 448, height: 80, background: '#8fd3ff', assets: { ground: made.recipe },
    instances: [{ asset: 'ground', at: [0, 0], tilemap: { ...tilemapOf(made.recipe, made.metadata), rows, outside: 'match' } }] }), { lit: false });
  assert.deepEqual(scene.data, drawn);
  // A set without slopes takes # and . alone, and every mistake is named where it is.
  assert.equal(compileAutotile({ ...meadow, preview: { rows: ['.##.', '####'] } }).preview.width, 64);
  assert.throws(() => compileAutotile({ ...meadow, preview: { rows: ['.#/.', '####'] } }), /autotile\.preview\.rows\[0\]: character "\/" at column 2 is not one this set draws: # \. \(a set with slopes has a character for each\)/);
  assert.throws(() => compileAutotile({ ...ground, preview: { rows: ['.#x.'] } }), /character "x" at column 2 is not one this set draws: # \. \/ \\ u U D d$/);
  assert.throws(() => compileAutotile({ ...ground, preview: { rows: ['####', '###'] } }), /autotile\.preview\.rows\[1\]: all rows must be 4 characters wide, as row 0 is: row 1 has 3/);
  assert.throws(() => compileAutotile({ ...ground, preview: { rows: ['#'.repeat(257)] } }), /257 by 1 tiles of 16 pixels is more than one picture holds/);
  assert.throws(() => compileAutotile({ ...ground, preview: { rows: [] } }), /autotile\.preview\.rows: expected 1–256 equal-width text rows of # \. \//);
});
