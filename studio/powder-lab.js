// The Powder lab: a falling-sand sandbox running src/powder.js's live grid in this page, 60 steps a second. Pick a
// material or a tool and drag on the grid; pause, step and restart; open the shipped presets; copy a link that replays
// every stroke on its frame; and bake a scene's own clip to a GIF or recipe, beside the matching command line and MCP
// calls. Scenes, brushes, links and commands live in powder-controls.js, which Node tests run as they are.
import { createLivePowder, applyStroke, packStrokes, unpackStrokes, compilePowder, SANDBOX } from '/powder.js';
import { renderProject } from '/core.js';
import { animationGIF } from '/gif.js';
import { POWDER_SCENES, SANDBOX_SOURCE, POWDER_TOOLS, brushInput, heldTool, callText, inputText, powderCommands, pixelDigest, fitReplayLink, readReplayLink, sceneById, BLAST } from '/powder-controls.js';

const $ = id => document.getElementById(id);
const canvas = $('canvas'), context = canvas.getContext('2d'), overlay = $('overlay'), ink = overlay.getContext('2d');
const STEP_MS = 1000 / 60, reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// While paused, strokes wait for the next step; past this many the brush stops until a step (the grid queues 4,096).
const MOST_WAITING = 1024;
const title = name => name.charAt(0).toUpperCase() + name.slice(1);
let scene = null, source = null, table = {}, live = null, image = null, zoom = 1;
let playing = !reducedMotion, clock = null, brush = 'sand', pointer = null, last = null, pressedAt = -1, hover = null, waiting = [];
let stepMs = 0, drawMs = 0, statusAt = -Infinity, baked = null, version = 0, busy = false, toastTimer;

function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000); }
function notice(message) { $('notice').textContent = message ?? ''; $('notice').hidden = !message; }
function failed(error) { $('error').textContent = error.message; $('error').hidden = false; }
function download(data, filename, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
// The table a source draws from: the starter table under a `base: "sandbox"` source's own materials.
const materialsOf = value => (value.base === 'sandbox' ? { ...SANDBOX.materials, ...value.materials } : value.materials ?? {});
const radius = () => Number($('radius').value), spray = () => Number($('spray').value) / 100;

// ---- Drawing ----
function draw() {
  const started = performance.now();
  live.render(image.data); context.putImageData(image, 0, 0);
  drawMs = drawMs * 0.9 + (performance.now() - started) * 0.1;
  $('frame').textContent = `Frame ${live.frame.toLocaleString('en')}`;
  drawOverlay();
  if (!playing || live.frame - statusAt >= 15) showStatus();
}
function showStatus() {
  statusAt = live.frame;
  const { counts, burning, chunks } = live.measure(), cells = live.width * live.height - (counts.empty ?? 0);
  $('status').textContent = `${cells.toLocaleString('en')} cells of material${burning ? `, ${burning.toLocaleString('en')} burning` : ''} · ${chunks.stepped} of ${chunks.of} chunks awake · step ${stepMs.toFixed(2)} ms, draw ${drawMs.toFixed(2)} ms in this browser`;
  showRecorded();
}
const showRecorded = () => { $('recorded').textContent = `${live.strokes.length.toLocaleString('en')} ${live.strokes.length === 1 ? 'stroke' : 'strokes'} recorded`; };
// Over the grid, in grid cells: the strokes waiting for a step while paused, and the brush under the pointer. The
// overlay is a canvas of its own, so the grid's canvas holds exactly the pixels the engine drew.
function drawOverlay() {
  const ratio = overlay.width / live.width;
  ink.setTransform(1, 0, 0, 1, 0, 0); ink.clearRect(0, 0, overlay.width, overlay.height); ink.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (!playing) for (const { x, y, x2 = x, y2 = y, radius: r, colour } of waiting) {
    ink.fillStyle = ink.strokeStyle = colour;
    for (const [cx, cy] of [[x, y], [x2, y2]]) { ink.beginPath(); ink.arc(cx, cy, r, 0, Math.PI * 2); ink.fill(); }
    if (x2 !== x || y2 !== y) { ink.lineWidth = r * 2; ink.beginPath(); ink.moveTo(x, y); ink.lineTo(x2, y2); ink.stroke(); }
  }
  if (hover) {
    const reach = brush === 'blast' ? radius() + BLAST.extra : brush === 'wind' ? radius() + 4 : radius();
    ink.lineWidth = 1.5 * live.width / (overlay.clientWidth || live.width); ink.strokeStyle = '#ffffff';
    ink.beginPath(); ink.arc(hover.x, hover.y, reach, 0, Math.PI * 2); ink.stroke();
  }
}
function fit() {
  if (!live) return;
  const choice = $('scale').value;
  if (choice === 'fit') {
    const box = $('preview'), style = getComputedStyle(box), across = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const down = Math.max(240, window.innerHeight - box.getBoundingClientRect().top - 170);
    zoom = Math.max(1, Math.min(8, Math.floor(Math.min(across / live.width, down / live.height))));
  } else zoom = Number(choice);
  const ratio = Math.min(4, window.devicePixelRatio || 1);
  for (const element of [canvas, overlay]) { element.style.width = `${live.width * zoom}px`; element.style.height = `${live.height * zoom}px`; }
  overlay.width = Math.round(live.width * zoom * ratio); overlay.height = Math.round(live.height * zoom * ratio);
  commands(); drawOverlay();
}

// ---- Stepping and the brush ----
function advance() {
  // A held brush works on every step, from where the pointer was at the last one; a press already made its own stroke.
  if (pointer && heldTool(brush) && !(pressedAt === live.frame && pointer === last)) stroke(pointer, last ?? pointer);
  last = pointer;
  const started = performance.now();
  live.step();
  stepMs = stepMs * 0.9 + (performance.now() - started) * 0.1;
  waiting = [];
}
function frame(now) {
  if (playing && live && !busy) {
    // Fixed steps at 60 a second whatever the display's rate; after a stall it carries on rather than catching up.
    if (clock === null || now - clock > 250) clock = now - STEP_MS;
    let steps = 0;
    while (now - clock >= STEP_MS - 1 && steps < 3) { advance(); clock += STEP_MS; steps++; }
    if (steps) draw();
  } else clock = null;
  requestAnimationFrame(frame);
}
// A brush's colour: a tool's own, or the colour a material reads as: a cloud's thick end (its ramp runs thin to thick),
// a liquid's surface line, or its first colour.
const colourOf = name => {
  if (name === 'erase') return live.backgroundColor ?? '#000000';
  const tool = POWDER_TOOLS.find(entry => entry.id === name), material = table[name], colors = material?.colors ?? ['#ffffff'];
  return tool?.colour ?? (material?.colorBy === 'density' ? colors[Math.floor(colors.length * 2 / 3)] : material?.top ?? colors[0]);
};
function stroke(at, from) {
  const made = brushInput(brush, at, from, { radius: radius(), spray: spray(), solid: table[brush]?.state === 'solid' });
  if (!made) return;
  if (!playing && waiting.length >= MOST_WAITING) { toast('Step or play to apply the strokes waiting.'); return; }
  const [action, input] = made, frameMade = live.frame;
  try { live[action](input); } catch (error) { toast(error.message); return; }
  waiting.push({ ...input, colour: colourOf(action === 'paint' ? input.material : brush) });
  $('stroke').textContent = `${callText(action, input)}\n${inputText(frameMade, action, input)}`;
  showRecorded();
}
const cellAt = event => {
  const box = canvas.getBoundingClientRect(), clamp = (value, most) => Math.max(0, Math.min(most - 1, value));
  return { x: clamp(Math.floor((event.clientX - box.left) / box.width * live.width), live.width) + 0.5, y: clamp(Math.floor((event.clientY - box.top) / box.height * live.height), live.height) + 0.5 };
};
function readout(at) {
  if (!at) { $('readout').textContent = 'Point at the grid to read a cell.'; return; }
  const x = Math.floor(at.x), y = Math.floor(at.y), cell = live.at(x, y);
  $('readout').textContent = `x ${x}, y ${y} · ${cell.material === 'empty' ? 'air' : cell.material}${cell.burning ? ', burning' : ''} · ${Math.round(cell.temperature)}°`;
}
canvas.addEventListener('pointerdown', event => {
  if (!live || busy || event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  const at = cellAt(event);
  pointer = last = hover = at; pressedAt = live.frame;
  stroke(at, at);
  drawOverlay();
});
canvas.addEventListener('pointermove', event => {
  if (!live || busy) return;
  const at = cellAt(event);
  hover = at; readout(at);
  if (pointer) {
    // Paused, a drag lays its stroke at once (it lands on the next step); playing, the next step strokes to here.
    const from = last ?? pointer;
    if (!playing && heldTool(brush) && (at.x !== from.x || at.y !== from.y)) { stroke(at, from); last = at; }
    pointer = at;
  }
  drawOverlay();
});
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, () => { pointer = last = null; });
canvas.addEventListener('pointerleave', () => { if (!pointer) { hover = null; readout(null); if (live) drawOverlay(); } });

// ---- Brushes ----
function brushButton(id, label, colour, hint) {
  const button = document.createElement('button'), chip = document.createElement('span'), name = document.createElement('span');
  button.type = 'button'; button.dataset.brush = id; button.title = hint; button.setAttribute('aria-pressed', 'false');
  chip.className = id === 'erase' ? 'chip erase' : 'chip'; if (id !== 'erase') chip.style.background = colour; chip.setAttribute('aria-hidden', 'true');
  name.textContent = label; button.append(chip, name);
  button.addEventListener('click', () => choose(id));
  return button;
}
function showBrushes() {
  // Every material of the scene's table but the wall, which is a tool of its own.
  const names = live.materials.filter(name => name !== (source.wall ?? 'wall'));
  $('materials').replaceChildren(...names.map(name => brushButton(name, title(name), colourOf(name), `${title(name)} · ${table[name]?.state ?? 'material'}`)));
  $('tools').replaceChildren(...POWDER_TOOLS.map(tool => brushButton(tool.id, tool.title, colourOf(tool.id), tool.hint)));
  choose(names.includes(brush) || POWDER_TOOLS.some(tool => tool.id === brush) ? brush : names[0]);
}
function choose(id) {
  brush = id;
  for (const button of document.querySelectorAll('[data-brush]')) button.setAttribute('aria-pressed', String(button.dataset.brush === id));
  $('brush-name').textContent = POWDER_TOOLS.find(tool => tool.id === id)?.title ?? title(id);
  if (live) drawOverlay();
}

// ---- Scenes and replays ----
function playState() { $('play').textContent = playing ? 'Ⅱ' : '▶'; $('play').setAttribute('aria-label', playing ? 'Pause simulation' : 'Play simulation'); }
function setBusy(value) {
  busy = value;
  for (const id of ['play', 'step', 'restart', 'link', 'gif', 'recipe', 'powder-source']) $(id).disabled = value;
  if (!value) for (const id of ['gif', 'recipe']) $(id).disabled = !scene?.file;
}
function commands() {
  if (!scene) return;
  const { cli, mcp } = powderCommands(scene, zoom);
  $('cli').textContent = cli.join('\n'); $('mcp').textContent = mcp.join('\n');
}
async function open(entry, link = null) {
  const mine = ++version;
  setBusy(true); notice(null); $('error').hidden = true;
  $('status').textContent = link ? 'Opening the replay…' : 'Loading…';
  try {
    let loaded = structuredClone(SANDBOX_SOURCE);
    if (entry.file) {
      const response = await fetch(`/examples/${entry.file}.powder.json`);
      if (!response.ok) throw new Error(`Could not load ${entry.title}: HTTP ${response.status}`);
      loaded = await response.json();
    }
    if (mine !== version) return;
    scene = entry; source = loaded; table = materialsOf(source); baked = null;
    live = createLivePowder(source, { record: true }); image = new ImageData(live.width, live.height);
    canvas.width = live.width; canvas.height = live.height;
    pointer = last = hover = null; waiting = []; clock = null; statusAt = -Infinity;
    $('name').textContent = entry.title; $('size').textContent = `${live.width} × ${live.height} px`;
    $('kind').textContent = entry.file ? `Falling sand · examples/${entry.file}.powder.json` : 'Falling sand · the starter table';
    for (const button of document.querySelectorAll('#scenes .example')) { const active = button.dataset.scene === entry.id; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
    $('bake-note').textContent = entry.file
      ? 'The scene\'s own clip, compiled here exactly as the command line compiles it. Your strokes are not part of it.'
      : 'The sandbox has no scripted inputs, so its clip would stand still. Download its source, add inputs (your last stroke above is one) and compile it.';
    $('link-text').value = ''; $('stroke').textContent = 'Paint on the grid to see it here.';
    showBrushes(); fit();
    if (link?.packed) { if (!await replay(link, mine)) return; }
    else history.replaceState(null, '', `#${entry.id}`);
    draw(); showStatus();
  } catch (error) { if (mine === version) failed(error); }
  finally { if (mine === version) setBusy(false); }
}
// Replays a link's strokes, each on its frame, a slice at a time so the page keeps drawing; strokes made after the
// last step wait for the next one, as they did for the sender. Ends paused, at the frame the link was made.
async function replay(link, mine) {
  const { frames, strokes } = unpackStrokes(link.packed);
  if (strokes.length && strokes.at(-1).f > frames) throw new Error('This link is damaged: a stroke comes after its last frame.');
  playing = false; playState();
  let at = 0;
  while (live.frame < frames) {
    const until = performance.now() + 30;
    do { while (at < strokes.length && strokes[at].f === live.frame) applyStroke(live, strokes[at++]); live.step(); } while (live.frame < frames && performance.now() < until);
    draw();
    $('status').textContent = `Replaying ${strokes.length.toLocaleString('en')} strokes: frame ${live.frame.toLocaleString('en')} of ${frames.toLocaleString('en')}…`;
    await new Promise(resolve => setTimeout(resolve, 0));
    if (mine !== version) return false;
  }
  for (; at < strokes.length; at++) { const s = strokes[at]; applyStroke(live, s); waiting.push({ ...s, colour: colourOf(s.op === 0 ? live.materials[s.m - 1] : ['paint', 'erase', 'wall', s.amount < 0 ? 'cool' : 'heat', 'wind', 'blast'][s.op]) }); }
  const told = `Replayed ${strokes.length.toLocaleString('en')} ${strokes.length === 1 ? 'stroke' : 'strokes'} over ${frames.toLocaleString('en')} frames`;
  if (!link.digest) notice(`${told}. Press play to carry on.`);
  else if (pixelDigest(live.render().rgba) === link.digest) notice(`${told}: the same pixels the sender saw. Press play to carry on.`);
  else notice(`${told}, but the pixels differ from the sender's: the link was probably made with another version of Pixelbolt.`);
  return true;
}
async function fromHash() {
  try {
    const link = await readReplayLink(location.hash);
    if (link) return open(sceneById(link.scene), link);
  } catch (error) { failed(error); }
  return open(sceneById(location.hash.slice(1)) ?? POWDER_SCENES[0]);
}

// ---- Baking ----
async function bake() {
  if (baked?.scene === scene.id) return baked;
  setBusy(true); $('status').textContent = `Compiling ${scene.title}…`;
  await new Promise(resolve => setTimeout(resolve, 30));
  try {
    const started = performance.now(), { recipe } = compilePowder(source), project = renderProject(recipe);
    baked = { scene: scene.id, recipe, project, clip: Object.keys(recipe.animations)[0], ms: Math.round(performance.now() - started) };
    return baked;
  } finally { setBusy(false); showStatus(); }
}

for (const entry of POWDER_SCENES) {
  const button = document.createElement('button'), label = document.createElement('span'), strong = document.createElement('strong'), small = document.createElement('small');
  button.className = 'example'; button.dataset.scene = entry.id; button.setAttribute('aria-pressed', 'false');
  strong.textContent = entry.title; small.textContent = entry.note; label.append(strong, small); button.append(label);
  button.addEventListener('click', () => open(entry));
  $('scenes').append(button);
}
$('scene-count').textContent = String(POWDER_SCENES.length).padStart(2, '0');
$('play').addEventListener('click', () => { playing = !playing; playState(); if (live) drawOverlay(); });
$('step').addEventListener('click', () => { if (!live || busy) return; playing = false; playState(); advance(); draw(); });
$('restart').addEventListener('click', () => { if (scene) open(scene); });
$('scale').addEventListener('change', fit);
window.addEventListener('resize', () => { if ($('scale').value === 'fit') fit(); });
$('radius').addEventListener('input', () => { $('radius-out').value = $('radius').value; if (live) drawOverlay(); });
$('spray').addEventListener('input', () => { $('spray-out').value = `${$('spray').value}%`; });
$('link').addEventListener('click', async () => {
  if (!live || busy) return;
  try {
    const made = await fitReplayLink(`${location.origin}${location.pathname}`, { scene: scene.id, strokes: live.strokes.slice(), frames: live.frame, digest: pixelDigest(live.render().rgba) }, packStrokes);
    $('link-text').value = made.link;
    const copied = await navigator.clipboard.writeText(made.link).then(() => true, () => false);
    const what = `${made.kept.toLocaleString('en')} ${made.kept === 1 ? 'stroke' : 'strokes'} over ${made.frames.toLocaleString('en')} frames, ${made.link.length.toLocaleString('en')} characters`;
    notice(`${copied ? 'Copied a link' : 'Made a link (select it to copy it)'} replaying ${what}${made.cut ? `: cut at a stroke to fit, so it stops at frame ${made.frames.toLocaleString('en')}` : ''}.`);
  } catch (error) { toast(error.message); }
});
$('gif').addEventListener('click', async () => {
  try {
    const { project, clip, ms } = await bake(), gif = animationGIF(project, clip, { scale: zoom });
    download(gif.data, `${scene.file}.gif`, 'image/gif');
    toast(`Saved ${scene.file}.gif · ${gif.width} × ${gif.height}, ${project.animations[clip].frames.length} frames, ${gif.colors} colours · compiled in ${ms} ms in this browser`);
  } catch (error) { toast(error.message); }
});
$('recipe').addEventListener('click', async () => {
  try { const { recipe } = await bake(); download(`${JSON.stringify(recipe)}\n`, `${scene.file}.json`, 'application/json'); }
  catch (error) { toast(error.message); }
});
$('powder-source').addEventListener('click', () => { if (source) download(`${JSON.stringify(source, null, 2)}\n`, `${scene.file ?? scene.id}.powder.json`, 'application/json'); });
window.addEventListener('hashchange', fromHash);
playState();
fromHash();
requestAnimationFrame(frame);
