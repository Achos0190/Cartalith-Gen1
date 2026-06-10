# Roadmap

Priority-ordered. One thing at a time; each item ends with `tests/run.sh` green and a browser sanity check. Detailed designs live in `docs/research/` and `docs/UNIFIED_TOOL_PLAN.md`.

## Now

## Next

3. **W0b — extend Worker coverage** (`docs/research/engine-optimization.md`)
   v0.041 moved the droplet pass (heaviest CPU op) into a blob-URL Worker with progress + sync fallback. Remaining candidates: stream-power and glacial kernels (same self-contained-kernel pattern), then JS micro-opts in the stencil loops.
4. **P0–P1 — Unified tool shell merge** (`docs/UNIFIED_TOOL_PLAN.md`)
   Namespace engine under `Gen`, merge into `cartalith_gen1_v0.001.html`, 5-tab UI, layers panel.
5. **P2 — Save schema v10** with both legacy importers.

## Later

7. **P3 — Climate→content bridges**: paint-grid fill from climate, flowField→ways river tracing, climate-aware planner, salt-flat/endorheic material (handoff pending #6).
8. **R32F GPU migration** (handoff pending #3) with RGBA8 fallback tier.
9. **G2 — Geoid sea-level field** (J2 + low-order harmonics + mantle noise; toggle, off by default).
10. **G3 — Moons & tidal-range overlay** → coastal hazard zones.
11. **Disturbance model completion** (handoff pending #2): wind-throw from W1 wind field, flood proxy from flowField/TWI.

## Bigger workstreams (planned, post-merge)

- **Biome handoff + visuals** (`docs/BIOME_AND_VISUALS_PLAN.md`): dual raster + 14-index paint grid with lock flags → procedural realistic base (parchment grain) → texture splatting (CC0 pack) → togglable Nortantis-style icon mountains.
- **World/regional tiling to 16k** (`docs/WORLD_REGIONAL_TILING_PLAN.md`): coarse world → region select → world-space-seeded amplified tiles with skirts → per-tile OffscreenCanvas/worker → fflate-compressed tiled export + manifest; 16-bit height packing & external 16-bit/.f32 import.

## Research / spikes

- Rust/WASM SIMD erosion kernel (inline base64) — only if profiling after #3/#8 still shows CPU-bound erosion. Verdict & sources: `docs/research/engine-optimization.md`.
- WebGPU compute backend — Gen1 v2 candidate.
- Dirty-rect rendering (handoff pending #5) — when brush latency becomes a complaint.

## Done

- 2026-06: **v0.046 — stream-power fix + menu cascade** (user bug report): relief inversion (ridges-for-rivers) and 45° line artefacts fixed via MFD drainage (Freeman 1991), steepest-descent receivers, anti-ridge deposition clamp, normalised uplift defaulting to 0 (carve-only). Old solver proven to net-RAISE channels (−0.0028), new net-incises (+0.0023); 84 assertions green incl. valleys-not-ridges regression. Sidebar reordered to the planetary-formation cascade (Planet/Calibrate before structure/climate/erosion; Save/Performance last).
- 2026-06: **v0.045 — W3.5 ocean currents**: opt-in `climate.currents`; wind-driven surface currents transport heat meridionally (poleward→warm SST→mild wet coast; equatorward→cold SST→fog-dry coast). Cold-current cooler/drier-coast (Benguela/Atacama) and warm-coast (Gulf-Stream) signatures both verified; 82 assertions green; currents-off bit-identical to v0.044.
- 2026-06: **v0.044 — region amplification primitive** (`WORLD_REGIONAL_TILING_PLAN` Stage 3): `amplifyRegion()` pure/worker-ready — coarse upsample + world-space fBm detail tapered by relief, faded underwater. Adjacent tiles proven seamless (seam Δ=0), deterministic, constraint-preserving. 78 assertions green; generate() bit-identical to v0.043. Verifiable core of the 16k tiling pipeline (export/OffscreenCanvas/fflate = browser follow-up).
- 2026-06: **v0.043 — W3 seasons + Köppen**: opt-in `climate.seasons`; `simulateWeather`/`buildWind` take a solar-declination arg so summer/winter passes shift the thermal equator by axial tilt; `computeSeasons()` builds seasonal temp/precip + a `koppenField` via a full Köppen–Geiger classifier (30 frozen codes, normalized-rain→mm scale). Köppen debug view + raster/manifest export. 73 assertions green (incl. one world → 22 distinct climates); seasons-off bit-identical to v0.042.
- 2026-06: **v0.042 — biome raster handoff (A1)**: `buildBiomeRaster()` + frozen `BIOME_INDEX`/`BIOME_KEYS` (0=ocean, 1..12 ice…tropWet); `exportZip` now ships `biome_raster.bin` + `biome_index.json` manifest for Cartalith. Generate output bit-identical to v0.041; 63 assertions green. First brick of the dual-layer biome bridge.
- 2026-06: **v0.041 — W0 worker droplet erosion**: droplet pass refactored into self-contained `dropletKernel` (no module globals), stringified into a blob-URL Web Worker with progress events and sync fallback; field copied in / transferred back so the live heightmap never detaches. Kernel proven bit-identical to v0.040 (fixed-seed 20k-droplet cross-version diff) and self-containment is regression-tested by rebuilding from `toString()` with shadowed globals. 57 assertions green. Worker path needs one manual browser check.
- 2026-06: **v0.040 — W2 moisture physics**: bulk-aerodynamic ocean evaporation `E = Ce·U·(qs−q)` (wind-speed + saturation-deficit, `climate.bulkEvap`); ITCZ/dry-belt corrector parametrised as `climate.zonalK`, default halved to 0.5 after measuring that W1 bands already produce emergent equator-max / 25–40° dry-dip / wet-westerlies structure. Legacy saves (zonalK 1, bulkEvap off) bit-identical to v0.039. 53 assertions green incl. emergent zonal-structure regression test.
- 2026-06: **v0.039 — W1 planetary wind field**: per-cell winds = latitude-band circulation (cell count from day length/size/gravity, Earth=3) + Coriolis-deflected thermal pressure-gradient flow (geostrophic poleward of ~15°, downgradient near equator, `pressK` slider). Region mode gets banded winds by default; manual windDir kept as override; legacy saves load as manual/pressK=0 — proven bit-identical to v0.038. Per-cell upwind border inflow. 50 assertions green.
- 2026-06: **v0.038 — G1 planet parameters**: `state.planet {g, rotationHours, axialTiltDeg, radiusRel}` + Planet UI section. Gravity scales stream-power/droplet/glacial erosion (×g), lapse (×g, CPU+GPU), craters (×g^-0.22), waves (×1/g); peak altitude rescales ~1/g on slider change. Earth defaults proven bit-identical to v0.037 (fixed-seed cross-version diff). 42 assertions green.
- 2026-06: **v0.037 — natural-order pipeline fixes** (`docs/research/pipeline-order-audit.md`): generate() now runs flow(area) → climate → flow(discharge); `computeFlow(true)` seeds runoff from rainField (Whipple & Tucker 1999); droplet erosion spawns ∝ precipitation; `isostaticRebound()` after fluvial/glacial/droplet erosion (England & Molnar 1990, ~80% broad-unload rebound). 38 smoke assertions green.
- 2026-06: Repo scaffolded — CLAUDE.md, headless verification harness, `verify-elevation` skill, research docs (weather v2, gravity, optimization, unified UI, pipeline-order audit), unified tool plan.
