# Compute-Offload Audit — GPU / multicore for every elevation-foundation step

*June 2026. User ask: "offload anything you can to multicore CPU or GPU (GPU preferred), for every step
of the elevation foundation." This is the full per-stage audit + the honest feasibility, because the
literal goal collides with three hard constraints and most of what's safely offloadable is already
offloaded.*

## The three constraints that cap "everything on GPU"

1. **GPU is default-ON and each op self-validates against the CPU** (`GPU.init` sets `enabled=true`;
   `_validateThermal`/`_validateDiffuse` compare GPU vs CPU on a small grid and **disable any op that
   doesn't match within tolerance**). So a GPU stage must reproduce the CPU result. **Procedural noise
   (`hash`/`vnoise`/`fbm`/`ridged`/`pfbm`/`pridged`) cannot match the CPU bit-for-bit in GLSL** (integer
   `Math.imul` hash + float64 accumulation vs GLSL int/float) — a noise shader would fail the self-test
   and silently fall back to CPU. GPU-ifying the noise stages is therefore not just risky, it's *inert*.
2. **Determinism / bit-identity discipline** (Invariant 10: Earth defaults bit-exact; the whole project
   is cmp-verified FIELD/TEMP/RENDER). Any offload must match the CPU canonical path.
3. **`file://` must work** (project rule). Cross-thread *shared memory* (`SharedArrayBuffer`) needs
   COOP/COEP headers, unavailable under `file://`. So multicore Workers must **copy/transfer** buffers
   (fine for the one-shot erosion kernels; for `generate()` it means making it async + per-stage copies).
   Plus: **GPU/worker code can't be headless-tested** (project rule) — only browser-verified.

## What is ALREADY offloaded

**GPU (WebGL2 fragment shaders, default-on, CPU-validated):**
- `gaussBlur` → blurH/blurV shaders. Used by `computeStress`, **`computeFlexure`**, the `baseField`
  blur, and many erosion/climate steps — so those stages are *already* partly on GPU.
- `normalize` (CPU min/max reduction + GPU linear map).
- `computeTemperature` (when geoid & ice-albedo are off — they aren't in the shader).
- `erodeThermal`, `hillslopeDiffuse`, `coastalProcess` (user-triggered erosion ops).

**Web Workers (self-contained kernels, transferable buffers — Invariant 11):**
- `dropletKernel`, `streamPowerKernel`, `glacialKernel`, `velocityErodeKernel` — all four heightmap
  erosion ops already run off the main thread with progress + sync fallback.

## Per-stage status of `generate()`

| Stage | Nature | Offload status / feasibility |
|---|---|---|
| `refreshGeoid`/`buildGeoid` | fbm + harmonics (opt-in, off) | noise → **worker-only**; off by default |
| `generateContinentalityField` | noise (opt-in) | worker-only |
| `computeWarp` | fbm domain warp | noise → **worker-parallel candidate**; not GPU |
| `buildPlates` | Voronoi seeds + Lloyd, RNG | sequential → neither |
| `assignPlates` | JFA Voronoi (iterative) | GPU-possible but bit-identity risk + already cheap → leave |
| `computeStress` | per-plate-pair + `gaussBlur` | blur **already GPU**; per-pair is data-dependent → CPU |
| `computeFlexure` | `gaussBlur(load)` | **already GPU** via gaussBlur |
| `baseField` build + blur | pointwise + `gaussBlur` | blur **already GPU** |
| `distanceToBoundary` | 2-pass chamfer scan | sequential → neither |
| `computeHeterogeneity` | fbm | noise → **worker-parallel candidate**; not GPU |
| `computeResistance` | pointwise from age/plates | small, data-dependent → low payoff |
| `buildOrogenyField` | per-margin SDF (opt-in, off) | off by default; complex |
| **height-formula main loop** | fbm/ridged/pfbm/pridged + field combine | noise → **the biggest worker-parallel candidate**; not GPU |
| `normalize` | min/max + map | **already GPU** |
| `stampVolcanoes`/`stampCraters` | RNG sequential placement | neither |
| `computeFlow` ×2 | elevation sort + sequential D8 accumulation | **inherently sequential** (each cell adds to its downstream after upstream resolves) → neither |
| `computeTemperature` | pointwise lapse | **already GPU** (geoid/albedo off) |
| `simulateWeather` | coarse 240×150 semi-Lagrangian, iterative | Invariant 3 (coarse blur CPU) + iterative → CPU |
| `applyOceanCurrents` | coarse-grid | coarse CPU |
| `renderNow` | per-pixel material/biome/hillshade/haze + viz noise | **GPU-render candidate (largest parallel win at high res)**; complex; viz-noise layers won't pass CPU-parity → partial |

## The genuinely-addable offloads (and their cost)

Everything else is already offloaded, noise (GPU-inert), or sequential. The three real opportunities:

- **A — Multicore `generate()` noise loops (Web Worker pool).** `computeWarp`, `computeHeterogeneity`,
  and the **height-formula loop** are embarrassingly parallel per-cell and **bit-identical** off-thread
  (same JS noise). Split rows across N workers, copy the few input arrays in, transfer output back.
  *Win:* large at 2K–8K (these are the dominant `generate()` cost). *Cost:* `generate()` must become
  **async** (wide ripple across every call site) + per-stage buffer copies (no SharedArrayBuffer under
  `file://`); worker path browser-only. *Risk:* medium (refactor surface), but math is unchanged.
- **B — GPU render path for `renderNow`.** The biome/relief pixel loop is the single most GPU-ideal,
  highest-res-sensitive task still on the CPU. *Win:* largest for display at 4K/8K. *Cost:* very high
  (port `materialWeights`/`classifyBiome`/hillshade/haze + many viz layers to GLSL); the noise-based
  viz styles (parchment/texture/NPR) won't match CPU exactly, so they'd need the per-op parity gate or
  stay CPU. *Risk:* high (default-on GPU + complex parity); browser-only.
- **C — Conservative GPU/stencil top-up.** Confirm `gaussBlur` is used wherever a blur appears, move the
  couple of remaining pointwise reductions/clamps onto existing shaders, add a GPU min/max reduction so
  `normalize` doesn't read back. *Win:* modest. *Cost/risk:* low. Mostly housekeeping.

## Shipped

**v0.135 — Track A (multicore `generate()` noise loops).** `computeWarp`/`computeHeterogeneity`/height
extracted to pure row-range fills (`fillWarpRows`/`fillHeteroRows`/`fillHeightRows`); a self-validating
`GENPOOL` Web-Worker pool runs them across cores when the grid is big enough, with a sync fallback that
keeps the headless path + default output **bit-identical**. The pool only engages after proving
bit-identity vs the sync fill on a probe (GPU-style gate). Tracks B (GPU render) and C (stencil top-up)
remain available if wanted later.

## Recommendation

The codebase is already well-offloaded for everything that can be offloaded *safely and bit-identically*.
The honest highest-value next step is **A (multicore generate noise loops)** — it's the biggest
remaining CPU cost, stays bit-identical, and is the truest reading of "multicore for every step."
**B (GPU render)** is the bigger display win but a much larger, riskier, browser-only effort. **C** is a
cheap top-up. "Every step on GPU" specifically is not achievable — noise can't match the CPU self-test,
and routing/Lloyd/chamfer/RNG-stamping/coarse-weather are inherently sequential.
