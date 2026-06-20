# Cartalith Gen1 — Unified Tool Plan

Goal: merge `elevation_foundation_v0.036.html` (procedural generator) and `Cartalith_V1.914.html` (cartographic editor) into **one single-file tool that loses no functionality from either** and continues each program's logical trajectory. Working name: `cartalith_gen1_v0.001.html`.

## Why merge is clean

The two apps don't overlap — they're adjacent pipeline stages:

```
GENERATE (elevation foundation)              EDIT & TELL STORIES (v1.914)
tectonics → erosion → climate → biomes  ⇒   base image → paint → routes → places → politics → planner
```

v1.914 contains **zero** simulation code; the elevation foundation contains **zero** cartographic content. Every conflict is in the *shell* (menubar, sidebar, canvas, save format), not in the engines. Both already use: single `<script>`-ish structure, module-level state, Canvas 2D, Catmull-Rom polylines, ZIP save with JSON + binary layers, the same dark-gold design language, and mobile slide-in sidebars.

## Architecture decision

**Host shell: v1.914.** It has the larger, more mature UI chrome (workspaces, save/load, politics timeline, planner). The elevation foundation moves in as an internal module ("the engine") with its globals namespaced under one `Gen` scope (`Gen.field`, `Gen.state`, `Gen.generate()`, …) to avoid collisions with v1.914 globals — the only required refactor of engine code. Engine pipeline, GPU module, and invariants move unchanged (CLAUDE.md invariants 1–9 still hold).

**Layer model (the contract that protects functionality):**

| Layer | Source | Storage | Regeneration-safe? |
|-------|--------|---------|--------------------|
| Terrain (procedural) | `Gen.generate()` | `heightmap.f32` + params | rewritten by Generate |
| Sculpt overlay | user brush/polyline | delta Float32Array | persists; "Bake" merges it |
| Climate fields | `Gen.refreshClimate()` | `temperature.f32`, `rainfall.f32` | recomputed from terrain |
| Paint grid (biome/terrain) | user paint or "fill from climate" | Uint8 RLE (v1.914 format) | persists; per-cell lock flag |
| Routes / ways / places | v1.914 | `project.json` | always persists |
| Politics slices | v1.914 | `politics_<year>.bin` | always persists |

This implements the climate-engine handoff's Phase 1 (elevation raster, water mask from `field < seaLevel`, per-cell lock flag) and resolves its Phase 0 questions: elevation source = generated **or** imported heightmap; single-file stance = keep, with HTTP-server-enhanced features degrading gracefully; wind = per-cell field (weather v2).

**Coordinate bridge:** the generated map renders at `GW×GH` and becomes v1.914's `state.image`; `mapWidthKm`/`peakM`/`seaLevel` populate `calibration` (px↔km already exists). Paint-grid `cellSize` defaults to a divisor of `GW`. One source of truth: `Gen.state` for the world, v1.914 `state` for content on it.

**Save format:** one ZIP, schema **v10** (continuing v1.914's lineage, migration via existing `applyLoadedState` path):
```
project.json          (v1.914 content + new "gen" block: full Gen.state params + planet block)
heightmap.f32  temperature.f32  rainfall.f32   (engine fields)
sculpt_delta.f32      (only if non-empty)
biome_baked.bin  terrain_baked.bin  politics_<year>.bin  planner.json  image.png   (as today)
```
Loading a legacy v1.914 ZIP → works, engine idle ("no generated terrain" state). Loading an elevation-foundation ZIP → works, imports as gen block + image. **No saved work from either app is orphaned.**

## UI (from docs/research/ui-unified-tool.md)

Menubar tabs: **Generate | Sculpt | Paint | Routes | Politics** (Planner opens as modal from settlements; Routes keeps measure mode). Always-on **Layers & Blend** panel (visibility/opacity per layer, Bake button) + shared **Project** panel (save/load/export). Regeneration-safety dialog when un-baked overlays exist: `[Bake & regenerate] [Regenerate, keep overlays] [Cancel]`. Unified CSS root on v1.914's `#b08d54` accent; engine keeps `.row`/`.seg` idioms inside Generate/Sculpt panels.

## Generator as Cartalith source map (+ external loading)

Non-negotiable: the generator is usable as Cartalith's base map **and** external heightmap loading stays possible. Both routes converge on the same `field`:
- **Generated** → biome raster + paint grid + calibration flow into Cartalith (see `docs/BIOME_AND_VISUALS_PLAN.md`).
- **External** → `loadImage()` imports a grayscale / 16-bit-packed PNG / `.f32`; a loaded map can also become the world constraint for regional tile-refinement (see `docs/WORLD_REGIONAL_TILING_PLAN.md`).
Neither path is privileged; the editor consumes whichever produced the heightmap.

## Related plans
- `docs/BIOME_AND_VISUALS_PLAN.md` — dual raster+paint-grid biome handoff; hybrid realistic/stylized visuals.
- `docs/WORLD_REGIONAL_TILING_PLAN.md` — world↔regional, 16k tiling, fflate compression.
- `docs/GENERATOR_PARAMETERS.md` — exact per-modifier reference.

## Phases

**P0a — Data-layer bridge (SHIPPED, elevation_foundation v0.138).** The paint-grid handoff is proven end-to-end *before* any shell work: the engine's `CART_BIOMES`/`CART_TERRAINS` already match v1.914's `BIOMES`/`TERRAINS` storage order byte-for-byte; v0.138 folds the biome debug views into one "Biomes" view on the Cartalith palette, ports `encodeBiomeRLE`/`decodeBiomeRLE` **verbatim** from v1.914, and exports `biome_baked.bin`/`terrain_baked.bin` (RLE of `buildCartBiome`/`buildCartTerrain`) + `cartalith_grid.json`. Round-trip is bit-identical through the editor's codec (headless-tested). Remaining at merge: a `GW×GH → widthCells×heightCells` resample on import (engine raster is 1 cell/px; editor grid uses `cellSize`).

**P0 — Namespace the engine (in elevation_foundation repo file, prove with tests)**
Wrap engine globals into `Gen` scope; `tests/run.sh` must stay green. This is the only risky mechanical step, so it happens *before* any merging, in isolation.

**P1 — Shell merge**
Copy engine `<script>` + styles into v1.914 file as `cartalith_gen1_v0.001.html`; add Generate/Sculpt tabs hosting the engine's existing sidebar sections; engine canvas output becomes the background image layer (live, replacing file-import as the default source — file import remains). Deliverable: both apps' full feature sets reachable in one file.

**P2 — Save format v10**
Combined ZIP, both legacy importers, regeneration-safety dialog, sculpt-overlay extraction (engine `pushUndo` stack already isolates brush deltas).

**P3 — Climate → content bridges (the "logical continuation" features)**
- "Fill paint grid from climate" (`classifyBiome(tempField, rainField)` → 14 biome indices, skipping locked cells)
- River auto-trace: `flowField` ridges → editable `ways[]` polylines
- Climate-aware planner: temperature/rainfall along a route by season → travel-speed modifiers feeding the existing economics/logistics planner
- Tidal-range overlay (gravity G3) → coastal hazard zones for settlements

**P4 — Weather v2 + planet parameters** (docs/research/weather-model-v2.md W1–W3, gravity-influence.md G1–G2) — built inside the unified tool so Köppen output drives both the renderer and the paint-grid fill.

**P5 — Performance** (docs/research/engine-optimization.md): Worker erosion → R32F → profile → optional WASM kernels.

## Functionality-loss checklist (gate for each phase)

Every release must still: generate/erode/sculpt/export worlds (all v0.036 sections & debug views) · paint biome+terrain with palettes & cell grid · trace/measure/snap routes · place/edit settlements with traits & economics · politics timeline painting per year · planner journey computation · save/load every legacy file · run offline from `file://` · pass `tests/run.sh` (extended with `Gen.` namespacing and new assertions per phase).
