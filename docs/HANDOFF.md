# Cartalith Gen1 — Session Hand-off

**Read this first.** Start-here guide for a new session. Pairs with `CLAUDE.md` (architecture + invariants) and `docs/SESSION_LOG_2026-06-10.md` (full history/decisions).

## Where we are

- Repo `achos0190/cartalith-gen1`, work branch **`claude/weather-gravity-cartalith-c4u12t`**, draft **PR #1** (base `main`). All work lives on the branch; push there, never to `main`.
- Current engine file: **`elevation_foundation_v0.047.html`** (older `v0.036–0.046` kept, never edited in place — new version = new file).
- Headless suite: **87 assertions, all green**. Run before & after any engine change:
  ```bash
  tests/run.sh            # extract JS → node --check → smoke suite (CPU paths)
  ```
- Two big single-file apps coexist: the elevation foundation (generator) and `Cartalith_V1.914.html` (cartographic editor). They are **not merged yet** — merge is planned (`docs/UNIFIED_TOOL_PLAN.md`).

## How to verify (the discipline we hold)

1. `tests/run.sh` must pass (extend `tests/test_tail.js` when adding a stage; stubs in `tests/stub_head.js`).
2. **Cross-version neutrality**: any additive/opt-in change must be proven byte-identical to the prior version at Earth/default settings — the `cmp` harness pattern (seed 12345, 256px, world off). Examples litter the git log; reuse them.
3. GPU shaders, Web Worker glue, and canvas interaction (zoom/pan/paint) **cannot be verified headlessly** — implement, then flag explicitly for a manual browser pass.
4. Commit messages end with the session URL line (see existing commits). Push to the work branch; PR #1 already exists.

## Immediate next task — v0.048 (approved, specced)

Plotline-guided geological feature brushes + freehand strokes + map zoom/pan + scale bar + Ctrl-Z. Full design: the approved plan and **`docs/research/map-painting-ux.md`**. Copy `v0.047` → `v0.048`; `generate()` must stay bit-identical (everything here is stroke/render-triggered).

Reuse what already exists (don't rebuild):
- `catmullRomSample(pts, step)` — centripetal Catmull-Rom (smooth the drawn guide).
- Freehand drag is already captured by the direct-paint brushes (`view` pointer handlers, `painting` flag, `evtToGrid`, `sculpt()`); the fixed-waypoint polyline (`polyDrawMode`/`polyPoints`) is what the user wants *replaced* by a hand-drawn guide.
- `pushUndo()`/`doUndo()` (5-level field snapshots) — bind **Ctrl-Z/Cmd-Z** via a `keydown` listener; undo already works for sculpt/erosion.
- `fbm`/`ridged` noise + existing brush math in `sculpt()` (`ridge`, `canyon`, `mesa`, `cliff`) — build `applyFeatureAlongCurve(curve, feature, radius, strength, seed)` on top (mountainRange/river/ridge/plateau/hills/escarpment/canyon), tapering by perpendicular distance from the line.
- Mobile CSS-transform zoom (`zoomLvl`/`applyZoom`) — promote to a general `{scale,panX,panY}` view transform (wheel-zoom-to-cursor, drag-pan, pinch); add a dynamic scale bar from `state.mapWidthKm/GW ÷ scale`. **`evtToGrid` must account for pan/zoom** so painting still lands correctly.
- `amplifyRegion(...)` exists for the *later* "refine this region at higher fidelity" feature (parked — leave a hook only).

Headless-testable parts: `applyFeatureAlongCurve` (mountainRange raises a ridge near the line; river carves below neighbours), RDP simplify (fewer points, endpoints preserved), field finite/in-range. Zoom/pan/scale-bar/stroke-capture = browser-only.

## Locked decisions (don't relitigate)

- Gravity = planetary parameter (`state.planet`). Single-file `file://` default; local HTTP server OK for Workers/WASM/WebGPU.
- Merge: v1.914 = host shell, engine namespaced under `Gen`, save schema **v10**; generator-as-source **and** external heightmap load both preserved.
- Biome handoff = **dual** full-res raster + editable paint grid. Visuals = **hybrid** realistic + togglable Nortantis-style icons (**Nortantis is AGPL — study the algorithm, copy no code**). Assets: sibling `assets/` folder only with a reputable CC0 pack (Poly Haven / ambientCG / K.M. Alexander shortlisted), else procedural. Compression = inline **fflate**.
- Tiling: continuous zoom on the current map now; tiled 16k + region refine later.
- Stream-power "carve" defaults to pure incision; uplift is opt-in (v0.046 fix).

## Engine capability summary (v0.037→v0.047)

Natural-order pipeline (flow→climate→flow, runoff-weighted) · G1 gravity scaling · full planetary weather **W1 winds / W2 moisture / W3 seasons+Köppen / W3.5 ocean currents** · worker droplet erosion · biome-raster handoff · seamless `amplifyRegion` (16k-tiling core) · fixed stream-power (MFD, anti-ridge, carve-default) · Wind + Köppen debug views. Sidebar follows the planetary-formation cascade.

## Docs map

`CLAUDE.md` (architecture, 11 invariants, verification) · `docs/ROADMAP.md` (priority order + Done log) · `docs/UNIFIED_TOOL_PLAN.md` · `docs/GENERATOR_PARAMETERS.md` (every modifier) · `docs/BIOME_AND_VISUALS_PLAN.md` · `docs/WORLD_REGIONAL_TILING_PLAN.md` · `docs/SESSION_LOG_2026-06-10.md` · `docs/research/` (ui-unified-tool, weather-model-v2, gravity-influence, engine-optimization, pipeline-order-audit, **map-painting-ux**).

## Watch-outs

- PR #1 has no CI; it merges only when the user merges it. A background monitor watches for merge/external pushes; re-arm it (it times out ~30 min) — don't poll with sleep.
- Don't edit old `v0.0XX` files. Don't renumber `BIOME_KEYS`/`KOPPEN_KEYS` (save-format-stable). Keep CPU and GPU lapse (`uLapse`) in lockstep. `dropletKernel` must stay self-contained.
