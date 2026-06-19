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
- **Phase B — Tectonic inversion for imported heightmaps (shipped, v0.106).**
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

## Phase A — step 2 (shipped, v0.105)

Six resource potential fields, carrying capacity, settlement suitability, and advisory seeds. All
debug-view + export only; bit-identical defaults preserved. 592 assertions, 0 failed.

### Primitives (pure, headless-tested)

- `buildResourcePotentials(lith, boundaryType, shearField, flowField, biome, fld, rain, age, W, H, sea)` → `{copper,tin,iron,gold,salt,timber}` — six `Float32Array [0,1]`.
  Copper: chamferDist decay from subduction/arcOO boundary cells × lith amplifier (andesite×1, basalt×0.8, other×0.55).
  Tin: old granite shields (lith=0, age>0.6) → 0.70; metamorphic skarn → 0.45.
  Iron: old craton BIF (granite, old, no boundary) → 0.65; bog iron (shale + wet + lowland) → 0.55.
  Gold: transform fault (BTYPE=5, shear) → up to 1.0; sheared granite → 0.55; old shield → 0.12 background.
  Salt: arid lowland limestone/sandstone (rain<0.22, r<0.25) → up to 0.90.
  Timber: closed-canopy biomes (3=boreal/4=conifer/5=tempForest/6=tempRain/12=tropWet) → rain-scaled [0.40–1.0].
- `buildCarryingCapacity(soil, water, biome, temp, fld, W, H, sea)` → `Float32Array [0,1]`.
  `K = soil × tempBell(18°C,σ²=800) × (0.25+0.75·water)`. Ocean → 0.
- `buildSettlementSuitability(soil, water, carryingCap, fld, slopeN, W, H, sea)` → `Float32Array [0,1]`.
  `P = σ(6·(Z−0.5))` where `Z = 0.35·K + 0.25·W + 0.15·A + 0.10·D + 0.15·C`.
  A = accessibility (1−slope/slopeMax), D = defensibility (peak at r≈0.35), C = coast/trade.
- `findSettlementSeeds(suit, W, H, opts)` → `Array<{x,y,score}>` sorted desc. Local maxima above
  threshold (default 0.65) with greedy suppression radius (default W/20). Never auto-places.

### Integration (zero default effect)

- Caches `_resourcePots/_carryCapField/_settleSuitField`, cleared in `generate()` + `computeFlow()`.
- `currentResourcePotentials/currentCarryingCapacity/currentSettlementSuitability` lazy builders.
- Debug views **Resources / Carry Cap / Settlement** (+ vctx seed-dot overlay for Settlement).
- Export adds `copper/iron/gold/salt/timber_potential.f32` + `carrying_capacity.f32` + `settlement_suitability.f32` + `resource_index.json`.

### Verification

```bash
tests/run.sh elevation_foundation_v0.105.html   # 592 assertions, 0 failed
```
Browser pass owed: resource/carry/settle debug-view legibility + advisory seed-dot overlay aesthetics.

## Phase B — tectonic inversion for imported heightmaps (shipped, v0.106)

### Why

An imported DEM (`loadImage`/`loadZip`) arrives with `field[]` populated but every tectonic proxy
field zeroed (`allocate()`) and `plates=[]`. The Phase A affordance fields (and the engine's relief,
biome, orogeny layers) all read those proxies — `plateCrust()`, `ageField`, `volcanicField`,
`resistanceField`, `boundaryType`, `shearField`, `stressField` — so for any real-world heightmap the
whole civilization stack and the Tect/Lith/Resources debug views + exports are dead. Phase B
reconstructs a *plausible* proxy set from the imported terrain so those layers work for DEMs too.

### Approach

Reduce inversion to **reconstruct `plates[]` + `plateId`, then run the forward downstream stages**.
Mountains/rifts mark plate **boundaries**; cratonic plains & ocean basins mark **interiors**. Seed
plates in low-relief interiors, partition by the existing `assignPlates()` JFA Voronoi (boundaries
fall along the relief belts), classify crust from elevation, and synthesise stress **directly from
relief** (velocity inversion is ill-posed). Deterministic from the heightmap alone — no RNG/seed.

### Primitives (pure, headless-tested; amplifyRegion mold)

- `buildReliefField(fld,W,H,opts)` → `[0,1]` boundary-probability (blurred gradient magnitude).
- `pickPlateSeeds(relief,W,H,opts)` → `[{x,y}]` lowest-relief cell per aspect-preserving grid cell.
- `classifyPlateCrust(fld,plateId,nPlates,W,H,sea)` → `base[]` (mean-elevation → sign, |base|∈[0.55,1]).
- `reconstructBoundaryStress(fld,plateId,base,relief,W,H,sea,opts)` → `{stressField, shearField,
  boundaryMask, boundaryType}` — the novel core (parallel to `computeStress`, reuses
  `classifyBoundary` + `gaussBlur`): `C` = relief × sign of updip (boundary elev vs `gaussBlur`
  trend) → convergent on belts / divergent in troughs; `S` = along-strike gradient → transforms.
- `stampVolcanicArcs(boundaryType,W,H,opts)` → `[0,1]` (`chamferDist` decay from subduction/arc cells).

### Orchestrator (reuses forward machinery)

`inferTectonics()` builds the above, sets module `plates`/`plateId`, then runs `distanceToBoundary()`
→`ageField`, `computeHeterogeneity()`, `computeResistance()`, `computeFlexure()`, blurred `baseField`,
and clears the affordance/graph caches. Opt-in **"Infer tectonics from heightmap"** Import-menu button
(`_canInvert` after import); **never called from `generate()`**. Leaves `field` untouched.

### Verification

```bash
tests/run.sh elevation_foundation_v0.106.html   # 615 assertions, 0 failed (+23)
```
Bit-identical at defaults to v0.105 (FIELD/TEMP/RENDER cross-version cmp-clean — inversion never runs
in `generate()`). Browser pass owed: import a real DEM → *Infer tectonics* → confirm the Tect graph
follows the mountain belts and Lith/Resources views populate sensibly.
