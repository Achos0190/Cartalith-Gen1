# World / Regional Maps, Tiling & 16k Generation — Plan

Goal: support global **world** maps and **regional** maps in one tool; let a user carve a region out of a world map and **regenerate it at higher fidelity** by tiling; reach up to **16384×16384 (16k)** per world or per tile; store efficiently with optional compression. The generator stays the source map for Cartalith, and **external heightmap loading remains supported** throughout.

Backed by `docs/research/` browser-limit and tiling research. Decision: compression via inlined **fflate** (~12.5 kB).

---

## The hard constraints (measured)

- **Memory**: a 16384² RGBA buffer = **1 GB**; a 16384² Float32 heightmap = **1 GB**; RGBA32F = 4 GB. You cannot hold a full 16k map as one live canvas everywhere.
- **Canvas/texture caps**: Chrome canvas backbuffer ~16.7 Mpx total (downscales above); **Firefox WebGL `MAX_TEXTURE_SIZE` often 4096**; iOS Safari canvas max 4096² and a ~384 MB pool. WebGL2 `MAX_TEXTURE_SIZE` is 16384 on desktop Chrome/Safari.
- **Conclusion**: 16k must be produced **tile-by-tile**, never as a single allocation. Universal single-canvas ceiling is ~**8192²**; 16k is reached as a grid of **4096² tiles** (4×4 for 16k).

The generator already has a working grid (`GW×GH`, 512/1K/2K), a tiled PNG bake path (`tiles/*.png` + `index.json`), and hand-rolled ZIP. This plan extends that spine rather than replacing it.

---

## Status (June 2026)

**Stage 3 amplification core shipped in v0.044**: `amplifyRegion()` — pure, worker-ready, proven seamless (seam Δ=0 across adjacent tiles), deterministic, constraint-preserving.

**Tiling core completed in v0.052** (pure, headless-verifiable): `refineTile()` splits a coarse sub-region into a cols×rows grid with one-cell shared-edge overlap → adjacent tiles seam-Δ=0 across a full split (both axes); `packHeight16`/`unpackHeight16` 16-bit R+G height packing (round-trip ≤1 LSB), wired into `exportZip` (`heightmap_rg16.bin`) + `loadZip` fallback; `buildTileManifest()` manifest v2 (schema 2, worldSeed, coarse per-tile bounds, height encoding, compression), now emitted by `bakeTiled`.

**Remaining (browser-bound):** region-selection UI on the world map, per-tile OffscreenCanvas/worker rendering at 16k, fflate-compressed tiled export (currently stored ZIP), and the 16-bit-packed **PNG** export (canvas `toBlob`; `.bin`/`.f32` precision already ship). These need a real browser/device and are the next steps once a manual pass confirms the core.

## Architecture: coarse world → selected region → high-res tiles

### Stage 1 — World map (coarse, fast, the index)
Generate the world at 1–2K as today (seamless toroidal mode already verified, seam Δ<0.12). This is the navigable overview and the **constraint map** for refinement. Store heightmap + climate fields.

### Stage 2 — Region selection
User draws/selects a rectangle on the world map (Cartalith-style camera + selection). The selection records world-space bounds (and toroidal wrap if it crosses the seam).

### Stage 3 — Regional refinement by amplification
Regenerate the selected region at high resolution as a grid of tiles. The key is **detail synthesis conditioned on the coarse world**, not a fresh unrelated generation:

```
refined(x,y) = upsample(worldHeight at this world coord)        // preserves continents/ranges
             + Σ high-octave detail(worldX, worldY, seed)        // adds fidelity the coarse map lacked
```
- Noise is sampled in **world-space coordinates** (`globalX+x, globalY+y, seed`) so tiles are **inherently seamless** — same principle large-terrain generators use. Our existing periodic noise (`pfbm`, `pridged`) already supports coordinate-driven sampling.
- Each tile generated with a **1–2 px skirt** (sample `[-overlap … size+overlap]`, discard the border on write) to kill filtering seams at tile joins.
- Erosion/climate run **per tile with the skirt** so rivers and rain shadows cross tile boundaries without cracks; the coarse world's flow gives boundary conditions. Reference: terrain amplification (Guérin/Cortial et al. 2016) — multi-scale decomposition adds detail while keeping large structure.

This directly answers "higher fidelity regional maps from world maps by tiles": the world map is the low-frequency constraint, tiles add the high frequencies, world-space seeding + skirts make them seamless.

### Stage 4 — Tiled export + manifest (+ optional compression)
Reuse and extend the existing tiled bake: each tile → PNG (visual) + optional `heightmap` data; write `index.json` manifest (world seed, bounds, tile grid, per-tile files, compression flag). Bundle into one ZIP. For 16k as 4×4 tiles: ~40–80 MB of PNGs + ~75–100 MB compressed heightmaps ≈ **120–180 MB** total.

---

## Memory & rendering discipline

- **Generate one tile at a time**; render to an `OffscreenCanvas`, convert to blob, **free, repeat**. Never hold all tiles live. (OffscreenCanvas is supported in all current browsers.)
- Heavy per-tile passes (erosion) run in the existing **Web Worker** path (v0.041 `dropletKernel` pattern) — extend the self-contained-kernel approach to stream-power/glacial so tiling doesn't freeze the UI.
- Cap the **interactive** preview at ≤8192²; only the **export** path reaches 16k via tiling. Detect device limits (`gl.MAX_TEXTURE_SIZE`, a canvas probe) and offer the largest safe tile size.

---

## Storage & compression

- **Inline fflate** (~12.5 kB, vendored into the file) for zip + gzip — 2–3× faster than alternatives, multi-threaded async mode. Replaces/augments the hand-rolled ZIP; keep the hand-rolled writer as a no-dependency fallback.
- **Heightmap precision**: canvas PNG export is 8-bit. For true height, either (a) **pack 16-bit height into R+G channels** (`H = R·256 + G`, engine-friendly), or (b) export **raw Float32** in the ZIP. Offer both; default to 16-bit-packed PNG for portability + a `.f32` for round-trip fidelity (the generator already writes `heightmap.f32`).
- **Quantize + gzip** heightmaps: uint16 + deflate ≈ 80–85% reduction on typical terrain. `CompressionStream` (gzip) is available natively in all 2025+ browsers as a zero-dep alternative, but fflate is faster on in-memory buffers — use fflate, keep `CompressionStream` as the dependency-free fallback.
- **RAR is out**: proprietary, no in-browser encoder. Recommend **ZIP/gzip** only. Users wanting RAR can re-compress the ZIP externally.

---

## External heightmap loading (preserved & extended)

`loadImage()` already imports a grayscale heightmap into `field`. Keep it, and extend:
- Import a **16-bit-packed** PNG (R+G) or a `.f32`/ZIP produced by our own exporter (full round-trip).
- A loaded heightmap can itself become the **world constraint** for Stage 3 refinement — so users can bring an external world and tile-refine regions of it.
- This satisfies the requirement that the generator be usable as a Cartalith source map **and** that external map loading stays possible.

---

## Sequencing

1. **fflate inlined + manifest v2** — compression and a richer `index.json` (bounds, world-space tile coords, height encoding); extends current tiled bake. Headless-testable (zip round-trip, manifest schema).
2. **Region selection on the world map** — UI + world-space bounds (with seam wrap).
3. **World-space-seeded refinement with skirts** — the amplification core; verify seam continuity across synthetic tile joins in the test harness (extend the existing seam check).
4. **Per-tile OffscreenCanvas + worker erosion** — 16k export without UI freeze or memory blowup; device-limit probing.
5. **16-bit height packing + external 16-bit/`.f32` import** — precision round-trip.

Verification: tiling/manifest/compression logic gets headless assertions (seam continuity across tiles, zip round-trip, height-pack/unpack fidelity). Full-16k memory behavior and OffscreenCanvas paths need a browser check — flagged in summaries. Targets (desktop 2026): coarse world <0.5 s; ~2–5 s per 4096² tile in a worker; full 16k region select→ZIP ≈ 30–60 s.
