import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { presetEntries, loadPreset, briefListing } from '../src/presets.js';
import { EFFECT_PRESETS } from '../studio/effects-controls.js';
import { FLUID_PRESETS } from '../studio/fluid-controls.js';

const root = fileURLToPath(new URL('../', import.meta.url)), cli = path.join(root, 'bin', 'pixelbolt.js'), examples = path.join(root, 'examples');
const runScript = (options, script, ...args) => promisify(execFile)(process.execPath, [...options, script, ...args], { maxBuffer: 16 * 1048576 });
const run = (...args) => runScript([], cli, ...args);

// Small presets, one of each kind, so a command here takes a moment rather than the minute that measuring every preset
// takes on a slow runner: a gas, a wave, a pose rig, a plain recipe, and an fx preset that names another file (the
// swing trail draws the swing rig) if there is one. A renamed preset leaves the first of its kind in its place.
const SMALL = { fluid: 'smoke-puff', wave: 'interference', poses: 'swing', recipe: 'coin', fx: 'swing-trail' };
async function smallPresets(entries) {
  const of = kind => entries.filter(entry => entry.kind === kind), naming = [];
  for (const entry of of('fx')) if (/"recipe":\s*"/.test(await readFile(path.join(examples, entry.file), 'utf8'))) naming.push(entry);
  const pick = (list, kind) => list.find(entry => entry.name === SMALL[kind]) ?? list[0];
  return [...['fluid', 'wave', 'poses', 'recipe'].map(kind => pick(of(kind), kind)), pick(naming.length ? naming : of('fx'), 'fx')].filter(Boolean);
}

// More small presets for the listing, whose descriptions take its other branches: an Effects lab title on a mix of
// loops and one-shots, a rig's motion templates, one holding a prop, and more than 12 animations.
const DESCRIBED = ['effects', 'slime-idle', 'hero-sword', 'holy-spells'];

// A clock that reads an hour later at every reading, so a listing with any time budget stops measuring at once.
const HOUR_PER_READING = `data:text/javascript,${encodeURIComponent('const now = Date.now; let readings = 0; Date.now = () => now() + 3600000 * readings++;')}`;

test('pixelbolt presets lists every preset and measures each however long that takes, and prints one preset\'s source', async t => {
  // The listing runs in a copy of the package that holds the small presets, on the clock above. presets.test.js compiles
  // and renders every shipped preset, checks that each draws something, and checks the facts its MCP listing gives each.
  const copy = await mkdtemp(path.join(path.resolve(os.tmpdir()), 'pixelbolt-presets-cli-'));
  t.after(() => rm(copy, { recursive: true, force: true }));
  await Promise.all(['bin', 'src', 'studio', 'package.json'].map(item => cp(path.join(root, item), path.join(copy, item), { recursive: true })));
  const entries = await presetEntries(), picked = [...await smallPresets(entries), ...entries.filter(entry => DESCRIBED.includes(entry.name))];
  assert.ok(picked.length > 0);
  for (const entry of picked) for (const file of [`examples/${entry.file}`, ...(await loadPreset(entry)).inlined]) {
    await mkdir(path.dirname(path.join(copy, file)), { recursive: true });
    await cp(path.join(root, file), path.join(copy, file));
  }
  const listing = JSON.parse((await runScript(['--import', HOUR_PER_READING], path.join(copy, 'bin', 'pixelbolt.js'), 'presets', '--full')).stdout), { guide, presets } = listing;
  const copied = await (await import(pathToFileURL(path.join(copy, 'src', 'presets.js')).href)).presetEntries();
  // By default a line each (help presets is the same listing): every fact is measured in a shell, so it is exactly
  // the full listing told briefly.
  assert.deepEqual(JSON.parse((await runScript(['--import', HOUR_PER_READING], path.join(copy, 'bin', 'pixelbolt.js'), 'help', 'presets')).stdout), briefListing(listing));
  for (const [args, message] of [[['presets', 'smoke-puff', '--full'], /--full goes with the listing/], [['help', 'presets', 'smoke-puff'], /help presets lists every preset/]]) {
    const refused = await runScript([], path.join(copy, 'bin', 'pixelbolt.js'), ...args).then(() => null, error => error);
    assert.ok(refused, args.join(' ')); assert.match(refused.stdout + refused.stderr, message);
  }
  // --find measures only the presets whose names match, and prints their lines.
  const find = async words => JSON.parse((await runScript(['--import', HOUR_PER_READING], path.join(copy, 'bin', 'pixelbolt.js'), 'presets', '--find', words)).stdout);
  const first = picked[0].name;
  assert.equal((await find(first)).presets[first], briefListing(listing).presets[first]);
  assert.match((await find('no-such-thing-zz')).guide, /^No preset matches/);
  for (const args of [['presets', '--find', 'x', '--full']]) {
    const refused = await runScript([], path.join(copy, 'bin', 'pixelbolt.js'), ...args).then(() => null, error => error);
    assert.ok(refused, args.join(' ')); assert.match(refused.stdout + refused.stderr, /--find goes on its own/);
  }
  assert.match(guide, /pixel_compile \{"preset": "<name>"\}/);
  assert.deepEqual(presets.map(entry => [entry.name, entry.file]), copied.map(entry => [entry.name, `examples/${entry.file}`]));
  for (const entry of picked) assert.ok(presets.some(listed => listed.file === `examples/${entry.file}`), entry.name);
  // No time budget in a shell: every preset is measured.
  assert.ok(presets.every(entry => entry.size && entry.frames && entry.plays && entry.colors && entry.for && !entry.error && !entry.unmeasured));
  // The listing says what a lab preset is for with its title and note in the lab's list, so every lab preset has both.
  for (const entry of [...FLUID_PRESETS, ...EFFECT_PRESETS]) assert.ok(typeof entry.title === 'string' && entry.title && typeof entry.note === 'string' && entry.note, entry.file);
  const smoke = entries.find(entry => entry.file === 'smoke-puff.fluid.json');
  if (smoke) {
    const one = JSON.parse((await run('presets', smoke.name)).stdout);
    assert.deepEqual(one.source, JSON.parse(await readFile(path.join(examples, smoke.file), 'utf8')));
    assert.match(one.next, /pixelbolt compile --preset smoke-puff/);
  }
});

test('gif --preset makes the GIF that compile then gif make, with a sheet of its frames, and writes nothing when refused', async t => {
  const dir = await mkdtemp(path.join(path.resolve(os.tmpdir()), 'pixelbolt-presets-gif-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const at = name => path.join(dir, name);
  // The two-step way, at the preset's own size and on another canvas.
  await run('compile', '--preset', 'campfire', '--out', at('whole.json'));
  await run('gif', at('whole.json'), '--scale', '2', '--out', at('whole.two.gif'));
  await run('compile', '--preset', 'campfire', '--size', '32x32', '--out', at('cut.json'));
  await run('gif', at('cut.json'), '--out', at('cut.two.gif'));
  const whole = JSON.parse((await run('gif', '--preset', 'campfire', '--scale', '2', '--out', at('whole.gif'))).stdout);
  assert.deepEqual([whole.name, whole.width, whole.height, whole.resized, whole.sheet], ['campfire', 64, 96, undefined, undefined]);
  assert.deepEqual(await readFile(at('whole.gif')), await readFile(at('whole.two.gif')));
  const cut = JSON.parse((await run('gif', '--preset', 'campfire', '--size', '32x32', '--out', at('cut.gif'), '--sheet', at('cut.png'))).stdout);
  assert.deepEqual([cut.width, cut.height, cut.resized, cut.sheet], [32, 32, undefined, at('cut.png')]);
  assert.match(cut.warnings.join(' '), /The 32×32 canvas leaves out .* of what the 32×48 drawing draws/);
  assert.deepEqual(await readFile(at('cut.gif')), await readFile(at('cut.two.gif')));
  assert.equal((await readFile(at('cut.png'))).subarray(1, 4).toString(), 'PNG');
  // The cut is said once: the clipping it causes is not listed as a second problem.
  assert.equal(cut.warnings.length, 1);
  assert.match(cut.warnings[0], /leaves out/);
  // A preset with several animations names them; --sheet and --size work with a recipe file too.
  const hero = JSON.parse((await run('gif', '--preset', 'hero', '--animation', 'walk', '--out', at('walk.gif'))).stdout);
  assert.ok(hero.animation === 'walk' && hero.animations.includes('idle'));
  const filed = JSON.parse((await run('gif', at('whole.json'), '--size', '32x32', '--out', at('filed.gif'), '--sheet', at('filed.png'))).stdout);
  assert.deepEqual(await readFile(at('filed.gif')), await readFile(at('cut.gif')));
  assert.equal(filed.sheet, at('filed.png'));
  for (const [args, message] of [
    [[at('whole.json'), '--preset', 'campfire', '--out', at('no.gif')], /gif takes a recipe file or --preset <name>, not both/],
    [['--preset', 'campfire', '--out', at('no.gif'), '--sheet', at('no.jpg')], /--sheet must name a new .png file/],
    [['--preset', 'campfire', '--out', at('no.gif'), '--sheet', at('cut.png')], /Output already exists/],
    [['--preset', 'shrine', '--size', '32x32', '--out', at('no.gif')], /reads the whole canvas/],
    [['--preset', 'no-such-preset', '--out', at('no.gif')], /no-such-preset/]
  ]) {
    const refused = await run('gif', ...args).then(() => null, error => error);
    assert.match(refused.stdout + refused.stderr, message);
    await assert.rejects(readFile(at('no.gif')), { code: 'ENOENT' });
  }
});

test('compile --preset writes the bytes compiling the preset\'s file writes, and refuses metadata a recipe lacks', async t => {
  const dir = await mkdtemp(path.join(path.resolve(os.tmpdir()), 'pixelbolt-presets-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entries = await presetEntries();
  // compile --preset reads the preset's own file: one preset of each kind shows it, an fx one that names another file
  // if there is one.
  const picked = await smallPresets(entries);
  await Promise.all(picked.map(async entry => {
    const out = path.join(dir, `${entry.name}.json`), file = path.join(dir, `${entry.name}.file.json`);
    await run('compile', '--preset', entry.name, '--out', out);
    if (entry.kind === 'recipe') assert.equal(await readFile(out, 'utf8'), await readFile(path.join(examples, entry.file), 'utf8'), entry.name);
    else {
      await run('compile', path.join(examples, entry.file), '--out', file);
      assert.equal(await readFile(out, 'utf8'), await readFile(file, 'utf8'), entry.name);
    }
  }));
  const recipe = entries.find(entry => entry.kind === 'recipe');
  if (recipe) {
    const refused = await run('compile', '--preset', recipe.name, '--out', path.join(dir, 'x.json'), '--metadata', path.join(dir, 'x.meta.json')).then(() => null, error => error);
    assert.ok(refused, 'compile --metadata of a plain recipe preset fails');
    assert.match(refused.stdout + refused.stderr, /has no metadata; omit --metadata/);
    await assert.rejects(readFile(path.join(dir, 'x.json')), { code: 'ENOENT' });
  }
  await assert.rejects(run('compile', path.join(examples, entries[0].file), '--preset', entries[0].name, '--out', path.join(dir, 'y.json')));
});
