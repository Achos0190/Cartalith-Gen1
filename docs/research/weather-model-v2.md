# Weather Model v2 — Cross-reference and Implementation Path

*Cross-references `Weather Model.md` (repo root) against the current implementation in `elevation_foundation_v0.036.html` (`simulateWeather`, `computeTemperature`, correctors) and external prior art.*

## Where we are (v0.036)

| Component | Current | Limitation |
|-----------|---------|------------|
| Temperature | `T_eq·cos(lat) − 6.5°C/km·elev + ocean moderation` | Fine; matches Weather Model.md Level 1 |
| Wind | **One global direction** (`climate.windDir`) | No trades/westerlies, no Coriolis, no monsoon |
| Moisture | Iterative advection on 240×150 coarse grid, fixed capacity | No Clausius–Clapeyron (warm air should hold ~7%/°C more) |
| Rain shadow | Orographic rise/lee heuristic along wind dir | Works, but only for the single direction |
| ITCZ / dry belts | Hard-coded latitude correction passes (+0.22 @ 0–15°, −0.30 @ 28°) | Hacks compensating for missing circulation — should fall out of the model |
| Seasons | None | No monsoon, no Mediterranean/wet-dry tropics, no Köppen seasonality inputs |

## What Weather Model.md proposes (assessment)

The doc describes an intermediate-complexity chain: pressure (hydrostatic `P = P₀·e^(−H/8500)`) → circulation cells (Hadley/Ferrel/Polar, cell count `N_c = √(ΩR/√(gH))`) → Coriolis `f = 2Ω·sin φ` → geostrophic wind `u = −(1/ρf)·∂P/∂y, v = (1/ρf)·∂P/∂x` → Clausius–Clapeyron capacity → advection–condensation → orographic `w = u·∂H/∂x + v·∂H/∂y` → convective rain → seasonal passes → Köppen.

**Verdict: sound and tractable on the existing 240×150 coarse grid**, with three implementation cautions:

1. **Geostrophic wind degenerates at the equator** (f → 0). Standard fix: blend geostrophic wind with the prescribed latitude-band zonal wind, weighting toward the band wind within ~±10° latitude (where real flow is driven by pressure gradient directly into lows — Hadley convergence).
2. **Don't iterate a full primitive-equation solve.** Keep the existing relaxation structure: compute a *static* wind field once per climate refresh (bands + Coriolis deflection + pressure-gradient perturbation), then run the existing moisture advection along that field. This preserves v0.036's performance profile.
3. **Seasonality multiplies cost ×4** (Jan/Apr/Jul/Oct). Acceptable: weather already runs on demand (`weatherBtn`), and the coarse grid is only 36k cells. Cache the four passes; derive MAT/Tmax/Tmin/MAP/Pmax/Pmin per cell for Köppen.

## Status (June 2026)

**W1 shipped in v0.039** (planetary bands + pressure/Coriolis winds, manual override kept). **W2 shipped in v0.040** (bulk-aerodynamic evaporation; zonal corrector halved after the emergence measurement below). W3 (seasons + Köppen) open.

Emergence measurement (world mode, 256px, corrector off): zonal-mean land rain peaks 0.37 at 0–5°, dips to 0.17 at 25–40°, rises to 0.42 at 55–60°, dries poleward of 65° — ITCZ/dry-belt/westerlies structure appears from the wind field + Clausius–Clapeyron capacity alone. The corrector (now `zonalK`, default 0.5) only sharpens contrast toward Earth-like ratios, standing in for vertical subsidence that 2-D advection cannot represent.

## Recommended staged implementation

**Stage W1 — Wind field (replaces single `windDir`):**
- Zonal bands: easterlies 0–30°, westerlies 30–60°, polar easterlies 60–90° (sign-flipped in S hemisphere), magnitude tapering at band edges; cell count from `N_c` formula so slow rotators get one giant Hadley cell (ties into the planet/gravity parameters).
- Add pressure perturbation: `P` from temperature + elevation (warm → low), geostrophic deflection by `f = 2Ω·sin φ`, blended out near the equator.
- Per-coarse-cell wind vectors `(u,v)` stored in two Float32Arrays (240×150 — negligible memory).
- UI: keep `windDir` as an override ("Manual wind" toggle) so existing maps stay reproducible.

**Stage W2 — Moisture physics:**
- Humidity capacity `q_s = 0.622·e_s/P` with `e_s(T) = 6.112·exp(17.67T/(T+243.5))` (Clausius–Clapeyron); precipitation `C = k(RH−1)` on supersaturation; evaporation `E = C_e·U·(q_s−q)` so warm oceans are moisture factories.
- Advect along the W1 field (existing upwind scheme is fine at this resolution; semi-Lagrangian optional later).
- **Delete the ITCZ/dry-belt correction passes** — convergence at the thermal equator and subsidence at ~30° now emerge from the wind field. Keep the coastal-proximity and river-corridor correctors (they model sub-grid effects).

**Stage W3 — Seasons + Köppen:**
- Thermal equator shift from solar declination `δ = 23.44°·sin(2πd/365)` (axial tilt becomes a planet parameter); run 4 seasonal passes; aggregate to climate normals; classify Köppen (Af…EF) as a new render/debug mode feeding `classifyBiome` upgrades.
- Monsoon falls out of seasonal land–sea temperature contrast, given W1+W2.

**Defer:** cyclones (∇²P minima), jet streams, ocean currents (`C = W + β∇H` — cheap, good candidate for W3.5), Ornstein–Uhlenbeck weather noise, cloud fraction. All additive once W1–W3 land.

## Prior art notes

- Azgaar's Fantasy Map Generator uses latitude-band winds + moisture-carrying particles with orographic loss — confirms bands alone (without pressure solve) already produce credible continental climate; our W1 goes one step further.
- The hierarchy in Weather Model.md (§"For 16k–32k Worlds": 256×128 circulation → 1024×512 humidity → 4096×2048 orographic → fractal downscale) maps directly onto our existing coarse-grid → full-grid structure and is the right long-term shape: the 240×150 grid is the circulation level; orographic detail is already applied at full resolution.
