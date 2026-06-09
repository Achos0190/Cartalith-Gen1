# UI Research — Unifying elevation_foundation and Cartalith v1.914

*June 2026. Sources: inventory of both files in this repo; UI patterns from Azgaar's Fantasy Map Generator, World Machine/Gaea/World Creator, Wonderdraft/Inkarnate.*

## A. Current UI — elevation_foundation v0.036

- **Layout:** 48px header (title, version, GPU tag, mobile hamburger) · canvas stage (~70%) · right sidebar (324px desktop / 87vw slide-in overlay on mobile).
- **Sidebar:** 2 tabs (Terrain / Sculpt). Terrain tab = stacked sections: Source (load heightmap, resolution seg buttons) · Tectonics · Volcanism & Impacts · Climate & Biomes (extent Region/World, latitude band, lapse) · Weather & Rainfall sim · Erosion (droplet / thermal+diffusion / stream-power / glacial / coastal subsections) · Calibration (sea %, peak m, map km) · View (render mode seg, blend, exaggeration, sun, debug views). Sculpt tab = polyline/brush tools, brush effect seg (raise/lower/smooth/flatten/canyon), radius/strength, 5-level undo.
- **Control idioms:** `.row` (label 90px | range | value 60px), `.seg`/`.seg.sm` segmented buttons, `.sec` section with small-caps h2, `.btnrow`, `.hint`, `.readout` (mono stats), `button.on` active state. Mobile: bigger sliders, zoom +/− buttons.

## B. Current UI — Cartalith v1.914

- **Layout:** 48px menubar (brand, 3 workspace tabs: **Routes | Planner | Map Setup**, theme dropdown, settings) · 340px left sidebar + canvas (Routes/Map Setup) or full-page scroll (Planner).
- **Routes workspace:** image loader, snap toggle, active-route toolbar (Undo/Clear/+New), expandable route cards (color swatch, name, meta), selection bar; canvas pan/zoom with mobile navpad (zoom + joystick) and floating touch-undo; bottom timeline dock (politics year slider).
- **Map Setup workspace:** paint layer toggle (Biome ⇄ Terrain), cell-size slider, brush (size/opacity), color palette grids (14 biomes / 13 terrains), climate-bands guide overlay, drawn-ways list, polity painter + timeline.
- **Planner workspace:** route groups → stage cards (settlement, travel mode, distance, economics grid, scarcity); settlement editor modal (name, class, trait chips, economics sliders, allegiance timeline keyframes).
- **Idioms:** `.section-label`, `.subsection`, `.toolbar`/`.toolbar-3`/`.toolbar-4` grids, `.route-card` with accent left border, color swatches, accent `#b08d54` golden-bronze dark theme.

## C. Patterns from comparable tools

| Tool | Takeaway |
|------|----------|
| Azgaar's FMG (azgaar.github.io/Fantasy-Map-Generator) | Generation params and editing tools in separate panels; toggleable overlay layers; lock mechanism so regeneration doesn't clobber edits; full-state JSON export. |
| World Machine / Gaea / World Creator | Staged pipeline (Build → Erode → Sculpt → Export); non-destructive: parameters are inputs, hand edits live in separate masks/layers; "seed + override" model. |
| Wonderdraft / Inkarnate | Editor-first: left tool palette, right layer panel, pervasive shortcuts (B/E…), visible linear undo history. |
| Hybrid generate+edit problem | Four known solutions: (a) separate procedural vs manual layers, (b) parameters-vs-content split (regenerate = re-run pipeline; edits are an overlay), (c) region locking, (d) seed snapshots/variants. |
| Canvas-heavy SPA convention | Left sidebar (tools or params) + center canvas + optional right inspector + status bar; floating mobile controls. |

## D. Recommended unified UI

**Design principle: “Layers first, regeneration safe.”** Procedural terrain output, manual sculpt overlay, paint layer, and cartographic content (routes/places/politics) are separate layers. Regenerating rewrites only the procedural layer; everything manual persists. A **Bake** action commits the sculpt overlay into the terrain.

**Top-level tabs (replace v1.914's 3):** `Generate | Sculpt | Paint | Routes | Politics` — each switches the left-panel sections, canvas cursor/handlers, and default layer visibility/fading. Planner becomes a modal/drawer launched from settlements in Politics.

**Layout:** keep Cartalith's menubar + 320–340px left panel + canvas. Always-visible **Layers & Blend** panel at top (visibility eye, opacity, blend mode per layer, "Bake sculpt onto terrain" button). Shared **Project** section at bottom (world name, Save/Load ZIP, Export dropdown: PNG / tiles / JSON / f32 fields).

**Section migrations:**
- Generate ← all elevation_foundation parameter sections (World Structure, Tectonics, Volcanism, Erosion, Weather, Climate, Calibration) as collapsible `.param-section`s; render-mode/debug toggles move to a canvas-corner overlay.
- Sculpt ← elevation_foundation Sculpt tab unchanged (polyline + brush + undo).
- Paint ← v1.914 Map Setup (Biome⇄Terrain toggle, brush, palettes, cell grid) — with a new "Generate biomes from climate" action that pre-fills the paint grid from `classifyBiome(tempField, rainField)`, then the user paints over it.
- Routes ← v1.914 Routes unchanged (cards, snapping, measure).
- Politics ← timeline, polity painter, settlement list; Planner embedded as modal.

**Regeneration safety dialog:** when generating with un-baked sculpts/paint: `[Bake & regenerate] [Regenerate, keep overlays] [Cancel]`.

**CSS merge:** one `:root`; adopt Cartalith's `#b08d54` accent and panel vars; keep elevation's `.row`/`.seg` (rename `.param-row`/`.tool-seg`); Cartalith's `.section-label`/`.subsection`/cards for lists; new `.layer-item`.

**Migration order (UI):** 1) merged CSS root + 5-tab menubar + context-sensitive panel skeleton → 2) Generate tab port → 3) Sculpt port → 4) Paint port (+climate pre-fill) → 5) Routes port → 6) Politics + Planner modal → 7) Layers & Blend wiring → 8) polish (shortcuts, mobile navpad, save/load round-trip).
