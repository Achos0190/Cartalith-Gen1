# LOD tile pyramid — live tiled viewer + per-tile editing

User request (June 2026): stop using a single 8K working canvas (it crashes browsers). Instead render the
heightmap as **stitched tiles** with a **pre-generated LOD pyramid**: per-tile resolution selectable
1K/2K/4K, and zoom swaps pyramid levels ("reverse mipmap") so the live working set stays ~2K-equivalent.
**Save/export still bakes the full 8K+ picture** (tile-by-tile, never held whole). First version also
supports **per-tile editing** (erosion/sculpt/paint on the loaded high-res tiles).

Chosen model: **pre-generated pyramid** + **viewer + per-tile editing** (user's picks).

## Architecture

The detail source is the existing **seamless** primitive `amplifyRegion` (high-frequency `fbm` conditioned
on the coarse world, deterministic in world coordinates → adjacent tiles AND adjacent levels agree,
seam-Δ=0). Level z splits the world into 2^z × 2^z tiles via `refineTile`. So the whole pyramid is built
from already-tested primitives; only the cache/viewer/edit-writeback is new.

```
coarse world (the live 2K base, generate())            ← exists
   ↓  pyramidTile(coarse, cW, cH, z, col, row, tileSize)   = refineTile over the full world  ← Stage 1 (done)
LOD pyramid: level z = 2^z×2^z seamless tiles, per-tile px = tileSize (1K/2K/4K)
   ↓  tile cache (LRU, bounded) keyed by (z,col,row)        ← Stage 2
viewer: pyramidLevelForZoom(scale) picks z; composite visible tiles on the viewT transform  ← Stage 2
   ↓  edit op on a loaded tile → write back to the tile + mark dirty                          ← Stage 3
export: bakeTiled walks every tile of the chosen export level → full 8K+ image, tile-by-tile ← mostly exists
```

## Stages

- **Stage 1 — pyramid core (v0.072, DONE).** Pure, headless-tested: `pyramidDims(z)`, `pyramidTile(...)`
  (= `refineTile` over the full world), `pyramidTileBounds`, `pyramidLevelForZoom`. Seam-Δ=0 same-level
  (asserted), determinism, addressing, level-for-zoom monotonic. No viewer yet → generate() bit-identical.
- **Stage 2 — live tiled viewer (browser).** A bounded LRU tile cache keyed by (z,col,row); on pan/zoom,
  pick the level from `pyramidLevelForZoom`, cull to the visible rect (`pyramidTileBounds`), generate
  missing tiles (worker-friendly: `pyramidTile` is pure), composite onto the `viewT`-transformed stack.
  Per-tile resolution selector (1K/2K/4K). The base coarse world remains the z=0 fallback so there is
  never a blank frame. Browser-only — manual verification.
- **Stage 3 — per-tile editing.** Erosion/sculpt/biome-paint operate on the *loaded* high-res tile(s)
  under the cursor; writes are stored as a per-tile override layer (so the procedural base stays
  reproducible) with tile-aware undo. Seam continuity at tile borders handled by editing on the +1
  overlap and re-deriving neighbours. Browser-only.
- **Export.** `bakeTiled`/`exportRegionTiles` already emit a full-res tiled image + 16-bit packs +
  manifest without holding the whole grid; wire the export-resolution picker to a pyramid level so
  "save as 8K" = bake level z where 2^z·tileSize ≈ 8192.

## Constraints / notes

- Memory: only the visible tiles + a small LRU margin are live → the browser never allocates 8K. This is
  the whole point vs the v0.068 8K working-grid button (which OOMs).
- Climate/tectonics/tides stay world-resolution (coarse); tiles inherit them via `amplifyRegion`'s
  conditioning, exactly as the export tiling already does — no per-tile simulation.
- Verifiability: the tile *math* is headless-tested (Stage 1). The cache/viewer/edit paths are
  canvas/interaction → browser-only, flagged per the project rule.
