# Map-Painting & Zoom UX — Research

*June 2026. Prior art for real-time heightmap painting, freehand strokes, and zoomable scale, with the key takeaways from the tools the user singled out (Wonderdraft, World Machine, World Creator). Drives `elevation_foundation_v0.048+`. Cross-ref `docs/BIOME_AND_VISUALS_PLAN.md` (visuals) and `docs/WORLD_REGIONAL_TILING_PLAN.md` (region refine).*

## The three tools the user wants us to learn from

### Wonderdraft — hand-drawn, symbol-along-stroke
- Direct-manipulation brushes: drag to paint landmasses; coastlines auto-style.
- **Mountain/tree/symbol brushes scatter symbols *along a dragged stroke*** with size jitter + spacing — the literal "draw a line → feature follows the plotline" model.
- Immediate visual feedback; layered, non-destructive (landmass / water / mountains / trees / labels).
- **Take:** capture a freehand drag as the guide; place the feature *along* it; preview live; jitter/taper so it never looks mechanical.

### World Machine — low-res preview, full-res build; parametric stack
- Node/device graph: generators → erosion/filter devices → output; non-destructive, parametric.
- **"Layout" resolution (cheap, interactive) vs "Build" (full-res, on demand)** — exactly "draw a cheap visual heightmap, then a Generate button does the expensive sim/export."
- Realism comes from stacking erosion devices on macro terrain.
- **Take:** keep painting on the working grid cheap + live; gate heavy erosion/climate behind an explicit Generate; the painted field is the macro layer erosion refines (we already do this — formalize it).

### World Creator — real-time brushes that apply *geological operators* locally
- Real-time sculpt + **filter brushes that apply erosion / sediment / terraces / flow under the brush**, not just raise/lower — "paint realistic geology."
- Flow / slope / cavity selectors; stamp real-world terrain.
- **Take:** feature brushes should stamp *procedural geology* (ridge + fractal detail, carved valley, plateau + rim) conditioned on the local field — reuse `fbm`/`ridged` + the `amplifyRegion` detail idea under the brush footprint.

## Incorporate now (v0.048) vs park

- **Now:** plotline-guided feature brushes (mountain range, river/valley, ridge, plateau/mesa, hills, escarpment, canyon) synthesized along a *hand-drawn* guide line, centred on the line within an affected radius, with fractal detail; cheap live preview; Generate button; Ctrl-Z; map zoom/pan + dynamic scale bar.
- **Park (notes below):** symbol/icon scatter along strokes (→ Nortantis-style visuals, `BIOME_AND_VISUALS_PLAN.md`); full node-graph/parametric stack; GPU filter brushes; region high-fidelity refine via `amplifyRegion` (selection UI on the new zoom); stamp-from-real-DEM.

---

## Topic 1 — Real-time painting with procedurally realistic feature brushes

- **Fractal brush stamping**: fBm (4–6 octaves of Simplex/Perlin; Simplex ~2× faster) modulated by a brush shape; **ridged multifractal** for mountains (higher elevations accrue more detail → natural ridge complexity). We already have `fbm`/`ridged`.
- **Two-step mask→amplify** (Azgaar): paint a coarse boolean control mask, then procedurally synthesize detail inside it; decouples *where* from *how it looks*. Maps onto our paint-base → Generate flow.
- **Dirty-rect optimization**: track the bounding rect of a stroke; update/redraw/snapshot only that region. Per-stroke deltas (tile snapshots) cut undo memory 5–10× vs full-array copies. *(Our `pushUndo` currently snapshots the whole field — a future optimization is dirty-rect undo.)*
- **Live hillshade**: recompute normals (Sobel) only in the dirty region; multidirectional hillshade (multiple light azimuths) improves low-relief readability.
- Tools: World Machine (node graph + Drawpaint mask), Gaea (real-time quadtree tiles), Wonderdraft (symbol brushes), Azgaar (sequential templates, brush radius/power, step undo).

## Topic 2 — Freehand strokes → smooth editable curves

- **Centripetal Catmull-Rom (α=0.5)**: four-point, tangents from neighbours, no manual handles, no self-intersections; O(n). **We already ship `catmullRomSample` (centripetal).**
- **Ramer–Douglas–Peucker simplify** before splining: removes the point farthest from the endpoint chord if > ε (≈1 px screen); reduces captured points 70–90%, O(n log n) avg.
- **Pressure/speed → width**: `min + pressure·(max−min)`; slower = wider. Optional; needs `pointerEvent.pressure`.
- Reference: OSM JOSM spline-drawing (Bézier ways from a guidance spline at ~0.01 t steps).
- **For us:** capture raw `pointerdown/move/up` → RDP (ε≈1px) → `catmullRomSample` → apply feature along the curve. The drawn line is a *guide*, not stored geometry.

## Topic 3 — Multi-scale zoomable presentation

| Approach | Pros | Cons | Best for |
|---|---|---|---|
| Continuous canvas zoom (`ctx.setTransform` / CSS transform) | simple, no preprocessing, responsive ≤8× | pixelation at high zoom | single-canvas heightmap viewer (**us, now**) |
| Tile pyramid (slippy) | LOD to planetary scale, incremental | needs tile gen + cache | multi-gigapixel web maps (later, ties to 16k tiling) |

- **Scale bar**: `km_per_px = (mapWidthKm / canvas.width) / scale`; pick a round distance (1/2/5×10ⁿ) rendering to ~80 px; redraw on zoom/pan. (Mapbox/Leaflet `L.Control.Scale`, Azgaar uses d3-zoom + dynamic bar.)
- **Multi-scale LOD / amplification**: coarse global map → refine viewport detail on zoom; deterministic seed keeps local detail consistent; quadtree subdivides only visible tiles. **This is our `amplifyRegion` path — parked for the region-refine feature.**
- Decision (user): **continuous zoom on the current displayed map, no tiles yet.**

## Topic 4 — Canvas pan/zoom in plain JS

- **`ctx.setTransform(k,0,0,k,panX,panY)` + `requestAnimationFrame`** = crisp semantic zoom with adaptive redraw (no pixelation); vs CSS transform (GPU-cheap but pixelates) vs `drawImage` of an offscreen buffer (memory/speed tradeoff, good for >2K maps).
- **Wheel** zoom toward cursor: `panX -= mouseX·(zoomFactor−1)` etc., clamp scale [0.25, 8]. **Pinch**: trackpad = `wheel + e.ctrlKey`; mobile = TouchEvent distance ratio; Safari `GestureEvent` (`e.scale`).
- **State** `{scale, panX, panY}`; `canvas_pt = data_pt·k + pan` (the d3-zoom transform). Our existing mobile zoom uses CSS transform — promote it to a general pan+zoom with this state and reset.
- **Float32 perf**: typed-array math fast; for >2K render once to an offscreen canvas and `drawImage` a viewport slice; `requestAnimationFrame`-batch redraws.

## Key sources
Red Blob Games (noise maps); Wikipedia centripetal Catmull-Rom; Ramer–Douglas–Peucker; MDN `setTransform`/Optimizing Canvas; d3-zoom (d3js.org/d3-zoom); Azgaar FMG GitHub (heightmap template editor, d3-zoom); World Machine / Gaea / World Creator product docs; Leaflet zoom levels; Observable "map zooming with slippy tiles and a scale bar"; Konva/Fabric multi-touch pinch.

## Implementation roadmap (effort × payoff)
| Feature | Technique | Effort | Perf |
|---|---|---|---|
| Realistic feature brushes | fBm/ridged stamping along a curve, taper by ⊥ distance | Med | Good (cache) |
| Freehand strokes | RDP (ε≈1px) + existing `catmullRomSample` | Low | Excellent |
| Continuous zoom | `ctx.setTransform`/CSS transform + rAF | Low | Excellent |
| Scale bar | `km_per_px` → round bar + label | Low | Excellent |
| Multi-touch pan/zoom | wheel+ctrlKey (pinch) + TouchEvent ratio | Med | Excellent |
| Dirty-rect live hillshade & undo | Sobel normals + per-stroke tile snapshots | Med | Good |
