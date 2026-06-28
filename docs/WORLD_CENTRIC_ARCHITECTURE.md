# Cartalith — World-Centric Architecture (the GIS reset)

> **Status:** Phase 1 foundation shipped as `Cartalith Gen1 v0.08.html` (self-contained, hand-written,
> not a build-script artifact). `v0.09.html` extends it with **hydraulic + thermal erosion** (the canonical
> "expensive simulation → cached, regeneration-safe dataset → still editable" op — baked into `erosionDelta`,
> composed in `nodeElevation`, recomputed downstream) and **endorheic lake filling** (Priority-Flood →
> `water=2` → Lake biome). This document is the contract the migration follows.
>
> **Why this exists.** `Cartalith Gen1 v0.07.html` unified the three tools *by isolation* — the elevation
> engine, the Cartalith editor and the asset compiler each run unmodified inside their own **shadow DOM**,
> exchanging data over **postMessage bridges** (verified: 3 shadow roots, 11 `postMessage`, 0 `Gen.state`).
> That is still "several applications sharing data." The user's directive is to **eliminate** that and make
> Cartalith behave like professional GIS software: **one world, many layers, one renderer, one toolset.**

## 1. The single rule

There is exactly **one** of each:

- one application (no sub-apps, no frames, no shadow-DOM islands)
- one **World** object (the only source of truth for geography)
- one **Renderer** (a layer stack composited to one canvas)
- one **Tool** framework (the active layer decides what a tool edits)
- one **Simulation** dependency graph (downstream-only recompute)
- one **Project** (one save file)

Workspaces (Geology / Hydrology / Climate / Ecology / Civilization / Atlas) are **UI presets only** —
they change which layers are visible and which panels/inspectors show. They never fork the data.

## 2. World model (shared, multi-attribute)

```
World
├── meta        { seed, width, height, kmPerCell, seaLevel, peakM, name, ... }
├── cells       Structure-of-Arrays over the W×H grid — every attribute a typed array,
│               so every cell simultaneously exposes ALL of:
│                 elevBase, elevDelta, elevation, slope, aspect,
│                 plateId, plateBoundary, uplift, rockType,
│                 flowAccum, water, rivers,
│                 temperature, rainfall,
│                 biome, biomeOverride, fertility, habitability,
│                 settleSuit, region
├── vectors     { settlements[], roads[], regions[], rivers[], labels[], annotations[] }
├── graph       SimulationGraph (nodes below)
└── layers      LayerRegistry (render views onto the above — they STORE NOTHING)
```

Key invariant: **no subsystem owns a private copy.** A "climate simulator" does not have its own grid;
it writes `cells.temperature` / `cells.rainfall` into the one World. A layer does not cache geography;
it reads a World attribute through a colormap.

**Overlay/regeneration safety** is built into the model: procedural attributes split into a
`*Base` (generator output) + a user delta/override (`elevDelta`, `biomeOverride`). Regenerating rewrites
only the base; user edits persist and re-compose. This is the UNIFIED_TOOL_PLAN layer contract, native.

## 3. Simulation as a dependency graph

Nodes, each declaring `deps`, the attributes it `outputs`, and a `run(world)`:

```
continents → tectonics → elevation → hydrology → climate → biomes → habitability → settlements → infrastructure
                                          └──────────────┴── (hydrology also feeds climate & habitability)
```

- Editing an attribute marks its owning node **and all transitive dependents** dirty.
- `runGraph()` processes nodes in topological order, **recomputing only dirty nodes** — never unrelated ones.
- Heavy downstream recompute is **lazy/debounced** (run on stroke-end, not per brush-dab); fast local
  effects (elevation+slope+relief) update immediately. This is the "never continuously simulate" rule.

Each node is a compact, **academically-grounded approximation** (the science family of the existing
engine, condensed): Voronoi plates + convergent-boundary uplift; steepest-descent flow accumulation;
latitude/lapse temperature + zonal+orographic rainfall; Whittaker/Köppen-style biomes; suitability-based
settlement seeding; least-cost (Dijkstra/MST) roads. Heavier engine science swaps in node-by-node later.

## 4. One renderer, one toolset

- **Renderer:** an ordered list of layers `{ id, name, kind:'raster'|'vector', visible, opacity, blend,
  paint(...) }`. Raster layers build an ImageData from one cell attribute via a colormap (rebuilt only when
  that attribute changed); vector layers stroke onto the 2D context. Toggling layers never instantiates
  anything — it flips `visible`.
- **Tools:** `Select · Inspect · Brush · Measure · Path · Region · Generate`. The tool is constant; the
  **active layer** determines the edit target (Brush on the Elevation layer raises/lowers terrain; on the
  Biome layer it paints a biome). Edits route into the World and mark the graph dirty.

## 5. Migration phases (each gates on "lose no functionality" + `tests/run.sh`)

- **P1 — Foundation (this file, v0.08):** World model, SimGraph, Renderer, Tools, Workspaces, a complete
  compact pipeline, GIS UX (layer manager, inspector, measure, save/load). Proves the architecture.
- **P2 — Engine science migration:** replace each compact node with the real `elevation_foundation`
  algorithm (tectonic-feature graph, worker erosion kernels, weather v2, Köppen, gravity/geoid/tides),
  wired as graph nodes writing the shared World. Reuse the 821-assertion harness per node.
  - **Started (v0.10):** the **tectonics node** now produces TYPED boundaries via the engine's T0
    `classifyBoundary` matrix (collision / subduction / arc / rift / transform, from per-plate crust +
    normal-stress `C` + shear `S`) and stamps per-type signed landform profiles — parallel mountain
    belts, ocean-side trench + volcanic arc, rift graben + shoulders, transform fault valley — by
    multi-source Dijkstra distance from each margin. `boundaryType` is a shared cell attribute; the Plate
    layer colours by it.
  - **Erosion kernels (v0.11):** two more erosion *commands* beside the v0.09 droplet — **stream-power**
    (Priority-Flood sink-fill → drainage area → `E = K·Aᵐ·Sⁿ / rock-resistance`, anti-ridge clamp →
    dendritic river valleys) and **glacial** (cold-gated abrasion → U-trough over-deepening). Both bake
    into `erosionDelta` and drive the cascade. `priorityFill` is now the shared flood routine (lakes +
    stream routing).
  - **Weather + Köppen (v0.12 — P2 COMPLETE):** the climate node is now weather-v2 — a latitude-band wind
    field (trade easterlies / mid-lat westerlies / polar easterlies) drives **downwind moisture advection**
    (ocean saturates the airmass; orographic rainout + drying crossing land → rain shadows + dry interiors).
    A **Köppen** node (`classifyKoppen`, A/B/C/D/E + subtypes) renders as its own layer, with a Wind layer.
- **P3 — Cartograph content (v0.13 — core shipped):** editable content as tools on the same World — a
  **Place** tool (drop/select/Delete settlements → `vectors.places`), a **Route** tool (terrain-aware
  least-cost trade routes via Dijkstra over a slope/water cost field, Esc commits → `vectors.userRoutes`),
  and a **Territory** tool (paint political ownership per faction → `cells.region`). New Places / Trade
  routes / Political-territory layers; all persist in the project save; Civilization workspace wired to
  them. Follow-ups: settlement economics/traits, politics *timeline* (per-era slices), journey planner.
- **P4 — Assets & export (v0.14 — export + symbols shipped):** GIS export suite — composite map **PNG**
  at N× scale (one shared `renderLayersToCanvas` path), single active-layer PNG, and vector **GeoJSON**
  (places/settlements as lon/lat points, routes as LineStrings, per-faction area summary). Tiered
  procedural settlement **symbols** (hamlet/town/city/metropolis). Save schema consolidated (v13).
  Deferred sub-item (architecturally optional): ZIP asset-pack import for sprite/texture packs.
- **P5 — Performance (v0.15 — core shipped):** **dirty-region chunked raster rendering** — each layer is
  tiled into 32×32 chunks; a local brush/territory edit marks only the touched chunks dirty and `ensure()`
  rebuilds just those (perf HUD shows N/total chunks), instead of rebuilding the whole W×H image. Plus a
  uniform-grid **spatial index** for O(1) vector picking, and the already-present lazy/debounced downstream
  recompute. Remaining (hardware-bound, browser-verified-only, like the engine's GPU/worker paths):
  Web-Worker offload of heavy commands + R32F GPU layers.

> **Command vs node.** Cheap, deterministic-from-params stages are auto-recomputing graph **nodes**
> (continents…infrastructure). Expensive, iterative, partly-stochastic stages (erosion now; full
> stream-power/glacial in P2) are **commands**: run on demand, bake a cached delta that persists through
> regenerate and re-composes in its owning node, then drive the downstream cascade. This is the perf
> contract — "expensive simulations produce cached datasets that become editable," never continuously
> re-simulated.

## 6. Phase status (P1–P5 core complete)

| Phase | Version | What landed |
|-------|---------|-------------|
| P1 — Foundation | v0.08 | World model · one renderer (layer stack) · one tool framework · dependency graph · workspaces · GIS UX (layer manager, inspector, measure, save/load) |
| P2 — Engine science | v0.09–v0.12 | hydraulic erosion + endorheic lakes · structured typed tectonics (belts/trenches/arcs/rifts) · stream-power + glacial erosion kernels · weather-v2 advection + Köppen |
| P3 — Content | v0.13 | Place / Route (least-cost) / Territory tools · politics, routes, places layers · all persisted |
| P4 — Export & symbols | v0.14 | composite + per-layer PNG · GeoJSON features (lon/lat) + faction areas · tiered settlement symbols |
| P5 — Performance | v0.15 | dirty-region chunked rasters · spatial vector index · lazy/debounced recompute |

**Remaining (deliberately deferred, architecturally optional / hardware-bound):** ZIP sprite/texture
asset-pack import; politics *timeline* (per-era slices) + journey planner depth; Web-Worker offload of
heavy commands + R32F GPU layers (browser-verified-only, exactly as the `elevation_foundation` flags them).
None of these change the world-centric architecture — they pour additional capability into the same spine.
