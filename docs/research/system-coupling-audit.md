# System-coupling audit — feedback loops in the simulation pipeline

User-requested audit (June 2026): does the simulator form a coupled Earth-system, or a one-way
post-processing cascade? Verdict and per-loop findings below, with the code locations where each
dependency breaks. Then the implementation plan for the loops the user prioritised (1, 2, 3).

## Verdict

Predominantly a **one-way cascade** with one genuine feedback edge and two partial ones:

```
Tectonics → Flexure → Height → Climate(1 pass) → Flow → Coast → Biomes/Render
                                    ↑__________________|
                       (erosion ops re-run refreshClimate — single step, user-triggered)
```

Most omissions are **intentional** — `docs/research/pipeline-order-audit.md` deliberately chose a
natural-order single pass with one flow→climate→flow sandwich, not an iterated landscape-evolution
model. They are realism ceilings, not bugs.

## Per-loop findings (v0.064 baseline)

1. **Climate ↔ erosion** — *partial, intentional.* `eroFinish` (≈L1595) runs `isostaticRebound →
   computeFlow(true) → refreshClimate` after each erosion op, so rain shadows recompute on new
   terrain. But it is a single user-triggered step; there is no automatic iteration to a fixed point.
2. **Ocean current ↔ atmosphere** — *absent as a loop.* `applyOceanCurrents` (≈L1954) runs AFTER
   `simulateWeather` built the winds/rain, and only additively nudges `tempField`/`rainField`. SST
   never re-enters `buildWind`'s pressure term or evaporation → currents are a post-process.
3. **Sediment transport / mass conservation** — *mostly absent.* Droplet (`deposit()` ≈L1138) and
   stream-power deposition are local/Lagrangian; no basin-wide conserved sediment budget routes mass
   to floodplains/deltas/shelves. Deltas come from a small flow-keyed nudge in `coastalProcessCPU`,
   shelves from `flexureField` — proxies, not deposited mass.
4. **Dynamic lithology** — *absent.* `computeResistance()` runs once in `generate()`; `resistanceField`
   never updates as erosion strips layers. (Future: depth-layered resistance.)
5. **Isostatic rebound** — *partial, intentional.* `isostaticRebound` (≈L1690) returns ~80% of the
   eroded column as broad uplift, but writes into `field` directly; `flexureField` is not re-evolved.
6. **Cryosphere ↔ climate (albedo)** — *absent.* `glacialErode` is terminal; `computeTemperature`
   (≈L1810) has no albedo/ice term, so no ice→albedo→cooling feedback.

## Implementation plan (user picked 1, 2, 3)

- **Loop 1 — v0.066 (done).** `evolveCoupled(cycles)`: each cycle carves (stream-power) → rebounds →
  `computeFlow` → `refreshClimate`, so rainfall driving the next cycle reflects the orography it
  built. New opt-in op (Erosion panel "Evolve" button + cycles slider) → `generate()` bit-identical.
- **Loop 2 — v0.067 (done).** Compute the SST anomaly BEFORE the weather sim and feed it into the
  sea-temperature that drives `buildWind` (pressure ∝ −T) and evaporation, so currents steer winds &
  rain instead of post-tinting. Gated on `state.climate.currents` (default off → bit-identical).
- **Loop 3 — v0.069 (done).** `routeSediment` carries an eroded-sediment supply down the drainage
  network and deposits it (floodplains, deltas/shelves, sink pooling), conserving mass exactly. Opt-in
  **Sediment fill** button (`depositSediment`). Default off → bit-identical.

Loops 4 (dynamic lithology) and 6 (cryosphere albedo) remain documented follow-ups.
