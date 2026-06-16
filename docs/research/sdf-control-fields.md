# Signed Distance Fields as Geometric Control Fields — v0.096

## Motivation

The renderer treats several features as **hard raster edges**: the land/water boundary is a
binary `isWater(vw)` test, biome boundaries rely on noise-jitter (`bioJitter`), and the coastal
beach rim is keyed to elevation (`r < 0.03`) rather than true distance-from-coast. These read as
stair-stepped or resolution-dependent, and they carry no continuous geometric information that
downstream effects (beaches, coastal plains, river banks, ecotones) can key off.

A **signed distance field (SDF)** converts a binary mask into a continuous scalar field: each cell
stores the signed distance to the nearest boundary (negative inside, 0 on the boundary, positive
outside). One SDF then acts as a **geometric control field** driving many distance-banded effects
at once — the user's headline insight: *"the biggest gain would not be smoother coastlines, it
would be using SDFs as geometric control fields."*

The codebase already had *half* of this: `computeCoastDistance` is an unsigned 2-pass chamfer
(ocean→land), used only for wave foam and tidal funnelling. v0.096 generalizes it.

## What v0.096 ships

All **render-only, opt-in, off ⇒ bit-identical** (proven: main-map land-render hash and LOD
tile-render hash both byte-identical to v0.095 at defaults). The engine still uses the binary mask
for physics; the SDF is pure visual reconstruction.

### Core primitives (pure, headless-tested)
- **`chamferDist(srcMask, W, H)`** — generic two-pass chamfer distance transform over any boolean
  source mask (source = 0, others = distance in cells). `computeCoastDistance` is the special case;
  this is the shared engine.
- **`buildCoastSDF(fld, W, H, sea)`** — signed coast distance: runs `chamferDist` for each class
  (distance-to-land, distance-to-water) and combines as `sdf[i] = isWater(i) ? +dToLand : −dToWater`
  → **negative inland, 0 at the shoreline, positive offshore**. One field, both sides.
- **`buildRiverSDF(flow, W, H, opts)`** — signed distance from the discharge mask (`flow > thresh`,
  the `buildRiverField` cutoff): negative inside channels, positive away.
- **`buildBiomeBoundaryDist(biome, W, H)`** — distance to the nearest cell of a *different* biome
  index (the ecotone half-width); 0 on a boundary, growing into each biome's interior.

### Consumers
- **B2 — coast as a control field** (`state.viz.sdfCoast`): inland distance `−sdf` drives a
  distance-banded coastal tint — bright shore sand (beach, ≤2.5 cells) → lush coastal plain
  (≤14 cells) — at a **constant world-relative width** (bands expressed in 256px-equivalent cells,
  `S = GW/256`, so they look the same at 512 / 2K / 8K).
- **B3 — river bands** (`state.viz.sdfRivers`): the river SDF drives bank / wetland / floodplain
  margins from a single field (channel → damp bank → wetland green → floodplain), constant width
  at any zoom.
- **B4 — SDF ecotones** (`state.viz.sdfBiomes`): `landColorCore` gained a trailing `ecoK` param
  (default 1 ⇒ bit-identical). Near a biome boundary (small `buildBiomeBoundaryDist`) the climate
  jitter is widened (`ecoK > 1`), so transitions blend over a distance band instead of a
  fixed-width noise edge.
- **B5 — reverse-mipmap coastlines in LOD tiles**: `renderBiomeTileRGBA` computes a **local** coast
  SDF from the tile's own (amplified) heightmap — like the existing local AO / crest passes — and
  applies the same beach/plain bands in world-relative units (`din = −coastSDF·cx·256/GW`). Because
  the band width is expressed in world units, the coastline reads at a **constant real-world width
  at every zoom level** (the user's "reverse mipmap" goal), and adjacent tiles agree because they
  share boundary heights.

## Why chamfer, not JFA

The two-pass chamfer is O(N), pure, headless-testable, and already proven in this codebase
(`computeCoastDistance`). It is "good enough" for decorative control fields (≤1-cell anisotropy
error vs. true Euclidean). The **Jump Flood Algorithm** (already implemented for plate Voronoi in
`assignPlates`, warp- and world-wrap-aware) is the precision upgrade path if true Euclidean
distance is ever needed — noted for the future, not required now.

## Seam safety

Main-map SDFs are computed over the full `GW×GH` grid → trivially consistent. LOD-tile coast SDF is
local to each tile but seam-safe because adjacent tiles share their boundary heights (refineTile's
1-cell coarse overlap), so the distance transform agrees at the shared edge. World-wrap is
deliberately ignored (subtle decoration), matching `computeCoastDistance`.

## Completed in v0.097 (the deferred follow-ups)
- **River + biome SDF in LOD tiles** — `renderBiomeTileRGBA` now builds a local river SDF (from the
  coarse `flowField` sampled at world coords) and a local biome-boundary distance (from a per-tile
  biome raster classified at the sampled climate), applying the same banded tints + `ecoK`.
- **SDF tints in PNG bakes** — the coast/river tints + `ecoK` were factored into shared helpers
  (`applyCoastRiverSDFv`, `sdfEcoKv`) called by **both** `surfaceColor` (screen) and `bakePixel`
  (export), and the SDF fields are built in `buildGridFields` too. Bakes now match the screen.
- **Sub-pixel land/water AA** — when the coast SDF is on, the biome-mode renderer blends sea↔land
  over a `smoothstep(-0.6,0.6,coastSDF)` sub-cell band instead of the hard `isWater` step.
- **JFA Euclidean backend** — `jfaDist(seedMask,W,H)` (Rong & Tan 2006; generalized from the
  `assignPlates` plate-Voronoi JFA) gives true Euclidean distance; the SDF builders take `opts.euclid`
  and the visual consumers use it (chamfer stays the builder default + the wave-field path). The
  1-√2 chamfer over-estimates Euclidean by up to 8.24%; JFA removes that anisotropy.

All four remain render-only / opt-in ⇒ off is bit-identical (main-map, `bakePixel`, and LOD-tile
render hashes all byte-identical to v0.096 at defaults).

## Deferred (lower priority)
- SDF in the *Relief* (hypso) view (currently biome-mode only).
- `jfaDist` world-wrap awareness for the toroidal seam (currently ignored, like `computeCoastDistance`).

## References
- Hellweger, F. & Maidment, D. (1997). AGREE — DEM Surface Reconditioning System. UT Austin. (the
  stream-burning precedent; SDF conditioning is the same family.)
- Rong, G. & Tan, T.-S. (2006). Jump Flooding in GPU with Applications to Voronoi Diagram and
  Distance Transform. *ACM SIGGRAPH I3D*.
- Green, C. (2007). Improved Alpha-Tested Magnification for Vector Textures and Special Effects
  (Valve / SDF text rendering). *ACM SIGGRAPH Courses*.
- Frisken, S. et al. (2000). Adaptively Sampled Distance Fields. *ACM SIGGRAPH*.
