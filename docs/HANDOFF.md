# Cartalith Gen1 — Session Hand-off

**Read this first.** Start-here guide for a new session. Pairs with `CLAUDE.md` (architecture + invariants) and `docs/ATLAS_ARCHITECTURE.md` (current north-star workstream).

## Where we are

- Repo `achos0190/cartalith-gen1`. All work through **v0.080** is on **`main`** (PR #3 merged June 2026); **v0.081** (Atlas Phase 2a) is on branch `claude/cartalith-phase-2a-idb-r4fm6c` (draft PR). Create a new branch (`claude/<topic>`) for the next session's work; push to that branch, never directly to `main`.
- Current engine file: **`elevation_foundation_v0.081.html`** (older `v0.036–0.080` kept, never edited in place — new version = new file).
- Headless suite: **369 assertions, all green**. Run before & after any engine change:
  ```bash
  tests/run.sh            # extract JS → node --check → smoke suite (CPU paths)
  ```
- Two big single-file apps coexist: the elevation foundation (generator) and `Cartalith_V1.914.html` (cartographic editor). They are **not merged yet** — merge is planned (`docs/UNIFIED_TOOL_PLAN.md`).

## How to verify (the discipline we hold)

1. `tests/run.sh` must pass (extend `tests/test_tail.js` when adding a stage; stubs in `tests/stub_head.js`).
2. **Cross-version neutrality**: any additive/opt-in change must be proven byte-identical to the prior version at Earth/default settings — the `cmp` harness pattern (seed 12345, 256px, world off). Examples litter the git log; reuse them.
3. GPU shaders, Web Worker glue, and canvas interaction (zoom/pan/paint) **cannot be verified headlessly** — implement, then flag explicitly for a manual browser pass.
4. Commit messages end with the session URL line (see existing commits). Push to the work branch; create a PR draft; ask user if they want to watch it.

## Current north star — Hierarchical Reverse-Refinement Atlas

**Architecture**: `docs/ATLAS_ARCHITECTURE.md`. The world is **procedural scaffolding that progressively bakes into a permanent hierarchical image pyramid**. "Generation is temporary, images are permanent." Once a chunk is baked it is authoritative; the engine only fills *unexplored* detail.

**Phase 1 (v0.079) — DONE**: Chunk lifecycle model + debug overlays.
- `chunkParent`/`chunkChildren`/`chunkColorHash`/`chunkState`: Unexplored → Generated → Edited → Baked
- `_atlasBaked` is a stub Set; Phase 2 wires it to IndexedDB
- Chunk-debug overlay on the LOD view: Grid / Colors / Labels toggles

**Phase 2a (v0.081) — DONE**: IndexedDB store + bake + "images override generation"
- Store `atlas` (`cartalith_atlas` DB, keyPath `key`, `world` index) → `{rg16 height, png Blob}`, keyed by `atlasChunkKey = worldKey:ts:z:col:row`
- `worldKey()` = FNV-1a hash of seed + generation params (render-affecting state subset)
- Pure cores headless-tested: `worldKey`/`atlasKeyStr`/`atlasEncodeChunk`/`atlasDecodeChunk`/`bakedCover`
- `bakeVisibleTiles()` renders visible LOD tiles → IDB → `_atlasBaked`; **Bake / Clear atlas** buttons
- Render rule (`drawLODView`): baked chunk → load from IDB (`atlasLoadImg`→`_atlasImg`); else procedural. `refineVisibleTiles` skips tiles under a baked ancestor (`bakedCover`).
- Off / no-IDB ⇒ bit-identical to v0.080 (field/temp/rain/render cmp-clean)

**Phase 2b (v0.082) — NEXT**: Persistence + atlas lifecycle (edits/bakes survive `generate()` across sessions — query IDB for the world's keys on generate/startup to repopulate `_atlasBaked`; atlas status UI; metadata round-trip). `generate()` already keeps same-world bakes in-session; 2b adds cross-session rediscovery. Drawing an upscaled baked *ancestor* when zoomed below it is a deferred render refinement from 2a.

**Phase 3 (v0.083)**: Biome-coloured tiles (tiles render the full biome look, not relief-only)

**Phase 4 (v0.084)**: Portable atlas export/import (`World/` ZIP → IndexedDB and back)

**Deferred**: F0–F3 frequency-layered generation; unified-tool merge P0–P2

## Completed workstreams (shipped in v0.048–v0.081)

- **Tectonic feature graph T0–T4**: shear field + boundary matrix (v0.058) → polyline graph (v0.060) → orogenic kernel (v0.061) → per-type profiles: trench+arc, collision belts, rift grabens (v0.062) → transform faults (v0.064). Feature-complete; optional T5 tuning/archetype hooks remain.
- **Earth-system coupling loops L1–L3**: climate↔erosion evolve (v0.066), currents→winds (v0.067), mass-conserving sediment routing (v0.069).
- **Gravity G1–G3**: G1 scaling throughout pipeline (v0.038), G2 geoid sea-level field (v0.054), G3 moons + tidal range field (v0.070). G4 tidal sedimentation deferred.
- **LOD tiled viewer Stages 1–3**: pure pyramid core (v0.072) → LRU viewer + overview-then-refine (v0.073–v0.074) → per-tile editing with Ctrl-Z (v0.075) → Atlas Phase 1 chunk model (v0.079) → **LOD interaction bug fix** (v0.080) → **Atlas Phase 2a: IndexedDB chunk baking + images-override** (v0.081).
- **Rivers**: smooth discharge-widened rivers (v0.076) + brushed rivers as entrenched drainage seeds (v0.077).
- **Visuals**: parchment + icons (v0.050), waves (v0.051), Style tab + asset-pack importer (v0.056), B2 texture splatting (v0.059).
- **16k tiling**: seamless `amplifyRegion` core (v0.044) → `refineTile` + `packHeight16` + manifest v2 (v0.052) → region-refine export (v0.053) → cols×rows + aspect-preserving tile pixels (v0.055).
- **Water quality**: smooth sea-floor shading (v0.063/v0.065), resolution-independent ocean grain + 4K/8K resolution options (v0.068), **warp-cache NaN root-cause fix** (v0.071 — this was the real "bad seas at 2K" fix).
- **Biome PoC**: Cartalith 15-biome palette auto-filled as a CBiome debug view (v0.078); sharper ecotone detail gated on `sharpBiomes` (v0.078).

## Optional follow-ups (not yet started)

- T5: tectonic archetype hooks — fold-intensity / trench-depth sliders wired into World Structure archetypes
- Real CC0 art into the sample-pack format (`docs/research/asset-candidates.md`): ambientCG textures + K.M. Alexander icons
- Bilinear texture sampling for splat
- Vector spline-traced coastlines (B4 optional half)
- Per-tile erosion at refine time; fflate vendoring for tile ZIP speed
- L4 dynamic lithology, L6 cryosphere albedo (lower-priority audit loops)
- G4 tidal sedimentation

## Manual browser pass still owed

(Headless can't cover canvas/WebGL/Worker paths.)

- **v0.081** — Atlas bake: enable Tiled LOD, **Refine** a view, **Bake visible tiles**; confirm the chunk-debug overlay shows baked tiles green, pan away/back re-draws them from the atlas (read-from-IDB), **Refine** no longer adds detail under baked tiles, **Clear atlas** reverts to procedural, and reload-page-then-bake round-trips through IndexedDB. Confirm no-IndexedDB / `file://`-without-IDB degrades silently to procedural.
- **v0.080** — Confirm LOD zoom + terrain painting now both work correctly when the Tiled-LOD view is toggled on/off; confirm wheel scroll zooms the LOD view, drag pans it, and Edit tiles brush works.
- **v0.079** — Chunk-debug overlay: Grid / Colors / Labels each toggle independently; tile labels show LOD/coords/state.
- **v0.078** — Sharper-biome aesthetics at 2K; CBiome debug view shows Cartalith 15-biome palette correctly.
- **v0.076/077** — Smooth rivers on biome map (trunk wide, tributaries thin); brushed-river guide locks the channel so erosion doesn't refill it.
- **v0.075** — LOD per-tile edit: raise/lower/smooth brush, Ctrl-Z tile undo, edit persists through re-refine.
- **v0.074** — Coarse overview loads instantly; Refine detail button amplifies the visible tiles on demand.
- **v0.071** — Switch resolutions 512→1K→2K→back with the same seed — should be 0 NaN cells each time.
- **v0.068** — Ocean grain looks the same coarseness at 512, 1K, and 2K; 4K/8K generate without OOM.
- **v0.063/v0.065** — Seas smooth/not-blocky on biome map at 2K; coastlines still crisp (mask uses raw field).
- **v0.061/v0.062** — Enable Structured orogeny, run erosion carve: collision belts, subduction trench+arc, rift grabens should read as real landforms.
- **v0.057** — Ocean-currents debug view: warm/cold SST colours + coarse flow arrows over water.
- **v0.056** — Import the sample pack ZIP; confirm sprites + textures appear; Clear resets to procedural.
- **v0.053** — Region drag-select overlay, ZIP download (PNG tiles + gzip'd bins), a 4×4@4096 run.

## Engine capability summary (v0.080)

Natural-order pipeline (flow→climate→flow, runoff-weighted) · G1 gravity scaling · full planetary weather **W1 winds / W2 moisture / W3 seasons+Köppen / W3.5 ocean currents** · **worker erosion: droplet + stream-power + glacial** (self-contained kernels, shared lock) · biome-raster handoff · seamless `amplifyRegion` (16k-tiling core) · fixed stream-power (MFD, anti-ridge, carve-default) · Wind + Köppen + Ocean-current debug views · plotline feature brushes (`applyFeatureAlongCurve` distance-field stamp, 7 features) · shared pan/zoom (`viewT`) + scale bar + Ctrl-Z · parchment grain + stylized icon layer + coastal wave lines + **Show rivers / Smooth rivers / Sharp biomes** (all in Style tab) · tiling core + region-refine export (`refineTile` seam-Δ=0, 16-bit `packHeight16`, manifest v2, drag-select → gzip'd tile ZIP) · G2 geoid sea-level field · region export with explicit cols×rows + aspect-preserving tile resolution · Style tab + in-app asset-pack import (ZIP/CSV, sprites + sample pack) · T0–T4 tectonic-feature graph (shear field, boundary matrix, polyline graph, orogenic multi-ridge kernel, per-type profiles, transform faults) · B2 texture splatting (tint-ratio) · L1–L3 Earth-system coupling loops (climate↔erosion evolve, currents→winds, mass-conserving sediment) · G3 moons + tidal range field · LOD tiled viewer (pyramid core + LRU cache + overview-then-refine + per-tile editing + **chunk lifecycle model** + chunk-debug overlay) · smooth + widening rivers + brushed river channel locking · Cartalith 15-biome CBiome debug view + sharper ecotone detail. Sidebar follows the planetary-formation cascade.

## Locked decisions (don't relitigate)

- Gravity = planetary parameter (`state.planet`). Single-file `file://` default; local HTTP server OK for Workers/WASM/WebGPU.
- Merge: v1.914 = host shell, engine namespaced under `Gen`, save schema **v10**; generator-as-source **and** external heightmap load both preserved.
- Biome handoff = **dual** full-res raster + editable paint grid. Visuals = **hybrid** realistic + togglable Nortantis-style icons (**Nortantis is AGPL — study the algorithm, copy no code**). Assets: in-app ZIP-pack import (`docs/ASSET_PACK_FORMAT.md`) for single-file/`file://` friendliness; always procedural fallback. CC0 packs (Poly Haven / ambientCG / K.M. Alexander) shortlisted in `docs/research/asset-candidates.md`.
- Atlas persistence = **IndexedDB** (permanent across sessions, file://-safe). Export to `World/` ZIP for handoff.
- Keep the current `amplifyRegion`-based reverse-refinement. F0–F3 frequency-layer refactor deferred until after the atlas works.
- Tiling: continuous zoom on the current map now; tiled 16k + region refine also available.
- Stream-power "carve" defaults to pure incision; uplift is opt-in.

## Docs map

`CLAUDE.md` (architecture, 11 invariants, verification, "Since v0.0XX" changelog) · `docs/ROADMAP.md` (priority order + Done log) · `docs/ATLAS_ARCHITECTURE.md` (current north-star workstream + phased plan) · `docs/UNIFIED_TOOL_PLAN.md` · `docs/GENERATOR_PARAMETERS.md` (every modifier) · `docs/BIOME_AND_VISUALS_PLAN.md` · `docs/WORLD_REGIONAL_TILING_PLAN.md` · `docs/LOD_PYRAMID_PLAN.md` · `docs/research/` (ui-unified-tool, weather-model-v2, gravity-influence, engine-optimization, pipeline-order-audit, map-painting-ux, asset-candidates, ASSET_PACK_FORMAT, **tectonic-feature-graph** [mountains-as-structures plan])

## Watch-outs

- PRs #1 and #2 are both merged. New work goes on a fresh branch; create a draft PR when pushing.
- Don't edit old `v0.0XX` files. Don't renumber `BIOME_KEYS`/`KOPPEN_KEYS`/`BTYPE_KEYS` (save-format-stable). Keep CPU and GPU lapse (`uLapse`) in lockstep. The three worker kernels (`dropletKernel`, `streamPowerKernel`, `glacialKernel`) must stay self-contained — no module globals (Invariant 11).
- `geoidField`, `tideField`, `continentalField`, `orogenyField`, `warpX`/`warpY` are all nullable — every consumer must null-check (see Invariant 4 pattern). `_atlasBaked` is a stub Set for now.
- The world-seam invariant (`avg wrap delta < 0.12`) is seed-dependent and occasionally near the threshold — don't tighten it.
