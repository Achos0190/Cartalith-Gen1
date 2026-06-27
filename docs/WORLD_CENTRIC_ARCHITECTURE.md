# Cartalith — World-Centric Architecture (the GIS reset)

> **Status:** Phase 1 foundation shipped as `Cartalith Gen1 v0.08.html` (self-contained, hand-written,
> not a build-script artifact). This document is the contract the migration follows.
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
- **P3 — Cartograph content:** routes/ways/places with traits & economics, politics-timeline layers,
  journey planner — as vector layers + tools on the same World (no separate editor).
- **P4 — Assets & export:** asset-pack module feeding splat/icons/symbols across every layer; save schema
  v10; tiled-LOD/atlas chunk store for very large worlds (chunked storage + dirty-region tiles).
- **P5 — Performance:** worker-offloaded heavy nodes, R32F GPU layers, spatial indexing.

## 6. What v0.08 deliberately does NOT yet have

Full v0.07 feature parity (the mature route/politics/planner editor, the full erosion suite, asset
compiler, LOD atlas). Those migrate in P2–P4. v0.08 is the **spine** — correct architecture first, then
pour the existing tested capability into it without re-introducing the multi-app split.
