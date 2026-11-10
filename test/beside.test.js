// Several recipes in one inspection image: `inspect --beside` and MCP pixel_inspect's `beside` draw the same view of
// each, one sheet under another, so variants (a sprite in three team colours) are compared with one look.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, inspectProject, stackViews, decodePNG } from '../src/index.js';
import { startMCP } from '../src/mcp.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sprite = (name, color, width = 4) => ({ version: 1, name, width, height: 4, palette: { a: color }, frames: [{ name: 'one', ops: [{ op: 'rect', x: 0, y: 0, w: width, h: 4, color: 'a' }] }, { name: 'two', ops: [{ op: 'pixel', x: 1, y: 1, color: 'a' }] }] });
const pixel = (sheet, x, y) => [...sheet.data.subarray((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4)];

test('stacked views keep every sheet whole, each under the one before', () => {
  const views = [sprite('red', '#ff0000'), sprite('blue', '#0000ff', 8)].map(recipe => ({ ...inspectProject(renderProject(recipe), { scale: 2 }), name: recipe.name }));
  const [red, blue] = views.map(view => view.sheet), stacked = stackViews(views);
  assert.deepEqual([stacked.sheet.width, stacked.sheet.height], [Math.max(red.width, blue.width), red.height + blue.height]);
  assert.deepEqual(stacked.stack, [{ name: 'red', y: 0, height: red.height }, { name: 'blue', y: red.height, height: blue.height }]);
  // Every pixel of each sheet is where the stack says, and what the narrower sheet leaves is the sheet's background.
  for (const [sheet, top] of [[red, 0], [blue, red.height]]) for (let y = 0; y < sheet.height; y++) for (let x = 0; x < sheet.width; x++) assert.deepEqual(pixel(stacked.sheet, x, top + y), pixel(sheet, x, y));
  assert.deepEqual(pixel(stacked.sheet, stacked.sheet.width - 1, 0), pixel(red, 0, 0));
  assert.deepEqual([stacked.cells, stacked.name], [views[0].cells, undefined]);
});

test('inspect --beside and pixel_inspect beside draw the variants in one image and say where each starts', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-beside-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const files = {};
  for (const [name, color] of [['red', '#ff0000'], ['blue', '#0000ff'], ['green', '#00ff00']]) { files[name] = path.join(dir, `${name}.json`); await writeFile(files[name], JSON.stringify(sprite(name, color))); }
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), ...args], { encoding: 'utf8', cwd: dir });
  const out = path.join(dir, 'all.png'), made = cli('inspect', 'red.json', '--beside', 'blue.json,green.json', '--frames', 'one', '--scale', '2', '--out', 'all.png');
  assert.equal(made.status, 0, made.stderr + made.stdout);
  const reply = JSON.parse(made.stdout), alone = inspectProject(renderProject(sprite('red', '#ff0000')), { frames: ['one'], scale: 2 }).sheet;
  assert.deepEqual(reply.stack, ['red.json', 'blue.json', 'green.json'].map((name, index) => ({ name, y: index * alone.height, height: alone.height })));
  assert.deepEqual([reply.sheet.width, reply.sheet.height, reply.cells], [alone.width, alone.height * 3, ['one: 100 ms']]);
  const image = decodePNG(await readFile(out)), centre = index => pixel(image, alone.gap + 2, index * alone.height + alone.gap + 2);
  assert.deepEqual([image.width, image.height, centre(0), centre(1), centre(2)], [alone.width, alone.height * 3, [255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255]]);
  // What reads one recipe at a time is refused, and a file that is not there is named.
  const said = (...args) => { const result = cli(...args); assert.equal(result.status, 1); return result.stdout + result.stderr; };
  assert.match(said('inspect', 'red.json', '--beside', 'blue.json', '--grid'), /--beside draws several recipes in one sheet/);
  assert.match(said('inspect', 'red.json', '--beside', 'missing.json'), /missing\.json/);
  assert.match(said('inspect', 'red.json', '--beside', 'blue.json', '--motion', 'idle'), /--beside cannot be combined with --motion/);

  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', id = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, root: dir, directory: path.join(dir, 'output') }); t.after(() => input.end());
  const call = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'beside-test', version: '1' } });
  const tool = async (name, args) => { const result = (await call('tools/call', { name, arguments: args })).result; return { ...result, info: JSON.parse(result.content[0].text) }; };
  const blue = (await tool('pixel_validate', { project: sprite('blue', '#0000ff') })).info.revision, green = (await tool('pixel_validate', { project: sprite('green', '#00ff00') })).info.revision;
  const both = await tool('pixel_inspect', { project: sprite('red', '#ff0000'), beside: [blue, green], frames: ['one'], scale: 2 });
  assert.deepEqual(both.info.stack, [{ name: 'red', y: 0, height: alone.height }, { name: blue, y: alone.height, height: alone.height }, { name: green, y: alone.height * 2, height: alone.height }]);
  const picture = decodePNG(Buffer.from(both.content.find(item => item.type === 'image').data, 'base64'));
  assert.deepEqual(pixel(picture, alone.gap + 2, 2 * alone.height + alone.gap + 2), [0, 255, 0, 255]);
  const refused = await tool('pixel_inspect', { project: sprite('red', '#ff0000'), beside: ['nosuchrevision'] });
  assert.equal(refused.isError, true);
});
