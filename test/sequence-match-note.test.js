import test from 'node:test';
import assert from 'node:assert/strict';
import { createBodiesSequence } from '../src/index.js';

// A bodies match written as video frames says how many of its frames fall between video frames and are never shown.
// The note is as true with a length in seconds as without one: `seconds` hid it, so a 30 frames a second clip of a
// 33 ms match lost a frame in every hundred with nothing said.
const source = (frames, duration) => ({
  format: 'pixelforge-bodies', version: 1, name: 'probe', width: 16, height: 16, palette: { k: '#000000', w: '#ffffff' },
  effects: { main: { frames, duration, background: 'k', bodies: [{ name: 'ball', shape: 'circle', radius: 2, at: [8, 4], fill: 'w' }] } }
});
const sidecar = (frames, duration, options) => JSON.parse(createBodiesSequence(source(frames, duration), options).files.get('sequence.json'));
const skipped = info => info.notes.filter(note => note.includes('fall between video frames'));
// The match frames a clip shows, worked out apart from the planner: video frame k starts at k / fps seconds and shows
// the match frame under way then; past the match's end it holds the last one.
const shown = (frames, duration, fps, count) => new Set(Array.from({ length: count }, (_, k) => Math.min(frames - 1, Math.floor(k * 1000 / (fps * duration)))));
const note = (missed, of, duration, fps) => `${missed} of the match's ${of} frames (${duration} ms each) fall between video frames at ${fps} frames per second and are not shown; give the effect a duration of at least one video frame (${Math.ceil(1000 / fps)} ms at this rate).`;

test('a match cut short by seconds still says which frames fall between video frames', () => {
  // 20 ms frames at 30 frames a second: 0.3 seconds is 9 video frames, which reach the match's 14th frame and show 9.
  const info = sidecar(30, 20, { fps: 30, seconds: 0.3 }), frames = shown(30, 20, 30, info.frames);
  assert.equal(info.frames, 9);
  assert.deepEqual([Math.max(...frames) + 1, frames.size], [14, 9]);
  assert.deepEqual(skipped(info), [note(5, 'first 14', 20, 30)]);
  // The case that was met: a 33 ms match at 30 frames a second loses one frame in about a hundred.
  const long = sidecar(120, 33, { fps: 30, seconds: 3.9 }), longFrames = shown(120, 33, 30, long.frames);
  assert.deepEqual([long.frames, Math.max(...longFrames) + 1, longFrames.size], [117, 118, 117]);
  assert.deepEqual(skipped(long), [note(1, 'first 118', 33, 30)]);
});

test('a match held past its end by seconds counts every frame it skipped', () => {
  // Two seconds of a 0.6 second match: all 30 frames are passed. 18 are shown while it runs and the last is held to
  // the end, so 19 are seen and 11 are not.
  const held = sidecar(30, 20, { fps: 30, seconds: 2 }), frames = shown(30, 20, 30, held.frames);
  assert.equal(held.frames, 60);
  assert.deepEqual([Math.max(...frames) + 1, frames.size], [30, 19]);
  assert.deepEqual(skipped(held), [note(11, 30, 20, 30)]);
  // Without seconds the note reads as it always has: the clip ends before the last frame, which is the twelfth unseen.
  const whole = sidecar(30, 20, { fps: 30 });
  assert.deepEqual([whole.frames, shown(30, 20, 30, whole.frames).size], [18, 18]);
  assert.deepEqual(skipped(whole), [note(12, 30, 20, 30)]);
});

test('frames that seconds cuts off are not counted as skipped', () => {
  // 40 ms frames at 25 frames a second: every match frame is one video frame, so a clip that ends early skips none.
  const cut = sidecar(30, 40, { fps: 25, seconds: 0.32 });
  assert.equal(cut.frames, 8);
  assert.deepEqual(skipped(cut), []);
  assert.deepEqual(skipped(sidecar(30, 40, { fps: 25 })), []);
  assert.deepEqual(skipped(sidecar(30, 40, { fps: 25, seconds: 3 })), []);
});
