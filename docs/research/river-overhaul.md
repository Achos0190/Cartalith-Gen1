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

## Pillar 2 — Micro-Physics: velocity-field hydraulic erosion (planned)

A **new erosion op** (separate button/kernel; existing kernels untouched). 2D velocity field
`v=(vx,vy)` over `GW×GH`; semi-Lagrangian momentum advection
`v_new = v_old(x − v_old·Δt) + a_gravity`; bank shear / centrifugal acceleration drives outer-bank erosion
+ inner-bank deposition (meanders, oxbows); adaptive priority-flood lake pooling at closed basins (spill at
the lowest sill). Sediment capacity loops credited to SebLague/Beyer; advection to LanLou123/Mei et al.;
pooling to weigert/SimpleHydrology.

## Pillar 3 — Optical realism: water shading (planned)

Beer–Lambert depth transmittance `I = I₀·e^(−Kd·depth)` over the river `depth` field from Pillar 1
(shallow reveals bed, deep → turbid green/blue by sediment load); dynamic flow-map animation skewing ripple
UVs by the normalised velocity field with two phase-shifted streams (seamless travel). Math headless-testable;
the rAF/canvas animation needs a manual browser pass. Credited to Premože & Ashikhmin.
