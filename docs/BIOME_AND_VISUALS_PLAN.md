# Biome Painting & Map Visual Quality — Plan

Two coupled goals: (1) make the generator's rich biome output flow into Cartalith's painting system *without losing detail*, and (2) raise Cartalith's visual quality with a **hybrid** look — realistic textured relief as the base, **togglable** stylized (Nortantis-style) mountain/forest icons on top.

Decisions locked (June 2026): hybrid visuals (toggle); **dual layer** biome handoff (full-res raster + editable coarse paint grid); assets from a **sibling `assets/` folder** only when a reputable open-licensed pack is present, otherwise procedural fallback; compression via inlined **fflate**.

---

## Part A — Biome handoff: dual raster + paint grid

The generator already computes, per land pixel, a material mixture `{snow, rock, sand, wetland, canopy, grass}` plus `classifyBiome(T, M)`. Cartalith stores a coarse `state.grid` of 14 biome indices (Uint8, RLE-baked). Rather than collapse one into the other, carry **both**, non-destructively (matches `docs/UNIFIED_TOOL_PLAN.md`'s layer model):

**Layer 1 — Biome raster (generator-owned, full resolution).** The generator emits a per-pixel biome/material image (`layers/biome.png`) and the raw fields (`temperature.f32`, `rainfall.f32`, heightmap). This is the *source of truth* for fine detail and renders as the base map in Cartalith.

**Layer 2 — Paint grid (user-owned, coarse, editable).** On import, auto-fill `state.grid.data` by sampling the generator's biome per cell: take the dominant `classifyBiome` result over each cell's pixels, mapped to Cartalith's 14 indices (`docs/research/ui-unified-tool.md`). The user paints over this; **per-cell lock flag** protects hand edits from re-fills (handoff Phase 1).

**Why dual, not quantize-only:** the raster keeps the painterly per-pixel gradients (mangrove fringes, alpine zonation) that 14 indices can't hold, while the paint grid stays the lightweight, hand-editable, politically-meaningful layer Cartalith already understands. Regenerating terrain refreshes Layer 1; Layer 2's locked cells persist.

**Biome → 14-index mapping table.** Author one explicit lookup from the generator's material/`classifyBiome` space to Cartalith's `BIOME` enum (coastal, temperate, jungle, boreal, mountain, desert, wetlands, tundra, ocean, hills, lake/river, ruined, …). Unmapped/transition pixels pick the nearest by `(T, M, elevation)` distance. Ship a "Fill biomes from climate" button (and an auto-fill on first import) that respects locks.

**Köppen upgrade (after W3).** When seasonal Köppen classification lands, add a richer optional mode: the raster can carry Köppen classes; the paint grid stays 14 indices unless the user later expands Cartalith's palette (deferred — flagged as a future option, not this plan).

---

## Part B — Visual quality: hybrid realistic + stylized

Layered renderer; each layer toggleable. Base layers are **pure-procedural** (always work single-file/offline). Asset-backed layers activate only when a sibling `assets/` pack is detected, degrading gracefully to procedural equivalents.

### B1 — Realistic base (no assets, ship first)
Compositing order, all on canvas 2D (techniques per `docs/research/` stylization findings):
1. **Hypsometric tint** by elevation (already present) — the color floor.
2. **Biome material color** (already present) blended by `bioBlend`.
3. **Multi-scale hillshade** (already present: 0.4 macro + 0.4 meso + 0.2 micro) — keep, expose a "relief strength" already in `exag`.
4. **Parchment/paper grain** (new, procedural): a tiling value-noise overlay blended `multiply` at low opacity for a drawn-on-paper base even without a texture pack. Reference: canvas `globalCompositeOperation='multiply'` + `ctx.filter`.
5. **Atmospheric haze** (already present).

### B2 — Texture splatting (asset-enhanced, optional)
Blend tiling biome textures (rock, grass, sand, forest-canopy, snow) weighted by the per-pixel material fractions the renderer already computes: `outRGB = Σ material_i · sampleTexture_i(uv)`. Top-3 materials per pixel for speed; precompute at working res, upscale for bakes. Procedural fallback when no pack: current flat material colors. This is the single biggest realism jump and reuses `materialWeights` directly.

### B3 — Stylized mountain/forest icons (asset-enhanced, the "Nortantis toggle")
A togglable vector/sprite layer drawn over the relief:
1. **Ridgeline detection** from the heightmap — local-maxima chains / high-curvature lines (we already have `curvatureAt`, `slopeAt`, `flowField`). Threshold by elevation like Nortantis (`mountainElevationThreshold` ≈ 0.58, `hillElevationThreshold` ≈ 0.53).
2. **Icon clustering & placement** along ridges, largest peaks on the main spine, smaller branching at 30–60°, spacing to avoid overcrowding (Nortantis `maxGapSizeInMountainClusters`). Scale icons by elevation; draw large→small for depth (z-order).
3. **Forest stippling** in high-canopy biome cells; **hill glyphs** in the 0.53–0.58 band.
4. **Render**: either CC0 PNG sprites (asset pack) or procedurally drawn vector glyphs (fallback) so the toggle works with zero assets.

> Nortantis (AGPL-3.0) is studied for *algorithm* only — thresholds, clustering, z-order. No code is copied; the implementation is original. This keeps Cartalith's licensing unconstrained.

### B4 — Coastline & water styling (optional polish)
Spline-smoothed coastlines (Catmull-Rom — Cartalith already has the sampler) to hide grid artifacts; layered "ocean wave" line styling near shore. Procedural; no assets.

---

## Asset packs (CC0 / open, pending your visual approval)

Assets load **only** from a sibling `assets/` folder, and **only after you approve a pack on visual quality**. Shortlist by reputation:

| Pack | License | Use | Reputation |
|------|---------|-----|------------|
| **Poly Haven** textures (polyhaven.com) | CC0 | Parchment/paper base, biome ground textures (rock, grass, sand, snow) | The gold-standard CC0 PBR library; very widely praised, donation-funded, broad professional use |
| **ambientCG** (ambientcg.com) | CC0 | Same — 2000+ materials incl. `Paper001` parchment | Highly regarded CC0 source, frequently recommended alongside Poly Haven |
| **K.M. Alexander #NoBadMaps brushes** | CC0 | Mountain/tree/city map icons (1,140+ PNG) | Popular in the fantasy-cartography community |
| **OpenGameArt CC0** map symbol packs | CC0 | Supplementary mountain/forest/hill icons | Community-reviewed; mixed quality — cherry-pick |

**Process:** I'll assemble a small candidate set (a few MB), you eyeball it, we vendor the approved subset into `assets/` with a `CREDITS.md` (CC0 needs no attribution but we record provenance). The tool ships working **without** the folder (procedural fallback), so the single-file/offline guarantee holds; the pack is a quality upgrade, not a dependency.

---

## Sequencing

1. **Biome raster export + 14-index fill with lock flags** (Part A) — unblocks the Cartalith handoff; no assets needed.
2. **Procedural realistic base** (B1) — parchment grain + relief tuning; pure code.
3. **Texture splatting** (B2) — biggest realism gain; needs an approved ground-texture pack (Poly Haven/ambientCG).
4. **Stylized icon layer toggle** (B3) — ridge detection first (testable headless), then sprite/vector rendering.
5. **Coastline/water polish** (B4) — optional.

Each step is independently shippable and falls back to the prior look if its assets are absent. Verification: ridge-detection and biome-mapping logic get headless assertions (`tests/`); texture/icon rendering needs browser visual checks (flag in summaries).
