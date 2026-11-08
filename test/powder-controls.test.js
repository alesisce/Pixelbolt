import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLivePowder, compilePowder, packStrokes, unpackStrokes, replayStrokes, applyStroke } from '../src/powder.js';
import {
  POWDER_SCENES, POWDER_PRESETS, SANDBOX_SOURCE, POWDER_TOOLS, TOOL_IDS, brushInput, heldTool, callText, inputText, powderCommands,
  pixelDigest, replayLink, fitReplayLink, readReplayLink, toBase64url, PowderLinkError, LINK_LIMIT
} from '../studio/powder-controls.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:4747/powder.html';
// What the page does for a brush between two cells: the input, queued on the live grid.
const brushOn = (live, tool, at, from, settings = {}) => {
  const made = brushInput(tool, at, from, { radius: 4, spray: 0.35, solid: false, ...settings });
  if (made) live[made[0]](made[1]);
  return made;
};
// A session in the sandbox: sand poured while held, a plank set alight, wind, a blast, walls, heat and cold, and a
// stroke left waiting for the next step when the link is made.
function session() {
  const live = createLivePowder(SANDBOX_SOURCE, { record: true });
  for (let f = 0; f < 120; f++) {
    if (f < 40) brushOn(live, 'sand', { x: 120.5 + (f % 7), y: 10.5 }, { x: 120.5 + ((f + 6) % 7), y: 10.5 });
    if (f === 10) brushOn(live, 'fire', { x: 98.5, y: 124.5 }, { x: 98.5, y: 124.5 });
    if (f === 12) brushOn(live, 'heat', { x: 96.5, y: 125.5 }, { x: 95.5, y: 125.5 });
    if (f === 30) brushOn(live, 'wind', { x: 80.5, y: 56.5 }, { x: 70.5, y: 60.5 });
    if (f === 50) brushOn(live, 'blast', { x: 200.5, y: 130.5 }, { x: 200.5, y: 130.5 });
    if (f === 60) brushOn(live, 'wall', { x: 30.5, y: 60.5 }, { x: 10.5, y: 60.5 });
    if (f === 70) brushOn(live, 'cool', { x: 190.5, y: 125.5 }, { x: 190.5, y: 125.5 });
    if (f === 80) brushOn(live, 'erase', { x: 200.5, y: 120.5 }, { x: 210.5, y: 120.5 });
    if (f === 90) brushOn(live, 'stone', { x: 60.5, y: 40.5 }, { x: 64.5, y: 40.5 }, { solid: true });
    live.step();
  }
  brushOn(live, 'water', { x: 140.5, y: 20.5 }, { x: 141.5, y: 20.5 });
  return live;
}
// What the page does with a link's strokes: each on its frame, then the ones made after the last step queued.
function replayed(packed) {
  const { frames, strokes } = unpackStrokes(packed), live = createLivePowder(SANDBOX_SOURCE, { record: true });
  replayStrokes(live, strokes, frames);
  for (const stroke of strokes.filter(s => s.f === frames)) applyStroke(live, stroke);
  return live;
}

test('the Powder lab lists every shipped powder preset, and its sandbox runs and compiles', async () => {
  const shipped = (await readdir(path.join(root, 'examples'))).filter(file => file.endsWith('.powder.json')).map(file => file.replace(/\.powder\.json$/, '')).sort();
  assert.deepEqual(POWDER_PRESETS.map(entry => entry.file).sort(), shipped);
  assert.equal(new Set(POWDER_SCENES.map(entry => entry.id)).size, POWDER_SCENES.length);
  assert.ok(SANDBOX_SOURCE.width <= 256 && SANDBOX_SOURCE.height <= 256, 'the sandbox source must still compile');
  const live = createLivePowder(SANDBOX_SOURCE);
  assert.deepEqual(Object.keys(live.measure().counts).sort(), ['empty', 'stone', 'water', 'wood']);
  assert.equal(compilePowder(SANDBOX_SOURCE).recipe.name, 'sandbox');
});

test('every brush makes an input the grid takes, and the call it shows is the stroke recorded', () => {
  const live = createLivePowder(SANDBOX_SOURCE, { record: true }), brushes = [...live.materials.filter(name => name !== 'wall'), ...TOOL_IDS];
  assert.deepEqual(POWDER_TOOLS.map(tool => tool.id), ['erase', 'wall', 'heat', 'cool', 'wind', 'blast']);
  for (const brush of brushes) {
    const made = brushInput(brush, { x: 60.5, y: 40.5 }, { x: 57.5, y: 42.5 }, { radius: 3, spray: 0.4, solid: brush === 'stone' });
    assert.ok(made, brush);
    const [action, input] = made, before = live.strokes.length;
    live[action](input);
    assert.equal(live.strokes.length, before + 1, brush);
    // The stroke as recorded holds the values the page shows, so a replay makes the same calls.
    const { f, op, m, ...recorded } = live.strokes.at(-1), shown = { ...input };
    if (shown.material) assert.equal(live.materials[m - 1], shown.material, brush);
    delete shown.material;
    for (const [key, value] of Object.entries(shown)) assert.equal(recorded[key], value, `${brush} ${key}`);
    assert.match(callText(action, input), new RegExp(`^live\\.${action}\\(\\{ .* \\}\\)$`));
    // The scripted input form is a source's `inputs` entry the reader takes.
    const entry = JSON.parse(inputText(f, action, input));
    assert.deepEqual(entry, { frame: f, [action]: input });
    assert.doesNotThrow(() => createLivePowder({ ...SANDBOX_SOURCE, inputs: [entry] }), brush);
    live.step();
  }
  // Painted solids fill every cell; the rest spray. Wind blows only while the pointer moves, at half its speed.
  assert.equal(brushInput('stone', { x: 1.5, y: 1.5 }, { x: 1.5, y: 1.5 }, { radius: 2, spray: 0.35, solid: true })[1].fill, 1);
  assert.equal(brushInput('sand', { x: 1.5, y: 1.5 }, { x: 1.5, y: 1.5 }, { radius: 2, spray: 0.35, solid: false })[1].fill, 0.35);
  assert.equal(brushInput('wind', { x: 9.5, y: 9.5 }, { x: 9.5, y: 9.5 }, { radius: 2, spray: 1 }), null);
  assert.deepEqual(brushInput('wind', { x: 40.5, y: 9.5 }, { x: 9.5, y: 12.5 }, { radius: 2, spray: 1 })[1], { x: 9.5, y: 12.5, x2: 40.5, y2: 9.5, radius: 6, vx: 8, vy: -1.5 });
  assert.deepEqual([heldTool('sand'), heldTool('wind'), heldTool('blast')], [true, true, false]);
  assert.deepEqual(powderCommands(POWDER_SCENES[1], 3), {
    cli: ['pixelbolt compile hut-fire.powder.json --out hut-fire.json', 'pixelbolt gif hut-fire.json --scale 3 --out hut-fire.gif'],
    mcp: ['pixel_compile { "preset": "hut-fire" }', 'pixel_render { "revision": <from pixel_compile>, "gif": { "scale": 3 } }']
  });
  assert.equal(powderCommands(POWDER_SCENES[0], 2).mcp[0], 'pixel_compile { "source": <sandbox.powder.json> }');
});

test('a replay link redraws exactly the pixels it was made from', async () => {
  const live = session(), digest = pixelDigest(live.render().rgba);
  const made = await fitReplayLink(BASE, { scene: 'sandbox', strokes: live.strokes, frames: live.frame, digest }, packStrokes);
  assert.equal(made.cut, false); assert.equal(made.kept, live.strokes.length); assert.ok(made.link.length <= LINK_LIMIT);
  assert.match(made.link, /^http:\/\/127\.0\.0\.1:4747\/powder\.html#s=sandbox&i=[A-Za-z0-9_-]+&h=[0-9a-f]{8}$/);
  const read = await readReplayLink(made.link.slice(made.link.indexOf('#')));
  assert.equal(read.scene, 'sandbox'); assert.equal(read.digest, digest);
  const again = replayed(read.packed);
  assert.equal(again.frame, live.frame);
  assert.equal(pixelDigest(again.render().rgba), digest);
  // The waiting stroke lands on the next step in both.
  live.step(); again.step();
  assert.equal(pixelDigest(again.render().rgba), pixelDigest(live.render().rgba));
  // A replayed run records the same strokes, so a link made from it carries them all.
  assert.deepEqual(packStrokes(again.strokes, again.frame), packStrokes(live.strokes, live.frame));
});

test('a recording too long for a link is cut at a stroke, and replays up to it', async () => {
  // A wandering drag (seeded), which deflate cannot pack away as it does a brush held still.
  const live = createLivePowder(SANDBOX_SOURCE, { record: true }), strokes = live.strokes, limit = 600;
  let seed = 7, from = { x: 128.5, y: 20.5 };
  const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 16; };
  for (let f = 0; f < 240; f++) {
    const at = { x: Math.max(0.5, Math.min(255.5, from.x + (next() % 9) - 4)), y: Math.max(0.5, Math.min(100.5, from.y + (next() % 5) - 2)) };
    if (f % 3) brushOn(live, ['sand', 'water', 'oil'][next() % 3], at, from);
    from = at; live.step();
  }
  const made = await fitReplayLink(BASE, { scene: 'sandbox', strokes, frames: live.frame, digest: 'deadbeef' }, packStrokes, limit);
  assert.equal(made.cut, true); assert.ok(made.link.length <= limit, `${made.link.length} characters`);
  assert.ok(made.kept > 0 && made.kept < strokes.length); assert.equal(made.frames, strokes[made.kept].f);
  // One more stroke would not have fitted.
  assert.ok((await replayLink(BASE, { scene: 'sandbox', packed: packStrokes(strokes.slice(0, made.kept + 1), strokes[made.kept + 1]?.f ?? live.frame) })).length > limit);
  const read = await readReplayLink(made.link);
  assert.equal(read.digest, null);
  const { frames, strokes: kept } = unpackStrokes(read.packed);
  assert.deepEqual([frames, kept.length], [made.frames, made.kept]);
  // Up to that frame, the cut replay is the session itself.
  const original = createLivePowder(SANDBOX_SOURCE, { record: true });
  replayStrokes(original, strokes.filter(s => s.f < made.frames), made.frames);
  assert.equal(pixelDigest(replayed(read.packed).render().rgba), pixelDigest(original.render().rgba));
});

test('links that name only a scene, or are damaged, are read or refused with a message', async () => {
  assert.equal(await readReplayLink('#hut-fire'), null);
  assert.equal(await readReplayLink(''), null);
  assert.deepEqual(await readReplayLink('#s=quarry-blast'), { scene: 'quarry-blast', packed: null, digest: null });
  const refused = async (fragment, pattern) => assert.rejects(readReplayLink(fragment), error => error instanceof PowderLinkError && pattern.test(error.message), fragment);
  await refused('#i=AAAA', /names no scene/);
  await refused('#s=volcano&i=AAAA', /no scene called volcano/);
  await refused('#s=sandbox&i=AA*A', /not base64url/);
  await refused('#s=sandbox&i=A', /not base64url/);
  await refused(`#s=sandbox&i=${toBase64url(new Uint8Array([1, 2, 3, 4, 5]))}`, /do not unpack/);
  await refused('#s=sandbox&i=AAAA&h=xyz', /pixel digest/);
  await assert.rejects(replayLink(BASE, { scene: 'volcano', packed: new Uint8Array(1) }), /no scene called volcano/);
  assert.equal(pixelDigest(new Uint8Array(0)), '811c9dc5');
});
