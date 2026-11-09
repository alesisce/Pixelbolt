// A recipe on a canvas of another size: the same drawing, cut to a window or given margins, never scaled. The window
// is chosen from what the frames draw (the one holding the most drawn pixels), every operation moves by one whole
// offset, and the result renders exactly as that window of the original does. Browser-compatible.
import { PixelError, CANVAS_SIDE, FRAME_AREA, renderProject } from './core.js';

const fail = (path, message) => { throw new PixelError(path, message); };

// "32x32", "32×32" or [32, 32].
export function readSize(value, path = 'size') {
  const parts = typeof value === 'string' ? /^(\d{1,4})[x×](\d{1,4})$/i.exec(value.trim())?.slice(1).map(Number) : value;
  if (!Array.isArray(parts) || parts.length !== 2 || parts.some(side => !Number.isInteger(side) || side < 1 || side > CANVAS_SIDE)) {
    fail(path, `expected a canvas size such as "32x32", each side from 1 to ${CANVAS_SIDE}`);
  }
  return parts;
}

// Where the new canvas starts along one axis, in the old canvas's pixels (negative when it grows). `drawn` counts the
// drawn pixels of every frame per column or row. A smaller canvas takes the window with the most of them; a tie, and
// a larger canvas, keep an edge the drawing touches as an edge (a floor stays the floor) and centre otherwise.
function start(drawn, size) {
  const old = drawn.length, low = drawn[0] > 0, high = drawn[old - 1] > 0;
  const preferred = high && !low ? old - size : low && !high ? 0 : Math.floor((old - size) / 2);
  if (size >= old) return preferred;
  let sum = 0;
  for (let i = 0; i < size; i++) sum += drawn[i];
  let best = 0, most = sum;
  for (let at = 1; at + size <= old; at++) {
    sum += drawn[at + size - 1] - drawn[at - 1];
    if (sum > most || (sum === most && Math.abs(at - preferred) <= Math.abs(best - preferred))) { best = at; most = sum; }
  }
  return best;
}

// Operations that only place something: they move with the canvas. The rest read the whole canvas (an outline, a
// flood fill, a dither's pattern), so the same operation on another canvas would draw something else.
const PLACED = new Set(['pixel', 'rect', 'ellipse', 'line', 'clear', 'grid', 'stamp', 'text', 'copy', 'autotile', 'box', 'tilemap', 'replace']);

function moveOps(ops, dx, dy, path, option) {
  return ops.map((op, index) => {
    const p = `${path}[${index}]`;
    if (!PLACED.has(op.op) || (op.op === 'copy' && op.symbol === undefined)) {
      fail(option, `${p} is ${op.op === 'copy' ? 'a copy from another frame' : `"${op.op}"`}, which reads the whole canvas, so this recipe cannot move to another canvas size; change the size in its source instead`);
    }
    if (op.op === 'replace') return op;
    const moved = { ...op, x: (op.x ?? 0) + dx, y: (op.y ?? 0) + dy };
    if (op.op === 'line') { moved.x2 = (op.x2 ?? op.x ?? 0) + dx; moved.y2 = (op.y2 ?? op.y ?? 0) + dy; }
    if (op.ground !== undefined) moved.ground = op.ground + dy;
    return moved;
  });
}

// { recipe, resized: { from, offset, cut } }: `offset` is where the new canvas starts in the old one, `cut` the share
// of the drawn pixels (over every frame) that the new canvas leaves out.
export function resizeRecipe(recipe, size, path = 'size') {
  const [width, height] = readSize(size, path), project = renderProject(recipe), { width: oldWidth, height: oldHeight } = project;
  if (width * height * project.frames.length > FRAME_AREA) fail(path, `${project.frames.length} frames of ${width}×${height} pixels exceed the ${FRAME_AREA.toLocaleString('en-US')}-pixel limit on a recipe's frames`);
  const columns = new Array(oldWidth).fill(0), rows = new Array(oldHeight).fill(0);
  for (const frame of project.frames) {
    for (let y = 0; y < oldHeight; y++) for (let x = 0; x < oldWidth; x++) if (frame.data[(y * oldWidth + x) * 4 + 3]) { columns[x]++; rows[y]++; }
  }
  const ox = start(columns, width), oy = start(rows, height), dx = -ox, dy = -oy;
  let total = 0, kept = 0;
  for (const frame of project.frames) {
    for (let y = 0; y < oldHeight; y++) for (let x = 0; x < oldWidth; x++) if (frame.data[(y * oldWidth + x) * 4 + 3]) {
      total++;
      if (x >= ox && x < ox + width && y >= oy && y < oy + height) kept++;
    }
  }
  // Drawing the old canvas clipped would show in a new margin: clear the margins after everything else is drawn.
  const margins = project.clipping ? [
    oy < 0 && { op: 'clear', x: 0, y: 0, w: width, h: dy },
    oy + height > oldHeight && { op: 'clear', x: 0, y: dy + oldHeight, w: width, h: height - dy - oldHeight },
    ox < 0 && { op: 'clear', x: 0, y: 0, w: dx, h: height },
    ox + width > oldWidth && { op: 'clear', x: dx + oldWidth, y: 0, w: width - dx - oldWidth, h: height }
  ].filter(Boolean) : [];
  const point = ([x, y]) => [x + dx, y + dy];
  const frames = recipe.frames.map((frame, index) => {
    const p = `frames[${index}]`;
    // A frame moved after it is drawn brings in what lay beside the window, which the new canvas never drew.
    for (const key of ['flipX', 'flipY', 'wrap', 'tile', 'translate']) {
      if (key === 'translate' ? frame.translate?.some(Boolean) : frame[key]) fail(path, `${p}.${key} is tied to the canvas size, so this recipe cannot move to another one; change the size in its source instead`);
    }
    const ops = [...moveOps(frame.ops ?? [], dx, dy, `${p}.ops`, path), ...margins];
    return {
      ...frame,
      ...(frame.anchor && { anchor: point(frame.anchor) }),
      ...(frame.points && { points: Object.fromEntries(Object.entries(frame.points).map(([name, at]) => [name, point(at)])) }),
      ...((frame.ops || ops.length > 0) && { ops }),
      ...(frame.layers && { layers: frame.layers.map((layer, li) => ({ ...layer, ...(layer.ops && { ops: moveOps(layer.ops, dx, dy, `${p}.layers[${li}].ops`, path) }) })) }),
      // Corrections are single canvas pixels, and one outside the canvas is an error, so those cut off are left out.
      ...(frame.pixels && { pixels: frame.pixels.map(pixel => ({ ...pixel, x: pixel.x + dx, y: pixel.y + dy })).filter(pixel => pixel.x >= 0 && pixel.y >= 0 && pixel.x < width && pixel.y < height) })
    };
  });
  return {
    recipe: { ...recipe, width, height, ...(recipe.anchor && { anchor: point(recipe.anchor) }), frames },
    resized: { from: [oldWidth, oldHeight], offset: [ox, oy], cut: total === kept ? 0 : Math.max(0.001, Math.round((total - kept) / total * 1000) / 1000) }
  };
}

// What a reply says about a resize: nothing when the whole drawing is kept.
export function resizeWarning({ from, cut }, [width, height]) {
  if (!cut) return null;
  const share = cut < 0.01 ? 'under 1%' : `${Math.round(cut * 100)}%`;
  return `The ${width}×${height} canvas leaves out ${share} of what the ${from[0]}×${from[1]} drawing draws (cut, not scaled): inspect it before delivering, and say so if it shows.`;
}
