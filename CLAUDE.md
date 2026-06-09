# Cartalith Gen1

HTML worldbuilding toolset. Two single-file apps being merged into one tool ("Gen1"):

| File | Lines | Role |
|------|-------|------|
| `elevation_foundation_v0.037.html` | ~2,400 | **Current** procedural heightmap/terrain/climate generator |
| `elevation_foundation_v0.036.html` | ~2,400 | Previous version (kept; don't edit) |
| `Cartalith_V1.914.html` | ~15,300 | Cartographic editor: routes, settlements, painted biome/terrain grid, politics timeline, journey planner |
| `Weather Model.md`, `Gravity influence.md` | — | User research notes feeding the roadmap |
| `docs/` | — | Research reports, roadmap, unified-tool plan |
| `tests/` | — | Headless verification harness for the elevation foundation |

Both apps are zero-dependency single-file HTML/JS/CSS, designed to open via `file://`. A local HTTP server is an accepted fallback for features that need it (Workers, WASM threads); `file://` must degrade gracefully, never break.

## Working rules

- Finish one thing before starting the next. Confirm design before building.
- Never let unbuilt features read as regressions in conversation.
- **After any change to the elevation foundation: run the `verify-elevation` skill (`tests/run.sh`).** A change is not done until it passes.
- GPU (WebGL) code cannot be tested headlessly — flag shader changes for manual browser verification.
- New version = new file (`elevation_foundation_v0.0XX.html`); don't edit old versions in place.

## elevation_foundation architecture (v0.036)

One `<script>` block, module-level globals, no classes. Resolution `GW × GH` (world mode = 2:1 equirectangular, region = 1.56:1, `GH = gridH(GW)`).

Global Float32Arrays (allocated in `allocate()`, line ~921): `field` (heightmap [0,1], sea level default 0.42), `stressField`, `baseField`, `ageField`, `flexureField`, `heterogeneityField`, `resistanceField`, `volcanicField`, `impactField`, `tempField` (°C), `rainField` [0,1], `flowField`, `continentalField` (nullable), plus `plateId` (Int16), `boundaryMask` (Uint8), `warpX`/`warpY` (nullable until `computeWarp()`).

Pipeline (`generate()`): continentality (if world_structure on) → warp → plates (Voronoi + Lloyd) → JFA assign → stress → flexure → base blur + age → heterogeneity → resistance → height formula → normalize → volcanism + craters → **flow(area) → climate → flow(discharge)** (`computeTemperature`, `simulateWeather` on a coarse 240×150 grid, correctors) → render (`renderNow`). The flow→climate→flow sandwich is deliberate (LEM-style coupling): rivers accumulate *runoff*, so `computeFlow(true)` seeds cells with mean-normalised `rainField` instead of 1. The natural-order rationale and formulas live in `docs/research/pipeline-order-audit.md` — keep new stages consistent with its canonical order (climate before water-driven processes, biomes last).

Since v0.037, erosion ops (`erode`, `streamPowerErode`, `glacialErode`) also: spawn droplets ∝ precipitation, apply `isostaticRebound(pre)` (~80% of broad eroded column returns as uplift, England & Molnar 1990), and refresh with `computeFlow(true)`.

Renderer: per-pixel material mixture `{snow, rock, sand, wetland, canopy, grass}` from `materialWeights(T, M, slope, r, twi, asp, curv)` (Σ=1 invariant); `classifyBiome(t,m)`; multi-scale hillshade; atmospheric haze.

Erosion (all in-place on `field`): `erode()` (droplet hydraulic), `erodeThermal/CPU`, `hillslopeDiffuse`, `streamPowerErode` (resistance-modulated K), `glacialErode`, `coastalProcess`.

GPU: WebGL2 fragment-shader compute with CPU fallbacks everywhere; RGBA8 float packing (R32F migration is pending work). Coarse-grid blur is always CPU `blurCoarse()`.

Export/import: `exportZip()` / `loadZip()` — `params.json` + `heightmap.f32` + `temperature.f32` + `rainfall.f32` + PNG layers (+ optional tiles).

### Invariants (never violate)

1. `materialWeights` fractions sum to 1.0 for all valid inputs.
2. All Float32Arrays remain finite after every pipeline stage.
3. Coarse-grid (240×150) blur always uses CPU `blurCoarse()` — never GPU.
4. `warpX`/`warpY` may be `null` before `computeWarp()` — consumers must null-check.
5. `deriveFromWorldStructure()` is called only from checkbox/archetype handlers, never inside `generate()`.
6. Transient UI state is never serialized.
7. `v(id,val)` / `lab(id,txt)` are module-level globals.
8. The γC height term was deliberately removed — do not re-add it (plate base reclassification already encodes continental elevation).
9. World mode seam: avg wrap delta < 0.12 (asserted in tests).

> Note: the legacy handoff doc lists an older `state.erosion` shape (`strength`/`evap`). The file is authoritative — current droplet params are `inertia`, `capacity`, `erode`, `evaporate`, `gravity`, `maxLifetime`, etc.

## Cartalith_V1.914 architecture

One main `state` object (~line 9020): background `image` + `camera`; paint `grid` (Uint8Array biome/terrain indices, configurable `cellSize`, RLE-baked); vector `routes[]`/`ways[]`/`places[]` (centripetal Catmull-Rom sampling); `politics` (per-year Uint16Array territory slices); `calibration` (px↔km). Canvas-2D rendering with offscreen layer compositing.

Save format: ZIP, schema **v9** — `project.json` + `biome_baked.bin`/`terrain_baked.bin` + `politics_<year>.bin` + image (+ optional `planner.json`). Migration precedent: `migrateToV4()` (~line 14899). v1.914 has **no** elevation/climate/simulation code — it is the downstream editor; the elevation foundation is the upstream generator.

## Verification

```bash
tests/run.sh          # extract JS → node --check → headless smoke suite (CPU paths)
```

See `.claude/skills/verify-elevation/SKILL.md`. Stubs live in `tests/stub_head.js`; assertions in `tests/test_tail.js` — extend both when adding pipeline stages or browser APIs.

## Roadmap

See `docs/ROADMAP.md` (weather model v2, gravity parameter, optimization, unified tool) and `docs/UNIFIED_TOOL_PLAN.md` (merge plan). Research backing: `docs/research/`.
