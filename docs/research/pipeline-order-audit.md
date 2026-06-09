# Pipeline Order Audit — generate() vs Real-World Earth-System Order

*June 2026. Audits `generate()` (elevation_foundation v0.036) and the erosion stages against the order in which planets actually acquire continents, climate, rivers, and biomes. Each gap carries the calculation needed to close it and an academic anchor.*

## Natural order vs current pipeline

| # | Real-world stage | v0.036 | Status |
|---|------------------|--------|--------|
| 1 | Planetary parameters (g, rotation, tilt) condition everything below | absent (planned G1) | planned |
| 2 | Mantle/crust differentiation → cratons vs ocean basins | `generateContinentalityField` + plate base classes | ✅ |
| 3 | Plate tectonics → boundaries, stress regimes | `buildPlates`→`assignPlates`→`computeStress` | ✅ |
| 4 | Lithospheric flexure / isostasy responds to loads | `computeFlexure` (from initial stress only) | ⚠️ gap 4 |
| 5 | Orogeny + crustal heterogeneity → raw topography | height formula (base + stress + flexure + hetero + noise) | ✅ |
| 6 | Volcanism & impacts stamp onto built topography | `stampVolcanoes`/`stampCraters` after normalize | ✅ correct position |
| 7 | **Climate**: temperature → circulation → precipitation, shaped by the topography | `refreshClimate()` — but runs **after** flow | ⚠️ gap 1 |
| 8 | **Drainage**: rivers form where rain falls; discharge Q = ∫runoff dA | `computeFlow()` uniform `acc.fill(1)`, runs **before** climate | ❌ gaps 1–2 |
| 9 | Erosion sculpts, weighted by water: fluvial (Q^m·S^n), hillslope, glacial above snowline, coastal at shore | stream power uses **area**, not discharge; droplets spawn uniformly; glacial correctly gated on `tempField<0` + snowline | ⚠️ gaps 2–3 |
| 10 | Isostatic rebound answers erosion (~80–85% of unloaded column) | never recomputed after erosion | ❌ gap 4 |
| 11 | Sea level = equipotential (geoid), not constant | scalar `seaLevel` (G2 planned) | planned |
| 12 | Soils → vegetation → biomes, last | soil-depth/vegetation/biome at render time | ✅ |

The macro-order of `generate()` is **fundamentally right** (tectonics → flexure → orogeny → volcanism → … → biomes last). The wrongness is concentrated in one place: **water**. Climate and drainage are decoupled and in the wrong relative order, so rivers ignore rainfall and erosion ignores rivers' real discharge.

## Gap 1 — Flow is computed before climate

`generate()` ends `computeFlow(); refreshClimate();`. Real drainage develops where precipitation supplies runoff. The circularity (orographic rain needs topography; corridors-corrector needs flow) is resolved the way coupled landscape-evolution models do — iterate once:

```
computeFlow_area()        // structural drainage from topography alone (current behavior)
refreshClimate()          // rain field, using area-flow for river-corridor correction
computeFlow_discharge()   // re-accumulate seeded with runoff (gap 2)
```
One extra O(N log N) accumulation per generate — negligible. Anchor: coupled LEMs iterate precipitation↔incision rather than ordering one before the other ([Braun & Willett 2013, the O(n) implicit scheme `streamPowerErode` already implements](https://www.sciencedirect.com/science/article/abs/pii/S0169555X12004618); [Whipple & Tucker 1999](https://agupubs.onlinelibrary.wiley.com/doi/10.1029/1999JB900120)).

## Gap 2 — Stream power uses area A, not discharge Q

In `streamPowerErode`, `area.fill(1)` then accumulates — pure drainage area; rainfall only scales K (`1+ck·2·rain`). The stream power law is `E = K·Q^m·S^n` where drainage area is merely a *proxy* for discharge under **uniform** precipitation ([Whipple & Tucker 1999](https://agupubs.onlinelibrary.wiley.com/doi/10.1029/1999JB900120); [Lague 2014 review](https://wpg.forestry.oregonstate.edu/sites/default/files/seminars/2014_Lague_ESPL.pdf)). With a spatially varying rain field we should accumulate runoff:

```js
// instead of acc.fill(1) / area.fill(1):
for (i) acc[i] = Math.max(0.05, rainField[i]);   // runoff seed, floor keeps deserts routable
```
Same change in `computeFlow()` (it feeds the river overlay, TWI wetlands, and the corridor corrector — wet-side slopes then grow denser river networks and deeper valleys than rain-shadow sides, the single most visible realism win available). Keep K's `(1+ck·2·rain)` term — it represents local erodibility/weathering by climate, distinct from discharge ([Yuan et al. 2019 deposition extension](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2018JF004867)).

## Gap 3 — Droplets spawn uniformly

`erode()` spawns at `rng()*(GW-1)` regardless of rainfall (rain only boosts pickup via `1+ck·rf`). Physical droplet density ∝ precipitation. Cheap fix — rejection sampling:

```js
do { px = rng()*(GW-1); py = rng()*(GH-1); }
while (ck > 0 && rng() > 0.15 + 0.85 * rainField[(py|0)*GW + (px|0)]);
```
Deserts then erode mainly by the thermal/talus pass (correct: arid landscapes are weathering-limited), humid regions by fluvial action.

## Gap 4 — No isostatic rebound after erosion

`computeFlexure` runs once from initial stress; large erosion passes then remove load without response. Reality: erosional unloading rebounds ~85 m per 100 m eroded over broad areas (crust/mantle density ratio ρc/ρm ≈ 2700/3300), and valley-focused erosion can drive *peak* uplift (England & Molnar 1990; [denudational rebound literature](https://www.researchgate.net/publication/249521590_Normal_faulting_driven_by_denudational_isostatic_rebound), [Alps Quaternary rebound](https://www.researchgate.net/publication/215614288_Quaternary_erosion-induced_isostatic_rebound_in_the_Western_Alps)). Implementation (after each heavy erosion op, before its final `computeFlow`):

```js
// rebound = 0.8 × (flexurally smoothed eroded thickness)
const eroded = preErosionField − field;           // >0 where material removed
field += 0.8 * gaussBlur(eroded, flexuralRadius); // radius ≈ state.tect.blurR (broad support)
```
Only the *long-wavelength* component rebounds (hence the blur — a point-load removal doesn't rebound locally); this reproduces valley incision driving ridge uplift. Cost: one blur per erosion run.

## Confirmed-correct couplings (don't touch)

- `glacialErode` gates on `field > snowline` **and** `tempField < 0°C`, then refreshes climate — already the natural order, and consistent with the glacial-buzzsaw result that glacial erosion pins mountain heights to the snowline (Egholm et al. 2009, *Nature* 460, "Glacial effects limiting mountain height").
- `streamPowerErode`'s uplift-vs-incision implicit solve is the standard [Braun & Willett 2013](https://www.sciencedirect.com/science/article/abs/pii/S0169555X12004618) scheme (credited in code comments as Cordonnier).
- Volcanism/impacts stamped after orogeny, resistance/heterogeneity derived from plate age before erosion, biomes strictly last — all match the geological sequence.

## Upgrade note for Weather W2

When implementing orographic precipitation (weather-model-v2.md), the reference formulation is the **linear theory of orographic precipitation** ([Smith & Barstad 2004, J. Atmos. Sci. 61:1377](https://journals.ametsoc.org/view/journals/atsc/61/12/1520-0469_2004_061_1377_altoop_2.0.co_2.xml)) — adds condensed-water advection and downslope evaporation length scales to the current pure upslope `w = u·∂H/∂x + v·∂H/∂y` model, fixing rain landing exactly on crests instead of slightly upwind/downwind. Tractable on the coarse grid (the model is used in QGIS plugins at similar resolutions).

## Canonical order (target, after fixes E1a–E1d)

```
planet params → continentality → warp → plates → stress → flexure →
orogeny (height formula) → normalize → volcanism → impacts →
flow(area) → climate(T, wind, rain) → flow(discharge) →
[user erosion ops: fluvial/hillslope (rain-weighted) → glacial (cold) → coastal,
 each followed by: isostatic rebound → flow(discharge) → climate refresh] →
sea level/geoid → render (materials/biomes last)
```
