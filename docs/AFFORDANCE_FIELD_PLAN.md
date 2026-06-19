# Affordance Field Foundation (AGFK state layer) — Plan & Status

## Why

The user supplied ten unified-engine specs. An audit found that most of the rendering /
curvature / SDF / loading-message material is **already shipped** in the elevation foundation, but
the **civilization / affordance layer is genuinely absent**: no lithology, soil, resources,
settlement suitability, carrying capacity, or cost-surface/route solver. Per the docs
(`Civilisation_placement.md`, `Cartalith_Raster_Civilization_Layer.md`,
`Cartalith_Unified_Engine_Specification §III`, `Upgrades_1.md` AGFK), civilization must be a
**derived continuous-raster field** over the existing terrain — not hex grids, not autonomous
placement ("the system proposes; the author decides").

This workstream builds that state layer as **pure raster map-algebra primitives** (the
`amplifyRegion`/`buildAOField`/`buildWaterBodies` mold): every input an argument, deterministic,
headless-testable, **debug-view + export only** so `generate()` and the default render stay
bit-identical. The fields are what the eventual Cartalith merge (AGFK sampling kernel) consumes
for settlement suggestion and route cost surfaces.

## Roadmap context (unification last)

- **Phase A — Affordance fields (this doc).** Lithology → soil → water access → resources →
  carrying capacity → settlement suitability.
- Phase B — Tectonic inversion for imported heightmaps.
- Phase C — Multi-channel RGBA atlasing export.
- Phase D — "The Painter" NPR (D1 multi-sun shipped in v0.104; hachure/ink/watercolor/contour-veins follow).
- Phase E — Anisotropic cost surface + lazy A*/Eikonal route solver (inline; no libs).
- Phase F — Unification with Cartalith (the AGFK sampler + merged UI). **Last.**

GitHub-doc library recommendations are adopted as **inline zero-dependency techniques** (RDP,
gzip via `CompressionStream`, JFA, MinHeap already inline; A*/FMM and multi-channel packing land
in Phases C/E). No vendored libraries — `file://` must keep working.

## Phase A — step 1 (shipped, v0.104)

Lithology, soil fertility, water access, multi-sun. All in `elevation_foundation_v0.104.html`.

### Primitives (pure, headless-tested)

- `buildLithology(fld, age, hetero, volc, crust, resist, rain, W, H, sea, opts)` → `Uint8Array`.
  Rock type from the engine's tectonic proxies (no lithology was tracked before):
  oceanic crust (`crust<0`) → basalt; volcanic (`volc>volcTh`) → andesite; hard basement
  (`resist>resHard`) → granite shield (old) / metamorphic (young); sedimentary lowland (`r<0.30`)
  → limestone (wet) / sandstone (arid) / shale (mid); upland default → granite (old) / shale.
  Frozen append-only `LITH_KEYS` (granite, basalt, andesite, limestone, sandstone, shale,
  metamorphic) + `LITH_WEATHER` weatherability lookup (Jenny) + `lithIndexManifest()`.
- `buildSoilFertility(lith, temp, rain, slopeN, age, W, H, opts)` → `Float32Array [0,1]`.
  `S = climateBell(T) · moisture · lithWeather · slopeShed · time`. `slopeN = slopeAt·W`
  (resolution-independent). Monotonic ↑ rain, ↓ slope (asserted).
- `buildWaterAccess(flowField, fld, W, H, sea, opts)` → `Float32Array [0,1]`.
  `exp(−d/λ)` from the nearest river (`flow>thresh`) or coast, via `chamferDist`. Water = 1.

### Integration (zero default effect)

- Caches `_lithField/_soilField/_waterField`, cleared in `generate()` + `computeFlow()`.
- `currentLithology/currentSoil/currentWaterAccess` lazy builders (the `currentWaterBodies` idiom).
- Debug views **Lith / Soil / Water** (`#debugSeg` + `updateLegend`), built only when selected.
- Export adds `lithology_raster.bin` + `lithology_index.json` + `soil_fertility.f32` +
  `water_access.f32` (the `biome_raster.bin` precedent).
- **Multi-sun** (Painter D1): `multiSunShade(x,y)` 4-light blend (0.40/0.30/0.20/0.10 + ambient
  floor); `macroShade()` selects it when `state.viz.multiSun`; used in `surfaceColor` +
  `buildGridFields`. Off ⇒ single-source `shadeFactor` ⇒ bit-identical. Style-tab checkbox.

### Verification

```bash
tests/run.sh elevation_foundation_v0.104.html   # 555 assertions, 0 failed
```
Cross-version determinism (pinned seed 12345, region 256): FIELD/TEMP/RAIN/RENDER hashes
byte-identical between v0.103 and v0.104. Browser pass owed: Lith/Soil/Water legibility and
multi-sun relief.

## Phase A — step 2 (next, v0.105–0.106)

- Resource/ore potential fields (copper, tin, iron, gold, salt, timber, freshwater) from
  lithology + tectonic setting (subduction → Cu, granite+orogeny → Sn, craton/bog → Fe, fault →
  Au, evaporite → salt) — `Civilisation_placement.md §8`, all `[0,1]` scalar fields.
- Food/carrying capacity `K = agriculture·efficiency` and settlement suitability
  `P_settle = σ(w·[F,W,A,D,C])` (logistic) — `Cartalith_Raster_Civilization_Layer.md §3`.
- Emergent settlement markers = local maxima of `P_settle` above a threshold with a suppression
  radius (advisory overlay, never auto-placed).
- All debug-view + export only; bit-identical default preserved.
