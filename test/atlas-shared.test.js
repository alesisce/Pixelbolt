// A trimmed sheet packs one cell for frames whose visible pictures are the same: a hold, or a frame moved whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject, buildAtlas } from '../src/core.js';
import { compilePoses } from '../src/authoring.js';
import { readFileSync } from 'node:fs';

const recipe = sheet => ({ version: 1, name: 'shared', width: 12, height: 10, palette: { k: '#1d2b3a', g: '#3fa34d' }, sheet,
  frames: [
    { name: 'rest', ops: [{ op: 'rect', x: 2, y: 3, w: 6, h: 5, color: 'g' }, { op: 'pixel', x: 3, y: 4, color: 'k' }] },
    { name: 'held', from: 'rest', duration: 900 },
    { name: 'up', from: 'rest', translate: [1, -2] },
    { name: 'blink', from: 'rest', ops: [{ op: 'pixel', x: 3, y: 4, color: 'g' }] },
    { name: 'gone' }, { name: 'gone-too' }
  ] });
// The pixels an engine draws for a frame: its rectangle of the sheet, put back at its offset on the source canvas.
function drawn(atlas, name, width, height, scale) {
  const { frame, spriteSourceSize: at } = atlas.metadata.frames[name], out = new Uint8ClampedArray(width * scale * height * scale * 4);
  for (let y = 0; y < frame.h; y++) for (let x = 0; x < frame.w; x++) {
    const from = ((frame.y + y) * atlas.width + frame.x + x) * 4;
    out.set(atlas.data.subarray(from, from + 4), ((at.y + y) * width * scale + at.x + x) * 4);
  }
  return out;
}

test('identical trimmed frames share one cell, and each is still drawn where it stands', () => {
  for (const sheet of [{ trim: true }, { trim: true, padding: 2, scale: 3 }]) {
    const project = renderProject(recipe(sheet)), atlas = buildAtlas(project), { frames } = atlas.metadata, s = sheet.scale ?? 1;
    assert.deepEqual(frames.held.frame, frames.rest.frame);
    assert.deepEqual(frames.up.frame, frames.rest.frame);
    assert.notDeepEqual(frames.blink.frame, frames.rest.frame);
    assert.deepEqual(frames['gone-too'].frame, frames.gone.frame);
    assert.deepEqual([frames.rest.spriteSourceSize, frames.up.spriteSourceSize].map(({ x, y }) => [x, y]), [[2 * s, 3 * s], [3 * s, 1 * s]]);
    assert.equal(frames.held.duration, 900);
    assert.equal(new Set(Object.values(frames).map(entry => JSON.stringify(entry.frame))).size, 3);
    const full = buildAtlas(renderProject(recipe({ scale: s, columns: 1 })));
    for (const frame of project.frames) {
      assert.deepEqual(drawn(atlas, frame.name, 12, 10, s), drawn(full, frame.name, 12, 10, s), frame.name);
    }
  }
});
test('the sheet is smaller for it, and an untrimmed sheet keeps a cell per frame', () => {
  const lone = recipe({ trim: true }); lone.frames = lone.frames.filter(frame => !['held', 'up', 'gone-too'].includes(frame.name));
  const shared = renderProject(recipe({ trim: true })).sheet, alone = renderProject(lone).sheet;
  assert.deepEqual([shared.width, shared.height], [alone.width, alone.height]);
  const grid = buildAtlas(renderProject(recipe({})));
  assert.equal(new Set(Object.values(grid.metadata.frames).map(entry => JSON.stringify(entry.frame))).size, 6);
});
test('frames of equal size and different pictures keep their own cells', () => {
  const project = renderProject({ version: 1, name: 'pair', width: 4, height: 4, sheet: { trim: true }, frames: [
    { name: 'a', ops: [{ op: 'rect', w: 2, h: 2, color: '#ff0000' }] }, { name: 'b', ops: [{ op: 'rect', w: 2, h: 2, color: '#00ff00' }] }] });
  const { a, b } = buildAtlas(project).metadata.frames;
  assert.notDeepEqual(a.frame, b.frame);
});
test('a compiled pose sheet, trimmed, draws every frame as its untrimmed sheet does', () => {
  const source = JSON.parse(readFileSync(new URL('../examples/hero.poses.json', import.meta.url), 'utf8'));
  const { recipe: hero } = compilePoses({ ...source, sheet: { ...source.sheet, trim: true } });
  const atlas = buildAtlas(renderProject(hero)), names = Object.keys(atlas.metadata.frames);
  const full = buildAtlas(renderProject({ ...hero, sheet: {} }));
  for (const name of names) assert.deepEqual(drawn(atlas, name, hero.width, hero.height, 1), drawn(full, name, hero.width, hero.height, 1), name);
});
