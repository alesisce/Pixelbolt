# 0.12.1

Fixes from a review of 0.12.0: bodies in crowds, long matches, memory and budgets.

- **Bodies in liquids:** a crowd of bodies that seals a liquid into one-cell pockets no longer crashes the fluid compiler, and a moving hoop no longer fills memory for every pixel it moves. The live fluid runner draws its bodies with every step, so a page's pixels don't depend on how often it renders.
- **Long matches:** a match too long for a sequence (about 2,070 frames at 1080×1920) is refused before it is simulated, and over MCP one too long to draw within the call's time limit is refused at once with the `pixelbolt sequence` command to run instead. `sequence` replies carry a summary of the match's figures; every frame's figures stay in `sequence.json`. The territory preset's frames last 34 ms, a whole video frame at 30 frames a second.
- **Checks before work:** sources the renderer would refuse (too many frame pixels, a heads-up display too large drawn finer) are refused before simulating; a warp or magnet target checks y against the height; the `subpixels` error names a value that fits; `bodies.schema.json` matches the runtime.
- **Budgets:** a looping spell whose looks hold no longer has half its painting budget; a presets listing on a busy machine always measures at least one preset, so its cache fills.
- **CLI:** a command that writes several files refuses two outputs that are one file on disk under different names, even with `--force`.
- **Docs:** `bodies` is listed in the help topics, the README, the agent guide and the MCP descriptions.

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
