---
name: verify-elevation
description: Headless verification of elevation_foundation_v*.html — extracts the JS, syntax-checks it, and runs the smoke-test suite (CPU fallback paths). Use after ANY change to the elevation foundation HTML, before delivering or committing.
---

# Verify elevation foundation

Run the full headless verification:

```bash
tests/run.sh                          # newest elevation_foundation_v*.html in repo root
tests/run.sh path/to/other_file.html  # or an explicit target
```

What it does:
1. Extracts the single `<script>` body from the HTML (`python3` regex, same as the historical harness).
2. `node --check` — fail fast on syntax errors.
3. Concatenates `tests/stub_head.js` (DOM/canvas stub; `webgl2` context returns `null` so every GPU path exercises its CPU fallback) + extracted JS + `tests/test_tail.js` (assertion suite) and runs it under `timeout 300 node`.

The suite regenerates at 256px in region mode, checks every global field array for finiteness/range, verifies the `materialWeights` Σ=1 invariant, runs all six erosion stages, renders, then regenerates in world (toroidal) mode and asserts seam continuity (avg wrap delta < 0.12).

Rules:
- A change is NOT done until this passes. Run `node --check` first if iterating quickly.
- GPU shader code cannot be tested headlessly — the suite only proves CPU-fallback parity paths. Flag GPU-shader changes for manual browser verification in your summary.
- If you add a new pipeline stage or global field array, add matching assertions to `tests/test_tail.js` in the same change.
- If the script gains new DOM/browser API usage, extend `tests/stub_head.js` (keep stubs minimal — element objects, 2D context no-ops).
- The test tail runs synchronously and calls `process.exit()` before `setTimeout`-deferred work fires; the deferred full-resolution initial `generate()` never runs. Don't convert the suite to async without accounting for that.
