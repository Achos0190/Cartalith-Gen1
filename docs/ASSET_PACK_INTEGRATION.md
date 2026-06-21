# Asset packs → the consolidated Cartalith tool

How the standalone **Asset Pack Compiler** (`asset_pack_compiler.html`) and the **schema-2 pack format**
(`docs/ASSET_PACK_FORMAT.md`) fold into the unified "Gen1" tool (the planned merge of
`elevation_foundation_v*.html` + `Cartalith_V1.914.html`, see `docs/UNIFIED_TOOL_PLAN.md`), and the concrete
prep the downstream side needs — especially for **custom icons**.

## 1. The pieces today

| Piece | Role | Pack awareness |
|---|---|---|
| **Compiler** (`asset_pack_compiler.html`) | authoring satellite — drag/crop/slice art → `pack.json` (schema 2) + STORED `.zip` | produces every section |
| **elevation_foundation** | upstream generator | **consumes** `textures` (splat) + `icons` (feature glyphs) via `parsePackManifest` / `assetPack` / `drawMapIcons` |
| **Cartalith_V1.914** | downstream cartographic editor | **no pack support yet** — settlements/traits/POIs are procedural Unicode/SVG glyphs; biome/terrain grids are flat-colour |

The compiler is deliberately a **separate, zero-dependency, single-file** tool. It should stay that way (authoring
≠ map-making), and the unified app should *consume* packs, not embed the authoring UI. (A later convenience: launch
the compiler from the app, or embed just the slicer — optional, not required.)

### Schema-2 sections and who reads them

```
textures   (7)   ── elevation_foundation: B2 splat (live today)
icons      (4)   ── elevation_foundation: drawMapIcons (live today)
biomes     (15)  ─┐
terrains   (13)  ─┤  unified app (new wiring — see §3)
structures (S/T/POI) ┤
custom     (sets) ─┘
```

`parsePackManifest` only iterates `PACK_TEX_SLOTS` / `PACK_ICON_SLOTS` and ignores unknown top-level keys, so a
schema-2 pack already loads cleanly in the current engine (no warnings). Everything below is **additive**.

## 2. Single source of truth: a shared pack module

Both consumers re-implement the same decode today. The merge should extract one **`pack` module** (pure, headless-
testable, the `amplifyRegion` mould) shared by the unified tool:

- `parsePackManifest(zip)` — already exists in elevation_foundation (~L4969); generalise it to also return
  `biomes`, `terrains`, `structures.{settlement,trait,poi}`, and `custom` (set → key → variants), validating files
  exist and emitting warnings for unknown keys.
- `unzipAny(ab)` (STORED + DEFLATE) — already in elevation_foundation; reuse verbatim.
- `pickIconVariant(x,y,seed,n)`, `spriteDrawRect`, `finalizePackTexture` — already exist; reuse.
- New: `buildSymbolRegistry(pack)` → a flat, addressable index of every placeable sprite
  (`structures/<group>/<key>` and `custom/<set>/<key>` → `{variants:[ImageBitmap], anchor}`), the thing a symbol
  picker and the renderer both read.

Keep the **frozen vocabularies** (`PACK_TEX_SLOTS`, `PACK_ICON_SLOTS`, the Cartalith `BIOMES`/`TERRAINS` keys,
`SETTLEMENT_CLASSES`/`TRAITS`/`POI_TYPES` keys) as the contract; the compiler and the app must share them.

## 3. Wiring each section into the unified renderer

- **textures / icons** — already done in elevation_foundation; carry over unchanged.
- **biomes / terrains** — the Cartalith paint grids render flat colours per cell. With a pack loaded, sample the
  matching `biomes[<key>]` / `terrains[<key>]` tile (tileable, opaque) for painted cells — exactly the elevation
  foundation's B2 splat idea, but keyed by the painted Cartalith index instead of `materialWeights`. Gate behind a
  strength slider; no pack ⇒ flat colour (bit-identical to today).
- **structures (settlement / trait / POI)** — Cartalith draws these as glyphs. Add a sprite-lookup at the draw
  site (mirroring `drawMapIcons`' "pack slot has variants ? sprite : procedural glyph" branch): if the loaded pack
  has `structures.<group>.<key>`, draw the (deterministic-variant) sprite; else the existing glyph. Center-anchored
  (the format already specifies it). **Zero behaviour change with no pack.**

## 4. Custom icons — what Cartalith must gain

Custom icons are the genuinely new concept; Cartalith has no notion of free-form user symbols. Prep, smallest→largest:

1. **Symbol registry from the pack** — build `buildSymbolRegistry(pack).custom` = `set → key → variants`. Drives
   the picker and renderer. (Trivial once §2 exists.)
2. **A placeable "symbol marker" object** — a new vector object alongside `places`/`ways`/`routes`:
   `{type:'symbol', set, key, variant?, x, y, scale, rot?}`. Lives in `state` so it serialises (Cartalith already
   serialises the whole `state`).
3. **A palette / picker UI** — grouped **by set** (the reason sets exist): a scrollable symbol palette, click a
   symbol then click the map to place (same interaction as the elevation foundation's "Add places" tool). Search
   by name; show variant count.
4. **Rendering** — draw placed symbols on the vector overlay layer (the `vctx` idiom), center-anchored, scaled by
   `state.calibration` so symbol size is map-relative; deterministic variant via `pickIconVariant(x,y,seed,n)`
   unless the user pinned one.
5. **Save-format support** — bump the Cartalith save schema (precedent: `migrateToV4` ~L14899) to persist the
   `symbol` markers. Two provenance options for the art itself:
   - **Embed the pack** in the project ZIP (precedent: elevation_foundation embeds the baked atlas via
     `atlasExportEntries`/`atlasImportEntries`) — self-contained, recommended default.
   - **Reference by pack name/id** + expect the pack re-imported — lighter saves, but breakable.
   Store a `packRef` (name/author/license/hash) regardless, so a project can report a missing pack.
6. **Missing-pack degradation** — a placed `symbol` whose pack isn't loaded should render a labelled placeholder
   (e.g. the set/key as text in a box), never vanish — so a project opened without its pack is still legible and
   re-linkable.

## 5. Suggested phasing

1. **Format + module** — land `parsePackManifest` generalisation + `buildSymbolRegistry` + headless tests
   (decode every section incl. grouped `custom`). No UI. (Pure, low-risk.)
2. **Structures sprites** — route settlement/trait/POI drawing through the registry (sprite-or-glyph). Visible win,
   no new data model.
3. **Biome/terrain texturing** — pack-textured paint cells behind a strength slider.
4. **Custom symbols** — the `symbol` object + picker + save-schema bump + embed/restore + placeholder fallback.

Steps 1–3 are bit-identical with no pack loaded; step 4 is the only save-format change (migration-gated).

## 6. Open decisions (for the user)

- **Embed vs reference** packs in Cartalith projects (recommend embed-by-default, like the atlas).
- **Compiler placement** — keep standalone (recommend), launch-from-app, or eventually embed the slicer as a tab.
- **Biome/terrain texture authority** — do pack tiles fully replace the flat palette, or tint it (so unpainted/no-
  pack stays recognisable)? (Recommend tint/replace behind one strength slider, default off ⇒ unchanged.)
- **Custom-symbol scale model** — fixed px, map-km-relative, or per-placement (recommend map-relative default with
  per-placement override).
