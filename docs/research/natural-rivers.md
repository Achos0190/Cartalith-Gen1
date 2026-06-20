# Natural River Networks — why the Flow/Strahler views read as straight + overcrowded, and how to fix it

*June 2026. User report: in the Strahler and Flow debug views the drawn rivers are "rather straight lines…
unnatural, and the sheer amount also seems overwhelming." This is research + a staged plan. It builds on
the v0.111–0.115 river overhaul (`docs/research/river-overhaul.md`); the issues here are in the **drainage
extraction + how the network is drawn**, not the Pillar-2 velocity erosion (which only carves the heightmap).*

## 1. Diagnosis (grounded in the code)

Two independent causes, both in `buildRiverNetwork` / `computeFlow` / the debug renders:

### A. Straight lines = **D8 single-direction flow routing**
`computeFlow` and `buildRiverNetwork` both choose **one** steepest-descent receiver among the **8
neighbours** (`for dy,dx in −1..1 … best drop`). D8 can only point in 8 discrete directions, so on smooth
or gently-sloped terrain the accumulated flow snaps to **45°/90° staircases — parallel, ruler-straight
channels**. This is the textbook D8 artifact (the "unacceptable 45° bias … parallel drainage lines").
The rendered network then stamps discs *straight along that D8 path*, so the straightness is visible
verbatim. (The meanders added by Pillar 2's velocity erosion live in the **heightmap**, not in these
accumulation-based debug views.)

### B. "Too many" = **pure-area channel threshold + drawing every order**
- `buildRiverNetwork` marks a cell a channel when `flow[i] > thresh`, with `thresh = W·H·0.0004` — a
  **fixed contributing-area threshold with no slope dependence**. Real channel heads follow a **slope–area
  law** (steep ground channelizes with far less drainage area; flat ground needs much more), so a flat
  area threshold over-dissects gentle terrain and under-cuts steep terrain → an unnaturally uniform,
  dense web.
- The **Flow** debug view paints `log(1+accumulation)` for **every** cell (down to 1-cell trickles); the
  **Strahler** view paints every channel cell including **order-1** headwaters. By Horton–Strahler laws
  the number of streams grows ~geometrically as order drops, so "show all orders" is dominated by the
  smallest, most numerous streams — the "overwhelming" look. Cartographers always **generalize by order**.

## 2. Research findings

### Flow-direction algorithms (the straightness)
| Method | Behaviour | Visual |
|---|---|---|
| **D8** (O'Callaghan & Mark 1984) | all flow → 1 of 8 neighbours | crisp channels but **45° bias, parallel straight lines** |
| **D∞ / D-infinity** (Tarboton 1997) | flow split between the **two** neighbours bracketing the true downslope angle (continuous 0–360°) | **removes the parallel/straight artifact**; channels follow the real aspect |
| **MFD** (Freeman 1991; Quinn 1991) | flow to *all* lower neighbours, slope-weighted | realistic divergence on hillslopes but **smears** channels (poorly-defined convergence) |

Takeaway: **D∞ for the routing angle** is the standard cure for straight D8 channels while keeping crisp
convergence; MFD is for hillslope/sheet flow, not channel display. An alternative that doesn't touch the
physics: keep D8 accumulation but **vectorise + spline-smooth** the channel polylines for *rendering*.

### Channel initiation & drainage density (the count)
The **slope–area threshold** `A·Sᶿ ≥ C` (Montgomery & Dietrich 1988/1992, "Where do channels begin?") is
the canonical channel-head model: a channel starts where contributing area `A` times slope `S` (exponent
θ≈1–2) exceeds a constant `C`. Equivalently `A ≥ C/Sᶿ` — **steep cells need little area, flat cells need a
lot** — which both *reduces* spurious flat-terrain channels and *places* heads at the convex→concave
inflection where real channels begin. Raising `C` lowers drainage density uniformly; the slope term makes
the density *vary naturally* with terrain.

### Stream-order generalization (the display)
Horton–Strahler laws: stream counts fall geometrically with order (bifurcation ratio ≈ 3–5). Standard map
generalization = **draw only order ≥ k** (k a zoom/clutter control). This is the single cheapest fix for
"too many."

### Meandering / sinuosity (naturalness)
Real rivers meander via helical flow + outer-bank erosion; planforms are modelled with **Kinoshita curves**
and sinuosity = along-channel / straight-line distance. For *rendering*, the universal trick (Wonderdraft,
Azgaar, World Creator, Hodgin's "Meander", Red Blob Games) is to treat the channel as a **polyline →
simplify (RDP) → spline (Catmull-Rom) → optional perpendicular perturbation** whose amplitude scales with
order/discharge and inversely with slope (low-order mountain streams straight; high-order lowland trunks
sinuous — exactly the Rosgen scaling the engine already references). **Cartalith already ships
`rdpSimplify` and `catmullRomSample`**, so the vector path is cheap to build.

## 3. Recommended plan for Cartalith (staged; reuses existing primitives)

All render/extraction-only; the heightmap and physics are untouched ⇒ default `generate()` bit-identical.

- **R1 — slope-area channel threshold (fewer, better-placed channels).** Replace the flat
  `flow > W·H·0.0004` test in `buildRiverNetwork` with a slope–area rule `flow · Sᶿ > C` (θ≈1, C tuned so
  Earth defaults keep a sensible trunk set). Pure; headless-testable (steep cell channelizes at lower area
  than a flat cell; raising C lowers density). Add a **"River density"** slider (= C).
- **R2 — Strahler-order display filter (kills the overwhelming count).** A **"Min stream order"** control
  for the Flow + Strahler views (and optionally the biome river overlay): draw only cells with order ≥ k.
  Trivial, immediate, reversible. Default k=1 (unchanged) so it's opt-in.
- **R3 — de-straighten the rendered rivers.** Two options:
  - *(a, lighter, render-only)* **vectorise + smooth**: trace the D8 receiver chains into polylines,
    `rdpSimplify` → `catmullRomSample`, and stroke those (reuse the road-overlay stroking idiom) instead of
    per-cell disc stamping → smooth curves, no 45° staircases, and order-scaled stroke width.
  - *(b, deeper)* **D∞ receivers** in `buildRiverNetwork` (and optionally `computeFlow`): pick the
    continuous downslope angle, route along it → physically removes the straight bias. Heavier (changes
    accumulation; must re-verify Strahler + erosion coupling), so (a) first.
- **R4 — order/slope-scaled sinuosity** on the R3(a) polylines: perturb the spline perpendicular by an fbm
  whose amplitude ∝ order and ∝ 1/slope (straight headwaters, meandering lowland trunks; Kinoshita-ish).
  Pure, tunable, headless-testable (sinuosity rises with order, falls with slope).
- **R5 — Flow view legibility.** Give the Flow view a log-floor / threshold so sub-channel trickles fade,
  matching the channel set the Strahler view shows.

Recommended order: **R2 (instant relief) → R1 (right density) → R3a (smooth look) → R4 (meanders) → R3b/R5
(polish)**. R2+R1+R3a address the report directly; R4 adds the natural feel.

## Shipped — v0.137 (R1 + R2 + R3a + R4)

- **R1** `channelThreshold(baseThresh, slopeN, density)` = `(base/density)·(1+8·slopeN)^−|ln density|` replaces
  the flat `flow>W·H·0.0004` test in `buildRiverNetwork` (which now also returns `recv`+`slope`). **Exactly
  identity at `density===1`** (`|ln 1|=0`) ⇒ the default network is bit-identical; a **"River density"** Style
  slider (`state.viz.riverDensity`, default 1) drives it. Steep ground channelizes with less area.
- **R2** `state.viz.minRiverOrder` (default 1) + a **"Min stream order"** slider: the Flow and Strahler views
  draw only cells with Strahler order ≥ k (Horton–Strahler generalization). Default 1 ⇒ views unchanged.
- **R3a** `traceRiverPolylines(order, recv, W, H, minOrder)` walks the receiver chains into ordered,
  non-overlapping polylines (main stems first, visited-mask tree); the Strahler view now strokes
  `rdpSimplify`→`catmullRomSample` splines on `vctx` (order-scaled width/hue) instead of per-cell discs — the
  45° staircase is gone. The Strahler pixel branch is dim-terrain-only.
- **R4** `riverSinuosity(samples, amp, wavelen, seed)` perturbs the spline perpendicular by an `fbm` wave;
  amplitude `riverSinuAmp(order, slopeN) = (0.6+0.5(order−1))/(1+6·slopeN)` (straight headwaters, meandering
  lowland trunks).

Render/extraction-only ⇒ `generate()` FIELD/TEMP/RAIN + default biome RENDER bit-identical to v0.136. 791
assertions green (+24). **Still open** (documented follow-ups): biome-overlay min-order (needs an order-aware
intensity), **R3b** D∞ receivers in `buildRiverNetwork`/`computeFlow` (physically removes the D8 bias, heavier),
**R5** Flow-view log-floor. Browser pass owed for the smooth/sinuous Strahler look + the density slider.

## 4. Sources
- D8 vs D∞ vs MFD: Tarboton 1997 (D∞); Freeman 1991 / Quinn 1991 (MFD); O'Callaghan & Mark 1984 (D8);
  review of DEM flow-direction methods (ResearchGate); Rivix "D8 vs D-Infinity"; TauDEM/QGIS, WhiteboxTools,
  ArcGIS Flow Direction docs.
- Channel initiation / drainage density: Montgomery & Dietrich, "Source areas, drainage density, and
  channel initiation" (WRR 1989) and "Where do channels begin?" / "Channel Initiation and the Problem of
  Landscape Scale" (Science 1992); slope–area `A·Sᶿ≥C` threshold literature.
- Meander/sinuosity & procedural rendering: Kinoshita curves; R. Hodgin & "Meander" (Houdini, river-history
  maps); Red Blob Games "Procedural river drainage basins"; Nick McDonald "Procedural Hydrology"; World
  Creator river docs; Wonderdraft/Azgaar river rendering (spline-smoothed polylines).
- Internal: `docs/research/river-overhaul.md`, `docs/research/multiscale-rivers.md`; engine
  `buildRiverNetwork`/`strahlerFromReceivers`/`computeFlow`, plus the existing `rdpSimplify` +
  `catmullRomSample` primitives.
