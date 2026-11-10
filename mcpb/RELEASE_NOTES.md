# 0.15.0

Made to be read by an agent: help that answers with a page, replies that say each thing once, and fewer steps from a request to the files. Rigid bodies gain joints, ropes and cloth, contributed by alesisce. Eighteen calls an agent makes for help and routine work returned 848 KB in 0.14.0 and return 46 KB now.

- **Joints, ropes and cloth** for `pixelforge-bodies` (#124, by alesisce):
  - `joints`: distance, rope, spring, hinge and weld, between two bodies or a body and the world, with anchors, angle limits and a breaking impulse.
  - `ropes`: a chain between two anchors, drawn as a rope or a chain, that sags, carries a load and can break.
  - `cloths`: a grid pinned to points, keys over time or bodies, with wind, gusts, collisions and tearing.
  - New presets: rope bridge, wrecking ball, ragdoll, flag and cape.
- **Help that answers with a page:**
  - `pixel_help` and `pixelbolt help` never return a whole guide unasked: a document is its opening and its sections, a long section its parts, and a word that starts no heading returns the paragraphs that mention it.
  - A schema topic is an outline of its properties; a path such as `effects.bodies` returns that part as JSON.
  - The pixel art skill is a short router to checklists by subject, among them characters, colour variants, effects, tiles and scenes.
- **Fewer steps:**
  - Presets on the canvas and frame count asked for: `compile --size 32x32 --frames 8 --animation <name>` (MCP `size`, `frames`, `animation`), and `gif --preset` in one call.
  - `render --look` writes the frames enlarged to look at, and `--gif` or `--gif-scale` the GIFs, in the same call.
  - A colour variant: `inspect --palette` says which keys colour which parts, a patch path takes `[*]` for every frame, and `inspect --beside` draws the versions in one labelled image.
  - Tiles: a compiled set's reply carries the tilemap to paste, slopes included, and a template's `preview.rows` draws a level of your own. A scene's view may be 1024 pixels a side.
  - `import --frame 24x24` cuts a sprite sheet whose atlas is lost into its frames.
- **Replies that say each thing once:** frames in runs, a summary when a patch changes many frames, the check's motion boxes only where a note cites them, every error of a recipe at once, and an unknown MCP option named with the options the tool has.
- **To start from:** a stocky knight beside the hero, a hermit-crab chest made of moving parts, an isometric tile set and glade, a two-layer snow-over-rock tile set and a lit camp scene in the craft notes.
- **Looks:** steam and fog in flat bands without specks, no bright line where smoke leaves the picture, drawn props in the floating-body presets, and emitters that follow a moving obstacle.
- **Breaking:** an anchored frame's atlas `anchor` is the 0-1 point Phaser and PixiJS read; the pixel point is `anchorPx`. The Tesla coil preset and the Emberfall demo are gone.
- **Also:** a Gemini CLI extension manifest, a smaller npm package, and fixes from three reviews (hidden state, first-time agents, and this release).

Known issues:
- A row of thin pieces standing on the floor (bowling pins) is shoved along by a ball rather than knocked flat; stacks of blocks fall as they should.
- A rope given a `density` far lighter than its load stretches; left without one, it holds.
- Cloth is moved by bodies and obstacles but does not push them.
- `compile --size` keeps a drawing that touches one edge of its canvas on that edge, so the fox gets its margin below.
- Some command-line replies still name the MCP call that fixes a mismatch.
- Thin smoke in falling sand still reads as dark blobs, and compiled falling-sand recipes are large (0.2–2.5 MB).
- With Godot's pixel snapping, a camera between whole pixels can put a parallax plane a pixel from where Pixelbolt draws it.
- Tails of five or more short links can thrash, and a far elbow can snap between frames in walks of 32 or more frames.
- Left-facing jumps, attacks and hurts aren't mirrored.

The full list of changes is in `CHANGELOG.md`.

The bundle keeps its 0.8.0 name, `pixelbolt.mcpb` (checksum `pixelbolt.mcpb.sha256`). The `pixelforge` command still works as an alias.

`pixelbolt.mcpb` contains the local Node.js MCP server, its eight tools, schemas, authoring help and the shipped examples, so every preset compiles from the bundle. The server makes no network requests.

Download `pixelbolt.mcpb` and open it in Claude Desktop, or use Settings -> Extensions -> install from file. Choose a workspace for recipes and generated artwork, then ask the agent to call `pixel_help`. The bundle uses the client's Node.js runtime (20 or newer); it does not include Node.js.

Download `pixelbolt.mcpb.sha256` beside the bundle to check its SHA-256:

```sh
sha256sum --check pixelbolt.mcpb.sha256
gh attestation verify pixelbolt.mcpb --repo skulitom/Pixelbolt --signer-workflow skulitom/Pixelbolt/.github/workflows/release.yml
```

On PowerShell, `(Get-FileHash pixelbolt.mcpb -Algorithm SHA256).Hash` should match the hash in the checksum file.

The GitHub release makes the bundle available immediately. MCP Registry publication is a separate, manually dispatched step after testing; see [Publishing](https://github.com/skulitom/Pixelbolt/blob/main/docs/PUBLISHING.md).
