# Physical-model tails — v0.098 (G4 · L4 · disturbance)

Three small, independent, opt-in physical-model additions that close out long-deferred roadmap
items. All are **gated / debug-only ⇒ default generate + render bit-identical** to v0.097.

## G4 — tidal sedimentation (completes the gravity workstream)

The G3 tide field (`tideField`, `computeTideField`) gives a per-cell **spring tidal range**, amplified
in shallow shelves (Green's law) and funnelled near coasts. G4 turns that range into deposition:

`applyTidalSedimentation(fld, tide, sea, W, H, opts)` (pure) accretes sediment in the **intertidal /
shallow-subtidal band** — submerged cells whose depth (`sea − h`) is *less than* the local tidal range
— building toward sea level, strongest in the shallowest flats: `accr = min(sea−h, k·tr·(1−depth/tr))`.
This raises **mudflats / tidal flats / estuary fill** exactly where the Tides view flags wandering-flood
zones. Wired as the opt-in **Tidal flats (G4)** erosion-panel button (`tidalFlats`), which requires Tides
on; it never auto-runs, so `generate()` is unchanged. Real-world basis: tide-dominated coasts (Wadden
Sea, Bay of Fundy flats) accrete fine sediment in the intertidal zone over each tidal cycle.

## L4 — dynamic lithology (exhumation hardening)

Resistance was static (`computeResistance`, set once). L4 makes it respond to erosion: where a pass has
carved deeply, harder basement is exposed, so the rock resists the *next* pass more.

`recomputeResistanceAfterErosion(resist, pre, post, W, H, opts)` (pure) raises resistance toward a
basement maximum in proportion to the exhumed column: `resist[i] = min(1, resist[i] + k·(pre−post))`.
Called in `eroFinish` and each `evolveCoupled` cycle **only when `state.tect.dynamicLithology`** (default
false ⇒ resistance untouched ⇒ bit-identical). Over repeated Evolve cycles this produces differential
erosion — structural benches, hard sills, inselbergs — instead of uniform lowering. **Dynamic lithology**
checkbox in the Erosion panel.

## Disturbance model (read-only hazard debug views)

Two derived hazard layers, exposed only as debug overlays (no new physics, never serialized), following
the `currentWindField`/`currentTideField` read-only-preview pattern:

- **Wind-throw** (`buildWindThrowField`/`currentWindThrowField`): prevailing-wind speed (W1 field) ×
  forest-canopy density (closed-canopy biome classes 3/4/5/6/12) × slope exposure; null over ocean.
  Green → red ramp. Flags where storms would topple exposed forest on windward ridges.
- **Flood proxy** (`buildFloodField`/`currentFloodField`): TWI (drainage area / slope) + log-discharge +
  low-lying base-level proximity; 0 on ridges. Pale → deep-blue ramp. Flags valley floors / floodplains /
  coastal flats.

Both are lazy-built + cached (keyed on resolution/seed/world), wired as **Wind-throw** and **Flood**
buttons in the debug picker with legend entries. Default debug view is `off` ⇒ neither is built ⇒ render
bit-identical.

## Verification
514 headless assertions (+15): tidal-sed no-op (zero/null tide), intertidal accretion toward sea, depth
gate, land untouched; lithology hardens eroded / spares un-eroded / clamps ≤1; wind-throw & flood finite
∈[0,1], zero over ocean, flood non-flat. Cross-version: `field`/`temp`/land-render hashes byte-identical
to v0.097. Browser pass owed: tidal-flat accretion shape, exhumation benches over repeated Evolve, and the
two hazard overlays' legibility.
