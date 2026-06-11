# Cartalith Gen1

> **New session? Read `docs/HANDOFF.md` first** — current state, next task, how to verify.

HTML worldbuilding toolset. Two single-file apps being merged into one tool ("Gen1"):

| File | Lines | Role |
|------|-------|------|
| `elevation_foundation_v0.052.html` | ~3,200 | **Current** procedural heightmap/terrain/climate generator |
| `elevation_foundation_v0.036–51.html` | — | Previous versions (kept; don't edit) |
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

Since v0.038 (`docs/research/gravity-influence.md` G1): `state.planet = {g, rotationHours, axialTiltDeg, radiusRel}`. Gravity hooks: stream-power K ×g, droplet acceleration ×g, glacial abrasion ×g, temperature lapse ×g (CPU **and** GPU `uLapse` uniform — keep in lockstep), crater radius ×g^−0.22, coastal waveStr ×1/g (via temporary `state.coastal` swap so GPU and CPU paths match). Talus is deliberately g-independent. **Invariant 10: Earth defaults (g=1) must reproduce the previous version bit-exactly** (asserted in tests via g-toggle round-trip). `axialTiltDeg` has no effect yet — reserved for seasons (W3).

Since v0.039 (`docs/research/weather-model-v2.md` W1): `buildWind(wx,wy,WW,WH,step,tc)` builds a per-coarse-cell wind field — latitude-band circulation with cell count from `circulationCells()` (≈ `3·√((24/rotationHours)·radiusRel/√g)`, Earth = 3) plus a pressure-gradient perturbation (P′ ∝ −T, geostrophic with `|f|` floored at 0.25, downgradient within ~±15° of the equator, magnitude normalised to 0.8·step at `climate.pressK=1`, total capped at 1.8·step for semi-Lagrangian stability). Region mode defaults to `climate.windMode:'auto'`; `'manual'` + `windDir` is the legacy override. **Legacy saves load as `windMode:'manual', pressK:0`, which is bit-identical to v0.038** (proven cross-version). Region border inflow now wets any border cell whose wind points inward.

Since v0.040 (W2): ocean evaporation is bulk-aerodynamic when `climate.bulkEvap` (default true) — `E = Ce·U·(qs−q)`, wind speeds it up, saturation deficit caps it. The ITCZ/dry-belt corrector is scaled by `climate.zonalK` (default **0.5**; the W1 bands make most of the zonal structure emergent — measured equator max, 25–40° dry dip, wet westerlies with the corrector fully off — the corrector only sharpens contrast that 2-D advection can't reach without vertical subsidence). Legacy saves load as `zonalK:1, bulkEvap:false` — bit-identical to v0.039.

Since v0.041 (W0): droplet erosion lives in **`dropletKernel(fld, rain, W, H, P, onProgress)` — a deliberately self-contained function (no module globals)** that is stringified into a blob-URL Web Worker by `erodeAsync()` (UI path: copies field/rain in, transfers result back, progress %, sync fallback when Workers are unavailable or error). The sync `erode()` calls the same kernel — proven bit-identical to v0.040. **Invariant 11: `dropletKernel` must stay self-contained** — the suite rebuilds it from `toString()` with all module globals shadowed and asserts bit-identical output. Thermal pass, rebound, flow and climate refresh stay on the main thread (`erodeFinish`). The worker path itself can't run headless — verify in a browser after touching it.

Since v0.042 (`docs/BIOME_AND_VISUALS_PLAN.md` Part A): `buildBiomeRaster()` emits one Uint8 biome index per cell (0 = ocean, then a **frozen append-only order** `ice…tropWet` = 1…12) via `classifyBiome`; `exportZip()` adds `biome_raster.bin` + `biome_index.json` (decode manifest) for the Cartalith handoff. Index order is save-format-stable — never renumber `BIOME_KEYS`.

Since v0.043 (`docs/research/weather-model-v2.md` W3): opt-in seasons via `climate.seasons` (default off → bit-identical). `simulateWeather(iters, decl)` / `buildWind(...,decl)` shift the thermal equator & circulation bands by solar declination; `computeSeasons()` builds `tempJul/JanField`, `rainJul/JanField`, and a `koppenField` (Köppen–Geiger, `classifyKoppen` from seasonal temp extremes + summer/winter precip, normalized rain→mm via `climate.maxRainMm` default 3000). `KOPPEN_KEYS` is a **frozen 30-code list** (Af…EF); a 'Köppen' debug view and `koppen_raster.bin`/`koppen_index.json` export accompany it. Only the `axialTiltDeg` planet param drives the spread.

Since v0.044 (`docs/WORLD_REGIONAL_TILING_PLAN.md` Stage 3): `amplifyRegion(src, srcW, srcH, region, outW, outH, opts)` is a **pure, worker-ready** primitive (no globals) — upsamples a coarse sub-region (preserves continents/ranges) + adds world-space high-frequency `fbm` detail tapered by local relief and faded out underwater. Because both terms are pure functions of the shared coarse coordinate, adjacent tiles are **seam-Δ=0 exactly** (proven in tests). This is the verifiable core of the world→regional→16k tiling pipeline; the tiled-export/OffscreenCanvas/fflate wiring is the browser-bound follow-up.

Since v0.045 (W3.5): opt-in `climate.currents` adds wind-driven ocean surface currents — `applyOceanCurrents()` (coarse grid) transports heat meridionally (poleward flow → warm SST anomaly → mild wet coasts; equatorward flow → cold SST → cool fog-dry coasts, Benguela/Peru→Atacama), shifting ocean `tempField` and nearby coastal temp/rain. Runs after the moisture correctors, before `computeSeasons`. Off → bit-identical to v0.044.

Since v0.046 (user bug report — ridges instead of rivers): `streamPowerErode` rewritten — **MFD drainage** (Freeman 1991, slope^1.1-weighted spread to all lower neighbours; kills the straight 45° D8 channel artefact), **steepest-descent receivers** on the sink-filled surface, an **anti-ridge deposition clamp** (a channel cell can never be raised above its own pre-incision uplifted surface — this was the relief-inversion bug: routed-in upstream sediment overfilled channels), and **uplift normalised + default 0** (the button carves rivers; uplift is opt-in orogeny). Regression-tested: channels must net-incise downward and sit below their neighbours. The sidebar follows the planetary-formation cascade: Source → Planet → Calibrate → World Structure → Tectonics → Volcanism → Climate → Weather → Erosion → Glacial → Coastal → View → Save/Performance.

Since v0.047: a **Wind** debug view visualises the W1 prevailing-wind field — `currentWindField()` (read-only; rebuilds the coarse `tc` like `simulateWeather` then calls `buildWind` at decl=0) feeds a per-pixel hue=bearing/brightness=speed map plus coarse arrow glyphs (reusing the plate-arrow `vctx` idiom). Render-only → bit-identical to v0.046.

Since v0.048 (`docs/research/map-painting-ux.md`): the waypoint "Polyline sculpt (GPU)" is **replaced** by plotline feature brushes — draw a freehand guide stroke (`guideDrawMode`; raw points → `rdpSimplify` at ~1 screen px → `catmullRomSample`), pick one of 7 features, Apply. `applyFeatureAlongCurve(fld, W, H, curve, feature, radius, strength, seed, opts)` is a pure-ish testable primitive (amplifyRegion mold; only pure `fbm`/`ridged` from module scope): a **distance-field stamp** — per-cell min distance d, arc-length u, side sign; one write per cell (sampling-density independent); cells beyond radius bit-untouched (asserted). Features: mountainRange (crest-jittered ridged relief), hills, ridge, plateau (mesa max-semantics, never lowers), escarpment (side-signed scarp), canyon, river (width/depth grow downstream u 0→1, floor-limited at sea−0.06, skips water). The GPU polyline path (`_fsPoly`/`GPU.polyline`) was deleted with the waypoint UI. Pan/zoom: one shared `viewT={scale,panX,panY}` transform on `.canvas-stack` — **mobile keeps its button overlay** (mobile-only gate + ✋ pan toggle + two-finger pinch/pan), **desktop adds** wheel-zoom-to-cursor (ctrl = trackpad pinch), middle-drag and space-drag pan; `evtToGrid` is transform-invariant (post-transform rect). Dynamic `#scaleBar` (1/2/5×10ⁿ km from `state.mapWidthKm` ÷ post-transform canvas width; refreshed in `renderNow`/`applyView`/resize). Ctrl/Cmd-Z → `undoLast()` (input-guarded). `generate()` proven bit-identical to v0.047 (cmp field/temp/rain). Stroke capture, pan/zoom, and the scale bar are browser-only — manual verification.

Since v0.049 (`docs/research/engine-optimization.md` W0b): stream-power and glacial carve join droplet erosion off the main thread. Both ops were refactored into **self-contained kernels** — `streamPowerKernel(fld, stress, resist, rain, W, H, P, onProgress)` and `glacialKernel(fld, temp, W, H, P, onProgress)` — that take every input as an argument (read-only fields + a packed `P` of state/planet params) and **inline their own MinHeap + priority-flood routing** (the routing block is deliberately duplicated into each kernel, not shared, so each can be stringified into a blob-URL Worker; **Invariant 11 now covers all three kernels** — the suite rebuilds each from `toString()` with module globals shadowed and asserts bit-identical output). `streamPowerErode()`/`glacialErode()` (sync) and `streamPowerEroseAsync()`/`glacialEroseAsync()` (worker) call the *same* kernel; `runErosionWorker(key, kernelFn, bodyJs, buildPayload, syncFn, finishFn, label)` is the generic blob-URL runner mirroring `erodeAsync`'s contract (copied-in buffers, transferred-back field, sync fallback when Workers are missing/error). One shared `_eroBusy` lock serialises all three heightmap-mutating ops. The main-thread tail (`eroFinish` = `isostaticRebound` → `computeFlow(true)` → `refreshClimate` → `renderNow`) stays off-worker. Pooled `mbuf/ibuf/ubuf` routing (`computeFlowRouting`) is gone — the kernels own routing now. **Proven bit-identical to v0.047** (seed 12345, 256px: stream-power and glacial outputs `cmp`-clean) — pure responsiveness win, no constraint change. The worker paths themselves can't run headless — verify in a browser after touching them.

Since v0.050 (`docs/BIOME_AND_VISUALS_PLAN.md` Part B, zero-asset tier): `state.viz = {parchment, icons}` (defaults 0/false → field **and** rendered RGBA proven bit-identical to v0.049; legacy saves merge these defaults in `loadZip`). **B1 parchment**: per-pixel two-octave `vnoise` paper-fibre grain multiplied into the biome/relief render modes plus a warm tint, gated on `pk>0` so the default path skips the branch. **B3 stylized icons**: `placeMapIcons(fld, biome, W, H, opts)` is a pure primitive (amplifyRegion mold; only pure `hash` from module scope) — land-relative elevation thresholds (mountain ≥0.58, hill 0.53–0.58 — Nortantis-style, **algorithm studied only, AGPL code not copied**), greedy largest-first acceptance with grid-bucketed spacing (big peaks claim the spine), forest stipple via deterministic jittered grid on closed-canopy biome classes (frozen indices 3,4,5,6,12), all lists painter-sorted north→south. `drawMapIcons(ctx, icons, W)` draws procedural vector glyphs (peaked mountain + shaded east flank, hill arcs, conifer/broadleaf trees) over the composited raster like the plate arrows — works with zero assets; sprite packs are the later optional B2/B3 asset tier. Render-view only: PNG bakes and layer exports unchanged (flagged follow-up). Glyph aesthetics need a browser check.

Since v0.051 (`docs/BIOME_AND_VISUALS_PLAN.md` Part B, B4): `state.viz.waves` (default false → bit-identical to v0.050, field+RGBA). `computeCoastDistance(fld, W, H, sea)` is a pure two-pass chamfer distance transform (land=0 source, ocean=distance-in-cells; world-wrap deliberately ignored — subtle decoration). The renderer turns it into concentric foam contours (`sin(cd/per)^3`, brighter near shore, faded into deep water) modulating **water cells only** — asserted that land pixels stay byte-identical when waves toggle. `WAVE_BAND≈GW/40`, `WAVE_PER≈GW/180`. Gated on the same `mapView` (dbg off + biome/hypso) as parchment/icons; off → the transform is skipped. Render-only; bakes/exports unchanged. Vector spline-traced coastlines (the other half of B4) remain an optional follow-up. Wave aesthetics need a browser check.

Since v0.052 (`docs/WORLD_REGIONAL_TILING_PLAN.md` Stages 3–5): the pure tiling core (verifiable like v0.044's `amplifyRegion`; OffscreenCanvas per-tile render, fflate and region-select UI are the browser follow-up). **`refineTile(src, srcW, srcH, region, cols, rows, col, row, tileSize, opts)`** splits a coarse sub-region into a cols×rows grid — each tile's coarse sub-bounds overlap its neighbour by exactly one coarse column/row (the shared seam line) so adjacent tiles are **seam-Δ=0 exactly** (asserted across a full 3×2 split, both axes; tile(0,0) matches a direct `amplifyRegion`). **`packHeight16`/`unpackHeight16`** = portable 16-bit height ↔ R+G byte packing (`H=R·256+G`, round-trip ≤1 LSB ≈7.6e-6; clamps out-of-range); wired into `exportZip` as `heightmap_rg16.bin` (the `.f32` stays the full-precision path) and `loadZip` reads it as a fallback. **`buildTileManifest`** = manifest v2 (`schema:2`, worldSeed/world, height encoding, compression, per-tile records with coarse bounds when refining a region) — a superset of the old flat `index` so existing consumers keep working; now emitted by `bakeTiled` as `tiles/index.json`. All pure → bit-identical to v0.051 (`generate()` field + RGBA `cmp`-clean). The per-tile worker render path and fflate compression need a browser check.

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

See `docs/ROADMAP.md` (weather model v2, gravity parameter, optimization, unified tool) and `docs/UNIFIED_TOOL_PLAN.md` (merge plan). Research backing: `docs/research/`. Per-parameter generator reference: `docs/GENERATOR_PARAMETERS.md`.
