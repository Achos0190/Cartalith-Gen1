# Roadmap

Priority-ordered. One thing at a time; each item ends with `tests/run.sh` green and a browser sanity check. Detailed designs live in `docs/research/` and `docs/UNIFIED_TOOL_PLAN.md`.

## Now

1. **G1 — Planet parameters** (`docs/research/gravity-influence.md`)
   `state.planet = {g, rotationHours, axialTiltDeg, radiusRel}` + scaling hooks (stream-power ×g, lapse ×g, peak calibration ×1/g, crater ×g^-0.22, waves ×1/g). Earth preset must reproduce v0.036 output exactly (add regression assertion).
2. **W1 — Wind field** (`docs/research/weather-model-v2.md`)
   Latitude-band circulation (cell count from planet g/Ω) + Coriolis-deflected pressure-gradient winds on the coarse grid; manual `windDir` becomes an override toggle.
3. **W2 — Moisture physics**
   Clausius–Clapeyron capacity, supersaturation rainfall, wind-speed evaporation; delete ITCZ/dry-belt latitude hacks (now emergent).

## Next

4. **W0 — Worker erosion + JS micro-opts** (`docs/research/engine-optimization.md`)
   Blob-URL worker, transferable buffers, progress events. Unblocks the UI before the merge makes frames more expensive.
5. **P0–P1 — Unified tool shell merge** (`docs/UNIFIED_TOOL_PLAN.md`)
   Namespace engine under `Gen`, merge into `cartalith_gen1_v0.001.html`, 5-tab UI, layers panel.
6. **P2 — Save schema v10** with both legacy importers.

## Later

7. **W3 — Seasons + Köppen** (4 seasonal passes, climate normals, Köppen debug/render mode).
8. **P3 — Climate→content bridges**: paint-grid fill from climate, flowField→ways river tracing, climate-aware planner, salt-flat/endorheic material (handoff pending #6).
9. **R32F GPU migration** (handoff pending #3) with RGBA8 fallback tier.
10. **G2 — Geoid sea-level field** (J2 + low-order harmonics + mantle noise; toggle, off by default).
11. **G3 — Moons & tidal-range overlay** → coastal hazard zones.
12. **Disturbance model completion** (handoff pending #2): wind-throw from W1 wind field, flood proxy from flowField/TWI.

## Research / spikes

- Rust/WASM SIMD erosion kernel (inline base64) — only if profiling after #4/#9 still shows CPU-bound erosion. Verdict & sources: `docs/research/engine-optimization.md`.
- WebGPU compute backend — Gen1 v2 candidate.
- Dirty-rect rendering (handoff pending #5) — when brush latency becomes a complaint.

## Done

- 2026-06: **v0.037 — natural-order pipeline fixes** (`docs/research/pipeline-order-audit.md`): generate() now runs flow(area) → climate → flow(discharge); `computeFlow(true)` seeds runoff from rainField (Whipple & Tucker 1999); droplet erosion spawns ∝ precipitation; `isostaticRebound()` after fluvial/glacial/droplet erosion (England & Molnar 1990, ~80% broad-unload rebound). 38 smoke assertions green.
- 2026-06: Repo scaffolded — CLAUDE.md, headless verification harness, `verify-elevation` skill, research docs (weather v2, gravity, optimization, unified UI, pipeline-order audit), unified tool plan.
