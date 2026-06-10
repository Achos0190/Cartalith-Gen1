# Generator Parameter Reference

Every modifier in the elevation foundation generator, what it controls, and how it acts on the pipeline. Grouped by panel section, in the order they appear in the UI. "Value mapping" is how the 0–100 slider maps to the internal `state` value; "Effect" is what that value does in the code.

Convention: most sliders show a friendly 0–100 (or 0–150/200) but store a scaled float. The stored value is what the formulas below use.

---

## World Structure (optional macro presets)

Only active when **World Structure** is enabled. Picking an archetype (`earth / supercontinent / archipelago / volcanic / rift`) sets all five sliders at once; editing a slider switches the archetype to `custom`. These derive the tectonic sliders (via `deriveFromWorldStructure()`) — they are a high-level front-end to plate behavior, applied **only** in the checkbox/archetype handlers, never inside `generate()`.

| Modifier | id | Effect |
|----------|-----|--------|
| **Continentality** | `wsCont` | How much land vs ocean. Raises the share of plates reclassified as continental (higher base elevation) vs oceanic. High = more/larger landmasses. |
| **Fragmentation** | `wsFrag` | Whether land is one mass or many. Pushes plate base elevations toward a broken, archipelago distribution (high) or consolidated continents (low). |
| **Tectonic energy** | `wsTect` | Overall relief intensity. Scales the tectonic-stress contribution to height — high = taller mountains, sharper boundaries. |
| **Ocean depth** | `wsOcean` | How deep ocean basins sit below sea level. Lowers the base of oceanic plates. |
| **Hotspot density** | `wsHot` | Volcanic province likelihood. Seeds more intraplate volcanic hotspots. |

---

## Tectonics (plate-driven base topography)

The core of the heightmap. Plates are Voronoi cells over drifting centroids; their boundaries generate stress (convergent = uplift, divergent = rift, shear). The height formula is:

```
field = 0.5 + α·(0.40·base + 0.50·stress) + F·flexure + C·heterogeneity + β·noise·(0.25 + 0.75·rugosity)
```

| Modifier | id | Value mapping | Effect |
|----------|-----|--------------|--------|
| **Plates** | `plates` | 4–40 count | Number of tectonic plates. Few = large continents & long boundaries; many = fragmented, busier coastlines. |
| **Drift** | `vel` | `×v/50` | Plate velocity multiplier. Scales how far centroids move and thus stress magnitude at boundaries — higher = more dramatic convergence/rifting. |
| **Warp** | `warp` | `v/100` | Domain-warp amount. Distorts the sampling grid (`warpX/warpY`) for organic, non-circular coastlines and ridgelines. 0 = geometric/blobby. |
| **Uplift spread** | `sigma` | `blurR = 2 + (v/100)·40` px | Blur radius for plate base & stress. Small = sharp, narrow mountain belts; large = broad, smooth swells. Also sets the flexural & rebound wavelength. |
| **Tectonic α** | `alpha` | `v/100·1.2` | Weight of tectonic signal (plate base + stress) in the height formula. The master "how tectonic vs noisy" dial. High = terrain dominated by plate structure. |
| **Noise β** | `beta` | `v/100·0.6` | Weight of fBm/ridged fractal detail. Adds roughness on top of tectonics; concentrated near boundaries (see Erosion/age). High = noisier, more detailed; low = smooth tectonic forms. |
| **Erosion / age** | `age` | `v/100` | Boundary-age influence. Rugosity = `exp(−age·(1 + ageInf·6))`: young crust near boundaries is rough, old interiors smooth. High = stronger young-vs-old contrast (sharp arcs, flat cratons). |
| **Flexure F** | `flexure` | `v/100·0.6` | Lithospheric flexure weight. Adds the broad isostatic response — continental shelves, foreland basins beside mountain loads. High = pronounced shelves/basins. |
| **Heterogeneity C** | `hetero` | `v/100·0.4` | Within-plate crustal diversity weight. Low-frequency fBm × age → craton-interior topography variation. High = lumpier plate interiors. |
| **Rock resistance** | `resist` | `v/100` | Erodibility spread by rock type. Feeds `resistanceField`: old shields resist stream-power erosion (5–30% rate), young arcs erode at full rate. High = stronger differential erosion (resistant uplands persist). |
| **Seed** | `seedN` | integer | RNG seed for the whole generation. Same seed + same params = identical world. Change for a different world with the same character. |
| **Ridged** (checkbox) | `ridged` | bool | Switches the fractal between ridged (sharp crests, mountainous) and standard fBm (rolling). |

---

## Volcanism & Impacts (feature stamping after orogeny)

Applied after the base height is built and normalized, before erosion.

| Modifier | id | Value mapping | Effect |
|----------|-----|--------------|--------|
| **Volcanoes** | `volc` | count | Number of volcanic edifices stamped (cones added to `field`, recorded in `volcanicField` for biome tinting). Province mode clusters them on convergent boundaries + hotspots. |
| **Volcano age** | `volca` | `v/100` | Erosion/weathering of volcanoes. Old (high) = lower, softer, wider; young (low) = tall, sharp, with caldera notch. |
| **Craters** | `crat` | `count = v·2` | Number of impact craters (recorded in `impactField`). Sizes follow a realistic distribution: mostly small (0.5–5 km), rare large basins (25–200 km). |
| **Crater age** | `crata` | `v/100` | Crater degradation. Old = shallow, infilled; young = crisp rim + central peak. |

---

## Climate & Biomes (latitude + temperature)

Sets the temperature field; biome colors follow from temperature × moisture. Latitude controls vary in **Region** mode; **World** mode uses the full −90…+90 globe and disables them.

| Modifier | id | Value mapping | Effect |
|----------|-----|--------------|--------|
| **North edge** | `latN` | −90…90° | Latitude of the map's top row (Region mode). Sets the cold/warm gradient direction. |
| **South edge** | `latS` | −90…90° | Latitude of the bottom row. Span between edges = climate range across the map. |
| **Equator °C** | `teq` | 0–45 °C | Sea-level temperature at the warmest latitude. `T = poleTemp + (equatorTemp−poleTemp)·cos(lat)`. |
| **Pole °C** | `tpo` | −50…10 °C | Sea-level temperature at the coldest latitude. |
| **Lapse rate** | `lapse` | `v/10` °C/km | Temperature drop per km of elevation, **×planet gravity**. Higher = colder peaks, lower snowline, more alpine zonation. |

---

## Weather & Rainfall (moisture simulation, runs on demand)

Iterative moisture advection on a coarse 240×150 grid: evaporate over sea → advect along wind → precipitate (orographic + convective + supersaturation) → deplete. Runs on the **Weather** button or after terrain changes.

| Modifier | id | Value mapping | Effect |
|----------|-----|--------------|--------|
| **Iterations** | `wIters` | 20–200 | Advection steps. More = moisture penetrates deeper inland (continental interiors get their fair share); fewer = coastal-only wetness. |
| **Orographic** | `rainK` | `×v/100` | Strength of rain-on-rising-terrain. High = drenched windward slopes + stark rain shadows; low = flatter rainfall. |
| **Evaporation** | `evap` | `v/100·0.3` | Base moisture pickup over ocean. With bulk-aerodynamic mode (default), wind speed and saturation deficit modulate it. High = wetter overall. |
| **Dryness** | `rainDep` | `v/100` | Depletion rate as air rains out. High = air dries quickly after the first ridge → sharper wet/dry boundaries; low = moisture carries further. |
| **Ocean supply** | `ocean` | `×v/100` | Multiplier on evaporation flux from sea cells. The global moisture-budget knob. |
| **Wind model** (seg) | `windMode` | auto / manual | **Planetary** = latitude circulation belts (trades/westerlies/polar easterlies, belt count from day length) bent by thermal pressure. **Manual** = one fixed direction (Region only). |
| **Pressure infl.** | `pressK` | `v/100` | How strongly thermal lows/highs bend the planetary wind (Coriolis-deflected). High = monsoon-like sea→land deflection where summer land runs hot; 0 = pure zonal belts. |
| **Zonal belts** | `zonalK` | `v/100` | Strength of the ITCZ-wet / subtropical-dry latitude correction. The wind field already produces this structure; this sharpens it. 0 = rely on emergent structure only. |
| **Wind →** | `windDir` | 0–360° | Prevailing wind direction in Manual mode. Disabled in Planetary mode and World mode. |

---

## Erosion (four processes, each a button, applied to `field` in place)

Run in geological order: hydraulic/thermal carving → stream-power channels → glacial valleys → coastal. Each runs on demand and refreshes flow + climate after. Droplet erosion runs in a Web Worker (non-blocking, progress %).

### Droplet (hydraulic) + thermal + diffusion
| Modifier | id | Value mapping | Effect |
|----------|-----|--------------|--------|
| **Droplets** | `drops` | `count = v·1500` | Number of simulated water droplets. More = denser, more complete drainage carving (slower). Spawn ∝ rainfall, so humid regions erode more. |
| **Strength** | `estr` | `v/100` | Erosion rate per droplet (how aggressively it cuts). High = deep canyons, fast incision. |
| **Deposition** | `edep` | `v/100` | Sediment drop rate when a droplet slows/floods. High = filled valleys, alluvial flats, deltas; low = bare bedrock channels. |
| **Thermal** | `ethr` | passes | Talus-relaxation passes after droplets. Slopes above the limit slump toward stability. More = smoother, more mature slopes. |
| **Slope limit** | `etal` | `v/1000` | Talus threshold (critical slope). Lower = more material slumps (gentler terrain); higher = steep cliffs persist. *Gravity-independent by design* (friction-dominated). |
| **Diffusivity D** | `edD` | `v/100·0.2` | Hillslope (soil-creep) diffusion coefficient `∂z/∂t = D∇²z`. High = rounded, soil-mantled hills. |
| **Passes** | `edPas` | count | Diffusion iterations. More = smoother hillslopes. |

### Stream-power (channel incision — implicit Braun & Willett solver, MFD drainage since v0.046)
| Modifier | id | Value mapping | Effect |
|----------|-----|--------------|--------|
| **Uplift** | `sUp` | `v/100·0.4` | Tectonic uplift rate competing against incision (normalised 0..rate). **Default 0 — the button purely carves rivers.** Raise it only to grow active-orogen ranges that fight the incision. |
| **Channeling** | `sK` | `v/100·0.03` | Erodibility constant K in `E = K·Q^m·S^n`, **×planet gravity**. High = rivers incise deep, dense valley networks. |
| **Iterations** | `sIt` | 4–40 | Solver steps toward equilibrium. More = closer to a mature, graded river profile. |
| **Deposition** | `sDep` | `v/100` | Sediment deposition in low-gradient reaches & below sea level → floodplains, fans. |
| **Rain → erosion** | `sClim` | `v/100` | Couples local rainfall to K (`1 + climateK·2·rain`). High = wet regions erode much faster than dry → climate-driven landscape asymmetry. |

### Glacial (U-valley carving above the snowline)
| Modifier | id | Value mapping | Effect |
|----------|-----|--------------|--------|
| **Snowline** | `gSnow` | `v/100` (fraction of land height) | Elevation above which ice forms (also requires `tempField < 0`). Lower = more of the map glaciated. |
| **Intensity** | `gKg` | `v/100` | Glacial abrasion coefficient, **×planet gravity**. High = deeper troughs, more dramatic cirques. |
| **U-width** | `gUF` | `v/100` | Lateral carving — how wide the U-shaped valley floor spreads. High = broad glacial valleys; low = narrow. |
| **Passes** | `gPas` | count | Glacial flow iterations. More = more developed valley systems. |

### Coastal (sea cliffs, estuaries, tidal marsh)
| Modifier | id | Value mapping | Effect |
|----------|-----|--------------|--------|
| **Wave strength** | `cWave` | `v/100` | Wave erosion of exposed coast, **×1/planet gravity**. High = retreating cliffs, smoothed shorelines (run multiple passes for sea-cliff retreat). |
| **Estuary depth** | `cEst` | `v/100·0.2` | How far up-river the sea funnels high-flow mouths. High = wide drowned estuaries where big rivers meet the sea. |
| **Marsh band** | `cMar` | `v/100·0.1` | Width of the flat intertidal zone given organic micro-relief. High = broad tidal marshes. |
| **Passes** | `cPas` | 1–15 | Coastal process iterations. More = more pronounced cliffs/estuaries. |

---

## Planet (planetary parameters — gravity drives terrain physics)

| Modifier | id | Value mapping | Effect |
|----------|-----|--------------|--------|
| **Gravity** | `pg` | `v/100` g (0.30–2.50) | Surface gravity. Scales **fluvial & glacial erosion ×g**, **temperature lapse ×g**, **crater size ×g⁻⁰·²²**, **wave energy ×1/g**, and rescales **peak altitude ~1/g** (low-g worlds get taller mountains — Olympus Mons effect). Talus stays fixed (friction-dominated). Regenerates the world. |
| **Day length** | `prot` | 6–96 h | Rotation period. Sets the number of atmospheric circulation cells (`N_c ≈ 3·√((24/h)·radius/√g)`): fast spin → many wind belts & jet streams; slow spin → one giant Hadley cell. Stored for the weather sim. |
| **Axial tilt** | `ptilt` | 0–45° | Obliquity. Reserved for seasonal weather (W3) — no terrain effect yet. |

---

## Calibrate (real-world scale — display & physics scaling, no re-sim unless noted)

| Modifier | id | Effect |
|----------|-----|--------|
| **Sea level** | `sea` | The height threshold counted as 0 m (below = ocean). Purely a threshold — shifts coastlines and biome colors live, no re-simulation. Default 42%. |
| **Peak altitude** | `peak` | Metres of the highest point. Sets the vertical scale (`metresPerUnit = peakM/(1−seaLevel)`) → affects temperature lapse and grade readout. Auto-rescales with gravity. |
| **Map width** | `mapw` | Real-world width in km. Sets horizontal scale (km per cell); combined with peak gives true terrain grade. Affects crater sizing (km→cells). |

---

## View (rendering only — never touches the heightmap)

| Modifier | id | Effect |
|----------|-----|--------|
| **Render mode** (seg) | `mode` | Biome (full color) · Relief (grayscale hillshade) · Height (hypsometric tint) · Shade. |
| **Debug** (seg) | `debug` | Overlays: plates, boundaries, stress, age, temperature, rainfall, flow — for inspecting any field directly. |
| **Relief ↔ biome** | `bioBlend` | Blend between pure relief shading (0) and full biome color (1). |
| **Relief** | `exag` | Vertical exaggeration for hillshade (`0.4 + (v/100)·7`). Higher = more dramatic shadows; pure visual. |
| **Sun** | `sun` | Hillshade sun azimuth (0–360°). Controls shadow direction. |
| **Show rivers** (checkbox) | `showRivers` | Toggles the river overlay (traced from `flowField`). |

---

## Resolution & Extent (top toolbar)

| Modifier | id | Effect |
|----------|-----|--------|
| **Resolution** (seg) | `resW` | Working grid width (512 / 1K / 2K). Higher = more detail, slower. Export can bake to higher res independently. |
| **Extent** (seg) | `world` | **Region** = a framed 1.56:1 area with user latitudes & prevailing wind. **World** = seamless 2:1 equirectangular globe with toroidal wrap and latitude wind belts. |

---

## Sculpt tab (manual editing, separate from generation)

| Modifier | id | Effect |
|----------|-----|--------|
| **Brush** (seg) | `brush` | raise / lower / smooth / flatten / canyon. |
| **Polyline Width/Strength** | `polyRad` / `polyStr` | Catmull-Rom polyline sculpt — width and intensity of the stroke. |
| **Brush Radius/Strength** | `brad` / `bstr` | Freehand brush footprint and intensity. |

---

*Generated against `elevation_foundation_v0.041.html`. Value mappings are read directly from the `tparam/eparam/cparam` bindings; keep this file in sync when slider scales change.*
