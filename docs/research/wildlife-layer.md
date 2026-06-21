# Wildlife Layer — Ecological Determination of Fauna from Terrain & Biome

A per-**ecoregion** (not per-cell) wildlife layer for the Cartalith elevation foundation. Animal
distributions are emergent, not painted: species richness, population density and trophic structure fall out
of climate, productivity, terrain heterogeneity and hydrology — all of which the engine already computes.

User decisions (locked):
- **Depth**: ecoregions → guilds → carrying capacity → **named species** (representative rosters).
- **Granularity**: per **biome region** (connected component), never per cell.
- **Region basis**: the **Cartalith 15-biome** grid (`buildCartBiome`, the merge target).
- **Surface**: a **"Wildlife" debug view** with **clickable regions → info popup** + a
  **`wildlife_regions.json` export**, exactly the pattern of the v0.110 settlement layer.
- **Delivery rule**: debug-view + export only ⇒ `generate()` / default render **bit-identical**.

## 1. Dependency hierarchy (one-directional)

```
Geology → Topography → Climate → Hydrology → Vegetation → NPP → Habitat structure
        → Food web → Species distribution → Population density
```
(Whittaker 1975; Odum 1983; Ricklefs 2008.) Every upstream term already exists in the engine, so the
wildlife layer is pure downstream map-algebra + aggregation.

## 2. Engine field mapping

| Framework term | Engine source |
|---|---|
| Temperature `T` (°C) | `tempField[i]` |
| Precipitation `P` (mm) | `rainField[i] * climate.maxRainMm` (default 3000) |
| Elevation / relief | `field[i]` (geoid-adjusted via `geoAt`) |
| Slope | `slopeAt(x,y)` |
| Distance-to-water / water access | `buildWaterAccess` → `currentWaterAccess()` (v0.104) |
| Water bodies (sea/lake) | `currentWaterBodies()` |
| Carrying-capacity base `K∈[0,1]` | `buildCarryingCapacity` → `currentCarryingCapacity()` (v0.105) |
| Biome regions | `buildCartBiome()` (15-class) → connected components |
| Latitude | from cell `y` (world mode = pole-to-pole) |

## 3. Net Primary Productivity — Miami model (Lieth 1975)

Per land cell (`g dry matter · m⁻² · yr⁻¹`):

```
NPP_T = 3000 / (1 + e^(1.315 − 0.119·T))
NPP_P = 3000 · (1 − e^(−0.000664·P))
NPP   = min(NPP_T, NPP_P)
```

Pure `buildNPP(temp, rain, fld, W, H, sea, {maxRainMm})` → Float32 (0 over ocean). Normalised
`NPPn = NPP/3000 ∈ [0,1]` is the energy proxy `E`.

## 4. Habitat heterogeneity — TRI (Riley et al. 1999) & TPI (Weiss 2001)

```
TRI(x,y) = sqrt( Σ_neighbours (z_i − z0)² )      // 8-neighbour; rugged = more niches
TPI(x,y) = z0 − mean(z_neighbours)               // >0 ridge, <0 valley/floodplain
```
Pure `buildTRI(fld,W,H)` / `buildTPI(fld,W,H,radius)`. Per-region we keep mean TRI (heterogeneity →
richness, Stein et al. 2014) and the **fraction of ridge / slope / valley / floodplain** cells (drives
which guild *sub-roles* appear: cliff herbivores & raptors need ridge, amphibians need floodplain).

## 5. Ecoregion segmentation

Connected-component label `buildCartBiome()` (4-neighbour, **x-wrap in world mode**), mirroring
`buildWaterBodies`. Each component of one biome class = one **ecoregion**. Skip water classes
(Lake 14 / Ocean 15 handled by a marine/aquatic branch) and **merge components below `minArea`**
(`≈ max(8, GW·GH/4000)` cells) into the dominant neighbour so we don't emit thousands of slivers.
Output: `regionId` Int32 raster (−1 = water/unassigned) + a per-region record array.

Per-region single-pass aggregates: `area` (cells; × cellKm² for km²), centroid (x-wrap aware),
mean `NPPn`, mean `TRI`, mean `waterAccess`, mean `K`, mean `|lat|`, biome class, ridge/valley fractions,
**coastal flag** (touches ocean), **island flag** (its landmass small/isolated → higher z).

## 6. Species richness (how many species to instantiate)

Combine the empirical laws into one richness multiplier, then map to a count bounded by the biome roster:

```
z      = 0.15 (continent) | 0.25 (mountainous, ridgeFrac high) | 0.30 (island)   // species–area exponent
S_raw  = c · Aᶻ · E^0.7 · (1 + kH·TRIn) · latF
latF   = clamp( cos(lat)^(−0.5), 1, 1.6 )                                          // Rosenzweig 1995
```
- Species–area `S = cA^z` (MacArthur & Wilson 1967).
- Energy `S ∝ E^0.7` (Wright 1983), `E = mean NPPn`.
- Heterogeneity `(1 + kH·TRIn)` (Stein et al. 2014), `kH≈0.6`, `TRIn` = TRI normalised to [0,1].
- `c` chosen so a rich tropical region saturates its roster and a polar one yields ~3–5.
`richness = round(clamp(S_raw, 2, rosterSize(biome)))` — the count of species drawn (highest-priority first)
from that biome's roster (§8).

## 7. Carrying capacity & populations (static; no Lotka–Volterra sim)

Total usable energy of a region `E_region = NPP · area_m²`. Trophic cascade by the **Lindeman 10% law**:

```
herbivore energy  = 0.10 · E_region
predator energy   = 0.10 · herbivore energy        // predatorCapacity = 0.1 × herbivore biomass
scavenger energy  = 0.02 · herbivore energy
```
Per-species **density / population** via **Kleiber (1932)** metabolic scaling — per-capita demand
`B = B0 · M^0.75` (M = body mass kg). For a species holding share `f` of its guild's energy:

```
population ≈ (f · guildEnergy) / (B0 · M^0.75 · days)
```
so large-bodied species (elephant-analogues) get low densities / large territories and small species high
densities — identical ecosystems support vastly different head-counts (Brown 1995; Damuth's law).
We report **per-guild total biomass + a representative population estimate per named species** (order of
magnitude — worldbuilding, not a census). Predator–prey **dynamics** (Lotka–Volterra) are explicitly out of
scope; the static `0.1×` cascade is the chosen approximation.

## 8. Guilds & named species per Cartalith biome (rosters)

Functional **guilds** (frozen keys): `grazer, browser, smallHerbivore, apexPredator, mesoPredator,
scavenger, raptor, semiAquatic, waterfowl, fish, primate, reptile, insectivore, marine`. Each biome has a
**roster** — ordered (priority) representative species, each tagged `{name, guild, massKg}`. Representative
Earth-analogue names (worldbuilders can rename); ridge/valley/coastal gating noted.

| Cart biome | Representative roster (priority order) |
|---|---|
| 5 Steppe / Grassland | bison‧grazer‧700, wild horse‧grazer‧350, antelope‧grazer‧50, wolf‧apexPredator‧40, lion‧apexPredator‧190, hare‧smallHerbivore‧4, vulture‧scavenger‧7, steppe eagle‧raptor‧3 |
| 2 Temperate Forest | red deer‧browser‧200, roe deer‧browser‧25, wild boar‧mesoPredator‧80, brown bear‧apexPredator‧250, lynx‧mesoPredator‧22, red fox‧mesoPredator‧6, badger‧insectivore‧12 |
| 6 Tropical Jungle | tapir‧browser‧250, forest deer‧browser‧30, jaguar‧apexPredator‧90, monkey troop‧primate‧8, hornbill‧raptor‧2, river turtle‧reptile‧20, forest hog‧browser‧100 |
| 7 Boreal Taiga | moose‧browser‧450, reindeer‧grazer‧120, grey wolf‧apexPredator‧40, lynx‧mesoPredator‧22, wolverine‧mesoPredator‧14, capercaillie‧smallHerbivore‧4 |
| 8 Mountain Highland | ibex‧browser‧90 (ridge), wild sheep‧grazer‧70 (ridge), chamois‧browser‧40, snow leopard‧apexPredator‧45 (ridge), golden eagle‧raptor‧5 (ridge), marmot‧smallHerbivore‧5 |
| 13 Hills | red deer‧browser‧180, wild boar‧browser‧70, fox‧mesoPredator‧6, hawk‧raptor‧1, hare‧smallHerbivore‧4 |
| 4 Wetlands / Marshes | beaver‧semiAquatic‧20, otter‧semiAquatic‧9, water buffalo‧grazer‧700, heron‧waterfowl‧2, crane‧waterfowl‧5, frog‧insectivore‧0.1, pike‧fish‧8 |
| 10 Hot Desert | camel‧grazer‧500, oryx‧grazer‧180, fennec‧mesoPredator‧1.5, jackal‧mesoPredator‧10, sandgrouse‧smallHerbivore‧0.3, monitor lizard‧reptile‧6, scorpion‧insectivore‧0.03 |
| 9 Cold Desert / Badlands | wild ass‧grazer‧260, saiga‧grazer‧40, corsac fox‧mesoPredator‧3, steppe eagle‧raptor‧3, jerboa‧smallHerbivore‧0.06 |
| 3 Mediterranean Scrub | red deer‧browser‧150, mouflon‧grazer‧45, wild boar‧browser‧70, wildcat‧mesoPredator‧5, booted eagle‧raptor‧1, tortoise‧reptile‧4 |
| 11 Tundra / Polar | reindeer‧grazer‧120, musk ox‧grazer‧300, arctic fox‧mesoPredator‧4, wolf‧apexPredator‧40, lemming‧smallHerbivore‧0.05, ptarmigan‧smallHerbivore‧0.5, snowy owl‧raptor‧2 |
| 1 Coastal Lowland | seal‧marine‧120 (coastal), shorebird flock‧waterfowl‧0.3, otter‧semiAquatic‧9, gull‧scavenger‧1, coastal grazer‧grazer‧60 |
| 14 Lake | trout/pike‧fish‧5, otter‧semiAquatic‧9, duck‧waterfowl‧1, heron‧waterfowl‧2, frog‧insectivore‧0.1 |
| 15 Ocean / Deep Water | fish shoal‧fish‧2, whale‧marine‧30000, seal‧marine‧120, seabird‧marine‧1 (productivity from coastal NPP proxy) |
| 12 Ruined Wastes | vermin‧smallHerbivore‧0.3, scavenger bird‧scavenger‧1, feral predator‧mesoPredator‧20 (sparse) |

Roster filtering per region: ridge-gated species require `ridgeFrac ≥ 0.15`; coastal species require the
coastal flag; the first `richness` survivors (§6) are "present". Apex predators only appear if herbivore
biomass clears a threshold (the `0.1×` cascade must yield a viable predator energy budget).

## 9. Output

```
wildlife_regions.json = { version, kind:'cartalith-wildlife', width, height, cellKm, count,
  regions:[ { id, biome, area, areaKm2, centroid:{x,y}, latitudeAbs, coastal, island,
              npp, heterogeneity(TRI), waterAccess, carryingCapacity,
              richness, guilds:[{guild, biomassRel, species:[{name, massKg, populationEst}]}],
              summary } ] }
```
Plus a `regionId` raster (optional `.bin`) for downstream lookup. The **Wildlife debug view** colours each
region (by richness, or by dominant guild) over hillshade + drops a marker at each centroid; clicking a
marker opens `#wildInfo` (the `#settleInfo` twin) with the region's ecology breakdown.

## 10. Pipeline & implementation stages

```
buildCartBiome → segment ecoregions → per-region aggregate (NPP, TRI, TPI, water, K, lat)
→ richness (species–area × energy × heterogeneity × latitude) → guild energy cascade (Lindeman)
→ named-species rosters + Kleiber populations → debug view + click popup + JSON export
```

Pure, headless-testable primitives (amplifyRegion mold — every input an argument):
`buildNPP`, `buildTRI`, `buildTPI`, `segmentEcoregions`, `aggregateEcoregions`, `regionRichness`,
`assignGuildsAndSpecies`. Browser-only: the debug-view render, the click hit-test + `#wildInfo` popup
(mirror `showSettleInfo`), and the export wiring (mirror `settlement_seeds.json`).

Caching: `_wildRegions` / `_wildRegionId` (+ `_nppField`,`_triField`) cleared each `generate()`/`computeFlow()`
like `_settleSuitField`. Built lazily only when the Wildlife view is open / export runs ⇒ default
generate + render untouched (bit-identical), verified by the cross-version `cmp` harness.

## References
MacArthur & Wilson 1967 (island biogeography, species–area); Wright 1983 (energy–richness); Lieth 1975
(Miami NPP); Riley et al. 1999 (TRI); Weiss 2001 (TPI); Stein et al. 2014 (heterogeneity–richness);
Rosenzweig 1995 (latitudinal gradient); Odum 1983 (carrying capacity); Lindeman 1942 (10% trophic
transfer); Kleiber 1932 (metabolic scaling); Brown 1995 / Damuth 1981 (density–mass); Lotka 1925 &
Volterra 1926 (predator–prey — referenced, not implemented). Algorithms studied; no code copied.
