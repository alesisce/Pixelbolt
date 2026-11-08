// A scene of three planes for the engine checks (scripts/verify-tiled.mjs, scripts/verify-godot.mjs) and the export
// tests: a sky with a sun and clouds that stays on screen (parallax 0), green hills halfway (0.5) and 0.6 into a haze
// of the sky's colour, and the ground (1) with the forest spirit on it, under a camera that pans 96 pixels right. The
// hills and the ground are one autotile set, the hills recoloured green by an asset palette, so the far tiles are the
// near ones' shapes, paler. Both maps start a cell left of the view, so no map edge shows as the camera pans.
// The checks put the camera at its start, halfway and its end, where every plane's share of it is a whole number of
// pixels, and at [47, 3] and [49, 0], where the hills' share is a whole number and a half ([23.5, 1.5] and [24.5, 0]):
// Pixelbolt rounds such a share down, as Godot draws it with Snap 2D Transforms to Pixel on.
import { readFile } from 'node:fs/promises';
import { compileAutotile } from '../src/authoring.js';

export const PARALLAX_CAMERAS = [[0, 0], [47, 3], [48, 0], [49, 0], [96, 0]];

const sky = { version: 1, name: 'sky', width: 32, height: 16, palette: { s: '#fff4c8', S: '#ffe08a', w: '#ffffff', c: '#e4f2fa', C: '#c6e2f2' },
  frames: [
    { name: 'sun', ops: [{ op: 'ellipse', x: 8, y: 0, w: 16, h: 16, color: 'S' }, { op: 'ellipse', x: 10, y: 2, w: 12, h: 12, color: 's' }] },
    { name: 'cloud', ops: [
      { op: 'ellipse', x: 2, y: 6, w: 14, h: 8, color: 'C' }, { op: 'ellipse', x: 9, y: 2, w: 14, h: 11, color: 'C' }, { op: 'ellipse', x: 18, y: 6, w: 12, h: 8, color: 'C' },
      { op: 'ellipse', x: 3, y: 6, w: 12, h: 6, color: 'c' }, { op: 'ellipse', x: 10, y: 2, w: 12, h: 9, color: 'c' }, { op: 'ellipse', x: 19, y: 6, w: 10, h: 6, color: 'c' },
      { op: 'ellipse', x: 11, y: 3, w: 8, h: 5, color: 'w' }, { op: 'rect', x: 2, y: 13, w: 28, h: 1, color: 'C' }] }
  ] };

export async function parallaxScene() {
  const spirit = JSON.parse(await readFile(new URL('../examples/forest-spirit.json', import.meta.url), 'utf8'));
  const ground = compileAutotile(JSON.parse(await readFile(new URL('../examples/ground.autotile.json', import.meta.url), 'utf8')));
  const legend = ground.metadata.slopes.legend;
  return { format: 'pixelforge-scene', version: 1, name: 'hills', width: 160, height: 96, duration: 3000, background: '#9ccfe6',
    haze: { color: '#b4dcee' }, camera: [{ time: 0, at: [0, 0], ease: 'inOut' }, { time: 3000, at: [96, 0] }],
    assets: { sky, ground: ground.recipe, hills: { recipe: ground.recipe, palette: { u: '#4f8f45', U: '#3f7a3c', b: '#5e9e4c', R: '#36693a', P: '#4a7f44', p: '#6aa556' } }, spirit },
    instances: [
      { name: 'sun', asset: 'sky', frame: 'sun', at: [118, 8], parallax: 0 },
      { name: 'cloud', asset: 'sky', frame: 'cloud', at: [14, 12], parallax: 0 },
      { name: 'cloud', asset: 'sky', frame: 'cloud', at: [72, 4], parallax: 0 },
      { name: 'hills', asset: 'hills', at: [-16, 24], parallax: 0.5, haze: 0.6, tilemap: { tile: [16, 16], legend,
        rows: ['....uU#Dd......', '..uU#####Dd.uU#', '###############', '###############', '###############'] } },
      { name: 'ground', asset: 'ground', at: [-16, 56], tilemap: { tile: [16, 16], legend,
        rows: ['........./#\\......', '##################', '##################'] } },
      { name: 'spirit', asset: 'spirit', at: [44, 72], anchor: [12, 23], animation: 'bob' }
    ] };
}
