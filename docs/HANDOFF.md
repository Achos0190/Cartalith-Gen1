# Cartalith Gen1 — Session Hand-off

**Read this first.** Start-here guide for a new session. Pairs with `CLAUDE.md` (architecture + invariants) and `docs/SESSION_LOG_2026-06-10.md` (full history/decisions).

## Where we are

- Repo `achos0190/cartalith-gen1`. v0.048–0.055 work lives on branch **`claude/map-painting-ux-v048-acjted`** (draft PR #2); earlier work (≤v0.047) on `claude/weather-gravity-cartalith-c4u12t` / PR #1. Push to the session's work branch, never to `main`.
- Current engine file: **`elevation_foundation_v0.055.html`** (older `v0.036–0.054` kept, never edited in place — new version = new file).
- Headless suite: **176 assertions, all green**. Run before & after any engine change:
  ```bash
  tests/run.sh            # extract JS → node --check → smoke suite (CPU paths)
  ```
- Two big single-file apps coexist: the elevation foundation (generator) and `Cartalith_V1.914.html` (cartographic editor). They are **not merged yet** — merge is planned (`docs/UNIFIED_TOOL_PLAN.md`).

## How to verify (the discipline we hold)

1. `tests/run.sh` must pass (extend `tests/test_tail.js` when adding a stage; stubs in `tests/stub_head.js`).
2. **Cross-version neutrality**: any additive/opt-in change must be proven byte-identical to the prior version at Earth/default settings — the `cmp` harness pattern (seed 12345, 256px, world off). Examples litter the git log; reuse them.
3. GPU shaders, Web Worker glue, and canvas interaction (zoom/pan/paint) **cannot be verified headlessly** — implement, then flag explicitly for a manual browser pass.
4. Commit messages end with the session URL line (see existing commits). Push to the work branch; PR #1 already exists.

## Immediate next task — per the user's sequence: visuals → 16k tiling → gravity → river/stream pass

**Shipped this branch:** v0.048 (plotline feature brushes, pan/zoom, scale bar, Ctrl-Z), v0.049 (W0b worker stream-power/glacial carve), v0.050–0.051 (parchment, icons, waves — zero-asset visuals tier), v0.052–0.053 (16k tiling: pure core + region-refine export) — see the `CLAUDE.md` "Since v0.0XX" paragraphs and ROADMAP Done entries. The zero-asset procedural visuals tier is now complete.

**Next build steps (user-set order, June 2026):**
1. **Visuals asset tier (gated — awaiting user approval)**: two design docs ready. (a) **`docs/research/asset-candidates.md`** — curated CC0 art shortlist (ambientCG textures + K.M. Alexander #NoBadMaps sprites). (b) **`docs/ASSET_PACK_FORMAT.md`** — proposed **in-app ZIP import** (file picker → unzip in memory → `pack.json`/`pack.csv` over a fixed slot vocabulary = renderer's material channels + icon classes, multi-variant icons picked by deterministic hash). This **supersedes the sibling-`assets/`-folder locked decision** (better for single-file/`file://`) — confirm before building. Build order once approved: importer + `assetPack` runtime + Import/Clear UI → wire B2 splatting → wire icon variants into `drawMapIcons`; bit-identical when no pack loaded.
2. **16k tiling pipeline**: DONE through v0.053; v0.055 made the region export take explicit **cols × rows + tile resolution** (was fixed N×N) with aspect-preserving tile pixels so non-square selections aren't squished. Optional follow-ups: per-tile erosion at refine time, fflate vendoring, 16k device memory test.
3. **Gravity completion**: G2 geoid sea-level field DONE in v0.054 (`buildGeoid`: J2 bulge + harmonics + mantle fbm, local sea level threads through water mask/climate/erosion/render + Geoid debug view; off ⇒ bit-identical). Remaining: **G3** moons & tidal-range overlay → coastal hazard zones.
4. **River painting / stream-carving quality pass** (user wants to re-check this — not now).

**Manual browser pass still owed** (headless can't cover): v0.053 — region drag-select overlay, refined ZIP download (PNG tiles present, gzip'd bins), a 4×4@4096 run to watch memory. v0.052 — export a tiled ZIP and confirm `tiles/index.json` is the new schema-2 manifest + `heightmap_rg16.bin` re-imports cleanly (round-trips field). v0.051 — coastal wave-line look at two zooms. v0.050 — parchment slider look, icon glyph aesthetics/density at 2048px (mountains on ridges, trees in forests, nothing in oceans), toggles off→on→off leaves the map unchanged. v0.049 — worker carve progress %, responsive UI, sync fallback. v0.048 — zoom/pan gestures desktop+mobile, paint/guide alignment at zoom ≠ 1, scale bar, Ctrl-Z guards, GPU tag, 7 feature brushes.

## Locked decisions (don't relitigate)

- Gravity = planetary parameter (`state.planet`). Single-file `file://` default; local HTTP server OK for Workers/WASM/WebGPU.
- Merge: v1.914 = host shell, engine namespaced under `Gen`, save schema **v10**; generator-as-source **and** external heightmap load both preserved.
- Biome handoff = **dual** full-res raster + editable paint grid. Visuals = **hybrid** realistic + togglable Nortantis-style icons (**Nortantis is AGPL — study the algorithm, copy no code**). Assets: ~~sibling `assets/` folder~~ → **revisited (June 2026, pending user OK): in-app ZIP-pack import** (`docs/ASSET_PACK_FORMAT.md`) for single-file/`file://` friendliness; always procedural fallback. CC0 packs (Poly Haven / ambientCG / K.M. Alexander) shortlisted in `docs/research/asset-candidates.md`. Compression = inline **fflate**.
- Tiling: continuous zoom on the current map now; tiled 16k + region refine later.
- Stream-power "carve" defaults to pure incision; uplift is opt-in (v0.046 fix).

## Engine capability summary (v0.037→v0.055)

Natural-order pipeline (flow→climate→flow, runoff-weighted) · G1 gravity scaling · full planetary weather **W1 winds / W2 moisture / W3 seasons+Köppen / W3.5 ocean currents** · **worker erosion: droplet + stream-power + glacial** (self-contained kernels, shared lock) · biome-raster handoff · seamless `amplifyRegion` (16k-tiling core) · fixed stream-power (MFD, anti-ridge, carve-default) · Wind + Köppen debug views · plotline feature brushes (`applyFeatureAlongCurve` distance-field stamp, 7 features) · shared pan/zoom (`viewT`) + scale bar + Ctrl-Z · parchment grain + stylized icon layer + coastal wave lines (zero-asset visual tier) · tiling core + region-refine export (`refineTile` seam-Δ=0, 16-bit `packHeight16`, manifest v2, drag-select → gzip-d tile ZIP) · G2 geoid sea-level field (local sea level, opt-in) · region export with explicit cols×rows + aspect-preserving tile resolution. Sidebar follows the planetary-formation cascade.

## Docs map

`CLAUDE.md` (architecture, 11 invariants, verification) · `docs/ROADMAP.md` (priority order + Done log) · `docs/UNIFIED_TOOL_PLAN.md` · `docs/GENERATOR_PARAMETERS.md` (every modifier) · `docs/BIOME_AND_VISUALS_PLAN.md` · `docs/WORLD_REGIONAL_TILING_PLAN.md` · `docs/SESSION_LOG_2026-06-10.md` · `docs/research/` (ui-unified-tool, weather-model-v2, gravity-influence, engine-optimization, pipeline-order-audit, map-painting-ux, **asset-candidates** [CC0 shortlist], **ASSET_PACK_FORMAT** [in-app ZIP import spec]).

## Watch-outs

- PR #1 has no CI; it merges only when the user merges it. A background monitor watches for merge/external pushes; re-arm it (it times out ~30 min) — don't poll with sleep.
- Don't edit old `v0.0XX` files. Don't renumber `BIOME_KEYS`/`KOPPEN_KEYS` (save-format-stable). Keep CPU and GPU lapse (`uLapse`) in lockstep. The three worker kernels (`dropletKernel`, `streamPowerKernel`, `glacialKernel`) must stay self-contained — no module globals (Invariant 11).
