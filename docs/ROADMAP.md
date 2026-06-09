# Roadmap

Priority-ordered. One thing at a time; each item ends with `tests/run.sh` green and a browser sanity check. Detailed designs live in `docs/research/` and `docs/UNIFIED_TOOL_PLAN.md`.

## Now

1. **W2 — Moisture physics polish**
   `satCap` is already Clausius–Clapeyron-ish (`0.16·e^{0.058T}`) and supersaturation rainfall exists; remaining: wind-speed-dependent evaporation `E = C_e·U·(q_s−q)`, then re-evaluate whether the ITCZ/dry-belt latitude correctors can be retired (subsidence drying may now emerge from the W1 band structure).

## Next

3. **W0 — Worker erosion + JS micro-opts** (`docs/research/engine-optimization.md`)
   Blob-URL worker, transferable buffers, progress events. Unblocks the UI before the merge makes frames more expensive.
4. **P0–P1 — Unified tool shell merge** (`docs/UNIFIED_TOOL_PLAN.md`)
   Namespace engine under `Gen`, merge into `cartalith_gen1_v0.001.html`, 5-tab UI, layers panel.
5. **P2 — Save schema v10** with both legacy importers.

## Later

6. **W3 — Seasons + Köppen** (4 seasonal passes, climate normals, Köppen debug/render mode).
7. **P3 — Climate→content bridges**: paint-grid fill from climate, flowField→ways river tracing, climate-aware planner, salt-flat/endorheic material (handoff pending #6).
8. **R32F GPU migration** (handoff pending #3) with RGBA8 fallback tier.
9. **G2 — Geoid sea-level field** (J2 + low-order harmonics + mantle noise; toggle, off by default).
10. **G3 — Moons & tidal-range overlay** → coastal hazard zones.
11. **Disturbance model completion** (handoff pending #2): wind-throw from W1 wind field, flood proxy from flowField/TWI.

## Research / spikes

- Rust/WASM SIMD erosion kernel (inline base64) — only if profiling after #3/#8 still shows CPU-bound erosion. Verdict & sources: `docs/research/engine-optimization.md`.
- WebGPU compute backend — Gen1 v2 candidate.
- Dirty-rect rendering (handoff pending #5) — when brush latency becomes a complaint.

## Done

- 2026-06: **v0.039 — W1 planetary wind field**: per-cell winds = latitude-band circulation (cell count from day length/size/gravity, Earth=3) + Coriolis-deflected thermal pressure-gradient flow (geostrophic poleward of ~15°, downgradient near equator, `pressK` slider). Region mode gets banded winds by default; manual windDir kept as override; legacy saves load as manual/pressK=0 — proven bit-identical to v0.038. Per-cell upwind border inflow. 50 assertions green.
- 2026-06: **v0.038 — G1 planet parameters**: `state.planet {g, rotationHours, axialTiltDeg, radiusRel}` + Planet UI section. Gravity scales stream-power/droplet/glacial erosion (×g), lapse (×g, CPU+GPU), craters (×g^-0.22), waves (×1/g); peak altitude rescales ~1/g on slider change. Earth defaults proven bit-identical to v0.037 (fixed-seed cross-version diff). 42 assertions green.
- 2026-06: **v0.037 — natural-order pipeline fixes** (`docs/research/pipeline-order-audit.md`): generate() now runs flow(area) → climate → flow(discharge); `computeFlow(true)` seeds runoff from rainField (Whipple & Tucker 1999); droplet erosion spawns ∝ precipitation; `isostaticRebound()` after fluvial/glacial/droplet erosion (England & Molnar 1990, ~80% broad-unload rebound). 38 smoke assertions green.
- 2026-06: Repo scaffolded — CLAUDE.md, headless verification harness, `verify-elevation` skill, research docs (weather v2, gravity, optimization, unified UI, pipeline-order audit), unified tool plan.
