import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject, parseColor, PixelError } from '../src/core.js';
import { compileFluid, createLiveFluid } from '../src/fluid.js';
import { compileBodies } from '../src/bodies.js';
import { fluidBodyPresets } from '../scripts/fluid-body-presets.mjs';
import { bodiesPresets } from '../scripts/bodies-presets.mjs';

// Bodies in a liquid (docs/physics-model.md, section 13): moving solids that shove it, floated and dragged by water,
// held up by resting sand.
const palette = { b: '#2f6fc0', B: '#1d3f7a', s: '#d1a457', k: '#111111', h: '#c98c4f', g: '#888888' };
const pool = (bodies, extra = {}) => ({ format: 'pixelforge-fluid', version: 1, name: 'pool', width: 48, height: 40, palette,
  effects: { pool: { kind: 'liquid', frames: 100, duration: 50, seed: 3, walls: ['left', 'right', 'bottom'], flip: 0.3, drag: 0.05, fill: [{ x: 0, y: 24, w: 48, h: 16 }], emitters: [],
    look: [{ field: 'density', colors: ['b'], thresholds: [0.5], dither: 0 }], bodies, ...extra } } });
const refused = (source, where, pattern) => assert.throws(() => compileFluid(source), error => error instanceof PixelError && error.path === where && pattern.test(error.message), where);
const paths = source => Object.values(compileFluid(source).metadata.effects)[0].bodies.paths;
// How many pixels of the given colours change from each frame to the next, from frame `from` on.
const changes = (source, keys, from) => {
  const project = renderProject(compileFluid(source).recipe), [animation] = Object.values(project.animations);
  const colours = keys.split('').map(key => parseColor(source.palette[key]).slice(0, 3).join());
  const mask = f => { const d = project.frames[animation.frames[f]].data, s = new Set(); for (let i = 0; i < d.length; i += 4) if (colours.includes(`${d[i]},${d[i + 1]},${d[i + 2]}`)) s.add(i); return s; };
  const out = [];
  for (let f = from; f + 1 < animation.frames.length; f++) { const a = mask(f), b = mask(f + 1); let n = 0; for (const i of a) if (!b.has(i)) n++; for (const i of b) if (!a.has(i)) n++; out.push(n); }
  return out;
};

test('bodies share a liquid only: one-shot, without heat, and not in the live runner', () => {
  const box = { shape: 'box', size: [6, 6], at: [24, 10], fill: 'h' };
  refused({ ...pool([box]), effects: { pool: { ...pool([box]).effects.pool, kind: 'gas', fill: undefined, flip: undefined, walls: undefined, emitters: [{ at: [8, 8], rate: 1 }] } } }, 'fluid.effects.pool.bodies', /in a liquid/);
  refused(pool([box], { loop: true }), 'fluid.effects.pool.loop', /loop: false/);
  refused(pool([box], { heat: {} }), 'fluid.effects.pool.heat', /heat/);
  refused(pool([{ ...box, shape: 'star' }]), 'fluid.effects.pool.bodies[0].shape', /circle, box, polygon, hoop/);
  assert.throws(() => createLiveFluid(pool([box])), error => error instanceof PixelError && /live runner/.test(error.message));
});

test('water floats a body by its density, a stone sinks to the bottom, and they come to rest', () => {
  const p = paths(pool([
    { name: 'light', shape: 'box', size: [8, 8], at: [10, 16], density: 0.2, fill: 'h' },
    { name: 'heavy', shape: 'box', size: [8, 8], at: [24, 16], density: 0.8, fill: 'h' },
    { name: 'stone', shape: 'box', size: [6, 4], at: [38, 16], density: 3, fill: 'g' }]));
  const end = name => p[name].at(-1)[1];
  // The water's surface is about row 24 (a little higher once the bodies displace it).
  assert.ok(end('light') < end('heavy'), `the lighter crate floats higher (${end('light')} against ${end('heavy')})`);
  assert.ok(end('light') > 16 && end('light') < 24, `the light crate floats mostly out of the water at ${end('light')}`);
  assert.ok(end('heavy') > 22 && end('heavy') < 32, `the heavy crate floats mostly under at ${end('heavy')}`);
  assert.equal(end('stone'), 38, 'the stone rests on the bottom');
  const crate = fluidBodyPresets['crate-splash'], still = changes(crate, 'hosSkr', 100);
  assert.ok(still.every(n => n === 0), `the bodies on the settled pool hold still: ${still.join(' ')}`);
});

test('resting sand holds a dropped body up as ground, and sand that slides carries one down', () => {
  const sand = { format: 'pixelforge-fluid', version: 1, name: 'sand', width: 48, height: 36, palette,
    effects: { sand: { kind: 'liquid', frames: 70, duration: 50, seed: 4, walls: ['left', 'right', 'bottom'], granular: { repose: 33 }, fill: [{ x: 0, y: 24, w: 48, h: 12 }], emitters: [],
      look: [{ field: 'density', colors: ['s'], thresholds: [0.35], dither: 0 }],
      bodies: [{ name: 'crate', shape: 'box', size: [8, 8], at: [16, 6], density: 2, fill: 'h' }, { name: 'ball', shape: 'circle', radius: 2.5, at: [34, 4], density: 3, fill: 'k' }] } } };
  const p = paths(sand);
  // The sand's surface is row 24: the crate's bottom (its centre plus 4) and the ball's (plus 2.5) stop within two rows of it.
  assert.ok(p.crate.at(-1)[1] + 4 <= 26 && p.crate.at(-1)[1] + 4 >= 23, `the crate stands on the sand at ${p.crate.at(-1)}`);
  assert.ok(p.ball.at(-1)[1] + 2.5 <= 26 && p.ball.at(-1)[1] + 2.5 >= 23, `the ball stands on the sand at ${p.ball.at(-1)}`);
  const late = p.crate.slice(-15);
  assert.ok(late.every(q => q[0] === late[0][0] && q[1] === late[0][1]), 'and stops');
  const slide = paths(fluidBodyPresets['sand-slide']).crate;
  assert.ok(slide.at(-1)[1] - slide[0][1] >= 4 && slide.at(-1)[0] - slide[0][0] >= 3, `the crate rides the slumping sand down and out: ${slide[0]} to ${slide.at(-1)}`);
});

test('a turning hoop is drawn as one ring: only its gap moves', () => {
  const project = renderProject(compileBodies(bodiesPresets['spinning-hoop']).recipe), [animation] = Object.values(project.animations);
  const hoop = parseColor(bodiesPresets['spinning-hoop'].palette.h).slice(0, 3).join();
  const mask = f => { const d = project.frames[animation.frames[f]].data, s = new Set(); for (let i = 0; i < d.length; i += 4) if (`${d[i]},${d[i + 1]},${d[i + 2]}` === hoop) s.add(i); return s; };
  for (let f = 5; f < 40; f++) {
    const a = mask(f), b = mask(f + 1); let n = 0;
    for (const i of a) if (!b.has(i)) n++;
    for (const i of b) if (!a.has(i)) n++;
    assert.ok(n <= 6, `frame ${f}: ${n} hoop pixels changed`);
  }
});
