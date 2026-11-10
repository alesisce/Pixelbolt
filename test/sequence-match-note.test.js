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
// sequence.json as it is written: after the frames, each file made in turn when the sequence is streamed.
const sidecar = (frames, duration, options, how) => {
  let json;
  for (const [name, bytes] of createBodiesSequence(source(frames, duration), options, how).files) { const made = typeof bytes === 'function' ? bytes() : bytes; if (name === 'sequence.json') json = made; }
  return JSON.parse(String(json));
};
// The note's counts, read out of its sentence so that the rest of its wording is free to change:
// [frames not shown, of how many, whether those are only the match's first frames]. These sources draw no other note.
const skipped = info => info.notes.map(note => { const found = note.match(/^(\d+) of the match's (first )?(\d+) frames\b.*\bfalls? between video frames\b/); assert.ok(found, note); return [Number(found[1]), Number(found[3]), found[2] !== undefined]; });
// The match frames a clip shows, worked out apart from the planner: video frame k starts at k / fps seconds and shows
// the match frame under way then; past the match's end it holds the last one.
const shown = (frames, duration, fps, count) => new Set(Array.from({ length: count }, (_, k) => Math.min(frames - 1, Math.floor(k * 1000 / (fps * duration)))));

test('a match cut short by seconds still says which frames fall between video frames', () => {
  // 20 ms frames at 30 frames a second: 0.3 seconds is 9 video frames, which reach the match's 14th frame and show 9.
  const info = sidecar(30, 20, { fps: 30, seconds: 0.3 }), frames = shown(30, 20, 30, info.frames);
  assert.equal(info.frames, 9);
  assert.deepEqual([Math.max(...frames) + 1, frames.size], [14, 9]);
  assert.deepEqual(skipped(info), [[5, 14, true]]);
  assert.match(info.notes[0], /^5 of .* fall between video frames .* are not shown/);
  // A match that fills part of a video frame more (61 frames of 10 ms fill 18.3) is cut by a clip of the 18 whole ones.
  const part = sidecar(61, 10, { fps: 30, seconds: 0.6 }), partFrames = shown(61, 10, 30, part.frames);
  assert.deepEqual([part.frames, sidecar(61, 10, { fps: 30 }).frames, Math.max(...partFrames) + 1, partFrames.size], [18, 19, 57, 18]);
  assert.deepEqual(skipped(part), [[39, 57, true]]);
  // The case that was met: a 33 ms match at 30 frames a second loses one frame in about a hundred.
  const long = sidecar(120, 33, { fps: 30, seconds: 3.9 }), longFrames = shown(120, 33, 30, long.frames);
  assert.deepEqual([long.frames, Math.max(...longFrames) + 1, longFrames.size], [117, 118, 117]);
  assert.deepEqual(skipped(long), [[1, 118, true]]);
  assert.match(long.notes[0], /^1 of .* falls between video frames .* is not shown/);
});

test('a match held past its end by seconds counts every frame it skipped', () => {
  // Two seconds of a 0.6 second match: all 30 frames are passed. 18 are shown while it runs and the last is held to
  // the end, so 19 are seen and 11 are not.
  const held = sidecar(30, 20, { fps: 30, seconds: 2 }), frames = shown(30, 20, 30, held.frames);
  assert.equal(held.frames, 60);
  assert.deepEqual([Math.max(...frames) + 1, frames.size], [30, 19]);
  assert.deepEqual(skipped(held), [[11, 30, false]]);
});

test('seconds that cut nothing off leave the note as it is without them', () => {
  // The same video frames, so the same note: the clip ends before the match's last frame, the twelfth unseen.
  const whole = sidecar(30, 20, { fps: 30 });
  assert.deepEqual([whole.frames, shown(30, 20, 30, whole.frames).size], [18, 18]);
  assert.deepEqual(skipped(whole), [[12, 30, false]]);
  for (const [frames, duration, fps, seconds] of [[30, 20, 30, 0.6], [3, 10, 30, 0.03], [250, 10, 1, 2.5]]) {
    const plain = sidecar(frames, duration, { fps }), timed = sidecar(frames, duration, { fps, seconds });
    assert.equal(timed.frames, plain.frames);
    assert.ok(plain.notes.length > 0);
    assert.deepEqual(timed.notes, plain.notes, `${frames} frames of ${duration} ms at ${fps}, ${seconds} seconds`);
  }
  // Written frame by frame, as the command line does, the note is the same.
  assert.deepEqual(sidecar(30, 20, { fps: 30, seconds: 0.3 }, { stream: true }).notes, sidecar(30, 20, { fps: 30, seconds: 0.3 }).notes);
});

test('frames that seconds cuts off are not counted as skipped', () => {
  // 40 ms frames at 25 frames a second: every match frame is one video frame, so a clip that ends early skips none.
  const cut = sidecar(30, 40, { fps: 25, seconds: 0.32 });
  assert.equal(cut.frames, 8);
  assert.deepEqual(cut.notes, []);
  assert.deepEqual(sidecar(30, 40, { fps: 25 }).notes, []);
  assert.deepEqual(sidecar(30, 40, { fps: 25, seconds: 3 }).notes, []);
});
