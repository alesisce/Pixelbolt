// Every module a studio page loads is on the studio's allowlist, served with a type the browser runs, and is the file
// of that name in this checkout. Release 0.13 shipped labs whose engine imported territory.js, which the studio did not
// serve; only the browser walk (scripts/qa-studio.mjs) caught it. This follows the same imports with fetch, from each
// page in studio/ to the last module it reaches, against a studio started here on a free port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudio } from '../src/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Static imports and re-exports, also over several lines: `import { a } from '…'`, `import '…'`, `export * from '…'`.
const IMPORTS = /^[ \t]*(?:import|export)\s[^;'"`]*?\bfrom\s*(['"])([^'"]+)\1|^[ \t]*import\s*(['"])([^'"]+)\3/gm;
const imports = text => [...text.matchAll(IMPORTS)].map(match => match[2] ?? match[4]);
// What a page loads from its markup: scripts and stylesheets, whatever order their attributes come in.
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1] ?? null;
const pageAssets = html => [
  ...[...html.matchAll(/<script\b[^>]*>/g)].map(([tag]) => attribute(tag, 'src')),
  ...[...html.matchAll(/<link\b[^>]*>/g)].filter(([tag]) => attribute(tag, 'rel') === 'stylesheet').map(([tag]) => attribute(tag, 'href'))
].filter(Boolean);
// The studio serves src/ and studio/ side by side at its root, so a path names a file in exactly one of them.
function checkoutFile(pathname) {
  const found = ['src', 'studio'].map(folder => path.posix.join(folder, ...pathname.split('/').filter(Boolean))).filter(file => existsSync(path.join(root, file)));
  assert.equal(found.length, 1, `${pathname} should name one file in src/ or studio/, not ${found.length ? found.join(' and ') : 'none'}`);
  return found[0];
}
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };

test('every script, stylesheet and module a studio page reaches is served, as the file of its name', async t => {
  const server = await startStudio({ port: 0, quiet: true });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`, served = new Map();
  // Fetches a path once: it must be on the allowlist, typed so the browser uses it (the studio sends nosniff, so a
  // module or stylesheet with another type is refused), and byte for byte the checkout's file.
  async function fetched(pathname, from) {
    if (served.has(pathname)) return served.get(pathname);
    const response = await fetch(origin + pathname), body = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200, `${from} loads ${pathname}, which the studio does not serve`);
    const type = TYPES[path.extname(pathname) || '.html'];
    assert.ok(response.headers.get('content-type')?.startsWith(type), `${pathname} is served as ${response.headers.get('content-type')}, not ${type}`);
    const file = pathname === '/' ? 'studio/index.html' : checkoutFile(pathname);
    assert.ok(body.equals(await readFile(path.join(root, file))), `${pathname} is served, but not from ${file}`);
    const text = body.toString('utf8');
    served.set(pathname, text);
    return text;
  }
  // Follows a module's static imports as the browser resolves them: against the address it was served from.
  async function walk(pathname, from, reached) {
    const text = await fetched(pathname, from);
    if (reached.has(pathname)) return;
    reached.add(pathname);
    if (!pathname.endsWith('.js')) return;
    for (const specifier of imports(text)) {
      const url = new URL(specifier, origin + pathname);
      assert.equal(url.origin, origin, `${pathname} imports ${specifier} from another address`);
      await walk(url.pathname, pathname, reached);
    }
  }
  const pages = (await readdir(path.join(root, 'studio'))).filter(name => name.endsWith('.html')).sort();
  assert.ok(pages.includes('powder.html') && pages.length >= 5, pages.join(', '));
  const summary = [];
  for (const page of pages) {
    const address = page === 'index.html' ? '/' : `/${page}`, html = await fetched(address, 'the studio'), reached = new Set();
    const assets = pageAssets(html).map(href => new URL(href, origin + address));
    assert.ok(assets.some(url => url.pathname.endsWith('.js')), `${page} loads no script`);
    for (const url of assets) {
      assert.equal(url.origin, origin, `${page} loads ${url.href} from another address`);
      await walk(url.pathname, page, reached);
    }
    // The walk followed imports past the page's own script (a page with one module would be a regex gone wrong).
    const modules = [...reached].filter(name => name.endsWith('.js'));
    assert.ok(modules.length > 1, `${page} reaches only ${modules.join(', ')}`);
    summary.push(`${page}: ${modules.length} modules`);
  }
  t.diagnostic(summary.join('; '));
});

test('the import reader finds imports written over several lines, re-exports and bare imports, and skips comments', () => {
  const text = [
    "import { a } from './a.js';",
    'import {',
    '  b,',
    '  c',
    "} from '/b.js';",
    "import './c.js';",
    "export { d } from './d.js';",
    "export * from \"./e.js\";",
    "// import { f } from './f.js';",
    " * import { g } from './g.js';",
    "export const from = 'h.js';",
    "const x = `",
    "text from 'i.js'`;"
  ].join('\n');
  assert.deepEqual(imports(text), ['./a.js', '/b.js', './c.js', './d.js', './e.js']);
});
