# Cartalith — Deep-Merge Plan (post-RC)

> **Context.** `Cartalith RC v0.01.html` ships the three tools as a single cohesive system *by isolation*:
> each engine runs unmodified in its own frame, a postMessage bridge wires unified save/open + handoffs.
> This is the **safety net**. This document plans the *next* step the user requested — fusing the three
> into **one shared namespace / one DOM / one world model** — and the safeguards that keep it lossless,
> especially around **code used in both apps that would otherwise break**.
>
> Companion: `docs/UNIFIED_TOOL_PLAN.md` (the original P0–P5 outline + layer contract + save schema v10),
> `docs/research/ui-unified-tool.md` (UI), `docs/ASSET_PACK_INTEGRATION.md` (pack module).

## 0. Why isolation first, then merge

The RC gives us a **known-good baseline**: every feature and importer provably works (each embedded app is
byte-identical to its original — `verify_rc.js` asserts it). The deep merge then proceeds *against* that
baseline: at every step we can diff behaviour against the RC frame, and if a merge step regresses anything we
fall back to the isolated frame for that subsystem. **The isolation shell is never deleted until the fused
build passes the full functionality-loss checklist.**

## 1. Architecture target

**Host = Cartalith** (the mature shell). **Engine = the elevation foundation, namespaced under `Gen.*`**
(`Gen.state`, `Gen.field`, `Gen.generate()`, `Gen.tempField`, …) inside one IIFE that exposes a small public
surface. **Compiler = the `pack` module** (pure, shared) + an optional authoring drawer. One `state` (Cartalith's)
for *content on the map*; `Gen.state` for *the world*. One canvas stack, one save file (schema v10), one CSS root.

```
ONE document, ONE script scope:
  Cart.*  (host: routes/places/politics/planner/paint, owns `state`, `render`, `$`)
  Gen.*   (engine IIFE: tectonics→climate→erosion→biomes, owns Gen.state/field/…)
  Pack.*  (shared pure module: parse/registry/sprites — read by both)
```

## 2. Collision inventory (measured, not guessed)

`build_rc.js`'s sibling analysis extracts every column-0 top-level declaration from each app's classic
`<script>` (these are exactly the identifiers that share one scope after a naive concatenation) and intersects
them. Result today:

| Pair | Collisions |
|---|---|
| **Generate ∩ Cartograph** | `state`, `render`, `resetView`, `scheduleRender`, `zoomAt`, `$`*, `crc32`, `encodeBiomeRLE`, `decodeBiomeRLE`, `BIOME_KEYS` |
| **Generate ∩ Assets** | *(none)* |
| **Cartograph ∩ Assets** | `$` |

\* `$` also collides via Cartograph∩Assets. Nine names between the two big apps — small and tractable, which is
why the merge is "clean." They fall into two classes:

**Class A — duplicate-and-(near-)identical → collapse to one shared definition** *(verify byte-equality first)*:
- `crc32`, `encodeBiomeRLE`, `decodeBiomeRLE` — already ported verbatim between the apps (v0.138). Move to a
  shared `util`/`pack` module; both callers use the one copy.
- `BIOME_KEYS` — shared vocabulary; promote to the single source of truth (the merge contract already requires
  the engine's `CART_BIOMES`/`CART_TERRAINS` to match Cartalith's `BIOMES`/`TERRAINS` byte-for-byte).
- `$` — both are `function $(id){return document.getElementById(id)}`-class helpers; unify to one.

**Class B — same name, *different meaning* → namespace (engine side renamed)**:
- `state` — **the critical one.** Two completely different shapes. The engine's becomes `Gen.state`; Cartalith
  keeps `state`. Every engine reference to `state` is rewritten to `Gen.state` (mechanical, scoped to the IIFE).
- `render`, `scheduleRender`, `resetView`, `zoomAt` — engine view ops vs editor view ops. Engine copies move
  inside the `Gen` IIFE (become `Gen.render`, etc.); they stop being globals, so no collision remains.

**Class C — non-identifier collisions the analyzer can't see (handle explicitly):**
- **DOM ids**: both use `id="view"` (the canvas), plus shared ids like `#scaleBar`. → prefix all engine ids
  `gen-*` (or host the engine panel in a **shadow root**, the cleanest isolation of ids + CSS).
- **CSS class names**: both define `.row`, `.sec`, `.seg`, `.hint`, `.val`, etc. with different rules. → prefix
  engine styles (`.gen .row`) or shadow-DOM them; the UI research already calls for `.param-row`/`.tool-seg`.
- **Module-global singletons & event listeners**: `window`-level `keydown`/`resize`/`message` handlers, the
  GPU/worker pools, `requestAnimationFrame` loops. → each engine listener is registered inside the IIFE and
  scoped to the engine container; audited individually.
- **localStorage keys / IndexedDB DB names**: engine uses `cartalith_atlas`; Cartalith uses theme keys. Distinct
  today — keep a registry to prevent future clashes.

## 3. Safeguards (the "double-used code would break" guard, automated)

1. **Collision linter in CI** *(the primary safeguard the user asked for)*. Generalise the analyzer in
   `build_rc.js` into `tools/collision_lint.js`: extract top-level decls from each module **after** namespacing
   and **fail `tests/run.sh`** if any intersection is non-empty (excluding an allow-list of intentionally-shared
   `util`/`pack` exports). This makes "code used in both that would break" a hard build error, not a runtime
   surprise. Extend it to flag duplicate DOM `id="…"` and duplicate top-level CSS selectors across modules.
2. **Engine stays headlessly testable in isolation.** The `Gen.*` IIFE must still extract + pass
   `tests/run.sh` (821 assertions) on its own — i.e. namespacing is the *only* engine change, proven
   bit-identical via the existing `cmp` harness (CLAUDE.md Invariant suite). No engine behaviour changes during
   the merge.
3. **Shadow-DOM the engine panel** (recommended) so engine ids/CSS/`<canvas>` cannot collide with the host —
   reduces Class-C work to the public data surface only.
4. **One subsystem at a time, reversible.** Order: shared `util`/`pack` → `Gen` IIFE wrapping → DOM/CSS scoping
   → save schema v10 → handoff rewrites. After each, run the full functionality-loss checklist; the RC frame for
   that tool remains a drop-in fallback until the fused path is signed off.
5. **Save round-trip gate.** Every legacy file (elevation `world.zip`, Cartalith v9 `.zip`, RC `.cartalith`,
   schema-2 pack) must still load after each step — headless `serialize→parse→merge` assertions per
   CLAUDE.md's discipline.
6. **Invariants preserved.** CLAUDE.md Invariants 1–11 (material weights Σ=1, finiteness, CPU coarse blur,
   null-checks, WS-only derive, transient-not-serialized, kernel self-containment, …) carry over unchanged; the
   merge must not touch the pipeline maths.

## 4. Seamless handoff — native, once merged

In the RC the handoff is a file synthesis over postMessage. After the merge it becomes **direct, live, no files**:

- **Generate → Cartograph (the headline flow).** Switching to Cartograph keeps the *same* world in view — the
  editor's base layer **is** the engine's live `Gen` canvas (not a baked PNG), so there is no reload and no
  resolution step. "Fill from world" calls `Gen.buildCartBiome()` / `Gen.buildCartTerrain()` directly into the
  paint grid (cell-aligned 1:1, `cellSize` already 1); calibration reads `Gen.state.mapWidthKm`; rivers can
  auto-trace from `Gen.flowField` into editable `ways[]`. The user *paints over the world they just grew* with
  zero import friction.
- **World ⇄ edits stay layered** (UNIFIED_TOOL_PLAN layer contract): regenerating rewrites only the procedural
  layer; sculpt/paint/routes/politics persist; a **Bake** action commits sculpt into terrain. The
  regeneration-safety dialog (`[Bake & regenerate] [Keep overlays] [Cancel]`) replaces the RC's coarse "replace"
  confirm.
- **Asset pack → everywhere.** One `Pack` module feeds engine splat/icons *and* Cartalith paint-cell texturing +
  settlement/POI/custom symbols (per `docs/ASSET_PACK_INTEGRATION.md`). Loading a pack updates both renderers
  live. The compiler becomes an optional authoring drawer that writes straight into the shared `Pack`.
- **Climate → content bridges** (UNIFIED_TOOL_PLAN P3): tidal-range → coastal hazard zones; per-route
  temperature/rainfall by season → planner travel modifiers; Köppen drives both renderer and paint fill.

## 5. Phasing (maps onto UNIFIED_TOOL_PLAN P0–P5, with the collision gate)

- **D0 — Shared modules + collision linter.** Extract `util` (`crc32`, zip helpers, `$`) + `pack` + shared
  vocab; land `tools/collision_lint.js` in `tests/run.sh`. *Pure; no UI.*
- **D1 — `Gen` IIFE.** Wrap the engine; rename Class-B names; prove `tests/run.sh` still green + `cmp`
  bit-identical. *Riskiest mechanical step — gated by the linter and the engine suite.*
- **D2 — DOM/CSS scoping** (shadow-root the engine panel) + the 5-tab menubar shell (reuse the RC chrome).
- **D3 — Save schema v10** (combined ZIP, both legacy importers, sculpt-overlay extraction, regen-safety dialog).
- **D4 — Native handoffs** (replace the bridge): live base layer, fill-from-world, river auto-trace, pack module.
- **D5 — Climate→content + weather v2 + performance** (worker erosion, R32F) inside the fused tool.

**Gate for every phase:** still generate/erode/sculpt/paint/route/politics/plan, load every legacy file, run
from `file://`, pass `tests/run.sh` (+ the collision linter + new integration assertions). The RC isolation
build is the fallback until D4 is signed off.
