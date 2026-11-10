// Nothing is defined or imported and then never used. Many sessions edit this code, and a helper left behind by a
// change, or an import a rewrite no longer needs, is read by every agent that opens the file after.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const uses = (source, name) => (source.match(new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')) ?? []).length;

test('no top-level function, constant or import of the toolkit\'s code is named only where it is defined', () => {
  const left = [];
  for (const folder of ['src', 'bin', 'studio', 'scripts']) for (const file of readdirSync(path.join(root, folder)).filter(name => /\.m?js$/.test(name))) {
    const source = readFileSync(path.join(root, folder, file), 'utf8'), names = [];
    for (const match of source.matchAll(/^(?:async )?(?:function\*?|const|let|class) ([A-Za-z_$][\w$]*)/gm)) names.push(match[1]);
    // What one statement takes apart or imports, on one line or several: `a`, `a: b`, `a = 1`, `a as b`.
    for (const match of source.matchAll(/^(?:const|let|import) \{([^}]+)\} (?:=|from) /gm)) for (const part of match[1].split(',')) {
      const name = part.split(/ as |:/).pop().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
    for (const match of source.matchAll(/^import ([A-Za-z_$][\w$]*)(?:,| from)/gm)) names.push(match[1]);
    for (const name of new Set(names)) if (uses(source, name) === 1) left.push(`${folder}/${file}: ${name}`);
  }
  assert.deepEqual(left, []);
});
