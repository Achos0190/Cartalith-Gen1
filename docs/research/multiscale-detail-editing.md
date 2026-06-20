# Multi-Scale Detail Editing — "detail surfaces on zoom, low-res never shreds"

*June 2026. User vision: like a real-world atlas, the world map shows only continents + major
features (Appalachians, Himalaya, deserts, Great Lakes); deltas, fjords, landmarks emerge only as
you zoom in. Today, **painting detail at a low working resolution shreds the heightmap into a
"distorted and grated mess"** — fine strokes alias into the coarse `field`. The detail should
instead live at the zoom level it belongs to and surface on zoom-in, never corrupting the macro
map. This doc captures the prior-art research and a staged plan that **reuses Cartalith's existing
LOD/atlas bones** rather than rebuilding the engine.*

---

## 1. The key realization

**Cartalith already implements the right architecture.** The bones for exactly this behaviour exist
and are headless-tested:

| Concept (industry) | Cartalith equivalent | Status |
|---|---|---|
| Layout (cheap preview) vs Build (full-res on demand) — *World Machine* | coarse `field` (`generate()`) vs LOD refine/bake | shipped |
| Tiled quadtree, per-tile resolution — *Gaea, slippy maps* | `pyramidTile`/`pyramidDims`/`pyramidTileBounds` | shipped (v0.072) |
| Reverse-mipmap LOD pick on zoom | `pyramidLevelForZoom` | shipped |
| Deterministic detail amplification (more octaves on zoom) | `amplifyRegion` + `addZoomDetail` | shipped (v0.044/0.126) |
| Sparse virtual texture / clipmap paging (only visible @ right mip resident) | `_lodCache` (LRU) + IndexedDB atlas | shipped (v0.073/0.081) |
| Non-destructive override layer (base stays reproducible) | `_lodEdits` per-tile override | shipped (v0.075) |
| "Images permanent, generation temporary" bake | `bakeVisibleTiles` → atlas, `bakedCover` | shipped (v0.081) |

So this is **not** a from-scratch build. It is: (a) fix two real limitations in the existing
detail-edit path, and (b) make that path the *natural* editing surface instead of a buried manual
mode.

## 2. Prior art (what comparable tools actually do)

- **World Machine** — *Layout* resolution is cheap + interactive; the *Build* resolves full detail
  on demand; **tiled exports** give "effectively unlimited resolution" stored across files. Lesson:
  keep macro painting cheap/live; gate heavy detail behind explicit refine/bake; never hold the
  whole high-res grid. *(Cartalith already mirrors this: `generate()` = layout, LOD refine/atlas =
  build.)*
- **Gaea** — real-time quadtree tiles; **Tiled Build** assigns resolution *per tile* + tile count;
  scales to 65 Gpx by never materializing the whole field. Lesson: the quadtree is the unit of both
  detail and memory; edit/raise resolution per node.
- **Quadtree terrain LOD (slippy maps, game engines)** — higher-res tiles *replace* lower-res ones
  as the camera nears; view-frustum cull; per-node world-space error decides when to subdivide.
  Lesson: the **same world point must agree across levels** (a coarse tile is a faithful
  down-sample of its children) — otherwise detail "pops" or the macro view lies. Cartalith gets
  cross-level agreement *for procedural* relief (seam-Δ=0, deterministic in world coords) but **not
  yet for painted edits** (see §3).
- **Multi-octave / band-limited noise** — each octave is a frequency band; finer octaves are only
  meaningful (Nyquist) at finer sampling. A deterministic noise function returns the *same* value at
  a world point regardless of zoom, which is what makes "detail consistent across zoom" possible.
  Lesson: **detail = high-frequency octaves activated by zoom level**; this is precisely
  `addZoomDetail`'s `extra = z − zBase` octave ramp. The user-facing knob that's missing is *how
  much* detail emerges.
- **Virtual texturing / clipmaps / sparse megatexture** — a single enormous virtual surface;
  only the visible region at the needed mip is resident, paged in/out (LRU). Editing writes into the
  sparse pages, not a giant array. Lesson: the **atlas (IndexedDB) + `_lodCache` LRU is Cartalith's
  hand-rolled sparse virtual heightmap** — the storage model is already correct.

## 3. The two *real* gaps (root cause of the "grated mess")

### Gap A — the natural brush is destructive at working resolution
`sculpt()` (and the canvas pointer handlers) write **directly into the coarse `field` (GW×GH)**.
At a low working resolution, a fine stroke can't be represented — it aliases into chunky cells (the
"distorted, grated" look). The **non-destructive multi-scale path already exists**
(`editTileAt` → `_lodEdits` at the tile's LOD resolution) but it is gated behind a buried sequence:
*enable Tiled LOD → zoom in → click Refine → enable "Edit LOD tiles."* The user naturally reaches
for the normal Sculpt brush, which is the destructive one.

### Gap B — per-tile edits are *level-locked* (they don't survive a zoom change)
`_lodEdits` is keyed by `lodCacheKey(v.z, col, row, ts)` — the **current view's level `v.z`**. An
edit painted at z=5 is stored under `(z=5,…)`. When you later view at z=7, `drawLODView` looks up
`(z=7,…)` keys and the z=5 edit **is not found** — so painted detail *disappears when you zoom
further*, and conversely fine detail painted at z=7 is invisible at z=3 (where it should appear as a
small notch). This breaks the very behaviour the user wants ("detail surfaces as you zoom,
consistently"). It is the multi-resolution-consistency problem that quadtree LOD solves by making
coarse nodes faithful down-samples of fine ones.

## 4. Proposed design (staged, bit-identical at defaults)

The guiding principle (from the atlas doc): **the macro `field` is the scaffold; detail lives in a
world-anchored, mip-consistent override that is *added on top* of the procedural base and only
resolves where/when the zoom warrants it.** Nothing changes on the default render path.

### Stage 1 — "Detail amount on zoom" + workflow smoothing (low risk)
*Goal: make the existing system pleasant and give the user the missing knob.*
- **Detail slider** driving `addZoomDetail`'s `detailAmp` (and optionally `extra` octave count) —
  "how much fractal relief emerges as you zoom." Default reproduces today's amplitude exactly
  (bit-identical). This directly delivers "deltas/fjords-scale roughness appears on zoom" for
  *procedural* terrain without any edit-store change.
- **Auto-LOD on zoom**: when the user zooms past ~2× on the main map, transparently enter the LOD
  viewer (today it's a manual checkbox). Debounced auto-refine already exists
  (`scheduleLodRefine`); wire the zoom-in gesture to it so detail streams in without ceremony.
- **One brush, zoom-aware**: the Sculpt brush, when zoomed in (LOD active), routes to
  `editTileAt` (non-destructive) instead of `sculpt()` (destructive). At base zoom it still edits
  the macro `field`. No new mode toggle — the zoom level decides.

### Stage 2 — world-anchored, mip-consistent edit store (the core fix for Gap B)
*Goal: painted detail surfaces correctly at every zoom and never aliases the macro map.*
- Replace the level-locked `_lodEdits` key with a **finest-level edit residency**: store each edit
  at the **finest level touched** (its native resolution), keyed by world-space chunk address, not
  by the transient view level.
- When compositing a view at level z, a tile **pulls its edits from the finest stored level and
  down-samples** (box/area average) into the tile — so a fjord painted at z=7 shows full-detail at
  z=7 and as a faithful small notch at z=3 (never a chunky alias, never absent). This is the
  quadtree "coarse = down-sample of children" invariant applied to the edit layer.
- The procedural base stays reproducible; edits remain a pure additive override (delta vs the
  procedural tile), so re-refine never overwrites them (already the v0.075 contract — preserved).
- **Bake → atlas** flattens edit + procedural into the permanent chunk (already exists); baked
  chunks become authoritative and `bakedCover` stops refinement beneath them (already exists).

### Stage 3 — detail feature brushes at zoom (payoff)
*Goal: the user's literal ask — "draw broad river deltas, fjords, landmarks" at zoom.*
- Reuse the existing plotline feature brushes (`applyFeatureAlongCurve`: mountainRange, river,
  canyon, escarpment, …) but target the **detail layer** at the current zoom instead of the coarse
  `field`. A delta/fjord drawn at z=6 is stored at z=6 resolution, down-samples cleanly into the
  world view, and only resolves its fine shape on zoom-in.

### Bit-identical discipline
- Default render path (LOD off, detail slider at its legacy value) stays **byte-identical** —
  asserted by the cmp harness (FIELD/TEMP/RENDER), exactly as every prior version.
- The edit-store refactor is gated behind the LOD/zoom path; with no edits present the composite is
  the pure procedural tile (today's behaviour).
- Pure cores (down-sample, world-chunk addressing, mip pull) are headless-tested like
  `amplifyRegion`/`refineTile`; the canvas/interaction parts are browser-verified per project rule.

## 5. Why this doesn't "compromise the tool"

- **No engine rewrite**: every stage reuses shipped, tested primitives (`amplifyRegion`,
  `pyramidTile`, `_lodEdits`, atlas). The only genuinely new logic is the mip-consistent down-sample
  of the edit layer (Stage 2) — a small pure function.
- **The destructive macro sculpt stays** for deliberate large-scale shaping (it's correct at world
  scale); it simply stops being the *only* path, and stops being what fine detail-painting lands in.
- **Memory stays bounded** (the whole point of the LOD/atlas): only visible tiles + LRU are live;
  8K/16K is never allocated whole.
- **Save/portability preserved**: edits + bakes already round-trip through the project ZIP +
  `World/` atlas export (v0.086/0.118).

## 6. Sources

- World Machine Help — Terrain Views / Tiled output / Professional addendum (help.world-machine.com).
- QuadSpinner Gaea — Build / Tiled Build docs (docs.quadspinner.com, quadspinner.com/Gaea/Build).
- Quadtree terrain LOD & wavelet LOD — ISPRS "Adaptive Level of Detail for Large Terrain
  Visualization"; SciTePress "Large-scale Terrain LOD based on Wavelet Transform".
- Multi-octave / band-limited procedural detail — Red Blob Games noise maps; Cesium "Procedural
  Terrain Generation with Noise Functions"; band-limited noise patents.
- Virtual texturing / clipmaps / sparse megatexture — Wikipedia *Clipmap/MegaTexture*; GameDev.net
  "Virtual Texture Terrain"; "Clipmaps vs sparse virtual textures."
- Internal: `docs/ATLAS_ARCHITECTURE.md`, `docs/LOD_PYRAMID_PLAN.md`, `docs/research/map-painting-ux.md`,
  `docs/research/multiscale-rivers.md`.
