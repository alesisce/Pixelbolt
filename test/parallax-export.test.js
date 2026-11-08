// A scene's parallax and haze in its exports: each Tiled layer carries its plane's parallax, hazed placements draw from
// hazed copies of their sheets, and each plane is an image a Godot scene scrolls with Parallax2D. scripts/verify-tiled.mjs
// and scripts/verify-godot.mjs check the same scene in a real Tiled and Godot; these tests pin the files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneBundle } from '../src/scene-export.js';
import { prepareScene, renderScene, scenePlanes, sceneHaze } from '../src/scene.js';
import { parallaxScene as godotScene } from '../src/godot.js';
import { decodePNG } from '../src/import.js';
import { parallaxScene, PARALLAX_CAMERAS } from '../scripts/parallax-scene.mjs';

const dot = color => ({ version: 1, name: 'dot', width: 2, height: 2, palette: { c: color }, frames: [{ name: 'a', ops: [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'c' }] }] });

// Lays the planes on the background at a camera position, each moved by its parallax share of the camera.
function layPlanes(scene, planes, camera) {
  const data = new Uint8ClampedArray(scene.width * scene.height * 4);
  for (let at = 0; at < data.length; at += 4) data.set(scene.background, at);
  for (const plane of planes) {
    const left = plane.at[0] - Math.round(plane.parallax[0] * camera[0]), top = plane.at[1] - Math.round(plane.parallax[1] * camera[1]);
    for (let y = 0; y < plane.height; y++) for (let x = 0; x < plane.width; x++) {
      const sx = left + x, sy = top + y, from = (y * plane.width + x) * 4, alpha = plane.data[from + 3] / 255;
      if (sx < 0 || sy < 0 || sx >= scene.width || sy >= scene.height || !alpha) continue;
      const to = (sy * scene.width + sx) * 4;
      for (let c = 0; c < 3; c++) data[to + c] = Math.round(plane.data[from + c] * alpha + data[to + c] * (1 - alpha));
    }
  }
  return data;
}

test('each layer of scene.tmx carries its plane\'s parallax, and the hills draw from their hazed tileset', async () => {
  const { files, warnings } = await createSceneBundle(await parallaxScene()), map = files.get('scene.tmx').toString();
  assert.deepEqual(warnings, []);
  assert.deepEqual(map.split('\n').filter(line => /^ <(layer|objectgroup|tileset) /.test(line)), [
    ' <tileset firstgid="1" source="assets/0/tileset.tsx"/>', ' <tileset firstgid="3" source="assets/1/tileset.tsx"/>', ' <tileset firstgid="163" source="assets/2/tileset.tsx"/>',
    ' <tileset firstgid="323" source="assets/3/tileset.tsx"/>', ' <tileset firstgid="329" source="assets/2/haze-0.6/tileset.tsx"/>',
    ' <objectgroup draworder="index" id="1" name="sun, cloud" parallaxx="0" parallaxy="0">',
    ' <layer id="2" name="hills" width="18" height="7" offsetx="-16" offsety="-8" parallaxx="0.5" parallaxy="0.5">',
    ' <layer id="3" name="ground" width="18" height="7" offsetx="-16" offsety="-8">',
    ' <objectgroup draworder="index" id="4" name="spirit">']);
  // The map keeps Tiled's parallax origin, which Tiled 1.11 reads the other way round from 1.8–1.10.
  assert.doesNotMatch(map, /parallaxorigin/);
  const cells = name => map.split(`name="${name}"`)[1].split('<data encoding="csv">\n')[1].split('\n</data>')[0].split(/,\n?/).map(Number).filter(Boolean);
  assert.ok(cells('hills').every(gid => gid >= 329 && gid < 489), 'hills: the hazed tileset');
  assert.ok(cells('ground').every(gid => gid >= 3 && gid < 163), 'ground: its own tileset');
  // The hazed copy: the same grid and terrains under its own name, over its own sheet beside it.
  const base = files.get('assets/2/tileset.tsx').toString(), hazed = files.get('assets/2/haze-0.6/tileset.tsx').toString();
  assert.equal(hazed, base.replace('name="hills" ', 'name="hills haze 0.6" '));
  assert.deepEqual(JSON.parse(files.get('alignment.json')).assets.hills.haze, [{ amount: 0.6, color: 'assets/2/haze-0.6/color.png', tiled: 'assets/2/haze-0.6/tileset.tsx', godot: 'assets/2/haze-0.6/sprite_frames.tres' }]);
  assert.equal(files.get('assets/2/haze-0.6/sprite_frames.tres').toString(), files.get('assets/2/sprite_frames.tres').toString());
});

test('a hazed sheet fades each colour as a whole, exactly as the scene draws it', async () => {
  const source = await parallaxScene(), scene = prepareScene(source), { files } = await createSceneBundle(source), haze = sceneHaze(scene);
  const base = decodePNG(files.get('assets/2/color.png')), hazed = decodePNG(files.get('assets/2/haze-0.6/color.png')), mapped = new Map();
  assert.deepEqual([hazed.width, hazed.height], [base.width, base.height]);
  let paler = 0;
  for (let at = 0; at < base.data.length; at += 4) {
    const from = [...base.data.subarray(at, at + 4)], to = [...hazed.data.subarray(at, at + 4)];
    assert.equal(to[3], from[3], 'alpha stays');
    if (!from[3]) continue;
    assert.deepEqual(to.slice(0, 3), haze(0.6, from), `pixel ${at / 4}`);
    // One colour in, one colour out.
    const key = from.join(), seen = mapped.get(key);
    assert.ok(!seen || seen === to.join());
    mapped.set(key, to.join());
    // Toward the haze colour, which is lighter than every colour of the hills.
    if (to.slice(0, 3).reduce((a, b) => a + b) > from.slice(0, 3).reduce((a, b) => a + b)) paler++;
  }
  assert.ok(paler > 0 && mapped.size > 4);
});

test('a scene\'s planes, laid on the background by their parallax, draw the unlit scene at every camera position', async () => {
  const source = await parallaxScene(), scene = prepareScene(source), start = renderScene(scene, { lit: false, draws: true });
  const { planes, shaded, oversized } = scenePlanes(scene, start.draws);
  assert.deepEqual([shaded, oversized], [[], []]);
  assert.deepEqual(planes.map(plane => [plane.parallax, plane.at, plane.width, plane.height, plane.instances.map(i => scene.instances[i].name)]), [
    [[0, 0], [14, 4], 136, 24, ['sun', 'cloud', 'cloud']], [[0.5, 0.5], [-16, 24], 240, 80, ['hills']], [[1, 1], [-16, 49], 288, 55, ['ground', 'spirit']]]);
  for (const camera of [...PARALLAX_CAMERAS, [17, 0], [33, 5]]) {
    const view = renderScene(prepareScene({ ...source, camera }), { lit: false });
    assert.deepEqual(layPlanes(scene, planes, camera), view.data, `camera at ${camera}`);
  }
  // The export writes them and says where each goes.
  const { files } = await createSceneBundle(source), alignment = JSON.parse(files.get('alignment.json'));
  assert.deepEqual(alignment.planes.map(plane => [plane.image, plane.parallax, plane.at, plane.size, plane.placements]), planes.map((plane, k) => [`planes/${k}.png`, plane.parallax, plane.at, [plane.width, plane.height], plane.instances.map(i => scene.instances[i].name)]));
  assert.deepEqual(decodePNG(files.get('planes/1.png')).data, planes[1].data);
});

test('planes are runs of draws on one plane: an attached placement rides its target\'s, and a shade placement is left out', async () => {
  const source = { format: 'pixelforge-scene', version: 1, name: 'runs', width: 16, height: 8, background: '#000000', camera: [0, 0], haze: { color: '#ffffff' },
    assets: { red: dot('#ff0000'), green: dot('#00ff00'), blue: dot('#0000ff') },
    instances: [
      { name: 'far', asset: 'red', at: [0, 0], parallax: 0.5, haze: 0.5 }, { name: 'pin', asset: 'blue', at: [2, 0], attach: { instance: 'far' } },
      { name: 'near', asset: 'green', at: [6, 2] }, { name: 'shadow', asset: 'green', at: [6, 4], shade: -1 }, { name: 'far2', asset: 'red', at: [10, 0], parallax: 0.5 },
      { name: 'wide', asset: 'blue', at: [12, 4], parallax: [2, 0] }
    ] };
  source.assets.green = { ...dot('#00ff00'), palette: { c: '#00ff00', d: '#008000' }, ramps: [['d', 'c']] };
  const scene = prepareScene(source), { draws } = renderScene(scene, { lit: false, draws: true }), result = scenePlanes(scene, draws);
  assert.deepEqual(result.planes.map(plane => [plane.parallax, plane.instances.map(i => scene.instances[i].name)]), [[[0.5, 0.5], ['far', 'pin']], [[1, 1], ['near']], [[0.5, 0.5], ['far2']], [[2, 0], ['wide']]]);
  assert.deepEqual(result.shaded, ['shadow']);
  // The far placement is hazed halfway to white; its pin is not.
  assert.deepEqual([...result.planes[0].data.subarray(0, 4)], [255, 128, 128, 255]);
  assert.deepEqual([...result.planes[0].data.subarray(8, 12)], [0, 0, 255, 255]);
  const map = (await createSceneBundle(source)).files.get('scene.tmx').toString();
  assert.deepEqual(map.split('\n').filter(line => / <objectgroup /.test(line)), [
    ' <objectgroup draworder="index" id="1" name="far, pin" parallaxx="0.5" parallaxy="0.5">', ' <objectgroup draworder="index" id="2" name="near">',
    ' <objectgroup draworder="index" id="3" name="far2" parallaxx="0.5" parallaxy="0.5">', ' <objectgroup draworder="index" id="4" name="wide" parallaxx="2" parallaxy="0">']);
});

test('scene.tscn scrolls each plane with a Parallax2D under a top-left camera at the camera\'s start', async () => {
  const source = await parallaxScene(), { files } = await createSceneBundle(source);
  assert.equal(JSON.parse(files.get('alignment.json')).godot, 'scene.tscn');
  assert.equal(files.get('scene.tscn').toString(), [
    '[gd_scene format=3]', '',
    '[ext_resource type="Texture2D" path="planes/0.png" id="1_plane"]', '[ext_resource type="Texture2D" path="planes/1.png" id="2_plane"]', '[ext_resource type="Texture2D" path="planes/2.png" id="3_plane"]', '',
    '[node name="hills" type="Node2D"]', 'texture_filter = 1', '',
    '[node name="Camera2D" type="Camera2D" parent="."]', 'anchor_mode = 0', '',
    '[node name="Background" type="Parallax2D" parent="."]', 'scroll_scale = Vector2(0, 0)', '',
    '[node name="Color" type="ColorRect" parent="Background"]', 'offset_right = 160.0', 'offset_bottom = 96.0', 'color = Color(0.611765, 0.811765, 0.901961, 1)', '',
    '[node name="sun" type="Parallax2D" parent="."]', 'scroll_scale = Vector2(0, 0)', '',
    '[node name="Image" type="Sprite2D" parent="sun"]', 'position = Vector2(14, 4)', 'texture = ExtResource("1_plane")', 'centered = false', '',
    '[node name="hills" type="Parallax2D" parent="."]', 'scroll_scale = Vector2(0.5, 0.5)', '',
    '[node name="Image" type="Sprite2D" parent="hills"]', 'position = Vector2(-16, 24)', 'texture = ExtResource("2_plane")', 'centered = false', '',
    '[node name="ground" type="Parallax2D" parent="."]', '',
    '[node name="Image" type="Sprite2D" parent="ground"]', 'position = Vector2(-16, 49)', 'texture = ExtResource("3_plane")', 'centered = false', ''].join('\n'));
  // A camera that starts elsewhere starts the Camera2D there.
  const moved = (await createSceneBundle({ ...source, camera: [{ time: 0, at: [12, 3] }, { time: 3000, at: [96, 0] }] })).files.get('scene.tscn').toString();
  assert.match(moved, /\[node name="Camera2D" type="Camera2D" parent="\."\]\nposition = Vector2\(12, 3\)\nanchor_mode = 0\n/);
});

test('plane nodes take names Godot accepts, each its own among its siblings', () => {
  const plane = name => ({ name, image: 'p.png', at: [0, 0], parallax: [1, 1] });
  const text = godotScene({ name: 'a.b', width: 4, height: 4, background: [0, 0, 0, 255], camera: [0, 0], planes: ['sky', 'sky', 'Background', 'a/b:c@d"e%f', '  ', 'Camera2D'].map(plane) });
  assert.deepEqual([...text.matchAll(/\[node name="((?:[^"\\]|\\.)*)" type="(\w+)"( parent="(?:[^"\\]|\\.)*")?\]/g)].filter(m => m[2] === 'Parallax2D' || !m[3]).map(m => m[1]),
    ['a_b', 'Background', 'sky', 'sky 2', 'Background 2', 'a_b_c_d_e_f', 'plane', 'Camera2D 2']);
});
