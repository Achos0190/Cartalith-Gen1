# "Better terrain" — process-guided landforms (fjords, fault-blocks, island arcs)

User-supplied geomorphology spec (2026-06). Maps specialized landforms to process-bound generative
operators so micro-features stay physically tied to the macro tectonics that create them.

## What the engine already does (assessment)

Much of Sections 2–3 of the spec is **already implemented** by the tectonic-feature graph (T0–T5,
`docs/research/tectonic-feature-graph.md`):

- **Stress/shear/strain fields + boundary-type matrix** (`computeStress`, `classifyBoundary`):
  collision / subductionOC / arcOO / rift / transform, with shear sense — the divergent-vs-convergent split
  the spec's pipeline asks for.
- **Island arcs** — `buildOrogenyField` `arcOO` profile: trench + island-arc ridge + backarc basin, with the
  trench placed on the **oceanic side** via a per-margin crust majority vote (the spec's "subduction polarity"
  constraint). Subduction (`subductionOC`) adds the Andean arc.
- **Fault-block / rift** — `buildOrogenyField` `rift` profile: axial graben + uplifted shoulders layered on the
  divergent stress. (Spec §2 wants the *repetitive parallel* Basin-and-Range sawtooth — see Phase 2 below.)
- **Volcanism correlated with rifts/arcs** (`volcanicField`, provinces, arc/rift placement) + gravity-scaled
  crater/volcano sizing.
- The general `h + flow + sediment` philosophy: the LEM pipeline (stream-power, droplet, glacial, velocity-field
  erosion, sediment routing) already treats rivers/valleys/deltas as emergent threshold features, not drawn ones.

## Phase 1 — Fjords (Section 1) — **shipped, v0.120**

The clearest gap: the engine had glacial erosion but no *constrained* glacial-coastal incision. Implemented the
composite probability mask + overdeepening carve as an opt-in op (never auto-runs ⇒ default bit-identical).

- `LITH_COMPETENCE[]` — crystalline competence by `LITH_KEYS` (granite/gneiss/basalt = hard; sed = weak).
- `buildFjordMask(fld, tempC, lith, coastD, W, H, sea, opts)` → Float32 [0,1] =
  **I_glacial** (paleoclimate-adjusted thermal band, `tempC − paleoAnomaly` in a cold-but-not-frozen window)
  × **H_relief** (neighbourhood max−min relief — rugged coastal mountains adjacent; high even at a flat valley
  floor between steep walls) × **B_crystalline** (lithological competence) × coastal-fringe falloff. Nonzero only
  on cold, rugged, hard-rock coastal land.
- `carveFjords(fld, mask, …)` → overdeepens pre-existing coastal **valley floors** below sea level (drowned
  U-valleys) while leaving ridges high → steep fjord walls. Only-deepens; low-mask cells untouched.
- `carveFjordsOp()` + a **Carve fjords** button (Glacial panel) + a **Fjord** debug view (the probability mask).
- Refs: Holtedahl 1993 (Norwegian fjords), Montgomery 2001 (slope–lithology relief control), Benn & Evans 2014.

## Phase 2 — Fault-block / Basin-and-Range repetition (Section 2) — planned

The current `rift` profile is a single axial graben. Section 2 wants the **repetitive parallel** horst–graben
ridge-and-valley field via an **anisotropic** coordinate stretch along the extension vector + a modulated
**sawtooth** displacement (sharp scarp + exponential block tilt), gated on divergent strain. This would extend
`buildOrogenyField`'s rift branch (and could read the shear field for the strike direction). Constraint: only in
`div(V_plates) > ε` zones; correlate with elevated hotspot/volcanic probability (high heat flow).

## Phase 3 — Discrete island-arc cones (Section 3) — planned

The current arc is a continuous ridge. Section 3 wants **discrete stratovolcano cones** (Poisson-disk / hashed
seeding) along the magmatic-window Gaussian at the trench-to-arc gap `D_arc = 100km/tan(θ)`, with flat-slab
(θ<15°) extinction. This would seed cones along the existing `arcOO`/`subductionOC` arc ridge and stamp the
`(1+noise)·e^(−(r/R)^γ)` stratovolcano profile (γ≈1.5), feeding `volcanicField`.

Refs: Stern 2002, Tatsumi & Eggins 1995 (subduction magmatism); Stewart 1978, Wernicke 1985 (Basin and Range).
