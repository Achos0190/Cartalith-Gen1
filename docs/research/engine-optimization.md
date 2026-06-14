# Simulation Engine Optimization — Options & Verdicts

*June 2026. Constraint baseline: single-file HTML, zero dependencies, `file://` first; a local HTTP server is now an accepted fallback (user decision), but `file://` must keep working with graceful degradation.*

## The headline question: is Rust an option within HTML?

**Yes — with a build step.** Rust compiles to WebAssembly (`wasm-pack --target web`), and the resulting `.wasm` binary can be **embedded in the HTML as a base64 string** and instantiated without any network fetch:

```js
const bytes = Uint8Array.from(atob(WASM_B64), c => c.charCodeAt(0));
const { instance } = await WebAssembly.instantiate(bytes.buffer, imports);
```

- This works under `file://` because no `fetch()` is involved — only string decoding. (Newer browsers also offer `Uint8Array.fromBase64()` directly.) Single-file games (js13k scene) and tools ship this way. Sources: [Inlining WASM in HTML might not be that terrible](https://bartbroere.eu/2025/03/06/inlining-wasm-in-html-not-terrible/), [wasm2js](https://github.com/sipavlovic/wasm2js), [js-inline-wasm](https://www.npmjs.com/package/js-inline-wasm), [publishing recommendations](https://nickb.dev/blog/recommendations-when-publishing-a-wasm-library/).
- Base64 inflates the binary ~33%; a lean Rust erosion kernel (no std features, `opt-level=z`) is typically 20–100 KB → 30–130 KB of base64. Acceptable in a ~180 KB HTML file.
- WASM can share memory with JS via `WebAssembly.Memory` — JS views the same buffer as `Float32Array`, so `field[]` can live inside WASM memory with zero-copy access from the renderer.

**But measure expectations:** for already-tight typed-array loops, WASM is typically **1.2–2× faster**, not 10× — JS JITs handle `Float32Array` math well ([surma.dev analysis](https://surma.dev/things/js-to-asc/), [Samsung Internet benchmark](https://medium.com/samsung-internet-dev/performance-testing-web-assembly-vs-javascript-e07506fd5875), [takahirox benchmarks](https://takahirox.github.io/WebAssembly-benchmark/), [Not So Fast, arXiv:1901.09056](https://arxiv.org/pdf/1901.09056)). The gap grows on large arrays and where WASM SIMD (128-bit, universally shipped) vectorizes stencil/droplet kernels — realistic 2–4× for our erosion inner loops with SIMD. WASM *threads* additionally need SharedArrayBuffer → COOP/COEP headers → HTTP-server-only.

**Workflow cost is the real price:** a Rust toolchain + build step breaks "edit one HTML file, refresh." Verdict: **worth it only for the 2–3 hottest kernels** (droplet erosion, stream-power solve, flow routing), embedded as one base64 blob with JS fallbacks kept (same pattern as the existing GPU/CPU dual paths). Do it *after* cheaper wins below. AssemblyScript is a lighter-toolchain alternative with similar gains; hand-written WAT is not worth the maintenance.

## Ranked optimization paths

| # | Path | Effort | Payoff | file:// | Verdict |
|---|------|--------|--------|---------|---------|
| 1 | **Web Worker for erosion (transferable buffers)** | Low-Med | UI never freezes (biggest *felt* win) | Needs blob-URL worker trick or HTTP | **Do first** |
| 2 | **R32F GPU textures** | Med | Removes RGBA8 pack/unpack from ~12 shaders; precision fix; some speed | Yes | **Do second** (already pending item) |
| 3 | **JS micro-opts** (alloc hoisting, `Math.fround`, tiling) | Low | 10–30% on hot loops | Yes | Continuous |
| 4 | **Rust/WASM kernels (inline base64 + SIMD)** | High | 2–4× on CPU erosion paths | Yes (inline) | After 1–3, if still needed |
| 5 | **WebGPU compute** | High | True compute shaders, shared workgroup memory | No (needs HTTP in practice) | Defer; revisit for Gen1 v2 |

### 1. Web Worker without SharedArrayBuffer
Erosion currently blocks the main thread (handoff pending item #4). SharedArrayBuffer requires cross-origin isolation (COOP+COEP headers — [web.dev/coop-coep](https://web.dev/articles/coop-coep), [MDN COEP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)) — HTTP-server only. **But plain Workers + transferable ArrayBuffers need no isolation**: `postMessage(field.buffer, [field.buffer])` transfers ownership of the ~10 MB Float32Array in ~0 copy time, worker erodes, transfers back. Ping-pong pattern, progress messages drive the busy indicator.
- `file://` wrinkle: Chrome blocks `new Worker('file://…')`, but a worker created from a **Blob URL of an inline `<script type="text/worker">` block** works under `file://`. That keeps single-file + offline intact.
- Code impact: erosion functions must not touch `document`/GPU — they already have pure CPU variants taking `(fld,w,h)` params, so extraction is mostly mechanical.

### 2. R32F texture migration
`EXT_color_buffer_float` makes R32F color-renderable in WebGL2 ([Khronos spec](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/EXT_color_buffer_float)); support is effectively universal on WebGL2-capable browsers. Gate on `gl.getExtension('EXT_color_buffer_float')` at `GPU.init()` self-validation; keep RGBA8 packing as fallback tier so the GPU tag reads `active (r32f)` vs `active (rgba8)`. Eliminates precision loss in iterative thermal/diffusion passes (visible banding source).

### 3. JS-level
- Hoist per-droplet allocations out of `erode()`'s 60k-iteration loop (gradient/position temporaries).
- Reuse scratch buffers across `gaussBlur`/`blurCoarse` calls instead of `new Float32Array` per pass (GC pressure during generate).
- Tile stencil passes (thermal, diffusion) into row strips for cache locality at 2048-wide rows.
- `renderNow()`: cache `materialWeights` inputs that are constant per render (already partially done via gridSlope/gridShade precompute before bakes — extend to interactive renders).

### 4. WebGPU (defer)
Now shipped by default across Chrome/Edge, Firefox 141+ (Windows) / 145 (macOS), Safari 26 ([web.dev](https://web.dev/blog/webgpu-supported-major-browsers), [implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), [caniuse](https://caniuse.com/webgpu)) — but Firefox Linux/Android still in progress and `file://`+WebGPU is inconsistent. Real compute shaders would transform flow routing and droplet erosion (atomics, workgroup memory), but it's a third backend to maintain next to WebGL2+CPU. Revisit once Gen1 unification stabilizes.

## Recommended sequence

1. **W0**: Blob-URL Worker for `erode`/`streamPowerErode`/`glacialErode` with transferable buffers + progress events. (Unblocks UI; no constraint changes.)
2. **W0.5**: JS micro-opts in the same loops while extracting them.
3. **R32F** migration with capability gating and RGBA8 fallback.
4. Profile. Only if CPU paths still dominate (GPU-less machines): Rust/WASM SIMD kernel for droplet erosion, inline base64, JS fallback retained.
5. WebGPU exploration as a Gen1 v2 spike.
