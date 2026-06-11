# Tectonic Feature Graph — making mountains tectonic structures, not blurred stress

Proposal (user, June 2026) + implementation plan. The single largest realism gap in the generator:
ranges are produced as **plate stress → blur → height**, which yields smooth uplift blobs. Real
orogens are linear, asymmetric, multi-ridged, valley-separated, boundary-type-specific, and
transform-offset. The missing layer is an intermediate **tectonic feature graph** between plate
interaction and the height field.

## What the code does today (confirmed)

`elevation_foundation_v0.0XX.html`:
- `computeStress()` (~L668): for each plate boundary cell, `C = (vA−vB)·n · vel` where `n` is the
  **inter-plate-center** direction (a coarse normal proxy), accumulated onto a 1px `boundaryMask`,
  then `stressField = gaussBlur(raw, blurR)` and normalized. **Normal component only.**
- `computeFlexure()` (~L700): seeds from boundary stress, blurs at `3×blurR` → forebulge / shelf /
  weak foreland basin. The *only* broad-wavelength tectonic structure.
- Height formula (~L756) and volcanism consume `stressField` as a scalar.
- Boundary "classification" (~L816): a sign threshold splits boundary cells into convergent
  (`s>thr`) vs divergent (`s<−thr`). No crust-type awareness; transforms are not modeled.

So the diagnosis holds: there is no shear field, no boundary-type matrix, no ridge-axis geometry, no
fold belts, no trench/arc/foreland as distinct landforms, no transform offsets, and the blur destroys
the linear information ridges need.

## Target architecture (the missing layer)

```
plates (Voronoi + velocities)        ← exists
   ↓  per-boundary-cell normal n AND tangent t
boundary classification (crust A × crust B × convergence sign × shear)   ← NEW
   ↓
boundary GRAPH: boundary pixels → polylines → segments (length, curvature, branch nodes)   ← NEW
   ↓
tectonic feature synthesis along each segment's signed distance field d, arclength u:
   · orogenic uplift kernel (primary + flanking ridges)                  ← NEW
   · fold belts (sin(f·d), f = k√|C|) → ranges + intermontane basins     ← NEW
   · subduction trench + volcanic arc (ocean–continent)                  ← NEW
   · island arc + backarc (ocean–ocean)                                  ← NEW
   · foreland basin (continent–continent)                               ← strengthen flexure
   · transform offset (lateral ridge displacement ∝ shear)              ← NEW
   ↓  sum into an uplift field U(x)
existing height formula + erosion carve the structure                    ← exists (erosion already good)
```

The key reusable primitives already exist: `distanceToBoundary()` (chamfer DT, ~L683) is the seed of
the per-segment distance field; `applyFeatureAlongCurve()` (v0.048) is *already a distance-field stamp
along a polyline* — the orogenic kernels are the same mold; `amplifyRegion`/world-space noise gives the
along-strike jitter; erosion (MFD stream-power, v0.046) already carves valleys from uplift.

## Components (formulas)

1. **Tangential shear field** — alongside the normal stress, compute `S = (vA−vB)·t`, `t = n⊥`.
   `|C|` drives convergence/uplift; `S` drives transforms and oblique offset.
2. **Boundary-type matrix** — per boundary segment, from crust type of each side
   (`plates[].base<0` = oceanic, else continental) × sign of `C` × `|S|`:

   | A | B | C | result |
   |---|---|---|--------|
   | C | C | + | fold-belt double chain + plateau + foreland basin |
   | O | C | + | trench + forearc + Andean volcanic arc |
   | O | O | + | trench + island arc + backarc basin |
   | any | any | − | rift / graben / mid-ocean ridge |
   | any | any | shear-dominant | transform: offset ranges, linear valley |

3. **Orogenic uplift kernel** — replace `h += stress` with a multi-ridge profile in boundary-normal
   distance `d`: `U(d) = A·e^(−d²/σ₁²) + 0.5A·e^(−(d−d₁)²/σ₂²) + 0.3A·e^(−(d+d₁)²/σ₂²)` → `/\/\` not `/\`.
4. **Fold frequency from convergence** — `f = k√|C|`; modulate perpendicular to strike:
   `ridge = sin(f·d)` → alternating ranges / intermontane basins (Rockies, Zagros, Appalachians).
5. **Transform offset** — displace ridge axes laterally by `offset = λ·S` (San Andreas, Alpine Fault).
6. **Foreland basin** — `B = −0.4A·e^(−(d−d_b)²/σ_b²)` on the craton side (Ganges, Po). Strengthens
   the existing flexure, which currently under-depresses.
7. **Subduction trench + arc** — ocean side `T = −A·e^(−d²/σ_t²)`; land side
   `Arc = 0.7A·e^(−(d−d_a)²/σ_a²)` (Andes, Cascades, Japan).
8. **Boundary graph** — the enabling upgrade: convert boundary pixels → polylines (trace + RDP, reuse
   `rdpSimplify` from v0.048), compute per-segment length / curvature / branch nodes, and grow features
   along these curves instead of from a raster. This is what Cortial 2019 / Cordonnier 2016 effectively do.

## Phased implementation plan (each phase: own version, headless-verifiable, gated)

Discipline (CLAUDE.md): every phase is **opt-in or reproduces the old result at a default**, proven
bit-identical via the `cmp` harness, so existing seeds/saves don't silently change until the user opts in.

- **T0 — shear + boundary metadata (no visual change yet).** Add the tangent/shear computation and a
  per-boundary-cell record (crust A/B, C, S, n, t). Store a `shearField`; add a **Shear/Boundary-type
  debug view**. `state.tect.tectonicGraph=false` gates everything downstream. Bit-identical (data only).
  Headless: shear is nonzero on oblique boundaries; type matrix classifies known synthetic cases.
- **T1 — boundary graph.** `traceBoundaries()` → polylines (pure, testable: closed loops, branch nodes,
  total length ≈ boundary-cell count). Debug overlay drawing the graph. Still no height change.
- **T2 — orogenic uplift kernel (opt-in).** Replace, behind the gate, the blob uplift with the
  multi-ridge kernel stamped along graph segments via the `applyFeatureAlongCurve` mold into a new
  `orogenyField`; feed it into the height formula in place of raw blurred stress. Off ⇒ bit-identical.
  Headless: a synthetic convergent boundary yields ≥3 parallel ridges with valleys between (like the
  v0.046 valleys-not-ridges assertion).
- **T3 — boundary-type features.** Trench/arc (O–C, O–O), fold belts (`sin(f·d)`), strengthened foreland
  basin, rift grabens — selected by the T0 matrix per segment. Headless: O–C profile has trench below
  sea then arc above; C–C has double chain + foreland depression.
- **T4 — transforms.** Shear-dominant segments offset ridge axes; linear transform valleys. Headless:
  lateral ridge displacement ∝ S.
- **T5 — tuning + archetype hooks.** Wire into the World Structure archetypes; expose a couple of
  sliders (fold intensity, trench depth). Final aesthetic pass (browser).

## Interactions / constraints

- **16k tiling**: the feature graph is computed at world resolution (the constraint map); `amplifyRegion`
  already adds high-frequency detail conditioned on the coarse field, so refined tiles inherit the
  tectonic structure for free — no per-tile tectonics needed.
- **Erosion**: already the right tool to carve valleys from the new uplift; no change needed (it may
  even need *less* synthetic ridging once fold belts exist).
- **Pipeline order** (`docs/research/pipeline-order-audit.md`): the graph + uplift slots in where
  `computeStress`/`computeFlexure` run today, before height normalization and climate.
- **Performance**: graph build is O(boundary cells); kernel stamping is O(cells near boundaries). World
  res only. Cheap relative to erosion.

## References

- Cortial, Peytavie, Galin, Guérin (2019), *Procedural Tectonic Planets* — approximates collision /
  subduction / island arcs / ocean ridges from plate interactions (not full physics).
- Cordonnier et al. (2016), *Large-scale terrain from tectonic uplift + erosion* — uplift fields, not
  noise, carved by erosion. (Already the basis of the v0.046 stream-power solver.)

## Verdict

This is the next major subsystem for World-Machine/Gaea/Cortial-class realism at 16–32k. It is large
(≈6 phased versions) but each phase is independently shippable, headless-verifiable, and gated so it
never regresses existing worlds. It does not block the current asset/visual work and can run as its own
workstream once prioritized.
