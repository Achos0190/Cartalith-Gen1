# CC0 Asset Candidates — for visual approval (B2 splatting + B3 sprite icons)

**Status:** awaiting your eyeball. Nothing is vendored yet. Per the locked decision
(`docs/BIOME_AND_VISUALS_PLAN.md` §Asset packs): assets live in a sibling `assets/` folder, load
**only after you approve a pack on visual quality**, and the tool always works **without** the folder
(procedural fallback — the single-file/offline guarantee holds). All candidates below are **CC0 /
public domain** (no attribution required; we still record provenance in `assets/CREDITS.md` when we
vendor).

How to review: open the view links, judge the look. Tell me which IDs to keep (or "all of a row",
or "swap X for Y"). Then I vendor the approved subset (1K JPG, color/albedo map only — the renderer
samples diffuse; normal/roughness maps are not needed for the canvas-2D splat) into `assets/textures/`
and `assets/icons/`, add `CREDITS.md`, and wire B2/B3 to detect and use them.

> Note on fetching: the asset CDNs (ambientCG, Poly Haven) block this environment's web-fetch user
> agent, so I can't preview thumbnails or download binaries from here. Vendoring will be done either
> by you dropping the approved zips into `assets/`, or from a context with normal network access.

---

## Texture splatting (B2) — ground materials

The renderer already computes a per-pixel material mixture `{snow, rock, sand, wetland, canopy,
grass}` (`materialWeights`). B2 replaces each flat material color with `Σ material_i ·
sampleTexture_i(uv)` (top-3 per pixel). One **color/albedo** texture per channel is all we need.

| Renderer channel | Primary candidate | Alt | License | Source |
|---|---|---|---|---|
| **grass** | `Grass001` (lush green) | `Grass004` (drier, varied) | CC0 | ambientCG |
| **rock** | `Rock023` (bare grey cliff) | `Rock030` | CC0 | ambientCG |
| **snow** | `Snow006` (clean snow) | `Snow002` | CC0 | ambientCG |
| **canopy** (forest floor) | `Foliage001` (leaf litter) | `Ground037` | CC0 | ambientCG |
| **sand** | pick from the sand query (desert/dune) — needs your pick | — | CC0 | ambientCG `list?q=sand` |
| **wetland** (mud) | pick from the dirt query (wet mud) — needs your pick | — | CC0 | ambientCG `list?q=dirt` |

View links:
- Grass: https://ambientcg.com/view?id=Grass001 · https://ambientcg.com/view?id=Grass004
- Rock: https://ambientcg.com/view?id=Rock023 · https://ambientcg.com/view?id=Rock030
- Snow: https://ambientcg.com/view?id=Snow006 · https://ambientcg.com/view?id=Snow002
- Forest floor: https://ambientcg.com/view?id=Foliage001 · https://ambientcg.com/view?id=Ground037
- Sand (pick one): https://ambientcg.com/list?q=sand
- Mud/wetland (pick one): https://ambientcg.com/list?q=dirt

Poly Haven is an equally-good CC0 alternative for any of these (terrain set:
https://polyhaven.com/textures/terrain) if you prefer its look.

**Download pattern** (for vendoring later): `https://ambientcg.com/get?file={ID}_1K-JPG.zip`
(e.g. `Grass001_1K-JPG.zip`). The `/api/v2/full_json?id={ID}&include=downloadData` endpoint returns the
canonical direct `rawLink` if the `get?file=` redirect ever changes. 1K JPG ≈ a few MB each; a 6-channel
set ≈ 15–25 MB total before we strip to color-only.

## Parchment base (B1 asset upgrade — optional)

B1 already ships a *procedural* paper grain (v0.050). An asset paper texture would only be a
quality bump, blended `multiply` like the procedural one:
- `Paper001`: https://ambientcg.com/view?id=Paper001
- `Paper005`: https://ambientcg.com/view?id=Paper005

---

## Stylized icons (B3) — mountain / hill / tree sprites

B3 already ships *procedural* vector glyphs (v0.050). The asset tier swaps in hand-drawn PNG sprites
when present. Best CC0 source: **K. M. Alexander's #NoBadMaps** brush sets — explicitly released
**CC0**, "always free… commercial use… no attribution required," with **each mountain, tree, and hill
as a separate PNG** (exactly the per-glyph sprites our placement layer wants).

Candidate sets (open and judge the style — they differ by era/look):
- **Hyacinth** — 19th-century mountains: https://kmalexander.com/2021/01/28/hyacinth-a-19th-century-mountain-brush-set-for-fantasy-maps/
- **Harrewyn** — 18th-century cartography (mountains, trees, hills): https://kmalexander.com/2019/07/29/harrewyn-a-free-18th-century-cartography-brush-set-for-fantasy-maps/
- **Blaeu** — 17th-century: https://kmalexander.com/2019/04/18/blaeu-a-free-17th-century-cartography-brush-set-for-fantasy-maps/
- **Lumbia** — sketchy/loose: https://kmalexander.com/2018/12/13/lumbia-a-free-sketchy-cartography-brush-set-for-fantasy-maps/
- Index of all sets: https://kmalexander.com/free-stuff/fantasy-map-brushes/

We need PNGs (the page also offers `.abr` Photoshop brushes — ignore those; use the individual-PNG
download). A handful of mountain variants + 2–3 tree variants + 1–2 hill glyphs is plenty;
`placeMapIcons()` already decides *where* they go, so we just need the artwork.

OpenGameArt CC0 map-symbol packs (https://opengameart.org/content/cc0-textures-0 and similar) are a
supplementary source — mixed quality, cherry-pick.

---

## Recommended minimal shortlist (my pick — change freely)

If you just want to say "go", this is the smallest set that covers everything:

- **Textures (6):** `Grass001`, `Rock023`, `Snow006`, `Foliage001`, one sand from `q=sand`, one mud from `q=dirt`.
- **Parchment (1):** `Paper001` (optional — procedural is fine).
- **Icons (1 set):** **Harrewyn** (has mountains + trees + hills in one coherent 18th-c. style), or **Hyacinth** if you want more dramatic mountains.

Reply with your keeps and I'll wire B2 (splatting) + B3 (sprite icons) to the `assets/` folder with a
graceful procedural fallback when it's absent.
