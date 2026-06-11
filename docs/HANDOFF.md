# Cartalith Gen1 — Session Hand-off

**Read this first.** Start-here guide for a new session. Pairs with `CLAUDE.md` (architecture + invariants) and `docs/SESSION_LOG_2026-06-10.md` (full history/decisions).

## Where we are

- Repo `achos0190/cartalith-gen1`. v0.048 work lives on branch **`claude/map-painting-ux-v048-acjted`** (draft PR); earlier work (≤v0.047) on `claude/weather-gravity-cartalith-c4u12t` / PR #1. Push to the session's work branch, never to `main`.
- Current engine file: **`elevation_foundation_v0.048.html`** (older `v0.036–0.047` kept, never edited in place — new version = new file).
- Headless suite: **105 assertions, all green**. Run before & after any engine change:
  ```bash
  tests/run.sh            # extract JS → node --check → smoke suite (CPU paths)
  ```
- Two big single-file apps coexist: the elevation foundation (generator) and `Cartalith_V1.914.html` (cartographic editor). They are **not merged yet** — merge is planned (`docs/UNIFIED_TOOL_PLAN.md`).

## How to verify (the discipline we hold)

1. `tests/run.sh` must pass (extend `tests/test_tail.js` when adding a stage; stubs in `tests/stub_head.js`).
2. **Cross-version neutrality**: any additive/opt-in change must be proven byte-identical to the prior version at Earth/default settings — the `cmp` harness pattern (seed 12345, 256px, world off). Examples litter the git log; reuse them.
3. GPU shaders, Web Worker glue, and canvas interaction (zoom/pan/paint) **cannot be verified headlessly** — implement, then flag explicitly for a manual browser pass.
4. Commit messages end with the session URL line (see existing commits). Push to the work branch; PR #1 already exists.

## Immediate next task — manual browser pass on v0.048, then pick from Roadmap → Next

**v0.048 shipped** (plotline feature brushes, pan/zoom, scale bar, Ctrl-Z — see `CLAUDE.md` "Since v0.048" and the ROADMAP Done entry). What headless tests could NOT cover needs one manual browser pass:

- Desktop: wheel-zoom keeps the point under the cursor fixed; ctrl-wheel (trackpad pinch) finer; middle-drag and space-drag pan; Ctrl/Cmd-Z undoes (and does NOT fire while typing in inputs).
- Mobile: zoom buttons (+/−/✋/⟳) appear and work; ✋ toggles one-finger pan; two-finger pinch zooms/pans; one finger still paints.
- Paint + guide strokes land correctly at zoom ≠ 1 (evtToGrid is transform-invariant — verify, don't assume).
- Scale bar: sensible 1/2/5×10ⁿ values at two zoom levels and after changing Map width (km).
- Feature brushes: draw guide → tube preview → Apply for each of the 7 features; rivers carve start→end; GPU tag still reads `active (…)` after the pPoly shader removal.

After that, next per `docs/ROADMAP.md`: **W0b** (worker stream-power/glacial kernels) or **P0–P1** (unified tool shell merge).

## Locked decisions (don't relitigate)

- Gravity = planetary parameter (`state.planet`). Single-file `file://` default; local HTTP server OK for Workers/WASM/WebGPU.
- Merge: v1.914 = host shell, engine namespaced under `Gen`, save schema **v10**; generator-as-source **and** external heightmap load both preserved.
- Biome handoff = **dual** full-res raster + editable paint grid. Visuals = **hybrid** realistic + togglable Nortantis-style icons (**Nortantis is AGPL — study the algorithm, copy no code**). Assets: sibling `assets/` folder only with a reputable CC0 pack (Poly Haven / ambientCG / K.M. Alexander shortlisted), else procedural. Compression = inline **fflate**.
- Tiling: continuous zoom on the current map now; tiled 16k + region refine later.
- Stream-power "carve" defaults to pure incision; uplift is opt-in (v0.046 fix).

## Engine capability summary (v0.037→v0.048)

Natural-order pipeline (flow→climate→flow, runoff-weighted) · G1 gravity scaling · full planetary weather **W1 winds / W2 moisture / W3 seasons+Köppen / W3.5 ocean currents** · worker droplet erosion · biome-raster handoff · seamless `amplifyRegion` (16k-tiling core) · fixed stream-power (MFD, anti-ridge, carve-default) · Wind + Köppen debug views · plotline feature brushes (`applyFeatureAlongCurve` distance-field stamp, 7 features) · shared pan/zoom (`viewT`) + scale bar + Ctrl-Z. Sidebar follows the planetary-formation cascade.

## Docs map

`CLAUDE.md` (architecture, 11 invariants, verification) · `docs/ROADMAP.md` (priority order + Done log) · `docs/UNIFIED_TOOL_PLAN.md` · `docs/GENERATOR_PARAMETERS.md` (every modifier) · `docs/BIOME_AND_VISUALS_PLAN.md` · `docs/WORLD_REGIONAL_TILING_PLAN.md` · `docs/SESSION_LOG_2026-06-10.md` · `docs/research/` (ui-unified-tool, weather-model-v2, gravity-influence, engine-optimization, pipeline-order-audit, **map-painting-ux**).

## Watch-outs

- PR #1 has no CI; it merges only when the user merges it. A background monitor watches for merge/external pushes; re-arm it (it times out ~30 min) — don't poll with sleep.
- Don't edit old `v0.0XX` files. Don't renumber `BIOME_KEYS`/`KOPPEN_KEYS` (save-format-stable). Keep CPU and GPU lapse (`uLapse`) in lockstep. `dropletKernel` must stay self-contained.
