// Builds the falling-sand GIFs shown in the README from examples/*.powder.json: each clip is compiled, rendered at a
// whole-number scale and encoded with exact colours. The clips are one-shot, so the last frame holds for a moment
// before it plays again. --check verifies the committed GIFs; --force replaces them.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePowder, renderProject, encodeGIF } from '../../src/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const POWDER_SHOWCASE = ['hut-fire', 'lava-falls', 'quarry-blast', 'rain-on-fire', 'stilt-hut'];
const HOLD = 1200;

// One GIF per example, at 3× (4× for the narrower ones): `recipes` may hand in recipes compiled elsewhere (the tests),
// keyed by example name.
export async function buildPowderGIFs(recipes = {}) {
  const files = new Map(), report = [];
  for (const name of POWDER_SHOWCASE) {
    const recipe = recipes[name] ?? compilePowder(JSON.parse(await readFile(path.join(root, 'examples', `${name}.powder.json`), 'utf8'))).recipe;
    const project = renderProject(recipe), [animation] = Object.values(project.animations), scale = project.width > 160 ? 3 : 4;
    const frames = animation.frames.map((index, position) => ({ data: project.frames[index].data, duration: project.frames[index].duration + (position === animation.frames.length - 1 ? HOLD : 0) }));
    const gif = encodeGIF(frames, project.width, project.height, { scale });
    files.set(`showcase/powder/${name}.gif`, Buffer.from(gif.data));
    report.push({ name, frames: frames.length, width: gif.width, height: gif.height, colors: gif.colors, bytes: gif.data.length });
  }
  return { files, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => !['--check', '--force'].includes(arg))) throw new Error('Use --check or --force.');
  const check = process.argv.includes('--check'), force = process.argv.includes('--force'), { files, report } = await buildPowderGIFs();
  if (check) {
    for (const [file, bytes] of files) if (!bytes.equals(await readFile(path.join(root, file)))) throw new Error(`Generated GIF differs: ${file}. Rebuild with node showcase/powder/build.mjs --force.`);
    console.log(`Verified ${files.size} falling-sand GIFs.`);
  } else {
    if (!force) for (const file of files.keys()) {
      try { await access(path.join(root, file)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      throw new Error(`Refusing to replace ${file}; use --force for an intentional rebuild.`);
    }
    for (const [file, bytes] of files) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), bytes, { flag: force ? 'w' : 'wx' }); }
    console.log(`Wrote ${files.size} falling-sand GIFs.`);
  }
  console.table(report);
}
