# Map Icons & Special Features — Expansion Research

> Research for expanding the Style tab icon system and hooking the full Asset Pack Compiler vocab into the elevation foundation.

---

## 1. What other tools do

### Algorithmic auto-placement (rare, differentiating)
**Azgaar's Fantasy Map Generator** is the only mainstream tool that places icons algorithmically from terrain data — settlements appear at high carrying-capacity cells, mountain symbols appear at high-elevation cells, forests at forest biome cells. This is exactly what Cartalith already does (v0.042 `placeMapIcons`, v0.105 `findSettlementSeeds`). Most tools don't get here; we are already ahead.

### Manual drag-drop (dominant pattern)
**Wonderdraft, Inkarnate, CC3+, MapForge** all center on the user dragging icons from a library panel onto the map. Key sub-patterns:
- **Category folders** — icons grouped by type (terrain / settlements / roads / POI). Users browse by folder.
- **Variant picking** — clicking a category randomly picks a visual variant (e.g. 3 different mountain silhouettes). We already have `pickIconVariant`.
- **Painter's sort** — icons drawn south-to-north so southern items appear in front. Already in `placeMapIcons`.
- **Snap-to-cursor** — manual placement snaps to a grid or terrain feature (CC3+ snaps to water/mountain cells).

### Asset packs
**Wonderdraft** pioneered the folder-based asset pack: a directory with a JSON manifest and per-category PNG sprite sheets. Custom packs are simply dropped into `%APPDATA%/Wonderdraft/assets/`. Our Asset Pack Compiler is a direct equivalent, and more ergonomic (GUI compiler vs. manual folder editing).

### Icon sizing & importance
**CC3+ and Wonderdraft** scale icons by "importance" — cities are drawn bigger than hamlets, major mountain ranges bigger than foothills. **Dungeon Alchemist** uses modular scale (each icon snaps to a size tier). This is an easy win: size settlements by population/tier, size terrain icons by elevation magnitude.

### Layering
Every tool has explicit layer ordering: terrain icons behind settlement icons behind POI labels. **Inkarnate** exposes this as a z-depth slider per placed object. We currently draw everything in one pass; a layer model (terrain → settlement → POI → labels) would match user expectations.

### Notable UX patterns worth borrowing
- **CC3+ "smart snap"** — when you place a settlement icon near a river cell, it snaps to the river. Translates to: snap icon placement to `_settleSeeds` or `flowField` peaks.
- **Inkarnate "replace variant"** — right-click an already-placed icon to cycle its sprite variant without moving it.
- **Wonderdraft density slider** — a global "icon density" slider that culls icons below a salience threshold. We have the salience score from `findSettlementSeeds` — easy to wire.

---

## 2. Current state

### What the elevation foundation has (v0.137)

**Icon slots currently consumed from asset packs:**
```
PACK_ICON_SLOTS = ['mountain', 'hill', 'tree_conifer', 'tree_broadleaf']
```
Four slots only. `placeMapIcons` auto-places terrain glyphs; `drawMapIcons` renders pack sprites or procedural fallbacks.

**Style tab icon controls:**
- Single checkbox: `state.viz.icons` (all-or-nothing)
- No per-category control, no density, no size slider

**Settlement data already computed (v0.105+):**
- `_settleSeeds` — advisory placement points with score, biome, resource potentials
- `_carryCapField`, `_settleSuitField` — per-cell suitability fields
- None of this is used for icon rendering yet.

**River/lake/POI data available:**
- `_riverNet.order` (Strahler order) — identifies major river junctions/sources
- `currentWaterBodies()` — sea / lake masks
- `buildFjordMask`, tidal fields — coastal special features

### What the Asset Pack Compiler already defines (schema 2)

The compiler has a **much richer vocab** than the foundation currently reads. Unused slots:

| Family | Slots | Count | Notes |
|--------|-------|-------|-------|
| **textures** | grass/rock/sand/snow/wetland/canopy/parchment | 7 | ✅ foundation reads all |
| **icons (terrain)** | mountain/hill/tree_conifer/tree_broadleaf | 4 | ✅ foundation reads all |
| **settlement** | hamlet/village/town/city/capital/monastery/fortress/university/industrial | 9 | ❌ foundation ignores |
| **trait** | fortified/mining/port/administrative/trade_hub/military/religious | 7 | ❌ foundation ignores |
| **poi** | ruin/landmark/mountain_peak/lake/battlefield/shrine/cave/bridge/other | 10 | ❌ foundation ignores |
| **biomes** | 15 Cartalith biome paints | 15 | ❌ foundation ignores (Cartalith use) |
| **terrains** | 13 Cartalith terrain paints | 13 | ❌ foundation ignores (Cartalith use) |

**The settlement/trait/poi families are fully designed but the elevation foundation never reads them.** This is the primary gap.

---

## 3. Proposed expansion — four stages

### Stage 1 — Connect settlement icons to `_settleSeeds` (highest value, small scope)

The settlement seeds (`_settleSeeds`) already classify each site by score and resources. Map these to the compiler's settlement/trait slots:

**Settlement tier → icon slot:**
```
score ≥ 0.85 → capital
score ≥ 0.70 → city
score ≥ 0.55 → town
score ≥ 0.40 → village
else         → hamlet
```

**Resource potentials → trait overlay slots:**
```
copper or iron or tin high → mining
salt or trade_hub high     → trade_hub
coastal + port biome       → port
gold high                  → (no slot yet — could add)
```

New pure function: **`placeSettlementIcons(seeds, opts)`** → `{settlements:[{x,y,slot,traitSlot,score}]}`.  
Draw with: procedural fallback glyph (circle + dot, scaled by tier) or pack sprite.

Style tab addition: **"Settlements"** checkbox + density slider (filters by score threshold).

### Stage 2 — POI icons from terrain analysis (medium scope)

Auto-place POI markers at notable terrain features, using existing computed fields:

| POI slot | Source |
|----------|--------|
| `mountain_peak` | local maxima of `field[]` above mountain threshold (r ≥ 0.70), spacing constraint |
| `lake` | `currentWaterBodies()` class-2 lake centroids |
| `cave` | high `heterogeneityField` + mid-elevation land (geology pocket) |
| `bridge` | `riverMask` crossing points where two roads nearly meet |
| `shrine` | isolated high cells (defensible hilltops) + high `settleSuitField` but no settlement |
| `ruin` | low `settleSuitField` cells that were once viable (low moisture + exhausted soil proxy) |
| `landmark` | convex ridgeline features from `_crestField` peaks |

New pure function: **`placePOIIcons(fld, flow, biome, waterBody, W, H, opts)`** → `{pois:[{x,y,slot}]}`.

Style tab: **"POI markers"** checkbox + per-category mini-toggles (mountain peaks / lakes / caves / etc.).

### Stage 3 — Icon controls in Style tab (UX, small scope)

Replace the single `icons` checkbox with a proper **"Map symbols"** accordion:

```
☑ Terrain icons     [Density ──●── 1.0×]  [Size ──●── 1.0×]
☑ Settlements       [Min score ──●── 0.4]  [Size ──●── 1.0×]
☑ POI markers       [per-type checkboxes]
```

New `state.viz` fields:
```js
iconDensity:   1.0,   // culls terrain icons below salience threshold
iconSize:      1.0,   // global scale multiplier
settleDensity: 0.4,   // min score to show a settlement icon
settleSize:    1.0,
poiTypes:      {mountain_peak:true, lake:true, cave:false, ...}
```

All default to current behaviour (≡ bit-identical render when no pack loaded).

### Stage 4 — Icons in LOD tiles and PNG bakes (completeness)

`renderBiomeTileRGBA` already has access to `bounds` (coarse-coord rect). Settlement and POI icon placement can be filtered to the tile's bounds, then drawn at full tile resolution. This gives icons in the exported region tiles and atlas PNGs — currently icons only appear in the on-screen overlay.

Implementation: pass `iconLists` (pre-computed from stages 1–2) into `renderBiomeTileRGBA`; filter by `bounds`; render with `drawMapIcons` into the tile's `OffscreenCanvas` context.

---

## 4. Recommended build order

| Priority | Stage | Scope | Value |
|----------|-------|-------|-------|
| 1 | Stage 1 — settlement icons | ~200 lines | High — closes the compiler↔foundation gap, uses already-computed data |
| 2 | Stage 3 — Style tab controls | ~80 lines HTML/JS | High — needed alongside Stage 1 to control density |
| 3 | Stage 2 — POI icons | ~300 lines | Medium — terrain analysis is richer but needs tuning |
| 4 | Stage 4 — LOD/bake icons | ~100 lines | Low — polish, needed only for export quality |

Stage 1 + Stage 3 together are the natural first PR (v0.138 of the elevation foundation). Stage 2 follows. Stage 4 is an export-quality follow-up.

---

## 5. What the compiler needs (follow-up)

Currently the compiler's `settlement`/`trait`/`poi` families are compiled into the ZIP but the foundation never reads them. Once Stage 1 lands:

- `loadAssetPack` should populate `assetPack.settlement`, `.trait`, `.poi` alongside `.icons`
- `PACK_SETTLEMENT_SLOTS`, `PACK_TRAIT_SLOTS`, `PACK_POI_SLOTS` constants mirror the compiler's families
- The pack inspector thumbnail grid (`#packGrid`) should gain tabs for each family

No compiler changes needed — the schema is already correct.
