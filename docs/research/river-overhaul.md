# River / Erosion / Water-Rendering Overhaul (4 pillars)

User-commissioned overhaul of the river generation, erosion, and water-rendering subsystems
(2026-06). Replaces the simplified down-gradient tracking + static geometric brushes with an
authentic simulation engine across four pillars. **User decisions (2026-06-19):**

- **Replace existing behaviour by default** (not opt-in) — the new systems become the default
  look. Each version re-baselines the RENDER hash; `field`/`temp`/`rain` stay bit-identical where the
  change is render-only.
- **Phased delivery, one pillar per version.**
- **Pillar 2 = a NEW erosion op** (the proven self-contained droplet/stream/glacial worker kernels and
  their Invariant 11 stay untouched).

## Pillar 4 — Provenance (cross-cutting, strict)

Every new solver/algorithm carries an `@architecture / @physics / @credits` comment block naming its
inspiration. **Original implementations only — algorithms studied, no GPL/AGPL code copied** (consistent
with the repo's existing "Nortantis studied, not copied" stance; SebLague is MIT). Sources:

| Subsystem | Credit |
|-----------|--------|
| Strahler ordering + Rosgen/sinuosity scaling | Pasternack-Lab/RiverBuilder (UC Davis); Genevaux et al. 2013; Galin et al. 2019; Strahler 1957; Leopold & Maddock 1953 |
| Velocity-field advection + hydraulic momentum | LanLou123/Webgl-Erosion; Mei et al. 2007 (GPU shallow-water) |
| Sediment transport / droplet deposition | SebLague/Hydraulic-Erosion; Hans Theobald Beyer 2015 |
| Depression sinks + adaptive lake pooling | weigert/SimpleHydrology (Nick Weigert) |
| Light absorption/scattering water shading | Premože & Ashikhmin (Stanford — "Rendering Natural Waters") |

## Pillar 1 — Macro-Topology: drainage networks & river geomorphology — **shipped, v0.111**

- `strahlerFromReceivers(recv, flow, chan, n)` — pure Strahler (1957) solver (upstream→downstream by
  ascending flow; no-donor ⇒ 1; max donor order, +1 only when the max is shared by ≥2 donors).
- `buildRiverNetwork(fld, flow, W, H, sea, opts)` → `{order:Int16, intensity:Float32[0,1], depth:Float32[0,1]}`:
  steepest-descent D8 receivers + channel mask → Strahler order → **Rosgen-inspired** cross-sections
  (half-width ↑ with discharge **and** order, ↓ with slope `1/(1+5·slopeN)`; depth ↑ with order/discharge,
  staged for Pillar 3). Confluence blend-flow = max-combined soft discs with order stepping by ≤1 (no spikes).
- `buildRiverField` delegates to `buildRiverNetwork(...).intensity` (the default river overlay is now
  Strahler/Rosgen-driven). `_riverNet` caches `{order,intensity,depth}` (cleared in `computeFlow`).
- **Strahler** debug view + legend; `strahler_order.bin` (Uint8) export.
- Render-only ⇒ `field`/`temp`/`rain` bit-identical to v0.110; RENDER changes by design. 669 assertions.
- Sinuosity is modelled (width/order scaling) but **true meandering is realised in Pillar 2** (centrifugal
  shear), which owns oxbow/meander generation.

## Pillar 2 — Micro-Physics: velocity-field hydraulic erosion — **shipped, v0.112**

A **new erosion op** (the proven droplet/stream/glacial worker kernels and Invariant 11 are untouched; it
never auto-runs ⇒ default `generate()`/render bit-identical to v0.111).

- `centrifugalShear(vx,vy,nvx,nvy)` → `{ox,oy,mag}` — outer-bank direction + turn magnitude (pure).
- `velocityErodeKernel(fld,rain,W,H,P,onProgress)` — grid (virtual-pipes, Mei et al. 2007 / LanLou123)
  shallow-water hydraulic erosion; mutates `fld`, returns `{water,vx,vy}`. Per iter: rain → virtual-pipe flux
  (outflow capped at available water ⇒ **emergent lake pooling**; sea = open sink, border reflective) → water
  + flux→velocity → **semi-Lagrangian momentum advection** `v_new=v_old(x−v_old·Δt)+g·∇` (+ sediment advect)
  → capacity erode/deposit (SebLague/Beyer) with **centrifugal outer-bank bias** (meanders/oxbows) →
  evaporation. Every write clamped (Invariant 2); suspended load settled at the end; flux ∝ planet g.
- `velocityErode()` sync wrapper → `enforceRiverChannels`→`computeFlow(true)`→`refreshClimate`→`renderNow`
  (no isostatic rebound). Stores `_veloVx/_veloVy/_veloWater` for the **Velocity** debug view + Pillar 3.
- UI: **Velocity (momentum)** Erosion accordion (Iterations/Strength/Meander, `state.velo`).
- **v0.114 worker-ification (DONE):** `velocityErodeKernel` made fully self-contained (inlined
  `_bilin`/`centrifugalShear`) → runs off-thread via `velocityEroseAsync()` (dedicated blob-URL runner
  transferring field+vx+vy+water back; sync fallback; shared `veloFinish()` tail). Invariant 11 now covers all
  four kernels. Bit-identical to v0.113. 692 assertions.

## Pillar 3 — Optical realism: water shading — **shipped, v0.113** (overhaul feature-complete)

- `waterShade(bed, depth, sed, Kd)` — Beer–Lambert `I=I₀·e^(−Kd·depth)`: shallow transmits the bed colour,
  deep absorbs to a turbid scatter colour (hue blue→green/brown with sediment). Applied by default in
  `surfaceColor`'s river block over the Pillar-1 `_riverNet.depth` (`RIVER_KD=5`); replaces the flat-blue
  overlay ⇒ `field`/`temp` bit-identical to v0.112, RENDER changes by design. Pure → tested.
- `flowMapPhases(t, period)` — two phase-shifted streams + triangle crossfade (seamless infinite flow). Pure → tested.
- Opt-in flow-map animation: `startWaterAnim`/`stopWaterAnim`/`waterAnimFrame` — a perf-capped (≤400k cells)
  rAF loop drawing a travelling shimmer over river cells on `polyOverlay`, flowing along `_veloVx/_veloVy`
  (Pillar 2) or the downhill gradient. `state.viz.waterAnim` + a Style→Overlays toggle, default off ⇒ never
  runs. Browser-only — the live animation needs a manual pass. Credited to Premože & Ashikhmin.
- 688 assertions.

## Status: P1–P3 shipped (v0.111–v0.113), P2 velocity op worker-ified (v0.114); P4 (provenance) threaded
throughout. **All code tasks complete.** Remaining = browser passes only: meander/oxbow emergence + the
Velocity view, the Beer–Lambert water look, the flow-map animation, and worker progress %/sync parity.
