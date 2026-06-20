# Asset Pack format — in-app import (proposed)

**Status:** design for your feedback. Not yet built. This supersedes the earlier "sibling `assets/`
folder" idea (`docs/BIOME_AND_VISUALS_PLAN.md` §Asset packs) with something that fits the
single-file/offline goal far better: **import a ZIP asset pack at runtime, through a file picker, and
hold it in memory** — no folder next to the HTML, nothing to deploy, the tool stays one file.

## Why a ZIP import beats a sibling folder

- **Single-file integrity.** The whole point of Cartalith is "open the `.html`, it works." A sibling
  folder breaks that the moment you move/email/host the file. An in-app import keeps the tool a single
  portable file; packs are optional add-ons the user loads when they want them.
- **`file://` reality.** Under `file://`, a page **cannot** auto-`fetch()` a sibling folder (CORS), so
  the folder approach only ever worked via a local server. A user-chosen file (`<input type=file>`)
  has none of those restrictions — it works under `file://`.
- **Shareable.** "Here's my map style" = send one `.zip`. Packs can live in a save file later too.
- **Same fallback guarantee.** No pack loaded → the existing procedural textures/icons render. The
  pack is a quality layer, never a dependency.

How it loads at runtime: **Import pack…** button → file picker → we unzip in memory (existing
`unzipStore`) → decode `pack.json` → decode each PNG to an `ImageBitmap`/`<img>` → register them in a
`assetPack` runtime object the renderer samples. Nothing is written to disk; re-importing replaces it;
a "Clear pack" button drops back to procedural.

---

## ZIP layout

```
mypack.zip
├── pack.json                      # manifest (required) — see below
├── textures/
│   ├── grass.png                  # one image per material channel (single variant)
│   ├── rock.png
│   ├── sand.png
│   ├── snow.png
│   ├── wetland.png
│   ├── canopy.png
│   └── parchment.png              # optional paper base
└── icons/
    ├── mountain_01.png            # numbered variants → picked deterministically to break repetition
    ├── mountain_02.png
    ├── mountain_03.png
    ├── hill_01.png
    ├── hill_02.png
    ├── tree_conifer_01.png
    ├── tree_conifer_02.png
    ├── tree_broadleaf_01.png
    └── tree_broadleaf_02.png
```

Folders are a convention; the **manifest is the source of truth** for what maps to what (so you can
name files anything and store them flat if you prefer). Paths in the manifest are **relative to the
ZIP root**.

## `pack.json` (manifest)

```json
{
  "schema": 1,
  "name": "My 18th-Century Pack",
  "author": "you",
  "license": "CC0",
  "textures": {
    "grass":     "textures/grass.png",
    "rock":      "textures/rock.png",
    "sand":      "textures/sand.png",
    "snow":      "textures/snow.png",
    "wetland":   "textures/wetland.png",
    "canopy":    "textures/canopy.png",
    "parchment": "textures/parchment.png"
  },
  "icons": {
    "mountain":       ["icons/mountain_01.png", "icons/mountain_02.png", "icons/mountain_03.png"],
    "hill":           ["icons/hill_01.png", "icons/hill_02.png"],
    "tree_conifer":   ["icons/tree_conifer_01.png", "icons/tree_conifer_02.png"],
    "tree_broadleaf": ["icons/tree_broadleaf_01.png", "icons/tree_broadleaf_02.png"]
  }
}
```

### The keys are a fixed vocabulary (this is the important part)

The engine only knows these slot names; anything else in the manifest is ignored (forward-compatible).

**Texture channels** — exactly the renderer's `materialWeights` outputs, so B2 splatting can drop them
in with zero new logic:

| key | used for | tiling |
|---|---|---|
| `grass` | grassland / meadow ground | must tile seamlessly |
| `rock` | bare rock / cliff / high slope | seamless |
| `sand` | desert / dune / beach | seamless |
| `snow` | snow / ice cap | seamless |
| `wetland` | marsh / mud / swamp floor | seamless |
| `canopy` | closed-forest ground tint | seamless |
| `parchment` | paper base multiplied over the whole map (optional) | seamless |

**Icon slots** — each is an **array of variants**; `placeMapIcons()` already decides *where* glyphs go,
and will pick a variant per placement by a deterministic hash of its position, so a ridge of 40
mountains doesn't show the same drawing 40 times:

| key | drawn for |
|---|---|
| `mountain` | peaks (land-relative elevation ≥ 0.58) |
| `hill` | hills (0.53–0.58) |
| `tree_conifer` | boreal/conifer forest cells |
| `tree_broadleaf` | temperate/tropical broadleaf forest cells |

Any slot you omit falls back to **procedural** for that slot only — so a pack can be icons-only,
textures-only, or just a couple of mountain variants. Mix and match freely.

### Variation rules (how repetition is broken)

- Provide **1–N variants** per icon slot. More variants = less visible repetition. 3–5 mountains and
  2–3 of each tree is plenty.
- Selection is **deterministic**: variant = `hash(tileX, tileY, seed) mod N`, so the same world always
  draws the same icons (re-exports are stable), but neighbours differ.
- Optional per-variant weighting later (e.g. `"mountain": [{"file":"…","weight":3}, …]`) — not in v1;
  say if you want it.

### Image requirements

- **Format:** PNG (RGBA). Icons **must** have transparency (alpha) so they composite over terrain.
- **Textures:** seamless/tileable, square, **512 or 1024 px** (we sample, not blit 1:1 — 1024 is ample;
  bigger just costs memory). Color/albedo only — no normal/roughness maps (canvas-2D can't use them).
- **Icons:** trimmed to content with a little padding, "base" of the glyph at the bottom-center
  (we anchor the bottom of the sprite to the map cell, like a label). ~128–512 px tall is fine.
- Keep a pack reasonable (a few MB) — it lives in browser memory.

### A CSV alternative (if you'd rather author in a spreadsheet)

If hand-writing JSON is annoying, the importer can **also** accept `pack.csv` instead of `pack.json`:

```csv
type,slot,file,variant
texture,grass,textures/grass.png,
texture,rock,textures/rock.png,
icon,mountain,icons/mountain_01.png,1
icon,mountain,icons/mountain_02.png,2
icon,hill,icons/hill_01.png,1
icon,tree_conifer,icons/conifer_01.png,1
```

`type` ∈ {texture, icon}; `slot` is one of the fixed keys above; `file` is the ZIP-relative path;
`variant` is ignored for textures and just orders icon variants. Same vocabulary, friendlier to author
in Excel/Sheets. The importer reads whichever of `pack.json` / `pack.csv` is present (JSON wins if both).

---

## How you'd use it (end-to-end)

1. **Assemble** a folder on your machine: a `pack.json` (or `pack.csv`) + `textures/` + `icons/` PNGs.
   (For the CC0 starting set, see `docs/research/asset-candidates.md`.)
2. **Zip** that folder's *contents* (so `pack.json` is at the ZIP root, not inside a subfolder).
3. In the tool: **View → Import pack…** → choose the ZIP. A summary appears ("7 textures, 3 mountains,
   2 trees loaded"). The map re-renders using the pack; empty slots stay procedural.
4. Toggle **Texture splatting** and **Stylized icons** on/off as before — now backed by your art.
5. **Clear pack** returns to fully procedural.

A worked starter pack (`assets/sample_pack.zip` built from the approved CC0 shortlist) can ship in the
repo as a reference + smoke test once you approve the candidate art.

---

## My recommendation

- Go with **ZIP import + `pack.json`** as the primary path, **`pack.csv` accepted** as the
  spreadsheet-friendly alternative — both over the same fixed slot vocabulary above.
- Keep the **fixed key set** small and tied to the renderer's existing material channels + icon
  classes; that's what lets the art drop in with almost no new branching and keeps the procedural
  fallback honest per-slot.
- Build order once you're happy with this: (1) importer + `assetPack` runtime + Import/Clear UI and a
  schema test, (2) wire textures into B2 splatting, (3) wire icon variants into `drawMapIcons`. Each
  step independently shippable and bit-identical when no pack is loaded.

Tell me if the slot vocabulary, the variant scheme, or the JSON-vs-CSV split should change, and whether
the sample pack should ship in-repo. Then I'll build the importer.

---

## Schema 2 — compiler superset (unified-app forward-prep)

The standalone **Asset Pack Compiler** (`asset_pack_compiler.html`) authors packs at `"schema": 2`. This is a
**strict superset of schema 1**: the `textures` and `icons` sections are byte-for-byte the same vocabulary and
shape, so the *current* elevation-foundation importer (`parsePackManifest`) reads them unchanged and silently
ignores everything else (it only iterates `PACK_TEX_SLOTS`/`PACK_ICON_SLOTS`, and only warns on unknown keys
*inside* `textures`/`icons` — the new top-level sections are never inspected). One pack therefore serves both
the shipping generator and the future unified Cartalith app.

The new sections carry the vocabulary the **downstream Cartalith editor** already defines (`BIOMES`, `TERRAINS`,
`SETTLEMENT_CLASSES`, `SETTLEMENT_TRAITS`, `POI_TYPES`) — currently drawn as procedural Unicode/SVG glyphs, so
custom art is greenfield and inert until the unified app wires it.

```json
{
  "schema": 2,
  "name": "...", "author": "...", "license": "CC0",

  "textures": { "grass": "textures/grass.png", ... },          // schema-1, engine-active
  "icons":    { "mountain": ["icons/mountain_01.png", ...], ... }, // schema-1, engine-active

  "biomes":   { "coastal": "biomes/coastal.png", ... },        // 15 Cartalith biome paint tiles (512², opaque, seamless)
  "terrains": { "paved": "terrains/paved.png", ... },          // 13 Cartalith terrain paint tiles (512², opaque, seamless)

  "structures": {                                              // map symbols (256², RGBA, center-anchored, 1..N variants)
    "settlement": { "hamlet": ["structures/settlement/hamlet_01.png", ...], ... },  // 9 size classes
    "trait":      { "port":   ["structures/trait/port_01.png", ...], ... },         // 7 role overlays
    "poi":        { "ruin":   ["structures/poi/ruin_01.png", ...], ... }            // 10 POI markers
  }
}
```

### New fixed keys

| Section | Keys (fixed vocabulary, mirrors Cartalith storage order) | Render rules |
|---|---|---|
| `biomes` (15) | `coastal` `temperate_forest` `mediterranean` `wetlands` `steppe` `jungle` `boreal` `mountain` `cold_desert` `hot_desert` `tundra` `ruined` `hills` `lake_river` `ocean` | 512×512, opaque (alpha flattened on black), seamless — paint-grid fills |
| `terrains` (13) | `paved` `dirt` `hardpack` `plains` `forest_path` `hills` `rocky` `mtn_pass` `mtn_trail` `swamp` `deep_sand` `snow` `ruins` | 512×512, opaque, seamless — terrain paint layer |
| `structures.settlement` (9) | `hamlet` `village` `town` `city` `capital` `monastery` `fortress` `university` `industrial` | 256×256, RGBA, **center-anchored** pin; 1..N variants |
| `structures.trait` (7) | `fortified` `mining` `port` `administrative` `trade_hub` `military` `religious` | 256×256, RGBA, center-anchored overlay |
| `structures.poi` (10) | `ruin` `landmark` `mountain_peak` `lake` `named_forest` `battlefield` `shrine` `cave` `bridge` `other` | 256×256, RGBA, center-anchored marker |

Biome/terrain keys are the suffixes of Cartalith's `--biome-*` / `--terrain-*` CSS tokens; structure keys are the
`key` fields of `SETTLEMENT_CLASSES` / `SETTLEMENT_TRAITS` / `POI_TYPES`. Anchor differs by family: feature icons
(`mountain`/`hill`/trees) stay **bottom-anchored** (glyph base on the cell); settlement/trait/POI symbols are
**center-anchored** (centered on the point), matching how Cartalith places pins today.
