// What routine commands print stays small. Each reply here once ran to tens of kilobytes (a palette patch of the fox:
// 23 KB, the same lines for each of 45 frames) or could again with one careless field; an agent reads every byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('compile, patch, inspect, render and autotile reply in a few kilobytes for a 45-frame character and a 151-tile set', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-replies-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = (...args) => { const run = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), ...args], { cwd: dir, encoding: 'utf8' }); assert.equal(run.status, 0, `${args.join(' ')}\n${run.stderr}`); return run.stdout; };
  const example = name => path.join(root, 'examples', name), sizes = {};
  const said = (label, limit, ...args) => { const reply = cli(...args); sizes[label] = Buffer.byteLength(reply); assert.ok(sizes[label] <= limit, `${label}: ${sizes[label]} bytes, over ${limit}`); return JSON.parse(reply); };
  assert.equal(said('compile', 1536, 'compile', example('fox.poses.json'), '--out', 'fox.json').frames, 45);
  await writeFile(path.join(dir, 'white.json'), JSON.stringify([{ set: 'palette.o', value: '#d8e0ea' }, { set: 'palette.y', value: '#f4f8fc' }, { set: 'palette.r', value: '#b4bfcf' }]));
  assert.equal(said('patch', 2048, 'patch', 'fox.json', '--changes', 'white.json', '--out', 'white-fox.json').frames.changed.count, 45);
  said('inspect', 5120, 'inspect', 'fox.json', '--diagnostics', '--palette', '--out', 'fox.png');
  said('render', 2560, 'render', 'fox.json', '--out', 'fox-out', '--look');
  said('autotile', 2048, 'autotile', example('ground.autotile.json'), '--out', 'ground.json');
  t.diagnostic(`reply bytes: ${JSON.stringify(sizes)}`);
});
