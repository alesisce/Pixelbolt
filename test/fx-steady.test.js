import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject } from '../src/core.js';
import { compileEffects } from '../src/fx.js';
import { compileWaves } from '../src/wave.js';
import { spellLibrary } from '../scripts/spell-library.mjs';
import { spellPresets } from '../scripts/spell-presets.mjs';
import { readShapes, renderShapes, holdBands, settleHolds } from '../src/shapes.js';
import { wavePresets } from '../scripts/wave-presets.mjs';

// Flicker as the eye sees it: pixels drawn in frames t − 1 and t + 1 in one colour but changed in frame t (a band that
// flips at a threshold and straight back, a hole for one frame), counted round a loop's seam too. Pixels and frames only.
function flips(recipe, name) {
  const project = renderProject(recipe), animation = project.animations[name];
  const frames = animation.frames.map(i => new Uint32Array(project.frames[i].data.slice().buffer)), F = frames.length;
  let flipped = 0, drawn = 0;
  for (let t = animation.loop ? 0 : 1; t < (animation.loop ? F : F - 1); t++) {
    const a = frames[(t + F - 1) % F], b = frames[t], c = frames[(t + 1) % F];
    for (let i = 0; i < b.length; i++) {
      if (b[i] >>> 24) drawn++;
      if (a[i] >>> 24 && a[i] === c[i] && b[i] !== a[i]) flipped++;
    }
  }
  return { flipped, share: flipped / Math.max(1, drawn) };
}
const palette = { k: '#112', b: '#24a', c: '#5af', W: '#fff', o: '#f93', y: '#fe6' };
const looks = (hold, extra = {}) => ({ warm: { colors: ['o', 'y', 'W'], thresholds: [0.2, 0.5, 0.8], ...(hold !== undefined && { hold }), ...extra } });
const source = (effect, hold, extra) => ({ format: 'pixelforge-fx', version: 1, name: 'steady', width: 40, height: 40, palette, effects: { e: { frames: 12, looks: looks(hold, extra), ...effect } } });
const compiled = (effect, hold, extra) => compileEffects(source(effect, hold, extra));

test('the shipped spells and waves keep their flicker low', () => {
  // Before bands held, these flipped 26.7%, 14.2%, 10.6%, 7.8% and 7.2% of their drawn pixels back and forth a frame,
  // and the waves 0.7% and 0.1%.
  const most = { 'lightning buff': 0.08, 'water buff': 0.06, 'lightning area': 0.05, 'fire projectile': 0.045, fireball: 0.045 };
  const got = {
    'lightning buff': flips(compileEffects(spellLibrary.lightning).recipe, 'buff').share,
    'water buff': flips(compileEffects(spellLibrary.water).recipe, 'buff').share,
    'lightning area': flips(compileEffects(spellLibrary.lightning).recipe, 'area').share,
    'fire projectile': flips(compileEffects(spellLibrary.fire).recipe, 'projectile-0').share,
    fireball: flips(compileEffects(spellPresets.fireball).recipe, 'fireball-0').share
  };
  for (const [name, share] of Object.entries(got)) assert.ok(share <= most[name], `${name} flips ${(100 * share).toFixed(2)}% of its pixels a frame`);
  for (const [name, preset] of Object.entries(wavePresets)) {
    const { recipe } = compileWaves(preset);
    for (const animation of Object.keys(recipe.animations)) assert.equal(flips(recipe, animation).flipped, 0, `${name} ${animation}`);
  }
  // That is the wave look's hold at work: without it, values wavering at a threshold flip pixels in the interference.
  const loose = structuredClone(wavePresets.interference);
  loose.effects.resonate.look.hold = 0;
  assert.ok(flips(compileWaves(loose).recipe, 'resonate').flipped > 0);
});

test('a look\'s bands hold: a field wavering at a threshold settles instead of flipping every frame', () => {
  // A disc whose power dips a tenth every other frame: each dip crosses a threshold only by less than the hold margin.
  const disc = { layers: [{ kind: 'burst', look: 'warm', at: [20, 20], radius: 14, noise: 0, flicker: 0.1 }] };
  const plain = flips(compiled(disc, 0).recipe, 'e'), held = flips(compiled(disc).recipe, 'e');
  assert.ok(plain.flipped > 40, `without a hold the dips flip ${plain.flipped} pixels`);
  assert.equal(held.flipped, 0);
  // A dip larger than the margin still shows: a strobe stays a strobe.
  assert.ok(flips(compiled({ layers: [{ ...disc.layers[0], flicker: 0.6 }] }).recipe, 'e').flipped > 40);
  // Lit and shade bands hold too: blobs swirling round a ring stir its rim lights less.
  const lights = { lit: { colors: ['W'], thresholds: [0.4] }, shade: { colors: ['k'], thresholds: [0.4] } };
  const swirl = { loop: true, layers: [{ kind: 'ring', look: 'warm', at: [20, 24], radius: 12, width: 6, squash: [1, 0.35] }],
    emitters: [{ at: [20, 24], rate: 1, life: [6, 8], sway: { amplitude: [12, 4], period: 12 }, blob: { look: 'warm', radius: [1, 3, 1] } }] };
  assert.ok(flips(compiled(swirl, undefined, lights).recipe, 'e').flipped < flips(compiled(swirl, 0, lights).recipe, 'e').flipped);
});

test('a still field, and one that only rises or only falls, draws exactly as without a hold', () => {
  const ring = { kind: 'ring', look: 'warm', at: [20, 20], radius: 12, width: 5, noise: 0.5 };
  for (const effect of [
    { layers: [ring] }, { loop: true, layers: [ring] },
    { layers: [{ kind: 'burst', look: 'warm', at: [20, 20], radius: 14, noise: 0, power: [0.3, 1.5], ease: 'linear' }] },
    { layers: [{ kind: 'star', look: 'warm', at: [20, 20], radius: 16, power: [1.5, 0.2] }] }
  ]) assert.deepEqual(compiled(effect).recipe, compiled(effect, 0).recipe, JSON.stringify(effect.layers[0]));
});

test('held bands loop exactly and compile the same every time', () => {
  for (const layer of [
    { kind: 'burst', look: 'warm', at: [20, 20], radius: 12, noise: 0.5, boil: 8 },
    { kind: 'burst', look: 'warm', at: [20, 20], radius: 12, noise: 0, flicker: 0.1 },
    { kind: 'beam', look: 'warm', at: [4, 20], to: [36, 20], width: 10, wobble: 0.3, wavelength: 7, waves: 4, noise: 0.5, scale: 3 }
  ]) {
    const effect = { loop: true, layers: [layer] }, first = compiled(effect);
    assert.equal(first.metadata.effects.e.seam.jump, 0, layer.kind);
    assert.deepEqual(first, compiled(structuredClone(effect)));
  }
  // Every shipped loop still closes exactly.
  for (const preset of [...Object.values(spellLibrary), ...Object.values(spellPresets)]) {
    const { metadata, warnings } = compileEffects(preset);
    for (const [name, effect] of Object.entries(metadata.effects)) if (effect.seam?.jump !== undefined) assert.equal(effect.seam.jump, 0, `${preset.name} ${name}`);
    assert.equal(warnings, undefined, preset.name);
  }
});

test('noise still breaks a shape into pieces under a hold', () => {
  const stream = { kind: 'stream', look: 'warm', at: [4, 34], through: [[14, 10], [26, 26], [36, 6]], width: [4, 8, 5], head: [0.3, 1], tail: [0, 0.4], sway: 2, noise: 0.6, scale: 3, power: 0.5 };
  const pieces = grid => {
    const at = new Set(grid.rows.flatMap((row, j) => [...row].flatMap((key, i) => (key === '.' ? [] : [`${grid.x + i},${grid.y + j}`]))));
    const seen = new Set();
    let count = 0;
    for (const start of at) {
      if (seen.has(start)) continue;
      count++;
      for (const stack = [start]; stack.length;) {
        const here = stack.pop();
        if (seen.has(here) || !at.has(here)) continue;
        seen.add(here);
        const [x, y] = here.split(',').map(Number);
        stack.push(`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`);
      }
    }
    return count;
  };
  const counts = compiled({ layers: [stream] }).recipe.frames.map(frame => pieces(frame.ops.find(op => op.op === 'grid')));
  assert.ok(Math.max(...counts) > 1, `${counts}`);
});

test('a dissolving particle fades out once as it moves, instead of blinking across a pattern fixed to the canvas', () => {
  for (const pattern of ['bayer4', 'noise', [[0, 1, 2], [1, 2, 0], [2, 0, 1]]]) for (const seed of [1, 2, 3]) {
    const fx = { format: 'pixelforge-fx', version: 1, name: 'fade', width: 40, height: 8, palette, symbols: { dot: ['y'] },
      effects: { e: { frames: 16, seed, emitters: [{ at: [4, 4], burst: 1, life: 16, angle: 0, speed: 1.4, dissolve: 0.8, pattern, shapes: ['dot'] }] } } };
    const shown = compileEffects(fx).recipe.frames.map(frame => (frame.ops?.length ? 1 : 0)).join('');
    assert.match(shown, /^1+0*$/, `${JSON.stringify(pattern)} seed ${seed}: ${shown}`);
  }
});

test('a loop whose looks hold paints its cycle once, as one without a hold does, and draws what painting it draws', () => {
  // Counted in pixels painted: the fireball loops with held looks. It painted its cycle twice (to settle the holds, then
  // to draw), taking twice as long; now it is drawn from what the first painting noted.
  const unheld = structuredClone(spellPresets.fireball);
  for (const effect of Object.values(unheld.effects)) for (const look of Object.values(effect.looks ?? {})) look.hold = 0;
  const held = compileEffects(spellPresets.fireball, { stats: true }), plain = compileEffects(unheld, { stats: true });
  assert.ok(held.work.painted > 0);
  assert.equal(held.work.painted, plain.work.painted);
  // A frame drawn from the tape is the frame painted with the same memory: held looks with lit and shade bands beside one
  // without a hold, a look drawn in front, a layer behind a character (split), and pixels that never settle (drawn loose).
  const W = 40, H = 40, frames = 12, split = true;
  const shapes = readShapes({
    looks: { warm: { colors: ['o', 'y', 'W'], thresholds: [0.2, 0.5, 0.8], lit: { colors: ['W'], thresholds: [0.3] }, shade: { colors: ['k'], thresholds: [0.4] } }, cool: { colors: ['b', 'c'], thresholds: [0.3, 0.7], hold: 0 }, top: { colors: ['c'], thresholds: [0.4], front: true, hold: 0.4 } },
    layers: [{ kind: 'burst', look: 'warm', at: [20, 20], radius: 12, noise: 0.5, boil: 8, depth: 'split' }, { kind: 'ring', look: 'cool', at: [20, 20], radius: 10, noise: 0.6 }, { kind: 'burst', look: 'top', at: [14, 14], radius: 6, noise: 0.4, flicker: 0.2 }]
  }, 'fx.effects.e', { palette, seed: 3, frames, loop: true });
  const draw = (f, memory) => [false, true].map(front => renderShapes(shapes, f, W, H, [], { spent: 0 }, front, split, 0, memory));
  const memory = holdBands(), reads = shapes.looks.map(() => []), tape = Array.from({ length: frames }, () => []);
  let at = 0;
  memory.trace = (look, codes) => reads[look].push(codes);
  memory.tape = (look, record) => { tape[at][look] = record; };
  for (; at < frames; at++) assert.deepEqual(draw(at, memory), [null, null], 'a taped frame is drawn later');
  memory.tape = null;
  settleHolds(memory, reads, W * H);
  for (const loose of memory.loose) if (loose) for (let c = 0; c < loose.length; c += 3) loose[c] = 1;
  const copy = () => ({ held: memory.held.map(held => held && Object.fromEntries(Object.entries(held).map(([name, bands]) => [name, Uint8Array.from(bands)]))), loose: memory.loose, trace: null, tape: null, replay: null });
  const painting = copy(), replaying = copy();
  let drawn = 0;
  for (let f = 0; f < frames; f++) {
    replaying.replay = tape[f];
    const want = draw(f, painting), got = draw(f, replaying);
    replaying.replay = null;
    assert.deepEqual(got, want, `frame ${f}`);
    drawn += want.filter(Boolean).length;
  }
  assert.ok(drawn >= frames, 'the frames draw something');
  // Painted on from there, both memories draw the same frames.
  for (let f = 0; f < 3; f++) assert.deepEqual(draw(f, replaying), draw(f, painting), `frame ${f} after the cycle`);
});
