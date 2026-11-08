import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLivePowder, compilePowder, packStrokes, unpackStrokes, replayStrokes, applyStroke, sandboxSource } from '../src/powder.js';
import {
  POWDER_SCENES, POWDER_PRESETS, SANDBOX_SOURCE, POWDER_TOOLS, TOOL_IDS, brushInput, heldTool, callText, inputText, clipSteps, powderCommands,
  pixelDigest, replayLink, fitReplayLink, checkReplay, readReplayLink, recordedText, replayLeft, toBase64url, PowderLinkError, LINK_LIMIT, REPLAY_FRAMES
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
  assert.equal(made.cut, 'length'); assert.ok(made.link.length <= limit, `${made.link.length} characters`);
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

test('a full recording makes a link that stops where the first stroke was left out, without the digest', async () => {
  // The live grid records at most 65,536 strokes, and its `recordedUntil` is the frame of the first one it left out,
  // which the page passes on. Here the session's strokes stand in for a recording that filled up partway: at a stroke
  // mid-session, and at the stroke still waiting for the next step.
  const live = session(), all = live.strokes, digest = pixelDigest(live.render().rgba);
  for (const left of [all.findIndex(s => s.f === 60), all.length - 1]) {
    const recordedUntil = all[left].f, strokes = all.slice(0, left);
    const made = await fitReplayLink(BASE, { scene: 'sandbox', strokes, frames: live.frame, digest, recordedUntil }, packStrokes);
    assert.deepEqual([made.cut, made.frames, made.kept], ['full', recordedUntil, strokes.length]);
    const read = await readReplayLink(made.link);
    assert.equal(read.digest, null, 'the end\'s digest would make the replay blame another version');
    // The replay is the session up to that frame, with the strokes recorded on it waiting for the next step.
    const original = createLivePowder(SANDBOX_SOURCE, { record: true });
    replayStrokes(original, strokes, recordedUntil);
    for (const stroke of strokes.filter(s => s.f === recordedUntil)) applyStroke(original, stroke);
    const again = replayed(read.packed);
    assert.equal(again.frame, recordedUntil);
    original.step(); again.step();
    assert.equal(pixelDigest(again.render().rgba), pixelDigest(original.render().rgba));
  }
  // While every stroke is recorded (null, or an engine without the field), nothing is cut.
  assert.equal((await fitReplayLink(BASE, { scene: 'sandbox', strokes: all, frames: live.frame, digest, recordedUntil: null }, packStrokes)).cut, false);
  assert.deepEqual([recordedText(1), recordedText(2048, null), recordedText(65536, 1234)], ['1 stroke recorded', '2,048 strokes recorded', 'Recording full: 65,536 strokes, up to frame 1,234']);
});

test('a link replays at most two hours: the lab cuts a longer session, and refuses a longer link before a step', async () => {
  const strokes = [{ f: 10, op: 1, x: 5.5, y: 5.5, radius: 2 }, { f: REPLAY_FRAMES + 5, op: 1, x: 6.5, y: 5.5, radius: 2 }];
  const made = await fitReplayLink(BASE, { scene: 'sandbox', strokes, frames: REPLAY_FRAMES + 60, digest: 'deadbeef' }, packStrokes);
  assert.deepEqual([made.cut, made.frames, made.kept], ['long', REPLAY_FRAMES, 1]);
  const read = await readReplayLink(made.link);
  assert.equal(read.digest, null);
  assert.equal(checkReplay(unpackStrokes(read.packed)).frames, REPLAY_FRAMES);
  // A one-hour session (216,000 frames at 60 a second) opens; the reviewer's 67-character link asking for 5,184,000
  // frames, or a stroke after the last frame, is refused.
  assert.equal(REPLAY_FRAMES >= 216000, true);
  assert.equal(checkReplay(unpackStrokes(packStrokes([], 216000))).frames, 216000);
  assert.throws(() => checkReplay(unpackStrokes(packStrokes([], 216000 * 24))), error => error instanceof PowderLinkError && /asks for 5,184,000 frames; the lab replays at most 432,000/.test(error.message));
  assert.throws(() => checkReplay({ frames: 5, strokes: [{ f: 6 }] }), error => error instanceof PowderLinkError && /a stroke comes after its last frame/.test(error.message));
  // The replay's estimate: none in its first second, then from how fast it has gone.
  assert.deepEqual([replayLeft(100, 100, 500), replayLeft(0, 100, 5000), replayLeft(1000, 3000, 2000), replayLeft(1000, 200000, 2000), replayLeft(10, 432000, 2000)],
    [null, null, 'about 6 s left', 'about 7 min left', 'about 24 h left']);
});

test('the stroke shown as a scripted input is in the bake when pasted, as is any frame before the last clipped step', () => {
  // clipSteps is the compiler's own count (metadata.steps), for the default clip and for clips of a source's own.
  const tiny = { ...sandboxSource(16, 16), version: 1, name: 'tiny', clips: { a: { start: 5, frames: 3, every: 4 }, b: { frames: 10 } } };
  assert.equal(clipSteps(tiny), compilePowder(tiny).metadata.steps);
  const none = compilePowder(SANDBOX_SOURCE), steps = clipSteps(SANDBOX_SOURCE), still = JSON.stringify(none.recipe.frames);
  assert.equal(steps, none.metadata.steps);
  // The page shows the input on frame 0 (the bake note gives the bound); the live frame it was made on is often past it.
  const [action, input] = brushInput('sand', { x: 120.5, y: 20.5 }, { x: 118.5, y: 20.5 }, { radius: 4, spray: 0.35, solid: false });
  const baked = frame => JSON.stringify(compilePowder({ ...SANDBOX_SOURCE, inputs: [JSON.parse(inputText(frame, action, input))] }).recipe.frames);
  assert.notEqual(baked(0), still, 'the input shown is not in the clip');
  assert.notEqual(baked(steps - 1), still, `an input on frame ${steps - 1} is not in the clip`);
  assert.equal(baked(steps), still, `an input on frame ${steps} lands after the clip's last frame`);
});
