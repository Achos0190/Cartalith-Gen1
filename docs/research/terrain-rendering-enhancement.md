# Cartalith Terrain Rendering Enhancement Framework

*User research note, June 2026. Feeds the visual-quality workstream.*

## Abstract

The terrain generator produces plausible geomorphology but lacks the hierarchical rendering
processes characteristic of high-quality cartographic relief imagery. Improvement should focus
on multi-scale shading, procedural texture synthesis, flow-line extraction, and ridge
enhancement rather than additional geological complexity. The objective is to approach
painterly terrain representations while preserving scalability to very high resolutions (>16k).

---

## 1. Multi-Scale Relief Shading

Single-frequency hillshading produces smooth, synthetic surfaces. Natural terrain exhibits
structure across several spatial frequencies.

**Macro scale** — mountain systems and broad valleys:
```
S_M = Hillshade(H, σ_M)      σ_M ≈ 64–128 pixels
```

**Meso scale** — secondary ridges and drainage basins:
```
S_m = Hillshade(H, σ_m)      σ_m ≈ 8–32 pixels
```

**Micro scale** — rock roughness and local surface irregularity:
```
S_µ = Hillshade(H, σ_µ)      σ_µ ≈ 2–8 pixels
```

**Combined illumination:**
```
S_final = 0.55·S_M + 0.30·S_m + 0.15·S_µ
```

Creates depth without excessive contrast.

### Implementation notes

The existing `shadeFactor(x,y)` uses a single-scale Sobel-based normal. This proposal adds
Gaussian-blurred copies of the heightmap at σ_M and σ_m before computing normals — matching
the `smoothSeaH` (box-blur) pattern already used for water shading. Compute-once in
`buildGridFields` / `renderNow` prologue (like `_seaH`/`_seaShade`).

Weights 0.55/0.30/0.15 should be slider-exposed eventually; start with hardcoded defaults.

---

## 2. Hierarchical Ridge Synthesis

Smooth fractal noise produces rounded blobs rather than folded mountain systems.

**Ridged noise:**
```
R(x,y) = (1 − |2N(x,y) − 1|)²
```

where N(x,y) is coherent (Perlin/Simplex) noise.

**Multi-octave:**
```
R_total = Σᵢ aᵢ Rᵢ
```

**Elevation-weighted to prevent lowland contamination:**
```
R_weighted = R_total · H²
```

### Implementation notes

The engine already has a `ridged` flag in `state.tect` used in `amplifyRegion`'s high-frequency
detail. This formalises and extends it: `ridgedFbm(x,y,octaves,seed)` as a standalone pure
function (no module globals), the elevation gate `H²` applied in `amplifyRegion` or
`landColorCore`. The `ridged` flag drives the switch; a strength slider would let users
tune lowland/mountain contrast.

---

## 3. Slope-Dependent Material Masks

Material assignment should derive from terrain metrics rather than biome colour alone.

**Terrain metrics:**
```
Slope:       G = √((∂H/∂x)² + (∂H/∂y)²)
Height:      h_n = (H − H_min) / (H_max − H_min)
Curvature:   C = ∇²H
```

**Material weights:**
```
Rock:       W_r = G^1.5
Grass:      W_g = 1 − G
Dry ground: W_d = 1 − Rain
Forest:     W_f = Rain · (1 − G)
```

**Final colour:**
```
C_final = W_r·C_r + W_g·C_g + W_d·C_d + W_f·C_f
```

### Implementation notes

`materialWeights(T, M, slope, r, twi, asp, curv)` already incorporates slope (`r`) and
moisture (`M`) — the framework here gives a cleaner, more explicit formulation of the same
idea. The `G^1.5` rock weight vs the existing linear `r` term is the key refinement. 
Curvature C is already computed for some debug views; could be exposed in `materialWeights`
for concavity-driven wetness.

---

## 4. Flow Field Enhancement

The reference style reveals nearly all drainage systems.

**Flow accumulation:**
```
F(i) = 1 + Σⱼ F(j)     (upstream cells contribute to downstream discharge)
```

**River width:**
```
W = W₀ + k·F^0.45
```

**Minor channels** (0.001 < F < 0.01) should be rendered as subtle terrain lines rather
than omitted.

### Implementation notes

`buildRiverField` (v0.076) already does discharge-widened rivers. The key additions:
- Extend the threshold floor down to catch minor channels (currently only trunk rivers
  shown above a `thresh`).
- Use `F^0.45` Hack's law exponent rather than the current log-scale `mag`.
- A "minor channels" toggle rendering subtle blue-grey lines for low-accumulation cells
  (similar to the `guideDrawMode` overlay idiom, not baked into the biome raster).

---

## 5. Ambient Occlusion

Terrain valleys possess local darkness independent of illumination direction.

**Approximation:**
```
AO = 1 − k·(H̄_neighbour − H)      k ≈ 0.2
```

**Combined:**
```
S' = S_final · AO
```

Improves depth perception significantly.

### Implementation notes

This is a fast screen-space AO approximation — sum the height difference vs a kernel of
neighbours (e.g., 8-neighbourhood at σ_M scale), clamp positive, scale by k. Pure function
of the heightmap, compute in the `renderNow` prologue alongside `_seaH`. Render-only:
field/temp/rain untouched. A toggle + strength slider.

---

## 6. Ridge Crest Enhancement

Mountain crests are visually dominant features.

**Ridge detection:**
```
R_c = (C < 0) ∩ (G > G_threshold)
```

where negative curvature (convex cells) at high slope identifies crests.

**Highlight intensity:**
```
I_r = 0.3·G
```

Thin bright strokes along detected crests → the characteristic hand-painted appearance
observed in relief atlases.

### Implementation notes

Curvature sign is already computed in the existing debug views. The crest overlay would be
rendered as a thin bright stroke over the biome map (similar to the existing `_riverField`
river overlay). A pure `buildCrestField(fld, W, H)` → `_crestField` (built lazily like
`_riverField`, cleared on `computeFlow`). Toggle in the Style tab.

---

## 7. Procedural Texture Synthesis

Uniform colour regions should be avoided.

**Three-frequency texture variation:**
```
T₁ = fBm(0.25x)      (large)
T₂ = fBm(x)          (medium)
T₃ = fBm(4x)         (fine)

T = 0.5·T₁ + 0.3·T₂ + 0.2·T₃
```

**Colour modulation:**
```
C' = C_base · (1 + 0.1·T)
```

### Implementation notes

The existing parchment grain (`state.viz.parchment`, v0.050) is a two-octave `vnoise`
texture. This generalises the pattern to land colour via `landColorCore` — a three-frequency
fbm modulation applied after the climate ramp and material blending, similar to the tint-ratio
splat path. Strength slider; off ⇒ bit-identical (0-gated like `pk>0` parchment gate).

---

## 8. High-Resolution Rendering Strategy

All procedural functions must be evaluated in **world coordinates**, not local tile
coordinates:

```
f(x,y) → f(X_world, Y_world)
```

This is already guaranteed by `amplifyRegion`'s world-space fbm detail and by the seam-Δ=0
assertion on `refineTile`. Any new noise introduced by this framework (ridged detail,
texture synthesis, crest field) must use the same world-coordinate convention — pure
functions of `(world_x / GW, world_y / GH)` — so that tiled 16k outputs are seamless
by construction, not by stitching.

---

## 9. Recommended Rendering Pipeline Order

Consistent with the existing `landColorCore` / `seaColorCore` structure:

1. Height field (`field`)
2. Multi-scale hillshading (new `_shadeM`/`_shadem`/`_shadeMicro`)
3. Ambient occlusion (new `_aoField`)
4. Material masks (`materialWeights` — slope/height/curvature inputs refined)
5. Procedural textures (three-frequency `T`, colour modulation)
6. Colour blending (`landColorCore` output with refined weights)
7. Flow-line overlay (`_riverField` extended to minor channels)
8. Ridge highlights (new `_crestField`)
9. Biome and vegetation tinting (existing climate ramp, parchment grain, icons, waves)
10. Export / bake (`bakePixel` / `buildGridFields`)

Steps 2–3 are new render-only precomputes (like `_seaH`); steps 4–6 extend existing
functions; 7–8 extend existing overlay idioms.

---

## Phased implementation plan

| Phase | Content | Version target |
|-------|---------|----------------|
| **R1** | Multi-scale hillshading (`_shadeM`/`_shadem`/`_shadeMicro`, weighted blend) + AO | v0.082 |
| **R2** | Ridge crest enhancement (`_crestField`, thin bright overlay) + slope-material refinement (`G^1.5` rock, curvature wetness) | v0.083 |
| **R3** | Procedural texture synthesis (three-frequency fbm colour modulation) + minor-channel flow lines | v0.084 |
| **R4** | Ridged-noise elevation-weighted detail (`ridgedFbm` formalised, strength slider) | v0.085 |

All phases are **render-only by default** (field/temp/rain bit-identical) with a toggle per
feature and gated strength sliders.

> Note: v0.082 is currently reserved for Atlas Phase 2b (cross-session IDB persistence). If
> the atlas work ships as planned, the rendering phases shift up by one version accordingly.
