# Gravity Influence — Cross-reference and Implementation Path

*Cross-references `Gravity influence.md` (repo root) against the v0.036 pipeline. Decision (June 2026): gravity is a **planetary world parameter** — a `state.planet` block — not just internal physics bookkeeping.*

## Scaling laws (the cheap, high-impact core)

| Quantity | Scaling with surface gravity g | Where it plugs into v0.036 |
|----------|-------------------------------|----------------------------|
| Max mountain height | ~ 1/g (crustal strength limit; cf. Olympus Mons ≈ 22 km at 0.38g vs Everest ≈ 9 km) | `state.peakM` default & calibration display; vertical exaggeration hint |
| Fluvial erosion rate | stream power ~ ρ·g·Q·S → ~ g | `streamPowerErode` K_eff multiplier |
| Hillslope/talus angle of repose | ≈ independent of g (friction-dominated granular media) | `erodeThermalCPU` talus — leave unchanged; document why |
| Atmospheric scale height | H = kT/(mg) ~ 1/g | Orographic strength per metre of relief: low-g world → atmosphere "sees" relief less per metre but mountains are taller; net orographic factor ≈ relief/H, roughly g-neutral for equilibrium terrain, **stronger** rain shadow for young high terrain |
| Lapse rate (dry adiabatic) | Γ = g/c_p ~ g | `computeTemperature` lapse constant (6.5 → 6.5·g_rel as first order) |
| Impact crater diameter | ~ g^(−0.22) in the gravity regime (larger craters on low-g worlds) | `crater` radius defaults |
| Tidal amplitude | ~ 1/g (per Gravity influence.md Level V) | future tides stage |
| Wave energy / coastal erosion | wave height ~ 1/g for given wind input | `coastalProcess` waveStr multiplier |
| Circulation cell count | N_c = √(ΩR/√(gH)) (with rotation Ω, radius R) | Weather v2 wind-band generator (see weather-model-v2.md) |

## What Gravity influence.md proposes vs what to build first

The doc's full architecture (orbital mechanics → gravity field → geoid solver → mean sea level → dynamic tides → hydrology → biomes) is the right *eventual* shape. Staging by payoff-per-effort:

**Stage G1 — `state.planet` + scalar gravity (build first):**
```js
state.planet = { g: 1.0, rotationHours: 24, axialTiltDeg: 23.4, radiusRel: 1.0 }
```
Wire the table above: stream-power K ×g, lapse ×g, peak-height calibration ×1/g, crater radii ×g^(−0.22), coastal wave strength ×1/g, and feed `g`/`Ω` into the Weather v2 cell-count formula. One slider, visible consequences everywhere, no new fields. Talus stays fixed (document the deliberate non-change).

**Stage G2 — Geoid as a sea-level field (Level I–II of the doc):**
- Replace scalar `seaLevel` with `seaLevel + geoidField[i]` where `geoidField` = J2 rotation term `k_rot·sin²(lat)` + 3–5 low-order harmonic terms + low-frequency mantle-density noise (reuse existing `fbm`).
- Ocean mask becomes `field[i] < seaLevelAt(i)` — touches `surfaceColor`, coastal distance, weather ocean-evaporation mask. This is the invasive part; gate it behind a "Geoid" toggle defaulting off so legacy maps render identically.

**Stage G3 — Moons & tides (Level III–VI):**
- `state.planet.moons = [{massRel, distRel, phase}]`; tidal amplitude `Σ M_i/d_i³ × k₂ × 1/g`.
- Static deliverable first: a **tidal-range field** (max−min over phases) rendered as an overlay and exported — drives intertidal/mangrove/salt-marsh materials in `materialWeights` and marks "wandering flood zones" for Cartalith (coastal hazard regions for settlements/routes).
- Animated `S(x,y,t)` coastlines are a toy on top, not a pipeline stage.

**Stage G4 — Tidal sedimentation (Level VII):** add tidal-energy term into `coastalProcess` (flats/estuary deposition where range is high and slope low). Defer until G3 ships.

**Out of scope** (research-grade, per the doc's own framing): viscoelastic mantle response, GIA, coupled mantle convection — the SELEN/CitcomS/ASPECT tier.

## Interactions to watch

- G1's lapse-rate and erosion changes alter existing outputs: **add a "Planet: Earth defaults" preset** that reproduces v0.036 byte-identical (g=1, 24h, 23.4°) — invariant for the test suite.
- Gravity, rotation, and the weather model are coupled through N_c and scale height — implement G1 *before or together with* Weather W1 so the wind-band generator reads planet params from day one.
- Geoid (G2) changes the meaning of `seaLevel` in exports; bump `params.json` with a `planet` block and keep loaders backward-compatible (missing block = Earth defaults).
