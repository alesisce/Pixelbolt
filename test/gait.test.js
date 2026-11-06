import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePoses } from '../src/authoring.js';
import { renderProject, describeStampRecipe, parseColor } from '../src/core.js';
import { plainRig } from '../scripts/figure-rigs.mjs';

// What makes a walk or run read as one, measured on the plain side-view humanoid (the hero example's figure). It
// faces right and travels right, so a larger arm angle swings the arm back.
const { recipe, metadata } = compilePoses(plainRig());
const pose = name => metadata.poses[name].parts;
const restArm = pose('stand').nearUpper.worldAngle;
const legLength = (() => {
  const { nearThigh, nearShin } = pose('stand');
  return Math.hypot(nearShin.joints.end[0] - nearThigh.joints.start[0], nearShin.joints.end[1] - nearThigh.joints.start[1]);
})();

for (const gait of ['walk', 'run']) {
  test(`${gait}: at each contact the arm on the leading leg's side is back and its partner forward, and they come together as the legs pass`, () => {
    for (const [suffix, lead, trail] of [['a', 'near', 'far'], ['b', 'far', 'near']]) {
      const parts = pose(`${gait}-contact-${suffix}`);
      assert.ok(parts[`${lead}Shin`].joints.end[0] > parts[`${trail}Shin`].joints.end[0], `${suffix}: the ${lead} foot leads`);
      assert.ok(parts[`${lead}Upper`].worldAngle >= restArm + 20, `${suffix}: the ${lead} arm swings back`);
      assert.ok(parts[`${trail}Upper`].worldAngle <= restArm - 20, `${suffix}: the ${trail} arm swings forward`);
      // The elbow bends coming forward: the forward forearm turns further forward than its upper arm.
      const bend = ((parts[`${trail}Fore`].worldAngle - parts[`${trail}Upper`].worldAngle) % 360 + 540) % 360 - 180;
      assert.ok(bend < -15, `${suffix}: the forward elbow bends (${bend}°)`);
    }
    for (const suffix of ['a', 'b']) {
      const apart = name => Math.abs(pose(name).nearUpper.worldAngle - pose(name).farUpper.worldAngle);
      assert.ok(apart(`${gait}-passing-${suffix}`) * 2 < apart(`${gait}-contact-${suffix}`), `passing-${suffix}: the arms come together as the legs pass`);
    }
  });
}

test('walk: contacts are centred under the hip with long legs, the body dips after each contact, and the lifted foot leaves behind and lands from in front', () => {
  for (const suffix of ['a', 'b']) {
    const parts = pose(`walk-contact-${suffix}`), hip = parts.nearThigh.joints.start;
    const feet = ['near', 'far'].map(side => parts[`${side}Shin`].joints.end);
    const ahead = Math.max(...feet.map(f => f[0])) - hip[0], behind = hip[0] - Math.min(...feet.map(f => f[0]));
    assert.ok(Math.abs(ahead - behind) <= 1, `contact-${suffix}: feet ${ahead} ahead and ${behind} behind the hip`);
    // Both legs are planted and nearly straight: the body has not sunk into a crouch.
    for (const foot of feet) assert.ok(Math.hypot(foot[0] - hip[0], foot[1] - hip[1]) >= legLength - 1, `contact-${suffix}: a planted leg is long`);
    assert.deepEqual(metadata.poses[`walk-contact-${suffix}`].contacts.toSorted(), ['farShinFoot', 'nearShinFoot']);
    const down = pose(`walk-down-${suffix}`).nearThigh.joints.start, passing = pose(`walk-passing-${suffix}`).nearThigh.joints.start;
    assert.ok(down[1] > hip[1], `down-${suffix} is lower than contact`);
    assert.ok(passing[1] < down[1], `passing-${suffix} rises from down`);
  }
  // The far leg lifts after contact-a and lands at contact-b: behind the hip when it leaves, ahead before it lands.
  const order = recipe.animations.walk.frames, lifted = order.slice(1, order.indexOf('walk-contact-b'))
    .filter(name => !metadata.poses[name].contacts.includes('farShinFoot'));
  assert.ok(lifted.length >= 2);
  const at = name => { const parts = pose(name); return parts.farShin.joints.end[0] - parts.farThigh.joints.start[0]; };
  assert.ok(at(lifted[0]) < 0, `${lifted[0]}: the lifted foot starts behind the hip`);
  assert.ok(at(lifted.at(-1)) > 0, `${lifted.at(-1)}: it reaches forward before landing`);
});

// A bone across a mass, so the bone's outline crosses the body: once in the pose as written, once mirrored.
const crossing = innerLines => ({
  format: 'pixelforge-poses', version: 1, name: 'crossing', width: 24, height: 24, ...(innerLines && { innerLines }),
  palette: { k: '#101018', a: '#402020', b: '#804040', c: '#c06060' }, ramps: [['a', 'b', 'c']],
  parts: {
    body: { mass: { size: [10, 12], ramp: 0, base: 1, outline: 'k' } },
    arm: { bone: { length: 8, width: [2, 2], ramp: 0, base: 2, outline: 'k' }, points: { end: 'end' } }
  },
  poses: [
    { name: 'cross', origin: [12, 12], parts: [{ name: 'body', part: 'body' }, { name: 'arm', part: 'arm', at: [-3, -4], angle: 60 }] },
    { name: 'mirrored', mirror: 'cross' }
  ]
});
const key = (palette, name) => parseColor(palette[name]).join();
const outlineInside = (project, palette) => project.frames.map(frame => {
  const w = project.width, h = project.height, rgba = (x, y) => [...frame.data.slice((y * w + x) * 4, (y * w + x) * 4 + 4)].join();
  const empty = (x, y) => x < 0 || y < 0 || x >= w || y >= h || frame.data[(y * w + x) * 4 + 3] === 0;
  let inside = 0, shade = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba(x, y) === key(palette, 'k') && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => empty(x + dx, y + dy))) inside++;
    if (rgba(x, y) === key(palette, 'b')) shade++;
  }
  return { frame: frame.name, inside, shade };
});

test('a figure keeps one outline round its silhouette: an outline inside it takes the ramp step below the base, mirrored too', () => {
  const source = crossing(), { recipe } = compilePoses(source);
  for (const { frame, inside } of outlineInside(renderProject(recipe), source.palette)) assert.equal(inside, 0, `${frame}: no outline colour inside the figure`);
  for (const frame of recipe.frames) {
    assert.ok(frame.pixels?.length > 0, `${frame.name}: the arm's inner outline is drawn as final pixels`);
    // The arm's base is c, so its inner line is b.
    assert.ok(frame.pixels.every(pixel => pixel.color === 'b'), frame.name);
  }
  // innerLines: "outline" keeps the outline colour inside the figure, as before.
  const kept = crossing('outline'), black = compilePoses(kept).recipe;
  assert.ok(black.frames.every(frame => frame.pixels === undefined));
  for (const { frame, inside } of outlineInside(renderProject(black), kept.palette)) assert.ok(inside > 0, `${frame}: the outline crosses the body`);
  assert.throws(() => compilePoses(crossing('none')), /poses\.innerLines/);
});

test('a compiled stamp recipe accepts final pixels in palette keys inside the canvas, and reports a bad one by path', () => {
  const base = { version: 1, name: 'stamped', width: 4, height: 4, palette: { k: '#000000' }, symbols: { dot: ['k'] },
    frames: [{ name: 'only', layers: [{ name: 'dot', ops: [{ op: 'stamp', symbol: 'dot', x: 1, y: 1 }] }] }] };
  const frame = pixels => ({ ...base, frames: [{ ...base.frames[0], pixels }] });
  assert.equal(describeStampRecipe(frame([{ x: 2, y: 2, color: 'k' }])).frames.length, 1);
  assert.throws(() => describeStampRecipe(frame([{ x: 2, y: 2, color: '#ffffff' }])), /project\.frames\[0\]\.pixels\[0\]\.color/);
  assert.throws(() => describeStampRecipe(frame([{ x: 4, y: 0, color: 'k' }])), /project\.frames\[0\]\.pixels\[0\]\.x/);
});
