# Session Log — 2026-06-10

A structured digest of the working session so the live conversation context can be cleared without losing decisions or state. (This is a digest, not a verbatim transcript — Claude has no tool to extract raw timestamped messages; a verbatim export must come from the Claude Code session history.)

## What this session produced

Branch `claude/weather-gravity-cartalith-c4u12t`, draft **PR #1** on `achos0190/cartalith-gen1`. Repo scaffolded from near-empty to a documented, test-backed worldbuilding toolset. Headless suite grew 0 → **87 assertions**, all green; every engine version carries a bit-identical neutrality proof vs its predecessor.

## Engine changelog (each a separate `elevation_foundation_v0.0XX.html`; older kept)

- **v0.037** — natural-order pipeline: `flow(area)→climate→flow(discharge)`; runoff-seeded drainage (Whipple & Tucker 1999); rain-weighted droplets; isostatic rebound (England & Molnar 1990).
- **v0.038** — G1 gravity: `state.planet{g,rotationHours,axialTiltDeg,radiusRel}`; g scales erosion ×g, lapse ×g, craters ×g⁻⁰·²², waves ×1/g, peak ~1/g. Earth defaults bit-identical to v0.037.
- **v0.039** — W1 planetary wind field (latitude bands, cell count from rotation/size/gravity, Coriolis-deflected thermal pressure winds); manual `windDir` kept.
- **v0.040** — W2 moisture: bulk-aerodynamic evaporation; ITCZ/dry-belt corrector measured emergent, demoted to `zonalK` (default 0.5).
- **v0.041** — W0 worker erosion: self-contained `dropletKernel` in a blob-URL Web Worker (file://-safe), progress + sync fallback.
- **v0.042** — biome raster handoff: `buildBiomeRaster()` + frozen `BIOME_INDEX` + `biome_index.json` for Cartalith.
- **v0.043** — W3 seasons + Köppen: declination-shifted summer/winter passes; full Köppen-Geiger classifier (30 frozen codes) → `koppenField`; Köppen debug view + export.
- **v0.044** — region amplification: `amplifyRegion()` pure/worker-ready; adjacent tiles seam-Δ=0 (the 16k-tiling core).
- **v0.045** — W3.5 ocean currents: `applyOceanCurrents()` warm (Gulf-Stream) / cold (Benguela/Atacama) coasts.
- **v0.046** — stream-power FIX (user bug: ridges-for-rivers + 45° lines): MFD drainage (Freeman 1991), steepest-descent receivers, anti-ridge deposition clamp, uplift normalised + default 0 (carve, not build). Old solver net-RAISED channels (−0.0028); new net-incises (+0.0023). Sidebar reordered to the planetary-formation cascade.
- **v0.047** — Wind debug view: `currentWindField()` + per-pixel hue=bearing/brightness=speed map + arrow glyphs.

## Key decisions locked

- **Gravity** = planetary parameter (not just internal physics).
- **Repo** is the home for source + docs; single-file `file://` is the default, local HTTP server acceptable for Workers/WASM/WebGPU.
- **Merge** target: v1.914 is host shell; engine namespaced under `Gen`; save schema v10; generator-as-source AND external heightmap load both preserved (`docs/UNIFIED_TOOL_PLAN.md`).
- **Biome handoff** = dual raster + paint grid (`docs/BIOME_AND_VISUALS_PLAN.md`).
- **Visuals** = hybrid realistic + togglable Nortantis-style icons (Nortantis is **AGPL — algorithm only, no code**). Assets: sibling `assets/` folder only with a reputable CC0 pack; procedural fallback. Compression: inline **fflate**.
- **Tiling** = continuous zoom on the current map now; tiled 16k + region refine later (`docs/WORLD_REGIONAL_TILING_PLAN.md`).
- **Stream-power carve** defaults to pure carving; uplift opt-in.
- **UX (latest)**: feature brushes must stamp realistic geology along a *hand-drawn guide line* (line = plotline; feature centred on it + affected radius); plain zoom/pan on the displayed map + scale bar; real-time visual paint before export; Generate button; Ctrl-Z.

## Docs in repo
`CLAUDE.md`; `docs/ROADMAP.md`, `UNIFIED_TOOL_PLAN.md`, `GENERATOR_PARAMETERS.md`, `BIOME_AND_VISUALS_PLAN.md`, `WORLD_REGIONAL_TILING_PLAN.md`; `docs/research/` = ui-unified-tool, weather-model-v2, gravity-influence, engine-optimization, pipeline-order-audit, **map-painting-ux** (new). Tests in `tests/` + `.claude/skills/verify-elevation`.

## Next / open
- **v0.048 (planned, approved)**: plotline-guided feature brushes + freehand strokes + zoom/pan + scale bar + Ctrl-Z (see plan / `map-painting-ux.md`).
- Browser-bound & unverified-headless: worker glue (v0.041), GPU shaders, Köppen/wind/relief visuals, the eventual UI merge — all need a manual browser pass.
- Larger parked workstreams: v1.914 UI merge (P0–P1), tiled 16k export + region refine, visual layers (parchment/splat/icons), G2 geoid, disturbance model, R32F, WebGPU.
