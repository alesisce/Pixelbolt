import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', ...args], { cwd: root, encoding: 'utf8' });

// render, scene and sequence write folders. An --out named like a file would make a folder called scene.png, so it
// is refused with the option that writes that file, and nothing is written.
test('a folder --out named like a file is refused with what to use instead, and writes nothing', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-out-folder-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [args, instead] of [
    [['scene', 'examples/forest-spirit-lit.scene.json', '--out', path.join(dir, 'scene.png')], /--image <file\.png>/],
    [['render', 'examples/forest-spirit.json', '--out', path.join(dir, 'sheet.PNG')], /the sheet as <name>\.png.*pixelbolt gif --out <new\.gif>/],
    [['sequence', 'examples/forest-spirit.json', '--fps', '30', '--out', path.join(dir, 'clip.gif')], /a new folder for the numbered frames/]
  ]) {
    const out = cli(...args);
    assert.equal(out.status, 1, out.stdout);
    const { error } = JSON.parse(out.stderr);
    assert.match(error, new RegExp(`^${args[0]} --out takes a folder, and .* names a file: `));
    assert.match(error, instead);
  }
  assert.deepEqual(await readdir(dir), []);
  // A plain folder name still works.
  const fine = cli('render', 'examples/forest-spirit.json', '--out', path.join(dir, 'bundle'));
  assert.equal(fine.status, 0, fine.stderr);
});
