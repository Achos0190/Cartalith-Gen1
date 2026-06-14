# Hierarchical Reverse-Refinement Atlas — architecture

User vision (June 2026): the world is **procedural scaffolding that progressively bakes into a permanent
hierarchical image pyramid**. "Generation is temporary, images are permanent." Once a chunk is baked it
becomes authoritative and the generator stops refining beneath it; the engine only ever fills *unexplored*
detail. This supersedes the "viewer" framing in `docs/LOD_PYRAMID_PLAN.md`.

## Decisions
- **Persistence: IndexedDB** (permanent across sessions, works under `file://`; export to a `World/` ZIP for handoff). Chosen over in-memory+ZIP and File System Access.
- **Generation: keep the current reverse-refinement** (`amplifyRegion` already synthesises finer detail on zoom). The F0/F1/F2/F3 frequency-layer refactor is **deferred** until after the atlas works.

## What already exists (reverse-refinement half)
- `amplifyRegion`/`refineTile` — deterministic-in-world-coords detail, seam-Δ=0 (so adjacent + cross-level tiles agree).
- LOD pyramid (v0.072–075): `pyramidTile`/`pyramidDims`/`pyramidTileBounds`/`pyramidLevelForZoom`; `_lodCache` (LRU); `drawLODView` overview-then-refine; per-tile editing (`_lodEdits`, `brushHeight`, `editTileAt`, `lodUndo`).

## Chunk model (Phase 1, v0.079)
Quadtree addressed by `(z,col,row)` (level z has 2^z×2^z chunks). Helpers: `chunkParent`, `chunkChildren`,
`chunkColorHash` (stable per-chunk colour), `chunkState` → **Unexplored → Generated (`_lodCache`) → Edited
(`_lodEdits`) → Baked (`_atlasBaked`)**, atlas authoritative. Debug overlays on the LOD view: per-level
coloured **grid**, hash **chunk colours**, **labels** (LOD/coords/parent/state). `_atlasBaked` is a stub Set
until Phase 2.

## Phased plan
- **Phase 1 — chunk model + debug (v0.079, this).** Lifecycle helpers (tested) + chunk-debug overlays. No behaviour change at defaults.
- **Phase 2a — IndexedDB store + bake + images-override (v0.080).** Store `atlas` keyed by `(worldKey,z,col,row)` → rg16 height + visual PNG; `meta {worldSeed,maxLOD,tileSize}`. Bake action writes a chunk; the viewer loads a baked chunk in place of procedural; no refinement beneath a baked chunk.
- **Phase 2b — persistence + lifecycle (v0.081).** Edits/bakes survive `generate()` when `worldKey` is unchanged; atlas status UI + clear; metadata round-trip.
- **Phase 3 — biome-coloured tiles (v0.082).** Tiles render the biome look (sample coarse climate per tile → `classifyBiome`/`materialWeights`/`landColorCore`), not relief-only.
- **Phase 4 — portable atlas export/import (v0.083).** Export IndexedDB → `World/` ZIP (`Metadata/`, `LODz/ z_c_r.png`, rg16) via `bakeTiled`/`buildTileManifest`/`gzipBytes`; import back into IndexedDB.

## Constraints
- IndexedDB / canvas / debug overlays are **browser-only** — flagged for manual verification; pure cores (addressing, state, encode/decode) are headless-tested.
- A baked chunk belongs to one `worldKey` (seed + generation params hash); a new world ⇒ a fresh atlas.
- Deferred: F0–F3 frequency-layered generation (per-zoom layer activation, dependency chain).
