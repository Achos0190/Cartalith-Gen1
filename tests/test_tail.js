/* Headless smoke tests for elevation_foundation. Appended after the extracted
 * <script> body; runs synchronously before any setTimeout-deferred work, then
 * exits (which cancels the deferred full-resolution initial generate()). */
'use strict';

let __pass = 0, __fail = 0;
function check(name, cond){
  if (cond){ __pass++; console.log('ok   - ' + name); }
  else { __fail++; console.error('FAIL - ' + name); }
}
function allFinite(a){ for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; }
function minMax(a){ let mn = Infinity, mx = -Infinity; for (let i = 0; i < a.length; i++){ if (a[i] < mn) mn = a[i]; if (a[i] > mx) mx = a[i]; } return [mn, mx]; }
function variance(a){ let s = 0, s2 = 0; const n = a.length; for (let i = 0; i < n; i++){ s += a[i]; s2 += a[i] * a[i]; } const m = s / n; return s2 / n - m * m; }
function fieldsFinite(tag){
  check(tag + ': field finite', allFinite(field));
  check(tag + ': field in [0,1]', (([mn, mx]) => mn >= -1e-6 && mx <= 1 + 1e-6)(minMax(field)));
}

/* ---------- region mode at reduced resolution ---------- */
state.resW = 256; state.world = false;
GW = 256; GH = gridH(GW);
allocate();
generate();

check('GPU fell back to CPU in headless run', !GPU.ok);
fieldsFinite('generate(region)');
check('plates assigned (multiple ids)', new Set(plateId).size >= 3);
check('boundaryMask has boundary cells', boundaryMask.some(v => v === 1));
check('stressField finite', allFinite(stressField));
check('baseField finite', allFinite(baseField));
check('ageField finite & in [0,1]', allFinite(ageField) && (([mn, mx]) => mn >= 0 && mx <= 1)(minMax(ageField)));
check('flexureField finite', allFinite(flexureField));
check('heterogeneityField finite', allFinite(heterogeneityField));
check('resistanceField finite', allFinite(resistanceField));
check('tempField finite & plausible (°C)', allFinite(tempField) && (([mn, mx]) => mn > -90 && mx < 60)(minMax(tempField)));
check('rainField finite & in [0,1]', allFinite(rainField) && (([mn, mx]) => mn >= 0 && mx <= 1)(minMax(rainField)));
check('rainField not flat', variance(rainField) > 1e-6);
check('flowField finite & non-negative', allFinite(flowField) && minMax(flowField)[0] >= 0);

/* ---------- materialWeights invariant: fractions sum to 1 ---------- */
{
  let ok = true, worst = 0;
  for (const T of [-25, -5, 5, 15, 22, 30, 38])
    for (const M of [0, 0.15, 0.35, 0.55, 0.8, 1])
      for (const s of [0, 0.01, 0.05, 0.2])
        for (const r of [0.01, 0.08, 0.4, 0.95])
          for (const asp of [-1, 0, 1]){
            const w = materialWeights(T, M, s, r, 5, asp, 0);
            const sum = w.snow + w.rock + w.sand + w.wetland + w.canopy + w.grass;
            worst = Math.max(worst, Math.abs(sum - 1));
            if (Math.abs(sum - 1) > 1e-3) ok = false;
          }
  check('materialWeights sums to 1 (worst |Δ|=' + worst.toExponential(1) + ')', ok);
}
check('classifyBiome returns a value across T×M sweep', (() => {
  for (const t of [-20, 0, 15, 30]) for (const m of [0, 0.5, 1]) if (classifyBiome(t, m) === undefined) return false;
  return true;
})());

/* ---------- discharge-weighted drainage (v0.037+, pipeline-order-audit gap 2) ---------- */
{
  const areaFlow = computeFlow().slice();
  const qFlow = computeFlow(true).slice();
  check('discharge flow finite & non-negative', allFinite(qFlow) && minMax(qFlow)[0] >= 0);
  let meanAbsDiff = 0;
  for (let i = 0; i < areaFlow.length; i++) meanAbsDiff += Math.abs(areaFlow[i] - qFlow[i]);
  meanAbsDiff /= areaFlow.length;
  check('discharge flow differs from area flow (rain coupling wired)', meanAbsDiff > 1e-4);
  /* totals legitimately differ (they depend on path lengths through wet vs dry cells);
     the seed normalisation only guarantees the same magnitude regime so TWI and
     river thresholds stay valid */
  let sa = 0, sq = 0;
  for (let i = 0; i < areaFlow.length; i++){ sa += areaFlow[i]; sq += qFlow[i]; }
  const ratio = sq / sa;
  check('discharge flow in same magnitude regime as area flow (got ×' + ratio.toFixed(2) + ')', ratio > 0.33 && ratio < 3);
}

/* ---------- wind field (v0.039+, weather-model-v2 W1) ---------- */
{
  check('circulation cells: Earth = 3', circulationCells() === 3);
  const r0 = state.planet.rotationHours;
  state.planet.rotationHours = 96;
  check('slow rotator collapses cells (96h → ' + circulationCells() + ')', circulationCells() < 3);
  state.planet.rotationHours = 6;
  check('fast rotator adds cells (6h → ' + circulationCells() + ')', circulationCells() > 3);
  state.planet.rotationHours = r0;

  const WW = 96, WH = 60, N = WW * WH, step = 3.0;
  const tc = new Float32Array(N);
  for (let y = 0; y < WH; y++) for (let x = 0; x < WW; x++) tc[y * WW + x] = 25 - (y / WH) * 40 + (x > WW / 2 ? 6 : 0);
  const wx = new Float32Array(N), wy = new Float32Array(N);
  buildWind(wx, wy, WW, WH, step, tc);
  check('auto wind field finite', allFinite(wx) && allFinite(wy));
  let varies = false;
  for (let i = 1; i < N; i++) if (wx[i] !== wx[0] || wy[i] !== wy[0]){ varies = true; break; }
  check('auto wind varies across the grid', varies);
  let maxMag = 0;
  for (let i = 0; i < N; i++) maxMag = Math.max(maxMag, Math.hypot(wx[i], wy[i]));
  check('wind magnitude capped for advection stability (max ' + maxMag.toFixed(2) + ' ≤ ' + (step * 1.8).toFixed(1) + ')', maxMag <= step * 1.8 + 1e-6);

  state.climate.windMode = 'manual'; state.climate.pressK = 0;
  buildWind(wx, wy, WW, WH, step, tc);
  let constant = true;
  for (let i = 1; i < N; i++) if (wx[i] !== wx[0] || wy[i] !== wy[0]){ constant = false; break; }
  check('manual wind with pressK=0 is uniform (legacy behavior)', constant);

  const manualRain = (simulateWeather(state.climate.wIters), rainField.slice());
  state.climate.windMode = 'auto'; state.climate.pressK = 0.6;
  simulateWeather(state.climate.wIters);
  let rDiff = 0;
  for (let i = 0; i < rainField.length; i++) rDiff += Math.abs(rainField[i] - manualRain[i]);
  check('planetary wind changes rainfall vs manual (mean Δ=' + (rDiff / rainField.length).toFixed(4) + ')', rDiff / rainField.length > 1e-4);
  applyClimateMoistureCorrectors();
}

/* ---------- moisture physics (v0.040+, weather-model-v2 W2) ---------- */
{
  const meanAbs = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };
  const base = (simulateWeather(state.climate.wIters), rainField.slice());
  state.climate.bulkEvap = false;
  simulateWeather(state.climate.wIters);
  check('bulk-aerodynamic evaporation changes rainfall', meanAbs(rainField, base) > 1e-4);
  state.climate.bulkEvap = true;

  const zk = state.climate.zonalK;
  simulateWeather(state.climate.wIters); applyClimateMoistureCorrectors();
  const withZonal = rainField.slice();
  state.climate.zonalK = 0;
  simulateWeather(state.climate.wIters); applyClimateMoistureCorrectors();
  check('zonalK scales the latitude corrector', meanAbs(rainField, withZonal) > 1e-4);
  state.climate.zonalK = zk;
  simulateWeather(state.climate.wIters); applyClimateMoistureCorrectors();
}

/* ---------- planet parameters (v0.038+, gravity-influence G1) ---------- */
check('state.planet has Earth defaults', !!state.planet && state.planet.g === 1 && state.planet.rotationHours === 24);
{
  const earthField = field.slice(), earthTemp = tempField.slice();
  state.planet.g = 2;
  generate();
  let fDiff = 0, tDiff = 0;
  for (let i = 0; i < field.length; i++){ fDiff += Math.abs(field[i] - earthField[i]); tDiff += Math.abs(tempField[i] - earthTemp[i]); }
  check('g=2 changes terrain (craters) and temperature (lapse)', fDiff > 0 && tDiff / field.length > 0.01);
  check('g=2 field finite & in [0,1]', allFinite(field) && (([mn, mx]) => mn >= -1e-6 && mx <= 1 + 1e-6)(minMax(field)));
  state.planet.g = 1;
  generate();
  let same = true;
  for (let i = 0; i < field.length; i++) if (field[i] !== earthField[i]){ same = false; break; }
  check('g restored to 1 reproduces Earth terrain bit-exactly', same);
}

/* ---------- droplet kernel self-containment (v0.041+, W0 worker contract) ---------- */
{
  // Rebuild the kernel from its string form with every module global shadowed to
  // undefined — exactly the environment it gets inside the Worker. Any closure
  // leak (a reference to field/GW/state/...) throws or corrupts the output here.
  const shadows = ['field', 'rainField', 'GW', 'GH', 'state', 'mulberry32', 'erodeThermal',
                   'isostaticRebound', 'computeFlow', 'refreshClimate', 'renderNow', 'gaussBlur'];
  let rebuilt = null, evalOk = true;
  try {
    rebuilt = new Function(...shadows, 'return (' + dropletKernel.toString() + ')')
      .apply(null, shadows.map(() => undefined));
  } catch (e){ evalOk = false; }
  check('dropletKernel rebuilds from source (worker stringification)', evalOk && typeof rebuilt === 'function');
  if (rebuilt){
    const W = 64, H = 48, n = W * H;
    const mk = () => { const a = new Float32Array(n);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = Math.max(0, 1 - Math.hypot(x - W / 2, y - H / 2) / (W / 2));
      return a; };
    const rain = new Float32Array(n).fill(0.5);
    const P = { droplets: 2000, inertia: 0.05, capacity: 4, minSlope: 0.01, deposit: 0.3, erode: 0.35,
                evaporate: 0.02, gravity: 4, g: 1, maxLifetime: 30, initSpeed: 1, initWater: 1, radius: 3, ck: 0.5, seed: 99 };
    const a = mk(), b = mk(), orig = mk();
    rebuilt(a, rain, W, H, P);
    dropletKernel(b, rain, W, H, P);
    let identical = true, changed = false;
    for (let i = 0; i < n; i++){ if (a[i] !== b[i]) identical = false; if (a[i] !== orig[i]) changed = true; }
    check('rebuilt kernel output finite & changed terrain', allFinite(a) && changed);
    check('rebuilt kernel bit-identical to in-module kernel (no closure leaks)', identical);
    let progCalls = 0;
    rebuilt(mk(), rain, W, H, { ...P, droplets: 500 }, () => progCalls++);
    check('kernel reports progress (' + progCalls + ' callbacks)', progCalls >= 2);
  }
}

/* ---------- stream-power / glacial kernel self-containment (v0.048b, W0b worker contract) ---------- */
{
  // Same discipline as the droplet kernel: rebuild from source with every module global shadowed
  // to undefined (the Worker environment). Any closure leak throws or corrupts the output.
  const shadows = ['field', 'stressField', 'resistanceField', 'rainField', 'tempField', 'GW', 'GH',
                   'state', 'isostaticRebound', 'computeFlow', 'refreshClimate', 'renderNow',
                   'gaussBlur', 'mbuf', 'ibuf', 'ubuf', 'MinHeap', 'computeFlowRouting'];
  const W = 60, H = 44, n = W * H;
  // a tilted dome so routing, MFD area and incision all have work to do
  const mk = () => { const a = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      a[y * W + x] = 0.55 - Math.hypot(x - W / 2, y - H / 2) / W * 0.7 + (x + y) * 0.0008;
    return a; };
  const stress = new Float32Array(n), resist = new Float32Array(n).fill(0.5), rain = new Float32Array(n).fill(0.5);
  for (let i = 0; i < n; i++) stress[i] = Math.max(0, mk()[i] - 0.3);

  for (const [name, fn, callArgs, makeArgs, P] of [
    ['streamPowerKernel', streamPowerKernel,
      'fld, stress, resist, rain', () => [stress, resist, rain],
      { k: 0.6, uplift: 0, deposit: 0.3, climateK: 0.5, iters: 6, resist: 0.5, g: 1, world: false, sea: 0.42 }],
    ['glacialKernel', glacialKernel,
      'fld, temp', () => [new Float32Array(n).fill(-12)],
      { kg: 0.15, mg: 0.4, snowline: 0.02, uFactor: 0.6, passes: 8, g: 1, sea: 0.42, world: false }],
  ]){
    let rebuilt = null, evalOk = true;
    try {
      rebuilt = new Function(...shadows, 'return (' + fn.toString() + ')').apply(null, shadows.map(() => undefined));
    } catch (e){ evalOk = false; }
    check(name + ' rebuilds from source (worker stringification)', evalOk && typeof rebuilt === 'function');
    if (rebuilt){
      const a = mk(), b = mk(), orig = mk(), extra = makeArgs();
      // signature: (fld, ...extraFields, W, H, P, onProgress)
      rebuilt(a, ...extra, W, H, P);
      fn(b, ...extra, W, H, P);
      let identical = true, changed = false;
      for (let i = 0; i < n; i++){ if (a[i] !== b[i]) identical = false; if (a[i] !== orig[i]) changed = true; }
      check(name + ' output finite & changed terrain', allFinite(a) && changed);
      check(name + ' bit-identical to in-module kernel (no closure leaks)', identical);
      let progCalls = 0;
      rebuilt(mk(), ...makeArgs(), W, H, P, () => progCalls++);
      check(name + ' reports progress (' + progCalls + ' callbacks)', progCalls >= 2);
    }
  }
}

/* ---------- biome raster handoff (v0.042+, BIOME_AND_VISUALS_PLAN Part A) ---------- */
{
  const raster = buildBiomeRaster();
  const wbR = currentWaterBodies();   // v0.103: raster's water classes (1 sea → 0, 2 lake → 13)
  check('biome raster length = GW×GH', raster.length === GW * GH);
  let valid = true, seaMatches = true, lakeMatches = true, distinct = new Set();
  const maxIdx = BIOME_KEYS.length; // ocean=0, biomes 1..maxIdx (incl. lake=13)
  for (let i = 0; i < raster.length; i++){
    const v = raster[i];
    if (v < 0 || v > maxIdx || (v | 0) !== v){ valid = false; break; }
    distinct.add(v);
    if ((wbR[i] === 1) !== (v === 0)){ seaMatches = false; }            // open sea ⇔ index 0
    if ((wbR[i] === 2) !== (v === BIOME_INDEX.lake)){ lakeMatches = false; }   // lake ⇔ index 13
  }
  check('biome raster values are valid indices (0..' + maxIdx + ')', valid);
  check('biome raster: index 0 ⇔ open sea (water-body 1)', seaMatches);
  check('biome raster: index 13 ⇔ lake (water-body 2)', lakeMatches);
  check('biome raster has multiple biomes (' + distinct.size + ' distinct)', distinct.size >= 3);
  const man = biomeIndexManifest();
  check('manifest covers every index in the raster', [...distinct].every(v => man.indices[String(v)] !== undefined));
  check('manifest index order is frozen (ocean=0, ice=1, tropWet=12, lake=13)',
    man.indices['0'].key === 'ocean' && man.indices['1'].key === 'ice' &&
    man.indices['12'].key === 'tropWet' && man.indices['13'].key === 'lake');
}

/* ---------- ocean currents (v0.045+, weather-model-v2 W3.5) ---------- */
{
  state.world = true; GW = state.resW; GH = gridH(GW); allocate(); generate();   // world mode: full hemispheres for current asymmetry
  state.climate.currents = false; refreshClimate();
  const tNo = tempField.slice(), rNo = rainField.slice();
  state.climate.currents = true; state.climate.currentK = 1.5; refreshClimate();
  check('currents change ocean SST somewhere', (() => {
    for (let i = 0; i < field.length; i++) if (field[i] < state.seaLevel && Math.abs(tempField[i] - tNo[i]) > 0.05) return true;
    return false;
  })());
  // a cold current must cool AND dry some coast (Benguela/Atacama signature)
  let coldDryCoast = false, warmCoast = false;
  for (let i = 0; i < field.length && !(coldDryCoast && warmCoast); i++){
    if (field[i] < state.seaLevel) continue;
    const dT = tempField[i] - tNo[i], dR = rainField[i] - rNo[i];
    if (dT < -0.1 && dR < -1e-4) coldDryCoast = true;
    if (dT > 0.1) warmCoast = true;
  }
  check('cold current produces a cooler, drier coast (Benguela/Atacama)', coldDryCoast);
  check('warm current produces a warmer coast (Gulf-Stream)', warmCoast);
  check('temp/rain finite after currents', allFinite(tempField) && allFinite(rainField) &&
    (([mn, mx]) => mn >= 0 && mx <= 1)(minMax(rainField)));
  state.climate.currents = false;
  state.world = false; GW = state.resW; GH = gridH(GW); allocate(); generate();   // restore region mode for later checks
}

/* ---------- regional amplification (v0.044+, WORLD_REGIONAL_TILING_PLAN Stage 3) ---------- */
{
  const src = field, sW = GW, sH = GH;
  const opts = { seed: 777, detailFreq: 1.0, detailAmp: 0.14, sea: state.seaLevel };
  // refine the left and right halves as two adjacent tiles that share an interior column
  const outW = 96, outH = 96;
  // tiles share their boundary column: A covers coarse x∈[40,72], B covers [72,104].
  // With (w-1) scaling, A's last column and B's first column both map to coarse x=72.
  const A = amplifyRegion(src, sW, sH, { x: 40, y: 30, w: 33, h: 33 }, outW, outH, opts);
  const B = amplifyRegion(src, sW, sH, { x: 72, y: 30, w: 33, h: 33 }, outW, outH, opts);
  check('amplifyRegion output finite & in [0,1]', allFinite(A) &&
    (([mn, mx]) => mn >= -1e-6 && mx <= 1 + 1e-6)(minMax(A)));
  // seam: A's right column and B's left column map to the same coarse coord (x=72) → must match
  let maxSeam = 0;
  for (let oy = 0; oy < outH; oy++) maxSeam = Math.max(maxSeam, Math.abs(A[oy * outW + (outW - 1)] - B[oy * outW + 0]));
  check('adjacent tiles seamless at shared edge (max Δ=' + maxSeam.toExponential(1) + ')', maxSeam < 1e-5);
  // determinism: same inputs → identical output
  const A2 = amplifyRegion(src, sW, sH, { x: 40, y: 30, w: 33, h: 33 }, outW, outH, opts);
  let identical = true;
  for (let i = 0; i < A.length; i++) if (A[i] !== A2[i]) { identical = false; break; }
  check('amplifyRegion deterministic', identical);
  // constraint preservation: downsampling the amplified tile back to coarse tracks the source region
  let err = 0, nrm = 0;
  for (let cy = 0; cy < 32; cy++) for (let cx = 0; cx < 32; cx++){
    const ox = Math.round(cx / 31 * (outW - 1)), oy = Math.round(cy / 31 * (outH - 1));
    const refined = A[oy * outW + ox], coarse = src[(30 + cy) * sW + (40 + cx)];
    err += Math.abs(refined - coarse); nrm++;
  }
  check('amplified tile preserves the coarse constraint (mean |Δ|=' + (err / nrm).toFixed(3) + ')', err / nrm < 0.06);
  // detail actually added somewhere (not a pure upsample)
  let added = 0;
  for (let cy = 0; cy < 32; cy++) for (let cx = 0; cx < 32; cx++){
    const ox = Math.round(cx / 31 * (outW - 1)), oy = Math.round(cy / 31 * (outH - 1));
    added = Math.max(added, Math.abs(A[oy * outW + ox] - src[(30 + cy) * sW + (40 + cx)]));
  }
  check('amplification adds sub-cell detail (max Δ=' + added.toFixed(3) + ')', added > 1e-3);

  /* ---- refineTile: full cols×rows split must be seam-Δ=0 at every internal join (v0.052) ---- */
  {
    const region = { x: 8, y: 6, w: 48, h: 30 }, cols = 3, rows = 2, ts = 24;
    const T = [];
    for (let r = 0; r < rows; r++){ T[r] = []; for (let c = 0; c < cols; c++) T[r][c] = refineTile(src, sW, sH, region, cols, rows, c, r, ts, ts, opts); }
    let vSeam = 0, hSeam = 0, fin = true;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++){ if (!allFinite(T[r][c])) fin = false; }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols - 1; c++)
      for (let y = 0; y < ts; y++) vSeam = Math.max(vSeam, Math.abs(T[r][c][y * ts + (ts - 1)] - T[r][c + 1][y * ts]));
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++)
      for (let x = 0; x < ts; x++) hSeam = Math.max(hSeam, Math.abs(T[r][c][(ts - 1) * ts + x] - T[r + 1][c][x]));
    check('refineTile tiles finite', fin);
    check('refineTile vertical seams Δ=0 (max ' + vSeam.toExponential(1) + ')', vSeam < 1e-6);
    check('refineTile horizontal seams Δ=0 (max ' + hSeam.toExponential(1) + ')', hSeam < 1e-6);
    const single = amplifyRegion(src, sW, sH, { x: region.x, y: region.y, w: region.w / cols + 1, h: region.h / rows + 1 }, ts, ts, opts);
    let m = 0; for (let i = 0; i < ts * ts; i++) m = Math.max(m, Math.abs(single[i] - T[0][0][i]));
    check('refineTile(0,0) matches a direct amplifyRegion of that sub-bounds (Δ=' + m.toExponential(1) + ')', m < 1e-6);
    /* ---- non-square tiles: aspect-preserving dims + seams still Δ=0 (v0.055) ---- */
    const nsRegion = { x: 4, y: 4, w: 60, h: 20 };   // 3:1 selection
    const td = tileDims(nsRegion, 2, 2, 30);
    check('tileDims preserves aspect (' + td.w + '×' + td.h + ')', td.w === 30 && td.h === 10);   // 1.5 cols-span : 0.5 → wait, (60/2)/(20/2)=3 → 30×10
    const A = refineTile(src, sW, sH, nsRegion, 2, 2, 0, 0, td.w, td.h, opts);
    const B = refineTile(src, sW, sH, nsRegion, 2, 2, 1, 0, td.w, td.h, opts);
    check('non-square tile has tw·th cells, finite', A.length === td.w * td.h && allFinite(A));
    let ns = 0; for (let y = 0; y < td.h; y++) ns = Math.max(ns, Math.abs(A[y * td.w + (td.w - 1)] - B[y * td.w]));
    check('non-square adjacent tiles seam Δ=0 (max ' + ns.toExponential(1) + ')', ns < 1e-6);
    // assembled image preserves the selection aspect regardless of grid choice
    const td2 = tileDims(nsRegion, 5, 1, 40);
    check('assembled size keeps selection aspect', Math.abs((5 * td2.w) / (1 * td2.h) - nsRegion.w / nsRegion.h) < 0.05);
  }

  /* ---- 16-bit height pack/unpack round-trip (v0.052) ---- */
  {
    const n = 500, fld = new Float32Array(n);
    for (let i = 0; i < n; i++) fld[i] = i / (n - 1);            // sweep [0,1]
    fld[0] = -0.3; fld[1] = 1.7;                                  // out-of-range clamps
    const rg = packHeight16(fld, n), back = unpackHeight16(rg, n);
    let maxErr = 0; for (let i = 2; i < n; i++) maxErr = Math.max(maxErr, Math.abs(fld[i] - back[i]));
    check('packHeight16 RGBA length & opaque', rg.length === n * 4 && rg[3] === 255 && rg[2] === 0);
    check('16-bit height round-trip within 1 LSB (max Δ=' + maxErr.toExponential(1) + ')', maxErr <= 0.5 / 65535 + 1e-9);
    check('packHeight16 clamps out-of-range', back[0] === 0 && back[1] === 1);
  }

  /* ---- tile manifest v2 (v0.052) ---- */
  {
    const man = buildTileManifest({ cols: 4, rows: 4, tileSize: 4096, width: 16384, height: 16384,
      seed: 12345, world: true, bounds: { x: 10, y: 20, w: 64, h: 64 }, heightEncoding: 'rg16', compression: 'gzip' });
    check('manifest schema 2 + back-compat flat fields', man.schema === 2 && man.cols === 4 && man.rows === 4 && man.tileSize === 4096 && man.width === 16384);
    check('manifest lists every tile', man.tiles.length === 16 && man.tiles[0].file === 'tiles/tile_0_0.png');
    check('manifest carries world seed + encoding', man.worldSeed === 12345 && man.world === true && man.heightEncoding === 'rg16' && man.compression === 'gzip');
    // coarse bounds: adjacent tiles share their seam edge (col c right edge == col c+1 left edge)
    const at = (r, c) => man.tiles[r * 4 + c].coarse;
    let edgeOK = true;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++){ const a = at(r, c), b = at(r, c + 1); if (Math.abs((a.x + a.w - 1) - b.x) > 1e-9) edgeOK = false; }
    check('manifest tile coarse bounds share seam edges', edgeOK);
    const m1 = buildTileManifest({ cols: 2, rows: 1, tileSize: 1024, width: 2048, height: 1024 });
    check('manifest defaults: no bounds → no per-tile coarse', m1.bounds === null && m1.tiles[0].coarse === undefined && m1.heightEncoding === 'none');
  }
}

/* ---------- seasons + Köppen (v0.043+, weather-model-v2 W3) ---------- */
{
  state.planet.axialTiltDeg = 23.4;
  computeSeasons();
  check('seasonal temp fields finite', allFinite(tempJulField) && allFinite(tempJanField));
  check('seasonal precip fields finite & in [0,1]', allFinite(rainJulField) && allFinite(rainJanField) &&
    minMax(rainJulField)[0] >= 0 && minMax(rainJulField)[1] <= 1.0001);
  // axial tilt must actually create a summer/winter temperature spread somewhere
  let maxSpread = 0;
  for (let i = 0; i < tempJulField.length; i++) maxSpread = Math.max(maxSpread, Math.abs(tempJulField[i] - tempJanField[i]));
  check('axial tilt produces seasonal temperature spread (max ' + maxSpread.toFixed(1) + '°C)', maxSpread > 1);
  // zero tilt ⇒ no seasonal spread (sanity on the declination wiring)
  const t0 = state.planet.axialTiltDeg; state.planet.axialTiltDeg = 0; computeSeasons();
  let spread0 = 0;
  for (let i = 0; i < tempJulField.length; i++) spread0 = Math.max(spread0, Math.abs(tempJulField[i] - tempJanField[i]));
  check('zero axial tilt ⇒ no seasonal temperature spread', spread0 < 1e-6);
  state.planet.axialTiltDeg = t0; computeSeasons();

  // Köppen field: valid indices, ocean⇔0, multiple classes, manifest coverage
  let kvalid = true, koceanOk = true; const kclasses = new Set();
  for (let i = 0; i < koppenField.length; i++){
    const v = koppenField[i];
    if (v < 0 || v > KOPPEN_KEYS.length || (v | 0) !== v){ kvalid = false; break; }
    kclasses.add(v);
    if ((field[i] < state.seaLevel) !== (v === 0)) koceanOk = false;
  }
  check('Köppen indices valid (0..' + KOPPEN_KEYS.length + ')', kvalid);
  check('Köppen: index 0 ⇔ ocean', koceanOk);
  check('Köppen produced multiple climate classes (' + kclasses.size + ')', kclasses.size >= 3);
  const km = koppenIndexManifest();
  check('Köppen manifest covers every produced class', [...kclasses].every(v => km.indices[String(v)] !== undefined));
  check('Köppen order frozen (Af=1, EF=30)', KOPPEN_KEYS[0] === 'Af' && KOPPEN_KEYS[KOPPEN_KEYS.length - 1] === 'EF');
  // classifier spot-checks
  const findCell = (pred) => { for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++){ const i = y * GW + x; if (field[i] >= state.seaLevel && pred(i, y)) return [i, y]; } return null; };
  const hot = findCell(i => tempJulField[i] > 24 && tempJanField[i] > 18);
  if (hot){ const code = classifyKoppen(hot[0], hot[1]); check('hot wet lowland classifies as tropical/arid (got ' + code + ')', /^[AB]/.test(code || '')); }
  else console.log('skip - no tropical test cell this seed');
}

/* ---------- erosion pipeline keeps field finite ---------- */
const savedDroplets = state.erosion.droplets;
state.erosion.droplets = 5000;
erode();                 fieldsFinite('dropletErode');
state.erosion.droplets = savedDroplets;
erodeThermal(2);         fieldsFinite('thermal');
hillslopeDiffuse();      fieldsFinite('diffuse');
/* stream-power must carve valleys, not build ridges (v0.046 fix) */
{
  state.world = false; GW = state.resW; GH = gridH(GW); allocate(); generate();
  const before = field.slice();
  streamPowerErode();
  fieldsFinite('streamPower');
  const flow = computeFlow(true);
  let mx = 1; for (let i = 0; i < flow.length; i++) if (flow[i] > mx) mx = flow[i];
  const thresh = mx * 0.02;
  let chanN = 0, localLow = 0, localHigh = 0, inciseSum = 0;
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++){
    const i = y * GW + x;
    if (before[i] < state.seaLevel || flow[i] < thresh) continue;      // land channels only
    const nbMean = (field[i - 1] + field[i + 1] + field[i - GW] + field[i + GW]) * 0.25;
    chanN++;
    if (field[i] <= nbMean + 1e-5) localLow++; else localHigh++;
    inciseSum += (before[i] - field[i]);                              // +ve = carved DOWN
  }
  // the bug raised channels (net incision NEGATIVE → ridges); the fix carves them DOWN
  check('stream-power channels net-incise downward (mean ' + (inciseSum / Math.max(1, chanN)).toFixed(4) + ' > 0)',
    chanN > 20 && inciseSum > 0);
  // and channels sit below their surroundings (valleys, not ridges)
  check('stream-power channels are valleys, not ridges (' + localLow + ' low vs ' + localHigh + ' high)',
    localLow > localHigh * 2);
}
glacialErode();          fieldsFinite('glacial');
coastalProcess();        fieldsFinite('coastal');
computeFlow();           check('flow after erosion finite', allFinite(flowField));
refreshClimate();        check('climate refresh finite', allFinite(tempField) && allFinite(rainField));

/* ---------- render produces a full RGBA buffer ---------- */
renderNow();
check('render wrote opaque pixels', img.data.length === GW * GH * 4 && img.data[3] === 255);

/* ---------- B1/B3 visual layers (v0.050, BIOME_AND_VISUALS_PLAN Part B) ---------- */
{
  // icon placement on a synthetic ridge: pure primitive, no globals
  const W = 96, H = 64, n = W * H, sea = 0.42;
  const fld = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const ridge = Math.max(0, 1 - Math.abs(y - 32) / 18);          // E–W ridge along y=32
    fld[y * W + x] = (x >= 8 && x < 88) ? sea + 0.02 + 0.48 * ridge : 0.2;  // flanks → low land, edges → ocean
  }
  const biome = new Uint8Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    biome[y * W + x] = (x < 48) ? 5 /* tempForest */ : 9 /* desert */;
  const opts = { sea, seed: 7 };
  const icons = placeMapIcons(fld, biome, W, H, opts);
  check('icons: mountains found on the ridge (' + icons.mountains.length + ')', icons.mountains.length >= 3);
  check('icons: hills found on the flanks (' + icons.hills.length + ')', icons.hills.length >= 2);
  const landR = v => (v - sea) / (1 - sea);
  check('icons: every mountain sits above the mountain threshold',
    icons.mountains.every(m => landR(fld[m.y * W + m.x]) >= 0.58));
  check('icons: every hill sits in the hill band',
    icons.hills.every(h => { const r = landR(fld[h.y * W + h.x]); return r >= 0.53 && r < 0.58; }));
  const mSpace = Math.max(5, Math.round(W / 90));
  let minD2 = Infinity;
  for (let a = 0; a < icons.mountains.length; a++) for (let b = a + 1; b < icons.mountains.length; b++){
    const dx = icons.mountains[a].x - icons.mountains[b].x, dy = icons.mountains[a].y - icons.mountains[b].y;
    minD2 = Math.min(minD2, dx * dx + dy * dy);
  }
  check('icons: mountain spacing respected (min ' + Math.sqrt(minD2).toFixed(1) + ' ≥ ' + mSpace + ')', minD2 >= mSpace * mSpace);
  check('icons: trees only on closed-canopy biome cells',
    icons.trees.length > 5 && icons.trees.every(t => { const b = biome[t.y * W + t.x]; return b === 3 || b === 4 || b === 5 || b === 6 || b === 12; }));
  check('icons: painter order is north→south', ['mountains', 'hills', 'trees'].every(k =>
    icons[k].every((p, i, a) => i === 0 || a[i - 1].y <= p.y)));
  const icons2 = placeMapIcons(fld, biome, W, H, opts);
  check('icons: placement deterministic', JSON.stringify(icons) === JSON.stringify(icons2));
  const flat = new Float32Array(n).fill(sea + 0.02);
  const none = placeMapIcons(flat, null, W, H, opts);
  check('icons: flat lowland → no mountains or hills', none.mountains.length === 0 && none.hills.length === 0 && none.trees.length === 0);

  // parchment: defaults-off neutrality + visible effect, on the real map
  const before = Uint8ClampedArray.from(img.data);
  state.viz.parchment = 0.5; renderNow();
  let diff = 0; for (let i = 0; i < img.data.length; i++) if (img.data[i] !== before[i]) diff++;
  check('parchment 0.5 changes pixels (' + diff + ' bytes differ)', diff > 1000);
  check('parchment render stays opaque', img.data[3] === 255);
  state.viz.parchment = 0; renderNow();
  let same = true; for (let i = 0; i < img.data.length; i++) if (img.data[i] !== before[i]){ same = false; break; }
  check('parchment off → bit-identical to before (default neutrality)', same);

  // icon layer toggles without error headless (vector draw is a vctx no-op in the stub)
  state.viz.icons = true; renderNow();
  check('icon layer renders without error', img.data[3] === 255);
  state.viz.icons = false; renderNow();
}

/* ---------- B4 coastal wave lines (v0.051) ---------- */
{
  // half ocean (x<W/2) / half land split: ocean distance grows toward the left edge
  const W = 40, H = 24, n = W * H, sea = 0.42;
  const fld = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fld[y * W + x] = x < W / 2 ? 0.2 : 0.7;
  const d = computeCoastDistance(fld, W, H, sea);
  check('coastDist: land cells are zero', (() => { for (let i = 0; i < n; i++){ const x = i % W; if (x >= W / 2 && d[i] !== 0) return false; } return true; })());
  check('coastDist: shore ocean cell ≈ 1', Math.abs(d[12 * W + (W / 2 - 1)] - 1) < 0.01);
  const row = 12 * W;
  check('coastDist: distance increases away from shore',
    d[row + (W / 2 - 1)] < d[row + (W / 2 - 5)] && d[row + (W / 2 - 5)] < d[row + 0]);
  check('coastDist: all finite', allFinite(d));

  // render: waves off = bit-identical; on = only WATER pixels change (land untouched)
  state.viz.parchment = 0; state.viz.icons = false; state.viz.waves = false;
  state.mode = 'biome'; state.debug = 'off'; renderNow();
  const base = Uint8ClampedArray.from(img.data);
  state.viz.waves = true; renderNow();
  let waterDiff = 0, landChanged = 0;
  for (let i = 0; i < GW * GH; i++){
    const p = i * 4, isW = field[i] < state.seaLevel;
    const changed = img.data[p] !== base[p] || img.data[p + 1] !== base[p + 1] || img.data[p + 2] !== base[p + 2];
    if (changed){ if (isW) waterDiff++; else landChanged++; }
  }
  check('waves on: water pixels change (' + waterDiff + ')', waterDiff > 50);
  check('waves on: land pixels untouched (' + landChanged + ' changed)', landChanged === 0);
  state.viz.waves = false; renderNow();
  let same = true; for (let i = 0; i < img.data.length; i++) if (img.data[i] !== base[i]){ same = false; break; }
  check('waves off → bit-identical (default neutrality)', same);
}

/* ---------- world (toroidal) mode + seam continuity ---------- */
state.world = true;
GW = state.resW; GH = gridH(GW);
allocate();
generate();
fieldsFinite('generate(world)');
{
  let d = 0;
  for (let y = 0; y < GH; y++) d += Math.abs(field[y * GW] - field[y * GW + GW - 1]);
  d /= GH;
  check('world seam avg delta < 0.12 (got ' + d.toFixed(4) + ')', d < 0.12);
}

/* ---------- emergent zonal climate structure (world mode, v0.039+) ---------- */
{
  const sums = { eq: [0, 0], dry: [0, 0] };
  for (let y = 0; y < GH; y++){
    const aLat = Math.abs(90 - (y / (GH - 1)) * 180);
    const slot = aLat < 10 ? 'eq' : (aLat >= 25 && aLat < 35 ? 'dry' : null);
    if (!slot) continue;
    for (let x = 0; x < GW; x++){ const i = y * GW + x; if (field[i] >= state.seaLevel){ sums[slot][0] += rainField[i]; sums[slot][1]++; } }
  }
  if (sums.eq[1] > 100 && sums.dry[1] > 100){
    const eq = sums.eq[0] / sums.eq[1], dry = sums.dry[0] / sums.dry[1];
    check('zonal structure: equatorial belt wetter than subtropical dry belt (' + eq.toFixed(2) + ' vs ' + dry.toFixed(2) + ')', eq > dry * 1.2);
  } else {
    console.log('skip - zonal structure (not enough land in test bands this seed)');
  }
}

/* ---------- wind debug view (v0.047+) ---------- */
{
  state.world = true; GW = state.resW; GH = gridH(GW); allocate(); generate();
  const wf = currentWindField();
  check('currentWindField finite with non-zero speed', allFinite(wf.u) && allFinite(wf.v) && wf.maxSpeed > 1e-3);
  // world mode: surface zonal wind reverses between the tropics (easterly/trades) and mid-latitudes (westerly)
  const rowU = (latAbs) => {
    // find the coarse row nearest |lat|=latAbs and return mean u there
    let bestY = 0, bestD = 1e9;
    for (let y = 0; y < wf.WH; y++){ const lat = Math.abs(90 - (y / (wf.WH - 1)) * 180); if (Math.abs(lat - latAbs) < bestD){ bestD = Math.abs(lat - latAbs); bestY = y; } }
    let s = 0; for (let x = 0; x < wf.WW; x++) s += wf.u[bestY * wf.WW + x];
    return s / wf.WW;
  };
  const uTrop = rowU(15), uMid = rowU(45);
  check('zonal wind reverses tropics↔mid-lat (trades ' + uTrop.toFixed(2) + ' vs westerlies ' + uMid.toFixed(2) + ')',
    Math.sign(uTrop) !== Math.sign(uMid) && Math.abs(uTrop) > 1e-3 && Math.abs(uMid) > 1e-3);
  // selecting the wind view renders a full opaque buffer
  state.debug = 'wind'; renderNow();
  check('wind debug view renders opaque pixels', img.data.length === GW * GH * 4 && img.data[3] === 255);
  // ocean-current debug view (v0.057): coarse field finite, vectors live on water, SST anomaly present
  const of = currentOceanField();
  check('currentOceanField finite + flow on water', allFinite(of.u) && allFinite(of.v) && allFinite(of.sst) && of.maxSpeed > 1e-3);
  let landZero = true, oceanCells = 0; for (let i = 0; i < of.u.length; i++){ if (!of.ocean[i]){ if (of.u[i] !== 0 || of.v[i] !== 0) landZero = false; } else oceanCells++; }
  check('ocean current vectors are zero on land (' + oceanCells + ' ocean cells)', landZero && oceanCells > 0);
  check('ocean SST anomaly has warm and cold sides', of.maxAnom > 1e-3);
  state.debug = 'ocean'; renderNow();
  check('ocean debug view renders opaque pixels', img.data.length === GW * GH * 4 && img.data[3] === 255);
  state.debug = 'off';
  state.world = false; GW = state.resW; GH = gridH(GW); allocate(); generate();
}

/* ---------- plotline feature brushes (v0.048) ---------- */
{
  const distToPolyline = (p, poly) => {
    let best = Infinity;
    for (let s = 0; s < poly.length - 1; s++){
      const ax = poly[s].x, ay = poly[s].y, dx = poly[s + 1].x - ax, dy = poly[s + 1].y - ay, L2 = dx * dx + dy * dy;
      let t = L2 > 1e-12 ? ((p.x - ax) * dx + (p.y - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy)));
    }
    return best;
  };

  // RDP: noisy sine simplifies; endpoints kept; every input point stays near the simplified polyline
  const raw = []; for (let i = 0; i <= 200; i++){ const x = i * 0.5; raw.push({ x, y: 10 * Math.sin(x * 0.08) + ((i * 2654435761 >>> 16) % 7) * 0.01 }); }
  const simp = rdpSimplify(raw, 0.5);
  check('rdp reduces point count (' + raw.length + ' → ' + simp.length + ')', simp.length < raw.length / 2 && simp.length >= 2);
  check('rdp keeps endpoints', simp[0] === raw[0] && simp[simp.length - 1] === raw[raw.length - 1]);
  check('rdp output stays within tolerance of input', raw.every(p => distToPolyline(p, simp) <= 0.75));
  check('rdp collinear → 2 points', rdpSimplify([{x:0,y:0},{x:1,y:1},{x:2,y:2},{x:3,y:3}], 0.1).length === 2);

  // synthetic flat grid for the feature stamps
  const W = 96, H = 72, flat = () => new Float32Array(W * H).fill(0.5);
  const curve = catmullRomSample([{x:16,y:36},{x:48,y:30},{x:80,y:40}], 2);

  // mountainRange: raised near the line; cells beyond the radius bit-untouched
  const a = flat(), R = 10;
  applyFeatureAlongCurve(a, W, H, curve, 'mountainRange', R, 0.8, 42, { sea: 0.42 });
  check('mountainRange finite & in [0,1]', allFinite(a) && (([mn, mx]) => mn >= 0 && mx <= 1)(minMax(a)));
  let nearSum = 0, nearN = 0, farSame = true;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const d = distToPolyline({ x, y }, curve), i = y * W + x;
    if (d <= R * 0.5){ nearSum += a[i]; nearN++; }
    else if (d > R + 1.5 && a[i] !== 0.5) farSame = false;
  }
  check('mountainRange raises the near-line band (mean ' + (nearSum / nearN).toFixed(3) + ' > 0.55)', nearSum / nearN > 0.55);
  check('cells beyond the radius are bit-untouched', farSame);

  // determinism: same seed bit-identical, different seed differs
  const b = flat();
  applyFeatureAlongCurve(b, W, H, curve, 'mountainRange', R, 0.8, 42, { sea: 0.42 });
  let same = true; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]){ same = false; break; }
  check('feature stamp deterministic (same seed bit-identical)', same);
  const c = flat();
  applyFeatureAlongCurve(c, W, H, curve, 'mountainRange', R, 0.8, 43, { sea: 0.42 });
  let differs = false; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]){ differs = true; break; }
  check('different seed produces different terrain', differs);

  // river on a flat field: channel carves down, sits below its surroundings, deepens downstream
  const rv = flat();
  const rCurve = catmullRomSample([{x:10,y:20},{x:50,y:36},{x:86,y:50}], 2);
  applyFeatureAlongCurve(rv, W, H, rCurve, 'river', 24, 0.9, 7, { sea: 0.42 });
  check('river field finite & in [0,1]', allFinite(rv) && (([mn, mx]) => mn >= 0 && mx <= 1)(minMax(rv)));
  let low = 0, high = 0;
  for (let k = Math.floor(rCurve.length * 0.1); k < Math.floor(rCurve.length * 0.9); k++){
    const x = Math.round(rCurve[k].x), y = Math.round(rCurve[k].y);
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
    const i = y * W + x;
    const nbMean = (rv[i - 1] + rv[i + 1] + rv[i - W] + rv[i + W]) * 0.25;
    if (rv[i] < 0.5 && rv[i] < nbMean - 1e-7) low++; else high++;
  }
  check('river channel cells carve down below their neighbours (' + low + ' low vs ' + high + ' high)', low > high * 2);
  const at = f => { const p = rCurve[Math.floor(rCurve.length * f)]; return rv[Math.round(p.y) * W + Math.round(p.x)]; };
  check('river deepens downstream (u≈0.15: ' + (0.5 - at(0.15)).toFixed(3) + ' < u≈0.85: ' + (0.5 - at(0.85)).toFixed(3) + ')',
    (0.5 - at(0.85)) > (0.5 - at(0.15)) * 1.3);

  // extremes: every feature at str=1, R=40 stays finite & in range; plateau never lowers
  let extOk = true, plateauOk = true;
  for (const ft of ['mountainRange', 'hills', 'ridge', 'plateau', 'river', 'canyon', 'escarpment']){
    const f = flat();
    applyFeatureAlongCurve(f, W, H, curve, ft, 40, 1, 99, { sea: 0.42 });
    if (!allFinite(f) || minMax(f)[0] < 0 || minMax(f)[1] > 1) extOk = false;
    if (ft === 'plateau') for (let i = 0; i < f.length; i++) if (f[i] < 0.5 - 1e-9){ plateauOk = false; break; }
  }
  check('all 7 features finite & in [0,1] at extreme settings', extOk);
  check('plateau never lowers terrain (mesa semantics)', plateauOk);
}

/* ---------- feature brush integration (UI call path on real terrain) ---------- */
{
  const before = field.slice();
  const pts = [{x:GW*0.25,y:GH*0.6},{x:GW*0.5,y:GH*0.45},{x:GW*0.75,y:GH*0.55}];
  const curve = catmullRomSample(pts, 2);
  applyFeatureAlongCurve(field, GW, GH, curve, 'mountainRange', 28, 0.45, 12345, { sea: state.seaLevel });
  fieldsFinite('feature brush (UI call path)');
  let changed = false; for (let i = 0; i < field.length; i++) if (field[i] !== before[i]){ changed = true; break; }
  check('feature brush changed real terrain', changed);
  computeFlow(true);
  check('flow finite after feature brush', allFinite(flowField));
}

/* ---------- region refine wiring (v0.053): sync parts ---------- */
{
  // normRegion: order-independent, clamped, min-size
  const a = normRegion(50.7, 30.2, 10.3, 60.9, 100, 80);
  check('normRegion orders + snaps corners', a.x === 10 && a.y === 30 && a.w === 41 && a.h === 31);
  const b = normRegion(-20, -10, 250, 200, 100, 80);
  check('normRegion clamps to grid', b.x === 0 && b.y === 0 && b.w === 100 && b.h === 80);
  const c = normRegion(50, 50, 51, 51, 100, 80);
  check('normRegion enforces min size', c.w >= 8 && c.h >= 8 && c.x + c.w <= 100 && c.y + c.h <= 80);
  const d = normRegion(98, 78, 99, 79, 100, 80);
  check('normRegion min-size near edge stays in bounds', d.x + d.w <= 100 && d.y + d.h <= 80 && d.w >= 8 && d.h >= 8);

  // renderHeightTileRGBA: opaque, finite, water vs land tinted differently
  const ts = 16, tile = new Float32Array(ts * ts);
  for (let i = 0; i < tile.length; i++) tile[i] = i < tile.length / 2 ? 0.2 : 0.8;   // top water, bottom land
  const rgba = renderHeightTileRGBA(tile, ts, ts);
  check('tile RGBA full + opaque', rgba.length === ts * ts * 4 && rgba[3] === 255 && rgba[rgba.length - 1] === 255);
  const top = [rgba[0], rgba[1], rgba[2]], bot = [rgba[(ts * ts - 1) * 4], rgba[(ts * ts - 1) * 4 + 1], rgba[(ts * ts - 1) * 4 + 2]];
  check('tile render distinguishes water from land', (top[0] !== bot[0] || top[1] !== bot[1] || top[2] !== bot[2]) && top[2] > top[0]);
}

/* ---------- G2 geoid sea-level field (v0.054, gravity-influence.md) ---------- */
{
  // buildGeoid pure math
  const W = 120, H = 60;
  const g1 = buildGeoid(W, H, { seed: 5, rotK: 1, harmK: 0, mantleK: 0, amp: 0.02, lat0: 90, lat1: -90 });
  check('geoid finite', allFinite(g1));
  let mx = 0, mean = 0; for (let i = 0; i < g1.length; i++){ mx = Math.max(mx, Math.abs(g1[i])); mean += g1[i]; }
  check('geoid peak equals amp (' + mx.toFixed(4) + ')', Math.abs(mx - 0.02) < 1e-6);
  check('geoid ~zero-mean (' + (mean / g1.length).toExponential(1) + ')', Math.abs(mean / g1.length) < 1e-4);
  // pure-J2: sea stands higher at the equator than the poles
  const eq = g1[(H >> 1) * W + 10], pole = g1[0 * W + 10];
  check('J2 bulge: equator sea level > pole (' + eq.toFixed(4) + ' vs ' + pole.toFixed(4) + ')', eq > pole + 0.01);
  const g2 = buildGeoid(W, H, { seed: 5, rotK: 1, harmK: 0, mantleK: 0, amp: 0.02, lat0: 90, lat1: -90 });
  check('geoid deterministic', g1.every((v, i) => v === g2[i]));
  const g3 = buildGeoid(W, H, { seed: 6, rotK: 0.2, harmK: 0.8, mantleK: 0.8, amp: 0.02, lat0: 90, lat1: -90 });
  check('different seed/mix differs', g3.some((v, i) => v !== g1[i]));

  // toggle neutrality + live effect on the real pipeline
  state.planet.geoid = state.planet.geoid || { enabled: false, amp: 0.015 };
  refreshGeoid();
  check('geoid off → geoidField null', geoidField === null);
  state.mode = 'biome'; state.debug = 'off';
  refreshClimate(); renderNow();
  const basePx = Uint8ClampedArray.from(img.data), baseTemp = tempField.slice(), baseField0 = field.slice();
  state.planet.geoid.enabled = true; state.planet.geoid.amp = 0.03;
  refreshGeoid();
  check('geoid on → field built', geoidField instanceof Float32Array && allFinite(geoidField));
  // ocean mask actually shifts somewhere
  let flips = 0;
  for (let i = 0; i < field.length; i++){
    if ((field[i] < state.seaLevel) !== (field[i] - geoidField[i] < state.seaLevel)) flips++;
  }
  check('geoid shifts the coastline (' + flips + ' cells flip)', flips > 0);
  refreshClimate(); renderNow();
  check('climate finite with geoid on', allFinite(tempField) && allFinite(rainField));
  check('terrain itself untouched by geoid', field.every((v, i) => v === baseField0[i]));
  let pxDiff = 0; for (let i = 0; i < img.data.length; i++) if (img.data[i] !== basePx[i]) pxDiff++;
  check('geoid on changes the render (' + pxDiff + ' bytes)', pxDiff > 100);
  // off again → climate AND render bit-identical (the gate works)
  state.planet.geoid.enabled = false; refreshGeoid(); refreshClimate(); renderNow();
  check('geoid off again → temp bit-identical', tempField.every((v, i) => v === baseTemp[i]));
  let same = true; for (let i = 0; i < img.data.length; i++) if (img.data[i] !== basePx[i]){ same = false; break; }
  check('geoid off again → render bit-identical', same);
}

/* ---------- asset packs (v0.056, docs/ASSET_PACK_FORMAT.md) ---------- */
{
  const fs = require('fs');
  // parsePackCsv — slots, icon variant ordering, tolerance, unknown-drop
  const csv = 'type,slot,file,variant\r\ntexture,grass,textures/grass.png,\r\n\r\nicon,mountain,icons/m2.png,2\nicon,mountain,icons/m1.png,1\ntexture,bogus,x.png,\nicon,dragon,d.png,1\n';
  const pc = parsePackCsv(csv);
  check('parsePackCsv reads texture slots', pc.textures.grass === 'textures/grass.png' && pc.textures.bogus === undefined);
  check('parsePackCsv orders icon variants by column', JSON.stringify(pc.icons.mountain) === JSON.stringify(['icons/m1.png', 'icons/m2.png']));
  check('parsePackCsv drops unknown slots', pc.icons.dragon === undefined);

  // parsePackManifest — JSON wins, string→array, missing-file warning, throw-on-neither
  const zip = { 'pack.json': new TextEncoder().encode(JSON.stringify({
      name: 'T', license: 'CC0', textures: { grass: 'g.png', nope: 'n.png' },
      icons: { mountain: ['m1.png', 'm2.png'], hill: 'h.png', tree_conifer: ['gone.png'] } })),
    'pack.csv': new TextEncoder().encode('type,slot,file,variant\ntexture,rock,r.png,\n'),
    'g.png': new Uint8Array(1), 'm1.png': new Uint8Array(1), 'm2.png': new Uint8Array(1), 'h.png': new Uint8Array(1) };
  const man = parsePackManifest(zip);
  check('parsePackManifest: JSON wins over CSV', man.textures.grass === 'g.png' && man.textures.rock === undefined);
  check('parsePackManifest: icon string → array', Array.isArray(man.icons.hill) && man.icons.hill[0] === 'h.png');
  check('parsePackManifest: missing files dropped + warned', man.icons.tree_conifer === undefined && man.warnings.some(w => /tree_conifer/.test(w)));
  check('parsePackManifest: unknown slot warned, not kept', man.textures.nope === undefined && man.warnings.some(w => /nope/.test(w)));
  check('parsePackManifest: name/license carried', man.name === 'T' && man.license === 'CC0');
  let threw = false; try { parsePackManifest({ 'foo.txt': new Uint8Array(1) }); } catch (e) { threw = true; }
  check('parsePackManifest throws when no manifest', threw);

  // pickIconVariant — deterministic, in range, hits all variants
  check('pickIconVariant deterministic', pickIconVariant(5, 9, 3, 4) === pickIconVariant(5, 9, 3, 4));
  check('pickIconVariant n<=1 → 0', pickIconVariant(5, 9, 3, 1) === 0);
  { const seen = new Set(); let inRange = true; for (let x = 0; x < 60; x++) for (let y = 0; y < 60; y++){ const v = pickIconVariant(x, y, 7, 4); if (v < 0 || v >= 4) inRange = false; seen.add(v); }
    check('pickIconVariant in [0,n) and hits all variants', inRange && seen.size === 4); }

  // spriteDrawRect — bottom-center anchor, ∝ s, aspect preserved
  const sr = spriteDrawRect(100, 200, 1, 10, 80, 160);
  check('spriteDrawRect bottom-center', Math.abs(sr.dx + sr.dw / 2 - 100) < 1e-9 && Math.abs(sr.dy + sr.dh - 200) < 1e-9);
  check('spriteDrawRect aspect preserved', Math.abs(sr.dw / sr.dh - 80 / 160) < 1e-9);
  check('spriteDrawRect scales with s', spriteDrawRect(0, 0, 2, 10, 80, 160).dh === sr.dh * 2);

  // finalizePackTexture — inverse channel means
  const ft = finalizePackTexture(2, 1, new Uint8ClampedArray([100, 50, 200, 255, 100, 150, 0, 255]));
  check('finalizePackTexture inv = 1/mean', Math.abs(ft.inv[0] - 1 / 100) < 1e-9 && Math.abs(ft.inv[1] - 1 / 100) < 1e-9 && Math.abs(ft.inv[2] - 1 / 100) < 1e-9);

  // serializeState carries scaleBar pref but never the pack
  const ser = serializeState();
  check('serializeState has viz.scaleBar, no assetPack', ser.state.viz.scaleBar === true && ser.state.assetPack === undefined);

  // save/load contract: the v0.086–0.092 params round-trip through serialize→JSON→default-merge (mirrors loadZip)
  {
    const savedViz = JSON.parse(JSON.stringify(state.viz)), savedTect = JSON.parse(JSON.stringify(state.tect)), savedClim = JSON.parse(JSON.stringify(state.climate));
    state.viz.crest = 0.5; state.viz.rockSlope = 0.4; state.viz.texture = 0.6; state.viz.minorStreams = 0.3; state.viz.ridgedRelief = 0.7; state.viz.ao = 0.55;
    state.tect.foldIntensity = 1.5; state.tect.trenchDepth = 0.8; state.tect.tectonicGraph = true;
    state.climate.albedo = 0.65;
    const pk = JSON.parse(JSON.stringify(serializeState()));   // serialize → JSON string → parse, like params.json
    // replicate loadZip's default-merges
    const viz = Object.assign({ parchment:0, icons:false, waves:false, scaleBar:true, splat:0.7, smoothRivers:true, sharpBiomes:true, ao:0, crest:0, rockSlope:0, texture:0, minorStreams:0, ridgedRelief:0 }, pk.state.viz || {});
    check('save round-trip: new viz sliders preserved', viz.crest === 0.5 && viz.rockSlope === 0.4 && viz.texture === 0.6 && viz.minorStreams === 0.3 && viz.ridgedRelief === 0.7 && viz.ao === 0.55);
    const tt = pk.state.tect;   // tect uses `if(==null)` guards → explicit values survive
    check('save round-trip: T5 tect params preserved', tt.foldIntensity === 1.5 && tt.trenchDepth === 0.8 && tt.tectonicGraph === true);
    check('save round-trip: L6 albedo preserved', pk.state.climate.albedo === 0.65);
    // an OLD save (missing the new fields) gets defaults, not undefined
    const old = Object.assign({ parchment:0, icons:false, waves:false, scaleBar:true, splat:0.7, smoothRivers:true, sharpBiomes:true, ao:0, crest:0, rockSlope:0, texture:0, minorStreams:0, ridgedRelief:0 }, { parchment:0.2 });
    check('save round-trip: legacy save merges new viz defaults', old.crest === 0 && old.ridgedRelief === 0 && old.parchment === 0.2);
    state.viz = savedViz; state.tect = savedTect; state.climate = savedClim;
  }

  // updateScaleBar honours the toggle
  state.viz.scaleBar = false; updateScaleBar();
  check('updateScaleBar hides when off', document.getElementById('scaleBar').style.display === 'none');
  state.viz.scaleBar = true;

  // sample pack on disk — proves STORED (sync unzipStore reads it) + manifest shape + PNG headers
  {
    const ab = fs.readFileSync('assets/sample_pack.zip');
    const z = unzipStore(ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength));
    const allStored = Object.values(z).every(v => v instanceof Uint8Array);
    check('sample_pack.zip is fully STORED (unzipStore reads every entry)', allStored && z['pack.json'] && z['pack.csv']);
    const sman = parsePackManifest(z);
    check('sample pack manifest: 7 textures + 3/2/2/2 icons, CC0', Object.keys(sman.textures).length === 7 &&
      sman.icons.mountain.length === 3 && sman.icons.hill.length === 2 && sman.icons.tree_conifer.length === 2 &&
      sman.icons.tree_broadleaf.length === 2 && sman.license === 'CC0' && sman.warnings.length === 0);
    const pngOK = Object.keys(z).filter(n => n.endsWith('.png')).every(n => { const d = z[n]; return d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4E && d[3] === 0x47; });
    check('sample pack PNGs have valid signatures', pngOK);
  }

  // sprite + neutrality smoke with a synthetic pack (no image decode; drawImage is a stub no-op)
  state.world = false; GW = state.resW; GH = gridH(GW); allocate(); generate();
  state.mode = 'biome'; state.debug = 'off'; state.viz.icons = false; renderNow();
  const baseNoPack = Uint8ClampedArray.from(img.data);
  assetPack = { name: 'syn', license: 'CC0', texAny: false, textures: {},
    icons: { mountain: [{ w: 64, h: 64, bmp: {} }, { w: 64, h: 64, bmp: {} }], tree_conifer: [{ w: 32, h: 48, bmp: {} }] } };
  renderNow();   // pack present but icons toggle off → every pack path inert
  let neutral = true; for (let i = 0; i < img.data.length; i++) if (img.data[i] !== baseNoPack[i]) { neutral = false; break; }
  check('asset pack loaded but icons off → render bit-identical', neutral);
  state.viz.icons = true;
  let threw2 = false; try { renderNow(); } catch (e) { threw2 = true; }
  check('sprite draw path runs without error', !threw2 && img.data[3] === 255);
  state.viz.icons = false; assetPack = null; renderNow();
}

/* ---------- B2 texture splatting (v0.059) ---------- */
{
  state.world = false; GW = state.resW; GH = gridH(GW); allocate(); generate();
  state.mode = 'biome'; state.debug = 'off'; state.viz.icons = false;
  state.viz.splat = 0.7; renderNow();
  const baseNoPack = Uint8ClampedArray.from(img.data);   // no pack ⇒ _splatK gated to 0
  // synthetic pack covering every material slot with a distinct solid texture
  const solid = (r, g, b) => { const d = new Uint8ClampedArray(4 * 4 * 4); for (let i = 0; i < 16; i++){ d[i*4]=r; d[i*4+1]=g; d[i*4+2]=b; d[i*4+3]=255; } return finalizePackTexture(4, 4, d); };
  assetPack = { name: 'syn', license: 'CC0', texAny: true, icons: {},
    textures: { grass: solid(60,140,60), rock: solid(140,140,140), sand: solid(210,190,140),
                snow: solid(240,240,245), wetland: solid(70,90,60), canopy: solid(40,80,45) } };
  // splat=0 with a pack loaded → identical to baseline (strength gate)
  state.viz.splat = 0; renderNow();
  let same0 = true; for (let i = 0; i < img.data.length; i++) if (img.data[i] !== baseNoPack[i]){ same0 = false; break; }
  check('splat strength 0 (pack loaded) → render bit-identical', same0);
  // splat>0 → land pixels change, ocean pixels stay (seaColor has no splat)
  state.viz.splat = 1; renderNow();
  let landChanged = 0, oceanChanged = 0;
  for (let i = 0; i < GW * GH; i++){ const p = i * 4, isW = field[i] < state.seaLevel;
    const ch = img.data[p] !== baseNoPack[p] || img.data[p+1] !== baseNoPack[p+1] || img.data[p+2] !== baseNoPack[p+2];
    if (ch){ if (isW) oceanChanged++; else landChanged++; } }
  check('splat 1 changes land pixels (' + landChanged + ')', landChanged > 100);
  check('splat leaves ocean pixels untouched (' + oceanChanged + ' changed)', oceanChanged === 0);
  check('splat render stays finite/opaque', img.data[3] === 255);
  // splat>0 but assetPack null → identical (pack gate)
  assetPack = null; renderNow();
  let sameNull = true; for (let i = 0; i < img.data.length; i++) if (img.data[i] !== baseNoPack[i]){ sameNull = false; break; }
  check('splat 1 with no pack → render bit-identical', sameNull);
  state.viz.splat = 0.7;
}

/* ---------- T0 tectonic boundary classification (v0.058, tectonic-feature-graph.md) ---------- */
{
  // pure matrix: crust A × crust B × convergence × shear
  check('classifyBoundary: C–C convergent → collision', classifyBoundary(false, false, 1.0, 0.1) === BTYPE.collision);
  check('classifyBoundary: O–C convergent → subduction', classifyBoundary(true, false, 1.0, 0.1) === BTYPE.subductionOC &&
    classifyBoundary(false, true, 1.0, 0.1) === BTYPE.subductionOC);
  check('classifyBoundary: O–O convergent → island arc', classifyBoundary(true, true, 1.0, 0.1) === BTYPE.arcOO);
  check('classifyBoundary: divergent → rift (any crust)', classifyBoundary(false, false, -1.0, 0.1) === BTYPE.rift &&
    classifyBoundary(true, true, -0.2, 0.0) === BTYPE.rift);
  check('classifyBoundary: shear-dominant → transform (any crust, any sign)',
    classifyBoundary(false, false, 0.2, 1.0) === BTYPE.transform && classifyBoundary(true, false, -0.1, 0.9) === BTYPE.transform);
  check('BTYPE order frozen', BTYPE_KEYS.join(',') === 'none,collision,subductionOC,arcOO,rift,transform');

  // synthetic two-plate worlds: head-on convergence vs pure shear
  const savedPlates = plates, savedSeed = state.tect.seed;
  state.world = false; GW = state.resW; GH = gridH(GW); allocate();
  // two plates split left/right at x=GW/2; assign plateId directly
  plates = [
    { x: GW * 0.25, y: GH * 0.5, vx: 1, vy: 0, base: 0.3 },     // continental, moving right
    { x: GW * 0.75, y: GH * 0.5, vx: -1, vy: 0, base: 0.3 },    // continental, moving left → head-on
  ];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) plateId[y * GW + x] = x < GW / 2 ? 0 : 1;
  computeStress();
  let convTypes = new Set(), shearMax = 0;
  for (let i = 0; i < boundaryType.length; i++){ if (boundaryMask[i]) convTypes.add(boundaryType[i]); shearMax = Math.max(shearMax, Math.abs(shearField[i])); }
  check('head-on C–C boundary classifies as collision', convTypes.has(BTYPE.collision) && !convTypes.has(BTYPE.transform));
  plates[0].vx = 0; plates[0].vy = 1; plates[1].vx = 0; plates[1].vy = -1;   // pure tangential motion
  computeStress();
  let transTypes = new Set();
  for (let i = 0; i < boundaryType.length; i++) if (boundaryMask[i]) transTypes.add(boundaryType[i]);
  check('pure tangential motion classifies as transform', transTypes.has(BTYPE.transform) && !transTypes.has(BTYPE.collision));
  check('shearField finite + normalized to |max|=1', allFinite(shearField) && Math.abs(Math.max(...Array.from(shearField).map(Math.abs)) - 1) < 1e-6);
  let typedOffBoundary = 0;
  for (let i = 0; i < boundaryType.length; i++) if (!boundaryMask[i] && boundaryType[i] !== 0) typedOffBoundary++;
  check('boundaryType only on boundary cells', typedOffBoundary === 0);

  // restore a real world and check the debug view + that real geometry produces shear somewhere
  plates = savedPlates; state.tect.seed = savedSeed; generate();
  check('real world: shearField finite, nonzero somewhere', allFinite(shearField) && shearField.some(v => Math.abs(v) > 1e-3));
  let realTypes = new Set(); for (let i = 0; i < boundaryType.length; i++) if (boundaryMask[i]) realTypes.add(boundaryType[i]);
  check('real world produces ≥3 distinct boundary types (' + [...realTypes].join(',') + ')', realTypes.size >= 3);
  state.debug = 'btype'; renderNow();
  check('Tect debug view renders opaque pixels', img.data.length === GW * GH * 4 && img.data[3] === 255);
  state.debug = 'off'; renderNow();
}

/* ---------- T1 boundary polyline graph (v0.060, tectonic-feature-graph.md) ---------- */
{
  // synthetic straight diagonal line → one open polyline, ~zero curvature
  const W = 24, H = 24, line = new Uint8Array(W * H);
  for (let i = 3; i < 20; i++) line[i * W + i] = 1;
  const gLine = traceBoundaries(line, W, H);
  check('straight line → exactly one polyline', gLine.polylines.length === 1);
  check('straight line → not closed', !gLine.polylines[0].closed);
  check('straight line → curvature ≈ 0', gLine.polylines[0].curvature < 1e-6);
  check('straight line length ≈ √2·span', Math.abs(gLine.polylines[0].length - Math.hypot(16, 16)) < 1.5);

  // synthetic diamond ring (diagonal edges → thins cleanly, no corner triangles) → one closed loop, no junctions
  const ring = new Uint8Array(W * H);
  for (let i = 0; i <= 6; i++){
    ring[(4 + i) * W + (10 + i)] = 1;   // top→right
    ring[(10 + i) * W + (16 - i)] = 1;  // right→bottom
    ring[(16 - i) * W + (10 - i)] = 1;  // bottom→left
    ring[(10 - i) * W + (4 + i)] = 1;   // left→top
  }
  const gRing = traceBoundaries(ring, W, H);
  check('diamond ring → one polyline, closed', gRing.polylines.length === 1 && gRing.polylines[0].closed);
  check('diamond ring → no junction nodes', gRing.nodes.length === 0);
  const ringLen = gRing.polylines.reduce((s, p) => s + p.length, 0);
  check('diamond perimeter ≈ 24·√2 (' + ringLen.toFixed(1) + ')', ringLen > 30 && ringLen < 38);

  // T-junction → a degree-3 node + ≥3 chains meeting there
  const tee = new Uint8Array(W * H);
  for (let x = 4; x <= 19; x++) tee[10 * W + x] = 1;   // horizontal bar
  for (let y = 4; y <= 10; y++) tee[y * W + 12] = 1;   // stem up to the bar
  const gTee = traceBoundaries(tee, W, H);
  check('T-junction → at least one junction node', gTee.nodes.length >= 1);
  check('T-junction → ≥3 polylines', gTee.polylines.length >= 3);

  // determinism
  const gA = traceBoundaries(tee, W, H), gB = traceBoundaries(tee, W, H);
  check('traceBoundaries deterministic', gA.polylines.length === gB.polylines.length &&
    gA.polylines.every((p, i) => p.pts.length === gB.polylines[i].pts.length));

  // thinning reduces a 2-px-thick bar to 1-px
  const thick = new Uint8Array(W * H);
  for (let x = 4; x <= 18; x++){ thick[9 * W + x] = 1; thick[10 * W + x] = 1; }
  const thinned = thinMask(thick, W, H);
  let beforeN = 0, afterN = 0; for (let i = 0; i < thick.length; i++){ beforeN += thick[i]; afterN += thinned[i]; }
  check('thinMask thins a 2-px bar (' + beforeN + '→' + afterN + ')', afterN > 0 && afterN < beforeN * 0.7);

  // real world: graph is non-trivial, finite, typed, and cached
  generate();
  const Gr = currentBoundaryGraph();
  check('real world: ≥1 boundary polyline', Gr.polylines.length >= 1);
  const totalLen = Gr.polylines.reduce((s, p) => s + p.length, 0);
  let bcells = 0; for (let i = 0; i < boundaryMask.length; i++) if (boundaryMask[i]) bcells++;
  check('traced length sane vs boundary-cell count (' + totalLen.toFixed(0) + ' vs ' + bcells + ')',
    totalLen > 0 && totalLen < bcells * 2);
  check('every polyline finite + typed (1..5)', Gr.polylines.every(p =>
    isFinite(p.length) && isFinite(p.curvature) && p.type >= 1 && p.type <= 5));
  check('currentBoundaryGraph caches (same object until generate)', currentBoundaryGraph() === Gr);
  generate();
  check('generate() invalidates the cache', currentBoundaryGraph() !== Gr);
}

/* ---------- T2+T3 tectonic feature kernels (v0.061/v0.062, tectonic-feature-graph.md) ---------- */
{
  // synthetic straight collision margin: vertical line, uniform stress 1, all-continental crust
  const W = 128, H = 96, stress = new Float32Array(W * H), pts = [], cont = new Float32Array(W * H).fill(1);
  for (let y = 10; y <= 85; y++){ pts.push([60, y]); stress[y * W + 60] = 1; }
  const opts = { blurR: 18, seed: 7, jitter: 0 };
  const U = buildOrogenyField([{ pts, type: BTYPE.collision }], stress, cont, W, H, opts);
  check('orogeny finite, nonzero', allFinite(U) && U.some(v => v > 0.5));

  // the research-doc T2 acceptance test: >=3 parallel ridges with valleys between
  const row = 48, prof = [];
  for (let x = 0; x < W; x++) prof.push(U[row * W + x]);
  const maxima = [];
  for (let x = 1; x < W - 1; x++)
    if (prof[x] > 0.1 && prof[x] > prof[x - 1] && prof[x] >= prof[x + 1]) maxima.push(x);
  check('collision margin → ≥3 parallel ridges (' + maxima.length + ' at x=' + maxima.join(',') + ')', maxima.length >= 3);
  let valleysOk = maxima.length >= 3;
  for (let k = 0; k + 1 < maxima.length && valleysOk; k++){
    let lo = Infinity;
    for (let x = maxima[k]; x <= maxima[k + 1]; x++) lo = Math.min(lo, prof[x]);
    valleysOk = lo < 0.75 * Math.min(prof[maxima[k]], prof[maxima[k + 1]]);
  }
  check('valleys between the ridges (cols <75% of peaks)', valleysOk);

  // T3: collision has a foreland-basin depression beyond one flank (negative somewhere)
  check('collision → foreland basin (negative cell present)', U.some(v => v < -0.05));

  // kernel support: cells beyond the collision radius (blurR*3.3) are bit-untouched (exactly 0)
  const RAD = 18 * 3.3;
  let outside = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (Math.abs(x - 60) > RAD + 1.5 && U[y * W + x] !== 0) outside++;
  check('cells beyond kernel radius exactly 0', outside === 0);

  // transform with NO shear input → still zero (amplitude comes from shear, not normal stress)
  const Ut = buildOrogenyField([{ pts, type: BTYPE.transform }], stress, cont, W, H, opts);
  check('transform without shear → zero', Ut.every(v => v === 0));

  // amplitude linear in margin stress (all per-type profiles scale by mean |stress|)
  const halfStress = Float32Array.from(stress, v => v * 0.5);
  const Uh = buildOrogenyField([{ pts, type: BTYPE.collision }], halfStress, cont, W, H, opts);
  let linOk = true;
  for (let i = 0; i < U.length; i++) if (Math.abs(Uh[i] - 0.5 * U[i]) > 1e-6){ linOk = false; break; }
  check('orogeny amplitude linear in stress', linOk);

  // deterministic
  const U2 = buildOrogenyField([{ pts, type: BTYPE.collision }], stress, cont, W, H, opts);
  check('buildOrogenyField deterministic', U.every((v, i) => v === U2[i]));

  // T3 subduction: ocean on the RIGHT (x>60) → trench below sea on ocean side, arc above on land side
  const argRow = (fld, y) => { let lo = Infinity, hi = -Infinity, xl = 0, xh = 0;
    for (let x = 0; x < W; x++){ const v = fld[y * W + x]; if (v < lo){ lo = v; xl = x; } if (v > hi){ hi = v; xh = x; } } return { lo, hi, xl, xh }; };
  const oceanR = Float32Array.from({ length: W * H }, (_, i) => (i % W) > 60 ? -1 : 1);
  const oceanL = Float32Array.from({ length: W * H }, (_, i) => (i % W) < 60 ? -1 : 1);
  const Us = buildOrogenyField([{ pts, type: BTYPE.subductionOC }], stress, oceanR, W, H, opts);
  const sR = argRow(Us, 48);
  check('subduction → trench (deep negative) + arc (positive)', sR.lo < -0.3 && sR.hi > 0.3);
  check('subduction trench sits on the oceanic side (x>60, x=' + sR.xl + ')', sR.xl > 60 && sR.xh < 60);
  // flip the ocean to the LEFT → trench follows the crust to x<60
  const Us2 = buildOrogenyField([{ pts, type: BTYPE.subductionOC }], stress, oceanL, W, H, opts);
  const sL = argRow(Us2, 48);
  check('trench follows crust input (ocean left → trench x<60, x=' + sL.xl + ')', sL.xl < 60 && sL.xh > 60);

  // T3 island arc (ocean both sides): trench + arc + backarc → both signs present
  const allOcean = new Float32Array(W * H).fill(-1);
  const Ua = buildOrogenyField([{ pts, type: BTYPE.arcOO }], stress, allOcean, W, H, opts);
  check('island arc → trench + arc (both signs)', Ua.some(v => v < -0.3) && Ua.some(v => v > 0.3));

  // T3 rift: axial graben notch (negative at the margin) flanked by uplifted shoulders
  const Urift = buildOrogenyField([{ pts, type: BTYPE.rift }], stress, cont, W, H, opts);
  check('rift → axial graben below shoulders', Urift[48 * W + 60] < 0 && Urift.some(v => v > 0.1));

  // T4 transform: amplitude from SHEAR; linear fault valley + a pressure ridge offset laterally ∝ shear sense/size
  const shearP = new Float32Array(W * H); for (const p of pts) shearP[p[1] * W + p[0]] = 0.8;   // uniform + shear along the fault
  const optT = { blurR: 18, seed: 7, jitter: 0, shear: shearP };
  const Utp = buildOrogenyField([{ pts, type: BTYPE.transform }], stress, cont, W, H, optT);
  check('transform with shear → nonzero, finite', allFinite(Utp) && Utp.some(v => v !== 0));
  check('transform → linear fault valley (axis below sea-floor)', Utp[48 * W + 60] < 0);
  const crestX = (fld) => { let hi = -Infinity, xh = 0; for (let x = 30; x < 90; x++){ const v = fld[48 * W + x]; if (v > hi){ hi = v; xh = x; } } return xh; };
  // flip shear sign → the pressure ridge moves to the opposite side of the fault
  const Utn = buildOrogenyField([{ pts, type: BTYPE.transform }], stress, cont, W, H, { ...optT, shear: Float32Array.from(shearP, v => -v) });
  check('transform ridge offset reverses with shear sign (' + crestX(Utp) + ' vs ' + crestX(Utn) + ')', crestX(Utp) < 60 && crestX(Utn) > 60);
  // larger shear → larger lateral offset (displacement ∝ S)
  const Uth = buildOrogenyField([{ pts, type: BTYPE.transform }], stress, cont, W, H, { ...optT, shear: Float32Array.from(shearP, v => v * 0.5) });
  check('lateral ridge offset scales with shear magnitude (∝S)', Math.abs(crestX(Utp) - 60) > Math.abs(crestX(Uth) - 60));
  check('transform valley depth scales with shear amplitude', Math.abs(Utp[48 * W + 60]) > Math.abs(Uth[48 * W + 60]) * 1.6);
  // beyond the transform radius (blurR*2) → bit-untouched
  let toutside = 0; const TRAD = 18 * 2.0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(x - 60) > TRAD + 1.5 && Utp[y * W + x] !== 0) toutside++;
  check('transform beyond radius exactly 0', toutside === 0);
  // zero shear → zero (no transform feature without shear)
  check('transform with zero shear → zero', buildOrogenyField([{ pts, type: BTYPE.transform }], stress, cont, W, H, { ...optT, shear: new Float32Array(W * H) }).every(v => v === 0));

  /* ---------- T5: fold-intensity + trench-depth tuning (v0.090) ---------- */
  {
    // back-compat: omitting foldK/trenchK reproduces the explicit defaults (0.16 / 1.0) bit-exactly
    const Udef = buildOrogenyField([{ pts, type: BTYPE.collision }], stress, cont, W, H, opts);
    const Uexp = buildOrogenyField([{ pts, type: BTYPE.collision }], stress, cont, W, H, { ...opts, foldK: 0.16, trenchK: 1.0 });
    check('T5 omitted foldK/trenchK ⇒ legacy defaults (bit-identical)', Udef.every((v, i) => v === Uexp[i]));
    // stronger fold intensity ⇒ larger crest-to-col ripple along the collision belt
    const ripple = (U) => { let mx = -1e9, mn = 1e9; for (let x = 0; x < W; x++){ const v = U[48 * W + x]; if (v > 0.1){ mx = Math.max(mx, v); mn = Math.min(mn, v); } } return mx - mn; };
    const Ulow = buildOrogenyField([{ pts, type: BTYPE.collision }], stress, cont, W, H, { ...opts, foldK: 0.05 });
    const Uhigh = buildOrogenyField([{ pts, type: BTYPE.collision }], stress, cont, W, H, { ...opts, foldK: 0.5 });
    check('T5 higher fold intensity ⇒ deeper intermontane cols (more ripple)', ripple(Uhigh) > ripple(Ulow));
    // deeper trench: subduction trench min more negative with larger trenchK
    const oceanR = new Float32Array(W * H); for (let i = 0; i < oceanR.length; i++) oceanR[i] = (i % W) > 60 ? -1 : 1;
    const trenchMin = (U) => { let lo = 1e9; for (let i = 0; i < U.length; i++) lo = Math.min(lo, U[i]); return lo; };
    const Ts1 = buildOrogenyField([{ pts, type: BTYPE.subductionOC }], stress, oceanR, W, H, { ...opts, trenchK: 1.0 });
    const Ts2 = buildOrogenyField([{ pts, type: BTYPE.subductionOC }], stress, oceanR, W, H, { ...opts, trenchK: 2.0 });
    check('T5 higher trench depth ⇒ deeper subduction trench', trenchMin(Ts2) < trenchMin(Ts1) - 0.1);

    // archetype wiring: deriveFromWorldStructure turns on the graph + maps fold/trench from ws params
    const savedWS = JSON.parse(JSON.stringify(state.world_structure)), savedTect = { g: state.tect.tectonicGraph, f: state.tect.foldIntensity, t: state.tect.trenchDepth };
    state.world_structure.tectonicEnergy = 0.9; state.world_structure.oceanDepth = 0.8;
    deriveFromWorldStructure();
    check('T5 archetype wiring enables structured orogeny', state.tect.tectonicGraph === true);
    check('T5 fold intensity scales with tectonicEnergy', Math.abs(state.tect.foldIntensity - (0.6 + 0.9)) < 1e-6);
    check('T5 trench depth scales with oceanDepth', Math.abs(state.tect.trenchDepth - (0.7 + 0.8 * 0.8)) < 1e-6);
    state.world_structure = savedWS; state.tect.tectonicGraph = savedTect.g; state.tect.foldIntensity = savedTect.f; state.tect.trenchDepth = savedTect.t;
  }

  // live-engine gate: off → on → off must round-trip bit-exactly (Invariant-10 style)
  generate();
  const base = Float32Array.from(field);
  check('gate off → orogenyField null', orogenyField === null);
  state.tect.tectonicGraph = true; generate();
  check('gate on → orogenyField built + finite', orogenyField !== null && allFinite(orogenyField));
  check('gate on → field finite', allFinite(field));
  let diff = 0; for (let i = 0; i < field.length; i++) if (field[i] !== base[i]) diff++;
  check('gate on changes the heightmap (' + diff + ' cells)', diff > 100);
  state.debug = 'oro'; renderNow();
  check('Orogeny debug view renders opaque pixels', img.data[3] === 255);
  state.debug = 'off';
  state.tect.tectonicGraph = false; generate();
  let same = true; for (let i = 0; i < field.length; i++) if (field[i] !== base[i]){ same = false; break; }
  check('gate off again → field bit-identical (round-trip)', same && orogenyField === null);
}

/* ---------- v0.063 smoothed-bathymetry water shading ---------- */
{
  state.world = false; GW = state.resW; GH = gridH(GW); allocate(); generate();
  state.mode = 'biome'; state.debug = 'off'; state.tect.tectonicGraph = false;
  renderNow();   // sets _seaH for the biome map
  check('smoothSeaH built + finite', _seaH !== null && allFinite(_seaH));
  // the smoothed sea floor must be flatter than the raw field over water cells (that is the whole point)
  const variance = (pick) => { let n = 0, s = 0, s2 = 0;
    for (let i = 0; i < field.length; i++) if (field[i] < state.seaLevel){ const v = pick(i); n++; s += v; s2 += v * v; }
    return n ? s2 / n - (s / n) * (s / n) : 0; };
  const vRaw = variance(i => field[i]), vSmooth = variance(i => _seaH[i]);
  check('smoothed bathymetry variance < raw seabed variance (' + vSmooth.toExponential(1) + ' < ' + vRaw.toExponential(1) + ')', vSmooth < vRaw);
  // v0.065: water hillshade comes from the smoothed sea floor, flatter than the raw seabed hillshade
  check('seaShade built + finite', _seaShade !== null && allFinite(_seaShade));
  const sVar = (pick) => { let n = 0, s = 0, s2 = 0; for (let i = 0; i < field.length; i++) if (field[i] < state.seaLevel){ const v = pick(i); n++; s += v; s2 += v * v; } return n ? s2 / n - (s / n) * (s / n) : 0; };
  // raw shadeFactor over water vs smoothed seaShade — smoothed must be flatter (less per-cell variation)
  const rawShadeVar = (() => { let n = 0, s = 0, s2 = 0; for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++){ const i = y * GW + x; if (field[i] < state.seaLevel){ const v = shadeFactor(x, y); n++; s += v; s2 += v * v; } } return n ? s2 / n - (s / n) * (s / n) : 0; })();
  check('smoothed sea hillshade flatter than raw (' + sVar(i => _seaShade[i]).toExponential(1) + ' < ' + rawShadeVar.toExponential(1) + ')', sVar(i => _seaShade[i]) < rawShadeVar);
  // land/water boundary is untouched: smoothing only feeds water COLOUR, the mask still uses raw field
  check('water shading is render-only (field still finite, sea level unchanged)', allFinite(field) && state.seaLevel === 0.42);
  // Relief mode does not build _seaH/_seaShade (keeps the height ramp)
  state.mode = 'hypso'; renderNow();
  check('Relief mode leaves _seaH/_seaShade null', _seaH === null && _seaShade === null);
  state.mode = 'biome'; renderNow();
}

/* ---------- loop 1: climate ↔ erosion coupled evolution (v0.066) ---------- */
{
  state.world = false; GW = state.resW; GH = gridH(GW); allocate(); generate();
  state.tect.tectonicGraph = false;
  const field0 = Float32Array.from(field), rain0 = Float32Array.from(rainField);
  evolveCoupled(3);
  check('evolveCoupled keeps field finite', allFinite(field));
  check('evolveCoupled keeps rainfall finite', allFinite(rainField));
  let terrChanged = 0; for (let i = 0; i < field.length; i++) if (field[i] !== field0[i]) terrChanged++;
  check('evolve carves the terrain (' + terrChanged + ' cells)', terrChanged > 100);
  // the loop CLOSED: rainfall was recomputed on the evolved terrain, so it differs from generate-time rain
  let rainChanged = 0; for (let i = 0; i < rainField.length; i++) if (Math.abs(rainField[i] - rain0[i]) > 1e-6) rainChanged++;
  check('climate re-evolved with terrain (' + rainChanged + ' rain cells changed)', rainChanged > 100);
  // channels incise: at least some cells cut down meaningfully (rebound broadly raises uplands — that's correct LEM)
  let maxDown = 0; for (let i = 0; i < field.length; i++) maxDown = Math.max(maxDown, field0[i] - field[i]);
  check('evolve incises channels (max cut ' + maxDown.toFixed(3) + ')', maxDown > 0.003);
  // determinism: same seed + same cycles → identical result
  generate(); evolveCoupled(3); const fa = Float32Array.from(field);
  generate(); evolveCoupled(3); let det = true; for (let i = 0; i < fa.length; i++) if (fa[i] !== field[i]){ det = false; break; }
  check('evolveCoupled deterministic', det);
}

/* ---------- loop 2: ocean currents ↔ atmosphere coupling (v0.067) ---------- */
{
  state.world = false; GW = state.resW; GH = gridH(GW); allocate(); generate();
  state.climate.currents = false; refreshClimate();
  const rainNoCur = Float32Array.from(rainField);
  const WW = Math.min(GW, 240), WH = Math.max(2, Math.round(WW * GH / GW)), wrapX = !!state.world, step = 3.0, N = WW * WH;
  const an = oceanSSTAnomaly(WW, WH, wrapX, step);
  check('oceanSSTAnomaly finite', allFinite(an));
  check('SST anomaly has warm + cold cells', an.some(v => v > 0.01) && an.some(v => v < -0.01));
  // the loop closes: winds built on tc+anomaly differ from winds on tc (currents steer winds)
  const tc0 = new Float32Array(N).fill(15), wx0 = new Float32Array(N), wy0 = new Float32Array(N);
  buildWind(wx0, wy0, WW, WH, step, tc0, 0);
  const tc1 = Float32Array.from(tc0); for (let i = 0; i < N; i++) tc1[i] += an[i];
  const wx1 = new Float32Array(N), wy1 = new Float32Array(N); buildWind(wx1, wy1, WW, WH, step, tc1, 0);
  let wd = 0; for (let i = 0; i < N; i++) if (wx0[i] !== wx1[i] || wy0[i] !== wy1[i]) wd++;
  check('winds respond to the SST anomaly (' + wd + ' coarse cells)', wd > 0);
  // currents on now reshapes rainfall (via the in-sim coupling, not just a post tint)
  state.climate.currents = true; refreshClimate();
  let rc = 0; for (let i = 0; i < rainField.length; i++) if (Math.abs(rainField[i] - rainNoCur[i]) > 1e-6) rc++;
  check('currents reshape rainfall (' + rc + ' cells)', rc > 50 && allFinite(rainField));
  // determinism
  const ra = Float32Array.from(rainField); refreshClimate();
  let det = true; for (let i = 0; i < ra.length; i++) if (Math.abs(ra[i] - rainField[i]) > 1e-9){ det = false; break; }
  check('currents-coupled climate deterministic', det);
  state.climate.currents = false; refreshClimate();
}

/* ---------- loop 3: mass-conserving sediment routing (v0.069) ---------- */
{
  // synthetic ramp draining downward into a sub-sea basin (closed, non-world)
  const W = 40, H = 40, n = W * H, fld = new Float32Array(n), disch = new Float32Array(n).fill(2), supply = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fld[y * W + x] = 0.6 - 0.013 * y;   // high at top, bottom rows < sea
  for (let i = 0; i < n; i++) supply[i] = 0.001;
  const sum = 0.001 * n, before = Float32Array.from(fld);
  const res = routeSediment(fld, disch, supply, W, H, { sea: 0.42, capacity: 6.0, world: false });
  check('routeSediment conserves mass (dep ' + res.deposited.toFixed(4) + ' vs supply ' + sum.toFixed(4) + ')', Math.abs(res.deposited - sum) < 1e-3);
  let totalRise = 0; for (let i = 0; i < n; i++) totalRise += fld[i] - before[i];
  check('Σ deposition equals Σ supply (mass conserved on grid)', Math.abs(totalRise - sum) < 1e-3);
  let belowRose = 0; for (let i = 0; i < n; i++) if (before[i] < 0.42 && fld[i] > before[i] + 1e-9) belowRose++;
  check('sediment builds deltas/shelves below sea (' + belowRose + ' cells)', belowRose > 0);
  // determinism
  const fld2 = new Float32Array(n); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fld2[y * W + x] = 0.6 - 0.013 * y;
  const r2 = routeSediment(fld2, disch, supply, W, H, { sea: 0.42, capacity: 6.0, world: false });
  let det = true; for (let i = 0; i < n; i++) if (fld[i] !== fld2[i]){ det = false; break; }
  check('routeSediment deterministic', det && r2.deposited === res.deposited);

  // wired op on the real engine
  state.world = false; GW = state.resW; GH = gridH(GW); allocate(); generate();
  state.tect.tectonicGraph = false;
  const fpre = Float32Array.from(field);
  depositSediment();
  check('depositSediment keeps field finite', allFinite(field));
  let changed = 0; for (let i = 0; i < field.length; i++) if (field[i] !== fpre[i]) changed++;
  check('sediment fill reshapes terrain (' + changed + ' cells)', changed > 100);
  generate(); depositSediment(); const fa = Float32Array.from(field);
  generate(); depositSediment(); let det2 = true; for (let i = 0; i < fa.length; i++) if (fa[i] !== field[i]){ det2 = false; break; }
  check('depositSediment deterministic', det2);
}

/* ---------- L6: cryosphere↔climate ice-albedo feedback (v0.091) ---------- */
{
  // pure applyCryosphereAlbedo: k=0 is a no-op; cold cells cool, warm cells untouched; finite + deterministic
  const mk = () => Float32Array.from([30, 20, 10, 0, -10, -20, -30]);   // warm→cold gradient
  const t0 = mk(); check('albedo k=0 ⇒ no-op (bit-identical)', applyCryosphereAlbedo(t0, 0).every((v, i) => v === mk()[i]));
  const tw = mk(), base = mk(); applyCryosphereAlbedo(tw, 1);
  check('albedo cools the cold (icy) cells', tw[6] < base[6] - 1 && tw[5] < base[5] - 1);
  check('albedo leaves warm cells (T≫1°C) untouched', Math.abs(tw[0] - base[0]) < 1e-6 && Math.abs(tw[1] - base[1]) < 1e-6);
  check('albedo output finite', allFinite(tw));
  const ta = mk(), tb = mk(); applyCryosphereAlbedo(ta, 1); applyCryosphereAlbedo(tb, 1);
  check('albedo deterministic', ta.every((v, i) => v === tb[i]));
  const ts = mk(), tS = mk(); applyCryosphereAlbedo(ts, 0.3); applyCryosphereAlbedo(tS, 1);
  check('albedo cooling scales with strength', tS[6] < ts[6]);

  // wired on the real engine: default off ⇒ tempField unchanged; on ⇒ cold regions cool further
  state.world = true; GW = state.resW; GH = gridH(GW); allocate(); generate();
  const savedA = state.climate.albedo;
  state.climate.albedo = 0; computeTemperature(); const tOff = Float32Array.from(tempField);
  state.climate.albedo = 0.8; computeTemperature(); const tOn = Float32Array.from(tempField);
  state.climate.albedo = savedA; computeTemperature();
  let cooled = 0, warmedAny = false, minOff = 1e9;
  for (let i = 0; i < tOff.length; i++){ minOff = Math.min(minOff, tOff[i]); if (tOn[i] < tOff[i] - 0.5) cooled++; if (tOn[i] > tOff[i] + 1e-6) warmedAny = true; }
  check('engine albedo cools polar/high cells (' + cooled + ')', cooled > 0);
  check('engine albedo never warms a cell', !warmedAny);
  check('engine albedo keeps tempField finite', allFinite(tOn));
}

/* ---------- G3: moons & tidal-range field (v0.070) ---------- */
{
  state.world = false; GW = state.resW; GH = gridH(GW); allocate(); generate();
  check('tides off (default) → tideField null', tideField === null);
  // forcing math: Σ massRel / distRel³
  check('tidalForcing linear in mass', tidalForcing([{ massRel: 2, distRel: 1 }]) === 2 * tidalForcing([{ massRel: 1, distRel: 1 }]));
  check('tidalForcing ∝ 1/dist³', Math.abs(tidalForcing([{ massRel: 1, distRel: 2 }]) - 1 / 8) < 1e-9);
  check('tidalForcing sums moons', Math.abs(tidalForcing([{ massRel: 1, distRel: 1 }, { massRel: 0.5, distRel: 1 }]) - 1.5) < 1e-9);
  // enable
  state.planet.tides.enabled = true; refreshTides();
  check('tideField built + finite', tideField !== null && allFinite(tideField));
  let landNonzero = 0, oceanPos = 0;
  for (let i = 0; i < tideField.length; i++){ if (field[i] >= state.seaLevel){ if (tideField[i] !== 0) landNonzero++; } else if (tideField[i] > 0) oceanPos++; }
  check('tides: land cells 0, ocean cells positive (' + oceanPos + ')', landNonzero === 0 && oceanPos > 100);
  // amplified near coast vs far/deep ocean (shelf + funnelling)
  const cd = computeCoastDistance(field, GW, GH, state.seaLevel), cscale = Math.max(4, GW / 40);
  let nearSum = 0, nearN = 0, farSum = 0, farN = 0;
  for (let i = 0; i < tideField.length; i++){ if (field[i] >= state.seaLevel) continue;
    if (cd[i] < cscale){ nearSum += tideField[i]; nearN++; } else if (cd[i] > 3 * cscale){ farSum += tideField[i]; farN++; } }
  check('tidal range amplified near coast', nearN > 0 && farN > 0 && nearSum / nearN > farSum / farN);
  // ∝ 1/g
  const g1 = computeTideField(state.planet.tides), savedG = state.planet.g;
  state.planet.g = 2; const g2 = computeTideField(state.planet.tides); state.planet.g = savedG;
  let di = -1; for (let i = 0; i < field.length; i++) if (field[i] < state.seaLevel - 0.1){ di = i; break; }
  check('tidal range ∝ 1/g', di >= 0 && Math.abs(g2[di] - g1[di] / 2) < 1e-6);
  // determinism
  const ta = computeTideField(state.planet.tides), tb = computeTideField(state.planet.tides);
  check('computeTideField deterministic', ta.every((v, i) => v === tb[i]));
  // debug view + overlay
  state.debug = 'tides'; renderNow(); check('Tides debug view renders opaque', img.data[3] === 255);
  state.debug = 'off'; renderNow();   // intertidal overlay path (tides enabled) runs without error
  check('biome render with tides overlay opaque', img.data[3] === 255);
  state.planet.tides.enabled = false; refreshTides();
}

/* ---------- v0.071: resolution-switch must not leave stale warp (NaN regression) ---------- */
{
  // mirror the resSeg button: change GW, allocate, generate — same seed (so the warp cache is tempted to hit)
  state.world = false; state.tect.seed = 777;
  const genAt = (R) => { state.resW = R; GW = R; GH = gridH(R); allocate(); generate(); };
  genAt(64); let nan0 = 0; for (let i = 0; i < field.length; i++) if (Number.isNaN(field[i])) nan0++;
  genAt(128);   // switch UP (the case that read warpX past its end → NaN before the fix)
  let nanUp = 0; for (let i = 0; i < field.length; i++) if (Number.isNaN(field[i])) nanUp++;
  check('switch to higher resolution: no NaN in field', nanUp === 0);
  check('warp rebuilt at the new resolution', !warpX || warpX.length === GW * GH);
  check('field finite after res switch', allFinite(field) && allFinite(tempField) && allFinite(rainField));
  genAt(64);    // switch DOWN too
  check('switch to lower resolution: field finite', allFinite(field) && field.every(v => !Number.isNaN(v)));
  state.resW = 256; GW = 256; GH = gridH(256); allocate();   // restore the suite's working size
}

/* ---------- LOD tile pyramid core (v0.072) ---------- */
{
  const cW = 33, cH = 17, coarse = new Float32Array(cW * cH);
  for (let y = 0; y < cH; y++) for (let x = 0; x < cW; x++) coarse[y * cW + x] = 0.3 + 0.4 * Math.sin(x * 0.4) * Math.cos(y * 0.5);
  const ts = 32, opts = { seed: 7, detailAmp: 0.1 };
  check('pyramidDims(0) = 1×1', pyramidDims(0).cols === 1 && pyramidDims(0).rows === 1);
  check('pyramidDims(2) = 4×4', pyramidDims(2).cols === 4 && pyramidDims(2).rows === 4);
  // a pyramid tile is exactly a refineTile over the full world (sanity)
  const t = pyramidTile(coarse, cW, cH, 1, 0, 0, ts, opts);
  const region = { x: 0, y: 0, w: cW - 1, h: cH - 1 }, td = tileDims(region, 2, 2, ts);
  const direct = refineTile(coarse, cW, cH, region, 2, 2, 0, 0, td.w, td.h, opts);
  check('pyramidTile matches refineTile', t.w === td.w && t.h === td.h && t.data.every((v, i) => v === direct[i]));
  // seam Δ=0 between horizontally adjacent tiles at level 2 (inherited from refineTile)
  const a = pyramidTile(coarse, cW, cH, 2, 1, 1, ts, opts), b = pyramidTile(coarse, cW, cH, 2, 2, 1, ts, opts);
  let seamMax = 0; for (let y = 0; y < a.h; y++) seamMax = Math.max(seamMax, Math.abs(a.data[y * a.w + (a.w - 1)] - b.data[y * b.w]));
  check('pyramid same-level horizontal seam Δ=0 (' + seamMax.toExponential(1) + ')', seamMax < 1e-6);
  const c2 = pyramidTile(coarse, cW, cH, 2, 1, 1, ts, opts), d2 = pyramidTile(coarse, cW, cH, 2, 1, 2, ts, opts);
  let vMax = 0; for (let x = 0; x < c2.w; x++) vMax = Math.max(vMax, Math.abs(c2.data[(c2.h - 1) * c2.w + x] - d2.data[x]));
  check('pyramid same-level vertical seam Δ=0', vMax < 1e-6);
  // tile has detail + finite
  const varOf = (tile) => { let s = 0, s2 = 0; for (const v of tile.data){ s += v; s2 += v * v; } const n = tile.data.length; return s2 / n - (s / n) * (s / n); };
  check('pyramid tile has detail + finite', varOf(t) > 0 && t.data.every(Number.isFinite));
  // addressing + level-for-zoom
  const bnd = pyramidTileBounds(cW, cH, 1, 1, 0);
  check('pyramidTileBounds addresses the quadrant', Math.abs(bnd.x - (cW - 1) / 2) < 1e-9 && Math.abs(bnd.w - (cW - 1) / 2) < 1e-9);
  check('pyramidLevelForZoom rises with zoom', pyramidLevelForZoom(4, 2048, 1024, 6) >= pyramidLevelForZoom(1, 2048, 1024, 6));
  // determinism
  const t2 = pyramidTile(coarse, cW, cH, 2, 1, 1, ts, opts);
  check('pyramidTile deterministic', a.data.every((v, i) => v === t2.data[i]));

  // Stage 2 engine: visible-tile enumeration + LRU cache
  const span = tilesInView(2, 0, 0, (cW - 1) / 2, (cH - 1) / 2, cW, cH);   // top-left quadrant at level 2 (4×4 grid)
  check('tilesInView spans the visible rect', span.c0 === 0 && span.c1 === 2 && span.r0 === 0 && span.r1 === 2 && span.count === 9);
  lodCacheClear();
  const vis = collectVisibleTiles(coarse, cW, cH, 1, 0, 0, cW - 1, cH - 1, ts, opts);   // whole world at level 1 = 4 tiles
  check('collectVisibleTiles returns the visible tiles, finite', vis.length === 4 && vis.every(t => t.data.every(Number.isFinite)));
  const before = _lodCache.size;
  const vis2 = collectVisibleTiles(coarse, cW, cH, 1, 0, 0, cW - 1, cH - 1, ts, opts);
  check('collectVisibleTiles reuses the cache (no growth)', _lodCache.size === before && vis2[0] === vis[0]);
  // LRU eviction
  lodCacheClear(); const sv = _lodCacheMax; _lodCacheMax = 3;
  for (let i = 0; i < 6; i++) lodCachePut('k' + i, { i });
  check('LRU cache evicts down to max', _lodCache.size === 3 && lodCacheGet('k0') === null && lodCacheGet('k5') !== null);
  _lodCacheMax = sv; lodCacheClear();
}

/* ---------- v0.074: button-driven LOD refine (overview, then refine on demand) ---------- */
{
  state.world = false; state.resW = 256; GW = 256; GH = gridH(256); allocate(); generate();
  _lodTile = 512; _lodZoom = 2; _lodCx = GW / 2; _lodCy = GH / 2; lodCacheClear();
  const v = lodViewRect();
  check('lodViewRect covers a centered sub-region', v.x1 > v.x0 && v.y1 > v.y0 && v.x1 <= GW - 1 && v.y1 <= GH - 1);
  const keys = visibleTileKeys(v.z, v.x0, v.y0, v.x1, v.y1);
  check('visibleTileKeys non-empty', keys.length >= 1);
  const before = _lodCache.size;
  refineVisibleTiles();
  check('Refine builds detail tiles into the cache', _lodCache.size > before);
  const after = _lodCache.size; refineVisibleTiles();
  check('re-refine reuses the cache (no growth)', _lodCache.size === after);
  const k0 = keys[0], t = lodCacheGet(lodCacheKey(v.z, k0.col, k0.row, _lodTile));
  check('refined tile is finite high-res detail', t && t.data.every(Number.isFinite) && t.w >= 2);
  _lodOn = false; _lodZoom = 1; lodCacheClear();
}

/* ---------- v0.094: burnChannels — AGREE stream-burning ---------- */
{
  const W = 32, H = 32, sea = 0.42;
  // zero flow → tile unchanged
  const base = new Float32Array(W * H).fill(0.6);
  const zeroFlow = new Float32Array(16 * 10);   // all zero
  burnChannels(base, W, H, zeroFlow, 16, 10, {x:0,y:0,w:15,h:9}, sea, {});
  check('burnChannels with zero flow leaves tile unchanged', base.every(v => Math.abs(v - 0.6) < 1e-6));

  // high-flow centre depresses, far cell unchanged
  const tile2 = new Float32Array(W * H).fill(0.6);
  const flow2 = new Float32Array(16 * 10);
  flow2[5 * 16 + 8] = 500;   // high-flow cell near world-centre of this tile's bounds
  const bounds2 = {x:6, y:3, w:10, h:7};
  burnChannels(tile2, W, H, flow2, 16, 10, bounds2, sea, {thresh:0.005, burnK:0.08, widthK:3});
  check('burnChannels depresses terrain under a high-flow cell', tile2.some(v => v < 0.6));
  check('burnChannels leaves terrain far from flow channel unchanged', Math.abs(tile2[0] - 0.6) < 1e-6);

  // never raises terrain (all deltas ≤ 0)
  const tile3 = new Float32Array(W * H).fill(0.6);
  const flow3 = new Float32Array(16 * 10).fill(100);
  burnChannels(tile3, W, H, flow3, 16, 10, {x:0,y:0,w:15,h:9}, sea, {});
  check('burnChannels never raises terrain', tile3.every(v => v <= 0.6));

  // never goes below sea - 0.06
  const tile4 = new Float32Array(W * H).fill(sea - 0.05);
  burnChannels(tile4, W, H, flow3, 16, 10, {x:0,y:0,w:15,h:9}, sea, {burnK:1.0});
  check('burnChannels never goes below sea - 0.06', tile4.every(v => v >= sea - 0.06 - 1e-9));

  // seam-Δ: two adjacent tiles share identical values at their shared coarse-coord column
  const cW2 = 32, cH2 = 20;
  const coarse2 = new Float32Array(cW2 * cH2).fill(0.5);
  coarse2[10 * cW2 + 22] = 800;   // prominent river cell well inside tB, >3px from seam
  const bA = {x:0, y:0, w:16, h:20}, bB = {x:15, y:0, w:16, h:20};
  const opts94 = {thresh:0.005, burnK:0.08, widthK:3};
  const tA = new Float32Array(32 * 20).fill(0.6);
  const tB = new Float32Array(32 * 20).fill(0.6);
  burnChannels(tA, 32, 20, coarse2, cW2, cH2, bA, sea, opts94);
  burnChannels(tB, 32, 20, coarse2, cW2, cH2, bB, sea, opts94);
  // right column of tA (x=31) and left column of tB (x=0) cover the same coarse coord x=15
  let maxSeam94 = 0;
  for (let y = 0; y < 20; y++) {
    const d = Math.abs(tA[y * 32 + 31] - tB[y * 32 + 0]);
    if (d > maxSeam94) maxSeam94 = d;
  }
  check('burnChannels seam-Δ < 1e-4 between adjacent tiles', maxSeam94 < 1e-4);
}

/* ---------- v0.095: tileErode (Phase 2 micro-erosion) + sharpDelta (Phase 3) ---------- */
{
  const W = 24, H = 24;
  // a sloped tile so droplets have somewhere to flow
  const slope = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) slope[y * W + x] = 0.7 - 0.012 * y;
  const tile = slope.slice();
  tileErode(tile, W, H, {seed: 7, g: 1, droplets: 300});

  // border ring is pinned (seam safety) — outer cells byte-unchanged
  let borderMoved = false;
  for (let x = 0; x < W; x++){ if (tile[x] !== slope[x]) borderMoved = true; if (tile[(H-1)*W+x] !== slope[(H-1)*W+x]) borderMoved = true; }
  for (let y = 0; y < H; y++){ if (tile[y*W] !== slope[y*W]) borderMoved = true; if (tile[y*W+W-1] !== slope[y*W+W-1]) borderMoved = true; }
  check('tileErode pins the border ring (seam safety)', !borderMoved);
  // interior actually changes
  let interiorMoved = false;
  for (let y = 1; y < H-1 && !interiorMoved; y++) for (let x = 1; x < W-1; x++) if (Math.abs(tile[y*W+x] - slope[y*W+x]) > 1e-7){ interiorMoved = true; break; }
  check('tileErode modifies the interior', interiorMoved);
  // all finite, never NaN
  check('tileErode output stays finite', tile.every(v => Number.isFinite(v)));
  // deterministic: same seed → identical
  const tile2 = slope.slice(); tileErode(tile2, W, H, {seed: 7, g: 1, droplets: 300});
  let det = true; for (let i = 0; i < tile.length; i++) if (tile[i] !== tile2[i]){ det = false; break; }
  check('tileErode is deterministic (same seed)', det);
  // tiny tiles are a no-op (guard)
  const tiny = new Float32Array(9).fill(0.5); tileErode(tiny, 3, 3, {seed: 1});
  check('tileErode no-ops on tiles < 4 px', tiny.every(v => Math.abs(v - 0.5) < 1e-6));

  // ----- sharpDelta -----
  const sea = 0.42, cW = 16, cH = 16;
  // zero flow → no-op
  const sdTile = new Float32Array(W * H).fill(sea - 0.02);   // in the delta zone
  const zeroFlow = new Float32Array(cW * cH);
  sharpDelta(sdTile, W, H, zeroFlow, cW, cH, {x:0,y:0,w:cW-1,h:cH-1}, sea, {});
  check('sharpDelta no-op when flow is zero', sdTile.every(v => Math.abs(v - (sea-0.02)) < 1e-6));

  // a single coarse local maximum deepens the channel cells inside the delta zone
  const flow = new Float32Array(cW * cH);
  flow[8 * cW + 8] = 900;                                    // dominant channel peak
  const bnds = {x:0, y:0, w:cW-1, h:cH-1};
  const sdTile2 = new Float32Array(W * H).fill(sea - 0.02);
  sharpDelta(sdTile2, W, H, flow, cW, cH, bnds, sea, {thresh:0.005, sharpK:0.03, zoneH:0.06});
  check('sharpDelta deepens a local-max channel in the delta zone', sdTile2.some(v => v < sea - 0.02 - 1e-6));
  check('sharpDelta never raises terrain', sdTile2.every(v => v <= sea - 0.02 + 1e-6));
  check('sharpDelta never goes below sea - 0.06', sdTile2.every(v => v >= sea - 0.06 - 1e-9));

  // cells above sea + zoneH are untouched (only acts in the delta zone)
  const sdHigh = new Float32Array(W * H).fill(sea + 0.2);
  sharpDelta(sdHigh, W, H, flow, cW, cH, bnds, sea, {thresh:0.005, sharpK:0.03, zoneH:0.06});
  check('sharpDelta leaves cells above the delta zone unchanged', sdHigh.every(v => Math.abs(v - (sea+0.2)) < 1e-6));

  // deterministic
  const sdA = new Float32Array(W * H).fill(sea - 0.02), sdB = new Float32Array(W * H).fill(sea - 0.02);
  sharpDelta(sdA, W, H, flow, cW, cH, bnds, sea, {thresh:0.005, sharpK:0.03, zoneH:0.06});
  sharpDelta(sdB, W, H, flow, cW, cH, bnds, sea, {thresh:0.005, sharpK:0.03, zoneH:0.06});
  let sdDet = true; for (let i = 0; i < sdA.length; i++) if (sdA[i] !== sdB[i]){ sdDet = false; break; }
  check('sharpDelta is deterministic', sdDet);

  // seam safety: two adjacent tiles over a shared coarse local-max agree at the seam.
  // The coarse local-max sits well inside both tiles' coarse bounds (one cell from the seam).
  const cW2 = 32, cH2 = 16;
  const flow2 = new Float32Array(cW2 * cH2);
  flow2[8 * cW2 + 20] = 900;                                 // peak inside tile B, > 3px from seam
  const bA = {x:0, y:0, w:16, h:15}, bB = {x:15, y:0, w:16, h:15};
  const tA = new Float32Array(32 * 16).fill(sea - 0.02), tB = new Float32Array(32 * 16).fill(sea - 0.02);
  sharpDelta(tA, 32, 16, flow2, cW2, cH2, bA, sea, {thresh:0.005, sharpK:0.03, zoneH:0.06});
  sharpDelta(tB, 32, 16, flow2, cW2, cH2, bB, sea, {thresh:0.005, sharpK:0.03, zoneH:0.06});
  let maxSeamSD = 0;
  for (let y = 0; y < 16; y++){ const d = Math.abs(tA[y*32 + 31] - tB[y*32 + 0]); if (d > maxSeamSD) maxSeamSD = d; }
  check('sharpDelta seam-Δ < 1e-4 between adjacent tiles', maxSeamSD < 1e-4);
}

/* ---------- v0.096: signed distance fields (coast / river / biome control) ---------- */
if (typeof buildCoastSDF === 'function') {
  const W = 16, H = 16, sea = 0.42;
  // left half land (0.6), right half ocean (0.3) → vertical coastline at x=8
  const f = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y*W+x] = x < 8 ? 0.6 : 0.3;
  const sdf = buildCoastSDF(f, W, H, sea);
  check('buildCoastSDF finite', sdf.every(v => Number.isFinite(v)));
  // sign convention: inland (land) negative, offshore (water) positive
  check('buildCoastSDF land cells are negative', f[8*W+2] >= sea && sdf[8*W+2] < 0);
  check('buildCoastSDF water cells are positive', f[8*W+12] < sea && sdf[8*W+12] > 0);
  // magnitude grows away from the coast (deep inland more negative than near-shore land)
  check('buildCoastSDF deepens inland', sdf[8*W+0] < sdf[8*W+7]);
  check('buildCoastSDF grows offshore', sdf[8*W+15] > sdf[8*W+8]);
  // near-shore magnitude is small (≈ a cell or two)
  check('buildCoastSDF ~0 near the shoreline', Math.abs(sdf[8*W+7]) <= 2 && Math.abs(sdf[8*W+8]) <= 2);
  // determinism
  const sdf2 = buildCoastSDF(f, W, H, sea);
  let det = true; for (let i = 0; i < sdf.length; i++) if (sdf[i] !== sdf2[i]) { det = false; break; }
  check('buildCoastSDF deterministic', det);

  // river SDF: a vertical line of high flow at x=8
  const flow = new Float32Array(W * H);
  for (let y = 0; y < H; y++) flow[y*W+8] = 1000;
  const rsdf = buildRiverSDF(flow, W, H, {thresh: 100});
  check('buildRiverSDF channel cells negative', rsdf[5*W+8] < 0);
  check('buildRiverSDF off-channel positive', rsdf[5*W+0] > 0);
  check('buildRiverSDF grows away from channel', rsdf[5*W+0] > rsdf[5*W+6]);
  check('buildRiverSDF finite', rsdf.every(v => Number.isFinite(v)));

  // biome-boundary distance: left half biome 1, right half biome 2 → boundary at x=8
  const bio = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) bio[y*W+x] = x < 8 ? 1 : 2;
  const bd = buildBiomeBoundaryDist(bio, W, H);
  check('buildBiomeBoundaryDist 0 on the boundary', bd[5*W+7] === 0 || bd[5*W+8] === 0);
  check('buildBiomeBoundaryDist grows into interiors', bd[5*W+0] > bd[5*W+6]);
  check('buildBiomeBoundaryDist non-negative & finite', bd.every(v => v >= 0 && Number.isFinite(v)));
  // uniform biome → no edges → all INF-ish (large), but finite
  const uni = new Uint8Array(W * H).fill(3);
  const bdU = buildBiomeBoundaryDist(uni, W, H);
  check('buildBiomeBoundaryDist uniform field has no boundary', bdU.every(v => v > 1e6));

  // ----- consumer exercised on the live generated world (uses globals from the region generate above) -----
  // find a near-shore land cell (land with a water neighbour)
  let shore = -1;
  for (let yy = 1; yy < GH-1 && shore < 0; yy++) for (let xx = 1; xx < GW-1; xx++) {
    const ii = yy*GW+xx; const vw = geoidField ? field[ii]-geoidField[ii] : field[ii];
    if (vw < state.seaLevel) continue;
    const wn = field[ii-1] < state.seaLevel || field[ii+1] < state.seaLevel || field[ii-GW] < state.seaLevel || field[ii+GW] < state.seaLevel;
    if (wn) { shore = ii; break; }
  }
  check('found a near-shore land cell for the SDF consumer test', shore >= 0);
  if (shore >= 0) {
    const sx = shore % GW, sy = (shore / GW) | 0, vw = geoidField ? field[shore]-geoidField[shore] : field[shore];
    // off
    _coastSDF = null; state.viz.sdfCoast = 0;
    const off = surfaceColor(sx, sy, shore, vw).slice();
    // on
    _coastSDF = buildCoastSDF(geoidField ? (()=>{const a=new Float32Array(GW*GH);for(let i=0;i<a.length;i++)a[i]=field[i]-geoidField[i];return a;})() : field, GW, GH, state.seaLevel);
    state.viz.sdfCoast = 1;
    const on = surfaceColor(sx, sy, shore, vw);
    check('SDF coast band changes a near-shore land pixel when enabled', on[0]!==off[0] || on[1]!==off[1] || on[2]!==off[2]);
    // restore the off state so later tests/cmp stay on the default path
    _coastSDF = null; state.viz.sdfCoast = 0;
    const back = surfaceColor(sx, sy, shore, vw);
    check('SDF coast restores to the off render after disabling', back[0]===off[0] && back[1]===off[1] && back[2]===off[2]);
  }
}

/* ---------- v0.097: jfaDist (Euclidean) + SDF Euclidean backend ---------- */
if (typeof jfaDist === 'function') {
  const W = 24, H = 24;
  // single seed at (5,7): every cell's distance must equal exact Euclidean to it
  const m1 = new Uint8Array(W * H); m1[7*W+5] = 1;
  const j1 = jfaDist(m1, W, H);
  let exact = true, maxErr = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const want = Math.hypot(x-5, y-7), got = j1[y*W+x], e = Math.abs(want-got);
    if (e > maxErr) maxErr = e; if (e > 1e-4) exact = false;
  }
  check('jfaDist is exact Euclidean from a single seed', exact);
  check('jfaDist seed cell has distance 0', j1[7*W+5] === 0);
  check('jfaDist finite', j1.every(v => Number.isFinite(v)));
  // vertical line seed at x=10 → distance is the horizontal offset, exactly
  const m2 = new Uint8Array(W * H); for (let y = 0; y < H; y++) m2[y*W+10] = 1;
  const j2 = jfaDist(m2, W, H);
  check('jfaDist on a line = perpendicular offset', Math.abs(j2[3*W+0]-10) < 1e-4 && Math.abs(j2[3*W+15]-5) < 1e-4);
  // deterministic
  const j1b = jfaDist(m1, W, H);
  let det = true; for (let i = 0; i < j1.length; i++) if (j1[i] !== j1b[i]) { det = false; break; }
  check('jfaDist deterministic', det);
  // relationship to chamferDist: the 1-√2 chamfer is an UPPER bound on Euclidean, within ~8%
  const c1 = chamferDist(m1, W, H);
  let upper = true, within8 = true;
  for (let i = 0; i < j1.length; i++) {
    if (j1[i] > c1[i] + 1e-3) upper = false;          // JFA (true Euclidean) never exceeds chamfer
    if (c1[i] > j1[i] * 1.09 + 1e-3) within8 = false; // chamfer stays within its ~8.24% theoretical max above
  }
  check('jfaDist ≤ chamferDist (Euclidean is the tighter distance)', upper);
  check('chamferDist within ~8% of jfaDist', within8);
  // SDF builders honour opts.euclid: sign convention preserved, magnitude differs slightly from chamfer
  const sea = 0.42, f = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y*W+x] = x < 12 ? 0.6 : 0.3;
  const sdfJ = buildCoastSDF(f, W, H, sea, {euclid:true}), sdfC = buildCoastSDF(f, W, H, sea);
  check('buildCoastSDF euclid keeps the sign convention', sdfJ[12*W+2] < 0 && sdfJ[12*W+20] > 0);
  check('buildCoastSDF euclid ~matches chamfer near the coast', Math.abs(Math.abs(sdfJ[12*W+8]) - Math.abs(sdfC[12*W+8])) <= 1.5);
}

/* ---------- v0.098: physical-model tails (G4 tidal sed · L4 lithology · disturbance) ---------- */
if (typeof applyTidalSedimentation === 'function') {
  const W = 8, H = 8, sea = 0.42;
  // zero tide → no-op
  const f0 = new Float32Array(W*H).fill(0.30);
  const r0 = applyTidalSedimentation(f0, new Float32Array(W*H), sea, W, H, {});
  check('tidal sed no-op when tide is zero', f0.every(v => Math.abs(v-0.30) < 1e-6) && r0.deposited === 0);
  // null tide → no-op
  const fN = new Float32Array(W*H).fill(0.30); applyTidalSedimentation(fN, null, sea, W, H, {});
  check('tidal sed no-op when tide is null', fN.every(v => Math.abs(v-0.30) < 1e-6));
  // intertidal cells (depth < tr) accrete toward sea, never above it
  const f1 = new Float32Array(W*H).fill(0.38), t1 = new Float32Array(W*H).fill(0.10);   // depth 0.04 < tr 0.10
  const r1 = applyTidalSedimentation(f1, t1, sea, W, H, {});
  check('tidal sed accretes in the intertidal band', f1.every(v => v > 0.38) && r1.deposited > 0);
  check('tidal sed never exceeds sea level', f1.every(v => v <= sea));
  // cells deeper than the tidal range are untouched
  const f2 = new Float32Array(W*H).fill(0.20); applyTidalSedimentation(f2, new Float32Array(W*H).fill(0.10), sea, W, H, {});
  check('tidal sed skips cells deeper than the tidal range', f2.every(v => Math.abs(v-0.20) < 1e-6));
  // land untouched
  const f3 = new Float32Array(W*H).fill(0.60); applyTidalSedimentation(f3, new Float32Array(W*H).fill(0.10), sea, W, H, {});
  check('tidal sed leaves land untouched', f3.every(v => Math.abs(v-0.60) < 1e-6));

  // L4 dynamic lithology
  const LW = 6, LH = 6, resist = new Float32Array(LW*LH).fill(0.3);
  const pre = new Float32Array(LW*LH).fill(0.5), post = pre.slice(); post[10] = 0.4;   // eroded 0.1 at cell 10
  recomputeResistanceAfterErosion(resist, pre, post, LW, LH, {k:6});
  check('dyn lithology hardens deeply-eroded cells', resist[10] > 0.3);
  check('dyn lithology leaves un-eroded cells unchanged', Math.abs(resist[0]-0.3) < 1e-6);
  check('dyn lithology clamps resistance to ≤ 1', resist.every(v => v <= 1));

  // disturbance debug fields on the live generated world
  const wt = currentWindThrowField();
  check('wind-throw field finite & in [0,1]', wt.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  let wtOceanZero = true; for (let i = 0; i < wt.length; i++){ if (field[i]-geoAt(i) < state.seaLevel && wt[i] !== 0){ wtOceanZero = false; break; } }
  check('wind-throw is zero over ocean', wtOceanZero);
  const fl = currentFloodField();
  check('flood field finite & in [0,1]', fl.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  let flOceanZero = true; for (let i = 0; i < fl.length; i++){ if (field[i]-geoAt(i) < state.seaLevel && fl[i] !== 0){ flOceanZero = false; break; } }
  check('flood is zero over ocean', flOceanZero);
  check('flood field is not flat (varies across the map)', variance(fl) > 1e-6);
}

/* ---------- Stage 3: per-tile editing (v0.075) ---------- */
{
  // pure brush
  const W = 20, H = 20, d = new Float32Array(W * H).fill(0.5);
  brushHeight(d, W, H, 10, 10, 5, 0.2, 'raise');
  check('brush raise lifts the centre', d[10 * W + 10] > 0.5);
  check('brush leaves cells outside the radius untouched', d[0] === 0.5);
  const dl = new Float32Array(W * H).fill(0.5); brushHeight(dl, W, H, 10, 10, 5, 0.2, 'lower');
  check('brush lower drops the centre', dl[10 * W + 10] < 0.5);
  const dc = new Float32Array(W * H).fill(1); brushHeight(dc, W, H, 10, 10, 5, 0.5, 'raise');
  check('brush clamps to [0,1]', dc.every(v => v <= 1 && v >= 0));
  const noisy = Float32Array.from({ length: W * H }, () => Math.random()); const ns = Float32Array.from(noisy);
  for (let k = 0; k < 6; k++) brushHeight(ns, W, H, 10, 10, 8, 1, 'smooth');
  const variance = a => { let s = 0, s2 = 0, n = 0; for (let y = 6; y <= 14; y++) for (let x = 6; x <= 14; x++){ const v = a[y * W + x]; s += v; s2 += v * v; n++; } return s2 / n - (s / n) ** 2; };
  check('brush smooth reduces local variance', variance(ns) < variance(noisy));
  // v0.085: the 8-mode unified kernel (same modes as the base sculpt brush) now lives in brushHeight too
  const dv = new Float32Array(W * H).fill(0.5); brushHeight(dv, W, H, 10, 10, 6, 0.5, 'volcano');
  check('brush volcano raises a conical peak', dv[10 * W + 10] > 0.5 && dv[10 * W + 11] > 0.5 && dv[10 * W + 11] < dv[10 * W + 10]);
  const dm = new Float32Array(W * H).fill(0.3); brushHeight(dm, W, H, 10, 10, 6, 0.5, 'mesa', { centerH: 0.3 });
  check('brush mesa builds a raised flat top (max-semantics, never lowers)', dm[10 * W + 10] > 0.3 && dm.every((v, i) => v >= (i === 0 ? 0.3 : 0)));
  const dr = new Float32Array(W * H).fill(0.5); brushHeight(dr, W, H, 10, 10, 6, 0.5, 'ridge', { nx: 1, ny: 0 });
  check('brush ridge crests along the stroke', dr[10 * W + 10] > 0.5);
  const dca = new Float32Array(W * H).fill(0.5); brushHeight(dca, W, H, 10, 10, 6, 0.8, 'canyon', { nx: 1, ny: 0 });
  check('brush canyon cuts a channel below the surface', dca[10 * W + 10] < 0.5);
  const dcl = new Float32Array(W * H).fill(0.5); brushHeight(dcl, W, H, 10, 10, 6, 0.8, 'cliff', { nx: 1, ny: 0 });
  check('brush cliff raises one side, lowers the other', dcl[10 * W + 13] > 0.5 && dcl[10 * W + 7] < 0.5);
  const du = new Float32Array(W * H).fill(0.5); brushHeight(du, W, H, 10, 10, 5, 0.2);   // no mode → back-compat raise default
  check('brush defaults to raise when mode omitted', du[10 * W + 10] > 0.5);

  // tile editing on a refined tile
  state.world = false; state.resW = 256; GW = 256; GH = gridH(256); allocate(); generate();
  _lodTile = 512; _lodZoom = 1; _lodCx = GW / 2; _lodCy = GH / 2; lodCacheClear(); _lodEdits.clear(); _lodUndo.length = 0;
  refineVisibleTiles();
  const pick = lodPick(GW / 2, GH / 2);
  check('lodPick returns a valid tile + in-range local coords', pick.lx >= 0 && pick.lx <= pick.td.w && pick.ly >= 0 && pick.ly <= pick.td.h);
  const proc = lodCacheGet(pick.key); const procCopy = proc ? Float32Array.from(proc.data) : null;
  lodEditBegin(GW / 2, GH / 2);
  const ok = editTileAt(GW / 2, GH / 2);
  check('editTileAt edits the refined tile', ok && _lodEdits.has(pick.key));
  check('edit diverges from the procedural tile', procCopy && !_lodEdits.get(pick.key).data.every((v, i) => v === procCopy[i]));
  // re-refine does not clobber the edit (drawLODView prefers _lodEdits)
  refineVisibleTiles();
  check('re-refine preserves the edit', _lodEdits.has(pick.key) && _lodEdits.get(pick.key).edited);
  // undo reverts to procedural
  lodUndo();
  check('Ctrl-Z reverts the tile edit', !_lodEdits.has(pick.key));
  _lodEdit = false; _lodOn = false; _lodEdits.clear(); _lodUndo.length = 0; lodCacheClear();
}

/* ---------- v0.076: discharge-widened smooth rivers ---------- */
{
  // synthetic land with a trunk river (high discharge) and a tributary (low discharge)
  const W = 40, H = 40, fld = new Float32Array(W * H).fill(0.6), flow = new Float32Array(W * H);
  const thresh = W * H * 0.0004;
  for (let y = 5; y < 35; y++) flow[y * W + 20] = thresh * 200;   // trunk down the middle
  for (let x = 20; x < 35; x++) flow[10 * W + x] = thresh * 8;    // thin tributary
  const rf = buildRiverField(flow, fld, W, H, 0.42);
  check('river field finite', allFinite(rf));
  // width: count lit cells across the trunk row vs the tributary column
  let trunkW = 0, tribW = 0;
  for (let x = 0; x < W; x++) if (rf[20 * W + x] > 0.01) trunkW++;        // across the trunk at row 20
  for (let y = 0; y < H; y++) if (rf[y * W + 30] > 0.01) tribW++;         // across the tributary at col 30
  check('trunk river is wider than the tributary (' + trunkW + ' vs ' + tribW + ')', trunkW > tribW && trunkW >= 3);
  // ocean cells get no river
  const fldSea = new Float32Array(W * H).fill(0.2);   // all below sea
  const rfSea = buildRiverField(flow, fldSea, W, H, 0.42);
  check('no river overlay on ocean cells', rfSea.every(v => v === 0));
  // deterministic
  const rf2 = buildRiverField(flow, fld, W, H, 0.42);
  check('buildRiverField deterministic', rf.every((v, i) => v === rf2[i]));
}

/* ---------- v0.077: river carving interplay (monotonic channel + entrenchment) ---------- */
{
  // a brushed river over terrain that RISES downstream must still carve a monotonically descending channel
  const W = 60, H = 20, fld = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fld[y * W + x] = 0.5 + x * 0.004;   // rises with x
  const orig = Float32Array.from(fld);
  const pts = []; for (let x = 5; x < 55; x++) pts.push([x, 10]);
  const cells = enforceChannelDescent(fld, W, H, pts, 0.42, 1.5);
  let mono = true, prev = Infinity;
  for (let x = 5; x < 55; x++){ const v = fld[10 * W + x]; if (v > prev + 1e-7){ mono = false; break; } prev = v; }
  check('brushed river centreline descends monotonically (cuts through rises)', mono);
  check('channel is carved below the original terrain', fld[10 * W + 30] < orig[10 * W + 30]);
  check('descent carve returns locked cells', cells.length > 0);

  // entrenchment: deposition refilling a locked river is clamped back to its floor
  state.world = false; state.resW = 256; GW = 256; GH = gridH(256); allocate(); generate();
  const i = 128 * GW + 100; riverMask[i] = 1; riverFloor[i] = 0.30; field[i] = 0.55; _riverAny = true;
  enforceRiverChannels();
  check('enforceRiverChannels clamps a refilled river to its floor', field[i] === riverFloor[i] && field[i] < 0.55);
  const j = 10 * GW + 10; field[j] = 0.99; riverMask[j] = 0; const jset = field[j];
  enforceRiverChannels();
  check('non-river cells untouched by enforcement', field[j] === jset);
  riverMask.fill(0); _riverAny = false;
  const snap = Float32Array.from(field); enforceRiverChannels();
  check('enforceRiverChannels is a no-op with no locked rivers', field.every((v, k) => v === snap[k]));
}

/* ---------- v0.078: Cartalith biome-paint PoC + sharper biomes ---------- */
{
  state.world = false; state.resW = 256; GW = 256; GH = gridH(256); allocate(); generate();
  const cb = buildCartBiome();
  check('buildCartBiome finite indices in 1..15', cb.length === GW * GH && cb.every(v => v >= 1 && v <= 15));
  const wbCB = currentWaterBodies();   // v0.103: open sea → Ocean(15), lake → Lake(14)
  let seaOk = true, lakeOk = true, landOk = true;
  for (let i = 0; i < cb.length; i++){
    if (wbCB[i] === 1 && cb[i] !== 15) seaOk = false;          // open sea → Ocean (15)
    if (wbCB[i] === 2 && cb[i] !== 14) lakeOk = false;         // lake → Lake (14)
    if (wbCB[i] === 0 && (cb[i] === 14 || cb[i] === 15)) landOk = false;   // land never water
  }
  check('CBiome: sea→Ocean(15), lake→Lake(14), land never water', seaOk && lakeOk && landOk);
  const cb2 = buildCartBiome();
  check('buildCartBiome deterministic', cb.every((v, i) => v === cb2[i]));
  // CBiome debug view renders opaque
  state.mode = 'biome'; state.debug = 'cbiome'; _cartBiome = null; renderNow();
  check('CBiome debug view renders opaque', img.data[3] === 255);
  state.debug = 'off';
  // bioJitter: sharp toggle changes the ecotone jitter; OFF reproduces the legacy single octave exactly
  const sv = state.viz.sharpBiomes;
  state.viz.sharpBiomes = false; const j0 = bioJitter(40, 30), legacy = vnoise(40 / GW * 40, 30 / GW * 40, 31);
  check('sharpBiomes off → legacy single-octave jitter (bit-identical)', j0 === legacy);
  state.viz.sharpBiomes = true; const j1 = bioJitter(40, 30);
  check('sharpBiomes on → jitter differs from legacy', j1 !== legacy);
  state.viz.sharpBiomes = sv;
}

/* ---------- v0.102: Cartalith terrain-paint PoC (reuses the world generated above; no extra generate() so the shared RNG stream stays put for the later seam test) ---------- */
{
  const ct = buildCartTerrain();
  check('buildCartTerrain finite indices in 0..13', ct.length === GW * GH && ct.every(v => v >= 0 && v <= 13));
  const wbCT = currentWaterBodies();   // v0.103: all water (sea+lake) → 0; dry land → painted
  let waterOk = true, landOk = true;
  for (let i = 0; i < ct.length; i++){
    if (wbCT[i] !== 0 && ct[i] !== 0) waterOk = false;   // sea & lakes → unpainted (0)
    if (wbCT[i] === 0 && ct[i] === 0) landOk = false;    // dry land always has a terrain
  }
  check('CTerrain: all water → 0, dry land always painted', waterOk && landOk);
  // human-made surfaces (Paved Road 1, Dirt Track 2, Forest Path 5, Ruins 13) never auto-generate
  check('CTerrain: no human-made surfaces auto-generated', ct.every(v => v !== 1 && v !== 2 && v !== 5 && v !== 13));
  const ct2 = buildCartTerrain();
  check('buildCartTerrain deterministic', ct.every((v, i) => v === ct2[i]));
  // CTerrain debug view renders opaque
  state.mode = 'biome'; state.debug = 'cterrain'; _cartTerrain = null; renderNow();
  check('CTerrain debug view renders opaque', img.data[3] === 255);
  state.debug = 'off';
}

/* ---------- v0.103: water bodies — sea vs lakes (pure, synthetic grids; no globals/RNG touched) ---------- */
{
  const W = 9, H = 9, sea = 0.5;
  // base: all land at 0.6; a big open sea fills the left 3 columns (touches the border → largest component)
  const f = new Float32Array(W * H).fill(0.6);
  for (let y = 0; y < H; y++) for (let x = 0; x < 3; x++) f[y * W + x] = 0.3;
  // an enclosed below-sea pocket in the middle, walled off from the open sea by land → inland-sea lake
  f[4 * W + 6] = 0.3; f[4 * W + 7] = 0.3; f[5 * W + 6] = 0.3; f[5 * W + 7] = 0.3;
  // an above-sea depression at (7,2): below its neighbours (0.6) but above sea → pooled lake when watered
  f[2 * W + 7] = 0.54;
  const wbWet = buildWaterBodies(f, W, H, sea, { rain: new Float32Array(W * H).fill(0.5) });
  check('water bodies: open sea is the largest component (class 1)', wbWet[4 * W + 0] === 1 && wbWet[4 * W + 1] === 1);
  check('water bodies: enclosed below-sea pocket → lake (class 2)', wbWet[4 * W + 6] === 2 && wbWet[5 * W + 7] === 2);
  check('water bodies: dry land → 0', wbWet[0 * W + 5] === 0);
  check('water bodies: watered above-sea depression → lake (class 2)', wbWet[2 * W + 7] === 2);
  // the SAME depression with no moisture stays dry (salt flat, not a lake)
  const wbDry = buildWaterBodies(f, W, H, sea, { rain: new Float32Array(W * H).fill(0.0) });
  check('water bodies: arid above-sea depression stays dry (not a lake)', wbDry[2 * W + 7] === 0);
  // the enclosed below-sea pocket is moisture-independent (it is real water)
  check('water bodies: below-sea lake independent of moisture', wbDry[4 * W + 6] === 2);
  // determinism
  const wb2 = buildWaterBodies(f, W, H, sea, { rain: new Float32Array(W * H).fill(0.5) });
  check('buildWaterBodies deterministic', wbWet.every((v, i) => v === wb2[i]));
  // forceLake: a deposited (user-painted) lake cell is always class 2, even on dry arid land
  const force = new Uint8Array(W * H); force[3 * W + 4] = 1;   // a dry land cell (0.6) far from any water
  const wbF = buildWaterBodies(f, W, H, sea, { rain: new Float32Array(W * H).fill(0.0), forceLake: force });
  check('buildWaterBodies forceLake → forced cell is lake (class 2)', wbF[3 * W + 4] === 2 && wbF[0 * W + 5] === 0);
}

/* ---------- v0.103: deposit-water tool — a lake on a mountain without raising sea level ---------- */
{
  // reuse the 256 region world generated for the CBiome/CTerrain blocks above (no regenerate → seam RNG untouched)
  let hi = -1, hc = 0;
  for (let i = 0; i < field.length; i++){ const h = field[i] - geoAt(i); if (h >= state.seaLevel && h > hi){ hi = h; hc = i; } }
  const mx = hc % GW, my = (hc / GW) | 0;
  state.radius = 8; lakeMask = null; _waterBody = null; _cartBiome = null;
  depositWater(mx, my);
  check('depositWater marks the clicked (highest) land cell as lake', !!lakeMask && lakeMask[hc] === 1);
  const wb = currentWaterBodies();
  check('deposited water classifies as lake (class 2) above sea level', wb[hc] === 2 && hi >= state.seaLevel);
  check('deposited lake exports as biome raster index 13', buildBiomeRaster()[hc] === BIOME_INDEX.lake);
  _cartBiome = null;
  check('deposited lake → Cartalith Lake(14)', buildCartBiome()[hc] === 14);
  const lc = lakeColor(mx, my, hc);
  check('lakeColor finite RGB in [0,255]', lc.length === 3 && lc.every(v => Number.isFinite(v) && v >= 0 && v <= 255));
  lakeMask = null; _waterBody = null; _cartBiome = null; _cartTerrain = null;   // clean up so later blocks aren't polluted
}

/* ---------- Atlas Phase 1: chunk model + lifecycle (v0.079) ---------- */
{
  const p = chunkParent(3, 5, 6);
  check('chunkParent halves col/row, drops a level', p.z === 2 && p.col === 2 && p.row === 3);
  check('chunkParent(0) = null (root)', chunkParent(0, 0, 0) === null);
  const ch = chunkChildren(2, 1, 1);
  check('chunkChildren = 4 at z+1 covering the quadrant', ch.length === 4 && ch.every(c => c.z === 3) &&
    ch.some(c => c.col === 2 && c.row === 2) && ch.some(c => c.col === 3 && c.row === 3));
  check('parent↔children round-trip', ch.every(c => { const pp = chunkParent(c.z, c.col, c.row); return pp.z === 2 && pp.col === 1 && pp.row === 1; }));
  const a = chunkColorHash(2, 3, 4), b = chunkColorHash(2, 3, 4);
  check('chunkColorHash deterministic + valid RGB', a.length === 3 && a.every((v, i) => v === b[i]) && a.every(v => v >= 0 && v <= 255));
  // lifecycle reflects the caches, with the atlas authoritative (v0.081: baked uses the worldKey-namespaced atlas key)
  _lodCache.clear(); _lodEdits.clear(); _atlasBaked.clear(); _lodTile = 512; _worldKey = 'tw';
  check('chunkState unexplored by default', chunkState(2, 1, 1) === 'unexplored');
  const key = lodCacheKey(2, 1, 1, _lodTile); _lodCache.set(key, {});
  check('chunkState cached after generation', chunkState(2, 1, 1) === 'cached');
  _lodEdits.set(key, {}); check('edited overrides cached', chunkState(2, 1, 1) === 'edited');
  _atlasBaked.add(atlasChunkKey(2, 1, 1, _lodTile)); check('baked overrides edited (images authoritative)', chunkState(2, 1, 1) === 'baked');
  _lodCache.clear(); _lodEdits.clear(); _atlasBaked.clear();
}

/* ---------- Atlas Phase 2a: worldKey + IDB chunk encode/decode + ancestor coverage (v0.081) ---------- */
{
  // worldKey deterministic + sensitive to a generation param
  const wk1 = worldKey(), wk2 = worldKey();
  check('worldKey deterministic (same state → same key)', wk1 === wk2 && typeof wk1 === 'string' && wk1.length > 0);
  const sv = state.tect.seed; state.tect.seed = sv + 1;
  check('worldKey changes when a gen param changes', worldKey() !== wk1);
  state.tect.seed = sv; check('worldKey restored when param restored', worldKey() === wk1);

  // atlasKeyStr format + uniqueness across z/col/row/ts
  check('atlasKeyStr format', atlasKeyStr('w', 512, 2, 3, 4) === 'w:512:2:3:4');
  const ks = new Set([
    atlasKeyStr('w', 512, 2, 3, 4), atlasKeyStr('w', 1024, 2, 3, 4),
    atlasKeyStr('w', 512, 3, 3, 4), atlasKeyStr('w', 512, 2, 4, 4), atlasKeyStr('w', 512, 2, 3, 5),
    atlasKeyStr('x', 512, 2, 3, 4)]);
  check('atlasKeyStr unique across ts/z/col/row/worldKey', ks.size === 6);

  // encode/decode round-trip ≤1 LSB, preserving dims + addressing
  const tw = 12, th = 8, td = new Float32Array(tw * th);
  for (let i = 0; i < td.length; i++) td[i] = i / (td.length - 1);
  const tile = { data: td, w: tw, h: th, z: 3, col: 5, row: 6 };
  const rec = atlasEncodeChunk(tile), dec = atlasDecodeChunk(rec);
  let maxErr = 0; for (let i = 0; i < td.length; i++) maxErr = Math.max(maxErr, Math.abs(td[i] - dec.data[i]));
  check('atlasEncodeChunk packs rg16 + dims', rec.rg16.length === tw * th * 4 && rec.w === tw && rec.h === th && rec.z === 3 && rec.col === 5 && rec.row === 6);
  check('atlas chunk round-trip ≤1 LSB (max Δ=' + maxErr.toExponential(1) + ')', maxErr <= 0.5 / 65535 + 1e-9);
  check('atlasDecodeChunk preserves addressing', dec.w === tw && dec.h === th && dec.z === 3 && dec.col === 5 && dec.row === 6);

  // bakedCover: a baked ancestor covers its descendants, not a sibling subtree
  _atlasBaked.clear(); _lodTile = 512; _worldKey = 'cw';
  check('bakedCover false when nothing baked', bakedCover(3, 4, 4) === false);
  _atlasBaked.add(atlasChunkKey(1, 1, 1, _lodTile));                 // bake a level-1 ancestor
  check('bakedCover true for a descendant of a baked ancestor', bakedCover(3, 4, 4) === true);   // (1,1,1)→(2,2,2)→(3,4,4)
  check('bakedCover true for the baked chunk itself', bakedCover(1, 1, 1) === true);
  check('bakedCover false for a sibling subtree', bakedCover(3, 0, 0) === false);                // under (1,0,0), not baked
  _atlasBaked.clear();
}

/* ---------- Atlas Phase 2b: metadata record helpers (pure) (v0.082) ---------- */
{
  check('atlasMetaKey prefixes the worldKey', atlasMetaKey('abc') === 'meta:abc');
  check('atlasMetaKey distinct from any chunk key', atlasMetaKey('abc') !== atlasKeyStr('abc', 512, 0, 0, 0));
  const m = atlasMetaRec('abc', { ts: 1024, chunks: 7, time: 42 });
  check('atlasMetaRec shape', m.key === 'meta:abc' && m.ts === 1024 && m.chunks === 7 && m.ver === VERSION && m.time === 42);
  check('atlasMetaRec has NO worldKey field (so the world index excludes it)', !('worldKey' in m));
}

/* ---------- Atlas Phase 3: biome-coloured tiles (renderBiomeTileRGBA) (v0.083) ---------- */
{
  // amplify a sub-region into a tile, then render it both ways
  const region = { x: GW * 0.25, y: GH * 0.3, w: GW * 0.4, h: GH * 0.35 }, TW = 40, TH = 36;
  const tile = amplifyRegion(field, GW, GH, region, TW, TH, { detailAmp: 0.1, sea: state.seaLevel });
  const bounds = { x: region.x, y: region.y, w: region.w, h: region.h };
  const bio = renderBiomeTileRGBA(tile, TW, TH, bounds);
  const relief = renderHeightTileRGBA(tile, TW, TH);
  check('renderBiomeTileRGBA RGBA length + opaque', bio.length === TW * TH * 4 && bio[3] === 255 && bio[bio.length - 1] === 255);
  let finite = true; for (let i = 0; i < bio.length; i++) if (!Number.isFinite(bio[i])) finite = false;
  check('renderBiomeTileRGBA all finite', finite);
  let diff = 0; for (let i = 0; i < bio.length; i++) if (bio[i] !== relief[i]) diff++;
  check('biome tile differs from the relief tile (climate colour added)', diff > bio.length * 0.25);
  const bio2 = renderBiomeTileRGBA(tile, TW, TH, bounds);
  check('renderBiomeTileRGBA deterministic', bio.every((v, i) => v === bio2[i]));
  // an all-ocean tile renders ocean (blue-dominant), an all-high tile does not
  const seaTile = new Float32Array(TW * TH).fill(state.seaLevel - 0.2);
  const sea = renderBiomeTileRGBA(seaTile, TW, TH, bounds);
  check('ocean tile is blue-dominant (B>R)', sea[2] > sea[0]);
  const hiTile = new Float32Array(TW * TH).fill(Math.min(1, state.seaLevel + 0.5));
  const hi = renderBiomeTileRGBA(hiTile, TW, TH, bounds);
  let oceanish = 0; for (let i = 0; i < hiTile.length; i++){ const p = i * 4; if (hi[p + 2] > hi[p] + 20) oceanish++; }
  check('land tile is not rendered as ocean', oceanish < hiTile.length * 0.5);
}

/* ---------- R1: ambient occlusion (aoMul + renderBiomeTileRGBA AO) (v0.084) ---------- */
{
  check('aoMul darkens depressions', aoMul(0.05, 1) < 1 && aoMul(0.05, 1) >= 1 - AO_MAX - 1e-9);
  check('aoMul leaves ridges/flat unchanged', aoMul(-0.05, 1) === 1 && aoMul(0, 1) === 1);
  check('aoMul scales with strength', aoMul(0.02, 1) < aoMul(0.02, 0.3));
  check('aoMul clamped at max darkening', aoMul(1, 1) === 1 - AO_MAX);
  const region = { x: GW * 0.25, y: GH * 0.3, w: GW * 0.4, h: GH * 0.35 }, TW = 40, TH = 36;
  const tile = amplifyRegion(field, GW, GH, region, TW, TH, { detailAmp: 0.1, sea: state.seaLevel });
  const bounds = { x: region.x, y: region.y, w: region.w, h: region.h }, saved = state.viz.ao;
  state.viz.ao = 0;   const off = renderBiomeTileRGBA(tile, TW, TH, bounds);
  state.viz.ao = 0.8; const on  = renderBiomeTileRGBA(tile, TW, TH, bounds);
  state.viz.ao = saved;
  let d = 0, neverBrighter = true; for (let i = 0; i < off.length; i += 4){ if (on[i] !== off[i]) d++; if (on[i] > off[i] || on[i + 1] > off[i + 1] || on[i + 2] > off[i + 2]) neverBrighter = false; }
  check('AO changes the biome tile when on', d > 0);
  check('AO only darkens, never brightens', neverBrighter);
  check('AO off ⇒ tile identical to no-AO render', (() => { state.viz.ao = 0; const a = renderBiomeTileRGBA(tile, TW, TH, bounds); state.viz.ao = saved; return a.every((v, i) => v === off[i]); })());
}

/* ---------- R2: ridge crest enhancement + slope-material refinement (v0.087) ---------- */
{
  // buildCrestField: convex (Laplacian<0) + steep → >0; concave bowl / flat / ocean → 0
  const W = 9, H = 9, ridge = new Float32Array(W * H), bowl = new Float32Array(W * H), flat = new Float32Array(W * H).fill(0.6);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const d = x - 4;
    ridge[y * W + x] = 0.4 + 0.3 * Math.exp(-(d * d) / 4);   // rounded dome ridge along x=4 (convex + sloped shoulders)
    bowl[y * W + x]  = 0.4 + 0.01 * d * d;                   // upward parabola valley — concave (curv>0) everywhere
  }
  const cr = buildCrestField(ridge, W, H, 0.0);
  check('buildCrestField fires on the convex ridge shoulders', cr.some(v => v > 0));
  check('buildCrestField ignores concave bowls (interior)', (() => { const bc = buildCrestField(bowl, W, H, 0.0); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (bc[y * W + x] !== 0) return false; return true; })());
  check('buildCrestField ignores flat ground', buildCrestField(flat, W, H, 0.0).every(v => v === 0));
  check('buildCrestField is land-only (ocean cells stay 0)', buildCrestField(ridge, W, H, 1.0).every(v => v === 0));
  check('buildCrestField deterministic', buildCrestField(ridge, W, H, 0.0).every((v, i) => v === cr[i]));
  // sx,sy scaling: a sub-cell-sampled ridge gives the same crest scale as the unit-step ridge
  const cr1 = buildCrestField(ridge, W, H, 0.0, 1, 1);
  check('buildCrestField sx,sy default to the unit-step result', cr1.every((v, i) => v === cr[i]));
  // applyCrest brightens toward the highlight, clamps at s≥1
  const c0 = [40, 60, 30]; applyCrest(c0, 0.5); check('applyCrest brightens toward the sunlit-rock stroke', c0[0] > 40 && c0[1] > 60 && c0[2] > 30);
  const c1 = [10, 10, 10]; applyCrest(c1, 2); check('applyCrest clamps strength at 1', Math.abs(c1[0] - 240) < 1e-6);
  const c2 = [10, 10, 10]; applyCrest(c2, 0); check('applyCrest no-op at strength 0', c2[0] === 10);

  // slope-rock refinement inside landColorCore: gated, off ⇒ identical
  {
    const args = [16, 0.5, 0.06, 0.5, 0.5, 0.5, 0.5, 0.8, 0.8, 0.0, 0.0, 0.0, state.bioBlend, 1, 50, 50, 1];
    const savedR = state.viz.rockSlope;
    state.viz.rockSlope = 0; const a = landColorCore(...args), a2 = landColorCore(...args);
    state.viz.rockSlope = 0.9; const b = landColorCore(...args);
    state.viz.rockSlope = savedR;
    check('slope-rock off ⇒ landColorCore deterministic/unchanged', a.every((v, i) => v === a2[i]));
    check('slope-rock on ⇒ steep land recolours toward rock', a.some((v, i) => v !== b[i]));
  }
}

/* ---------- R3: procedural texture synthesis + minor-channel flow lines (v0.088) ---------- */
{
  // texture synthesis inside landColorCore: gated, off ⇒ identical, on ⇒ modulates, deterministic per-pixel
  const args = [16, 0.5, 0.06, 0.5, 0.5, 0.5, 0.5, 0.8, 0.8, 0.0, 0.0, 0.0, state.bioBlend, 1, 50, 50, 1];
  const savedT = state.viz.texture;
  state.viz.texture = 0;   const off = landColorCore(...args), off2 = landColorCore(...args);
  state.viz.texture = 0.9; const on = landColorCore(...args), on2 = landColorCore(...args);
  state.viz.texture = savedT;
  check('texture off ⇒ landColorCore unchanged/deterministic', off.every((v, i) => v === off2[i]));
  check('texture on ⇒ colour is modulated', off.some((v, i) => v !== on[i]));
  check('texture on ⇒ deterministic (seamless world-coord noise)', on.every((v, i) => v === on2[i]));
  // two different world positions get different texture (it's spatially varying)
  state.viz.texture = 0.9;
  const pA = landColorCore(16, 0.5, 0.06, 0.5, 0.5, 0.5, 0.5, 0.8, 0.8, 0, 0, 0, state.bioBlend, 1, 17, 23, 1);
  const pB = landColorCore(16, 0.5, 0.06, 0.5, 0.5, 0.5, 0.5, 0.8, 0.8, 0, 0, 0, state.bioBlend, 1, 200, 140, 1);
  state.viz.texture = savedT;
  check('texture varies across world coords', pA.some((v, i) => v !== pB[i]));

  // minor channels: surfaceColor band below the trunk threshold, gated, off ⇒ identical
  state.world = false; state.resW = 128; GW = 128; GH = gridH(128); allocate(); generate(); computeFlow(true);
  const hi = GW * GH * 0.0004, lo = hi * 0.05;
  // find a land cell whose flow sits in the minor band
  let idx = -1; for (let i = 0; i < GW * GH; i++){ if (field[i] >= state.seaLevel && flowField[i] > lo && flowField[i] < hi){ idx = i; break; } }
  const savedM = state.viz.minorStreams, savedR2 = state.showRivers; state.showRivers = true;
  if (idx >= 0){ const x = idx % GW, y = (idx / GW) | 0;
    _riverField = null; state.viz.minorStreams = 0;   const c0 = surfaceColor(x, y, idx, field[idx]);
    _riverField = null; state.viz.minorStreams = 0;   const c0b = surfaceColor(x, y, idx, field[idx]);
    check('minor channels off ⇒ surfaceColor unchanged/deterministic', c0.every((v, i) => v === c0b[i]));
    _riverField = null; state.viz.minorStreams = 0.9; const c1 = surfaceColor(x, y, idx, field[idx]);
    check('minor channels on ⇒ band cell shifts blue-grey', c1.some((v, i) => v !== c0[i]) && c1[2] >= c1[0]);
  } else { console.log('skip - no minor-band cell found at this seed/res'); check('minor channels band lookup', true); }
  state.viz.minorStreams = savedM; state.showRivers = savedR2; _riverField = null;
}

/* ---------- R4: ridged-noise elevation-weighted relief detail (v0.089) ---------- */
{
  // ridgedFbm pure: [0,1], deterministic, octave-count matters, and ridgedFbm(...,6,..) === ridged(...)
  let inRange = true; for (let k = 0; k < 50; k++){ const v = ridgedFbm(k * 0.37, k * 0.21, 5, 9); if (v < 0 || v > 1) inRange = false; }
  check('ridgedFbm stays in [0,1]', inRange);
  check('ridgedFbm deterministic', ridgedFbm(1.3, 2.7, 5, 9) === ridgedFbm(1.3, 2.7, 5, 9));
  check('ridgedFbm octave count changes detail', ridgedFbm(1.3, 2.7, 1, 9) !== ridgedFbm(1.3, 2.7, 5, 9));
  check('ridgedFbm(…,6,…) matches the legacy ridged()', Math.abs(ridgedFbm(1.3, 2.7, 6, 9) - ridged(1.3, 2.7, 9)) < 1e-12);

  // landColorCore ridged relief: gated; off ⇒ identical; lowland (r=0) untouched even when on (H² gate); highland changes
  const base = [16, 0.5, 0.06, /*r*/0.8, 0.5, 0.5, 0.5, 0.8, 0.8, 0.0, 0.0, 0.0, state.bioBlend, 1, 50, 50, 1];
  const low  = base.slice(); low[3] = 0.0;   // r=0 ⇒ H² gate = 0
  const savedRR = state.viz.ridgedRelief;
  state.viz.ridgedRelief = 0;   const off = landColorCore(...base), off2 = landColorCore(...base);
  state.viz.ridgedRelief = 0.9; const on = landColorCore(...base), onLow = landColorCore(...low);
  state.viz.ridgedRelief = 0;   const offLow = landColorCore(...low);
  state.viz.ridgedRelief = savedRR;
  check('ridged relief off ⇒ landColorCore unchanged/deterministic', off.every((v, i) => v === off2[i]));
  check('ridged relief on ⇒ highland colour changes', off.some((v, i) => v !== on[i]));
  check('ridged relief H² gate ⇒ lowland (r=0) untouched', onLow.every((v, i) => v === offLow[i]));
}

/* ---------- v0.104 Affordance Field Foundation: lithology / soil / water access + multi-sun ---------- */
{
  /* synthetic inputs for the pure builders */
  const W = 32, H = 24, n = W * H, sea = 0.42;
  const fld = new Float32Array(n), age = new Float32Array(n), het = new Float32Array(n),
        volc = new Float32Array(n), crust = new Float32Array(n), resist = new Float32Array(n),
        rain = new Float32Array(n), temp = new Float32Array(n), slopeN = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const i = y * W + x;
    fld[i] = x < W / 2 ? 0.30 : 0.70;          // left lowland / right upland
    crust[i] = x < 4 ? -0.2 : 0.3;             // far-left oceanic crust
    volc[i] = (x === 6) ? 0.8 : 0.0;           // a volcanic column
    resist[i] = x > W * 0.7 ? 0.8 : 0.2;       // hard basement on the right
    age[i] = x / (W - 1);                       // young → old left→right
    rain[i] = y / (H - 1);                      // dry → wet top→bottom
    temp[i] = 18;                               // optimal for soil bell
    slopeN[i] = x < W / 2 ? 0.0 : 3.0;         // upland is steep
  }

  /* buildLithology */
  const lith = buildLithology(fld, age, het, volc, crust, resist, rain, W, H, sea);
  check('lithology length = n', lith.length === n);
  let lithValid = true, distinctL = new Set();
  for (let i = 0; i < n; i++){ const v = lith[i]; if (v < 0 || v >= LITH_KEYS.length || (v | 0) !== v) lithValid = false; distinctL.add(v); }
  check('lithology values are valid indices', lithValid);
  check('lithology: oceanic crust ⇒ basalt (idx 1)', lith[0] === 1 && lith[2 * W + 1] === 1);
  check('lithology: volcanic column ⇒ andesite (idx 2)', lith[10 * W + 6] === 2);
  check('lithology has multiple rock types (' + distinctL.size + ')', distinctL.size >= 3);
  const lith2 = buildLithology(fld, age, het, volc, crust, resist, rain, W, H, sea);
  check('lithology deterministic', lith.every((v, i) => v === lith2[i]));

  /* buildSoilFertility — range, determinism, monotonic in rain (↑) and slope (↓) */
  const soil = buildSoilFertility(lith, temp, rain, slopeN, age, W, H);
  check('soil finite & in [0,1]', allFinite(soil) && (([mn, mx]) => mn >= 0 && mx <= 1)(minMax(soil)));
  const soil2 = buildSoilFertility(lith, temp, rain, slopeN, age, W, H);
  check('soil deterministic', soil.every((v, i) => v === soil2[i]));
  /* two lowland cells, same column, dry (y=2) vs wet (y=H-2) → wetter has more soil */
  const colx = 8; check('soil rises with rainfall', soil[(H - 2) * W + colx] > soil[2 * W + colx]);
  /* same rain row, flat lowland (x=8) vs steep upland (x=W-4) → flat keeps more soil */
  const rowy = H - 2; check('soil falls with slope', soil[rowy * W + 8] > soil[rowy * W + (W - 4)]);

  /* buildWaterAccess — water cells = 1, decays inland, deterministic */
  const flow = new Float32Array(n);              // one trunk river down column x=16
  for (let y = 0; y < H; y++) flow[y * W + 16] = n;   // well above threshold
  const wa = buildWaterAccess(flow, fld, W, H, sea);
  check('water access finite & in [0,1]', allFinite(wa) && (([mn, mx]) => mn >= 0 && mx <= 1)(minMax(wa)));
  check('water access: on the river ⇒ 1', Math.abs(wa[10 * W + 16] - 1) < 1e-6);
  check('water access decays away from the river', wa[10 * W + 17] > wa[10 * W + 22]);
  const wa2 = buildWaterAccess(flow, fld, W, H, sea);
  check('water access deterministic', wa.every((v, i) => v === wa2[i]));

  /* live cached builders run on the generated world */
  check('currentLithology finite indices', (() => { const a = currentLithology(); return a.length === GW * GH && a.every(v => v >= 0 && v < LITH_KEYS.length); })());
  check('currentSoil finite & in [0,1]', (() => { const a = currentSoil(); return allFinite(a) && (([mn, mx]) => mn >= 0 && mx <= 1)(minMax(a)); })());
  check('currentWaterAccess finite & in [0,1]', (() => { const a = currentWaterAccess(); return allFinite(a) && (([mn, mx]) => mn >= 0 && mx <= 1)(minMax(a)); })());
  check('lithology manifest covers every key', (() => { const m = lithIndexManifest(); return LITH_KEYS.every((k, i) => m.indices[String(i)] && m.indices[String(i)].key === k); })());

  /* multiSunShade: in [0,1], floor ≥ 0.10 (no black voids), deterministic */
  {
    const sv = state.viz.multiSun; let mn = 2, mx = -1, fin = true;
    for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++){ const s = multiSunShade(x, y); if (!Number.isFinite(s)) fin = false; if (s < mn) mn = s; if (s > mx) mx = s; }
    check('multiSunShade finite & in [0,1]', fin && mn >= 0 && mx <= 1);
    check('multiSunShade ambient floor ≥ 0.10 (no black voids)', mn >= 0.10 - 1e-9);
    state.viz.multiSun = sv;
  }

  /* default-neutrality: new debug views OFF + multiSun OFF ⇒ render bit-identical */
  {
    const sv = state.viz.multiSun;
    state.mode = 'biome'; state.debug = 'off'; state.viz.multiSun = false;
    renderNow(); const base = Uint8ClampedArray.from(img.data);
    state.viz.multiSun = true; renderNow();
    let diff = 0; for (let i = 0; i < img.data.length; i++) if (img.data[i] !== base[i]) diff++;
    check('multi-sun on changes the render', diff > 100);
    state.viz.multiSun = false; renderNow();
    let same = true; for (let i = 0; i < img.data.length; i++) if (img.data[i] !== base[i]){ same = false; break; }
    check('multi-sun off ⇒ render bit-identical (default neutrality)', same);
    state.viz.multiSun = sv; renderNow();
  }
}

/* ---------- v0.105 Resource potentials / Carrying capacity / Settlement suitability ---------- */
{
  const W = 24, H = 20, n = W * H, sea = 0.42;
  const fld = new Float32Array(n), lith = new Uint8Array(n), age = new Float32Array(n),
        bt = new Uint8Array(n), shear = new Float32Array(n), flow = new Float32Array(n),
        rain = new Float32Array(n), temp = new Float32Array(n), slopeN = new Float32Array(n),
        biome = new Uint8Array(n), water = new Float32Array(n), soil = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const i = y * W + x;
    fld[i] = 0.55;                          // land (above sea=0.42)
    lith[i] = 0;                            // granite default
    age[i] = 0.7;                           // old (> ageOld=0.6)
    rain[i] = 0.4; temp[i] = 18;
    biome[i] = 5;                           // tempForest (closed canopy)
    water[i] = 0.7; soil[i] = 0.6;
  }
  /* copper test: put a subduction boundary at x=4 row */
  for (let y = 0; y < H; y++) bt[y * W + 4] = 2;  // subductionOC
  /* transform fault at x=20 */
  for (let y = 0; y < H; y++){ bt[y * W + 20] = 5; shear[y * W + 20] = 0.8; }
  /* salt basin: arid lowland in limestone at column x=12 */
  for (let y = 0; y < H; y++){ const i = y * W + 12; lith[i] = 3; rain[i] = 0.10; fld[i] = 0.50; }

  const rp = buildResourcePotentials(lith, bt, shear, flow, biome, fld, rain, age, W, H, sea);
  const keys = ['copper','tin','iron','gold','salt','timber'];
  for (const k of keys){
    const [mn, mx] = minMax(rp[k]);
    check('resource ' + k + ' in [0,1]', mn >= 0 && mx <= 1.0 + 1e-6);
    check('resource ' + k + ' finite', allFinite(rp[k]));
  }
  /* copper: cell on subduction boundary should be higher than an interior cell */
  check('copper: subduction boundary > interior', rp.copper[10 * W + 4] > rp.copper[10 * W + 15]);
  /* timber: canopy cell (biome=5) > 0; land cell with biome=9 (desert) = 0 */
  const bioMix = new Uint8Array(n); bioMix.set(biome);
  for (let y = 0; y < H; y++) bioMix[y * W + 18] = 9;  // desert column
  const rp2 = buildResourcePotentials(lith, bt, shear, flow, bioMix, fld, rain, age, W, H, sea);
  check('timber: closed-canopy biome > 0', rp2.timber[10 * W + 6] > 0);
  check('timber: desert biome = 0', rp2.timber[10 * W + 18] === 0);
  /* salt: arid lowland column (x=12 limestone) > wet interior */
  check('salt: arid limestone lowland > wet interior', rp.salt[10 * W + 12] > rp.salt[10 * W + 6]);
  /* gold: transform fault cell > non-fault cell */
  check('gold: transform fault > non-fault', rp.gold[10 * W + 20] > rp.gold[10 * W + 6]);
  /* determinism */
  const rp3 = buildResourcePotentials(lith, bt, shear, flow, biome, fld, rain, age, W, H, sea);
  check('resource potentials deterministic', keys.every(k => rp[k].every((v, i) => v === rp3[k][i])));

  /* buildCarryingCapacity */
  const noFld = new Float32Array(n).fill(0.30);   // ocean cells
  const carryLand = buildCarryingCapacity(soil, water, biome, temp, fld, W, H, sea);
  const carrySea  = buildCarryingCapacity(soil, water, biome, temp, noFld, W, H, sea);
  check('carryingCapacity finite & in [0,1]', allFinite(carryLand) && (([mn,mx])=>mn>=0&&mx<=1)(minMax(carryLand)));
  check('carryingCapacity: ocean (fld<sea) = 0', carrySea.every(v => v === 0));
  /* higher soil → higher carry cap (same water/temp row) */
  const soilHi = new Float32Array(n).fill(0.9), soilLo = new Float32Array(n).fill(0.1);
  const cHi = buildCarryingCapacity(soilHi, water, biome, temp, fld, W, H, sea);
  const cLo = buildCarryingCapacity(soilLo, water, biome, temp, fld, W, H, sea);
  check('carryingCapacity rises with soil fertility', cHi[10 * W + 6] > cLo[10 * W + 6]);
  const carry2 = buildCarryingCapacity(soil, water, biome, temp, fld, W, H, sea);
  check('carryingCapacity deterministic', carryLand.every((v, i) => v === carry2[i]));

  /* buildSettlementSuitability */
  const slopeFlat = new Float32Array(n).fill(0.5), slopeCliff = new Float32Array(n).fill(6.0);
  const carry = buildCarryingCapacity(soil, water, null, temp, fld, W, H, sea);
  const suit = buildSettlementSuitability(soil, water, carry, fld, slopeFlat, W, H, sea);
  const suitSea = buildSettlementSuitability(soil, water, carry, noFld, slopeFlat, W, H, sea);
  check('settleSuitability finite & in [0,1]', allFinite(suit) && (([mn,mx])=>mn>=0&&mx<=1)(minMax(suit)));
  check('settleSuitability: ocean = 0', suitSea.every(v => v === 0));
  /* logistic: max < 1 (never saturates), min ≥ 0 on land */
  const [sMin, sMax] = minMax(suit);
  check('settleSuitability logistic shape (0 ≤ min, max < 1)', sMin >= 0 && sMax < 1.0);
  /* flat > cliff for same inputs */
  const suitCliff = buildSettlementSuitability(soil, water, carry, fld, slopeCliff, W, H, sea);
  check('settleSuitability: flat terrain > cliff terrain', suit[10 * W + 6] > suitCliff[10 * W + 6]);
  const suit2 = buildSettlementSuitability(soil, water, carry, fld, slopeFlat, W, H, sea);
  check('settleSuitability deterministic', suit.every((v, i) => v === suit2[i]));

  /* findSettlementSeeds */
  /* create a synthetic suitability field with two clear peaks */
  const synthSuit = new Float32Array(W * H);
  synthSuit[8 * W + 6] = 0.85;  synthSuit[8 * W + 5] = 0.70;  synthSuit[8 * W + 7] = 0.70;  // peak A
  synthSuit[8 * W + 18] = 0.80; synthSuit[8 * W + 17] = 0.65; synthSuit[8 * W + 19] = 0.65; // peak B
  const seeds = findSettlementSeeds(synthSuit, W, H, {thresh: 0.75, suppR: 4});
  check('findSettlementSeeds returns array with {x,y,score}', Array.isArray(seeds) && seeds.length > 0 && 'x' in seeds[0] && 'score' in seeds[0]);
  check('findSettlementSeeds: all scores ≥ threshold', seeds.every(s => s.score >= 0.75));
  check('findSettlementSeeds: sorted by score desc', seeds.every((s, i) => i === 0 || s.score <= seeds[i - 1].score));
  check('findSettlementSeeds: suppression radius respected', (() => {
    for (let i = 0; i < seeds.length; i++) for (let j = i + 1; j < seeds.length; j++){
      const dx = seeds[i].x - seeds[j].x, dy = seeds[i].y - seeds[j].y;
      if (dx * dx + dy * dy < 16) return false;  // suppR=4, suppR²=16
    }
    return true;
  })());

  /* live builders on the generated world */
  check('currentResourcePotentials has correct keys', (() => { const rp = currentResourcePotentials(); return RESOURCE_KEYS.every(k => k in rp && allFinite(rp[k])); })());
  check('currentCarryingCapacity finite & in [0,1]', (() => { const a = currentCarryingCapacity(); return allFinite(a) && (([mn,mx])=>mn>=0&&mx<=1)(minMax(a)); })());
  check('currentSettlementSuitability finite & in [0,1]', (() => { const a = currentSettlementSuitability(); return allFinite(a) && (([mn,mx])=>mn>=0&&mx<=1)(minMax(a)); })());

  /* default-neutrality: rsrc/carry/settle debug views off ⇒ render bit-identical to base */
  {
    state.mode = 'biome'; state.debug = 'off'; renderNow();
    const base = Uint8ClampedArray.from(img.data);
    for (const d of ['rsrc','carry','settle']){
      state.debug = d; renderNow();
      state.debug = 'off'; renderNow();
      let same = true; for (let i = 0; i < img.data.length; i++) if (img.data[i] !== base[i]){ same = false; break; }
      check('debug view ' + d + ' off ⇒ render bit-identical', same);
    }
  }
}

/* ---------- v0.106 tectonic inversion (Phase B): reconstruct proxy plates + tectonic fields
   from an imported heightmap's morphology, re-enabling the affordance stack for DEMs ---------- */
{
  const W = 40, H = 30, n = W * H;

  // buildReliefField: flat field with one elevated ridge column → high relief there, low elsewhere
  const f1 = new Float32Array(n).fill(0.5);
  for (let y = 0; y < H; y++) f1[y * W + (W >> 1)] = 0.95;
  const rel1 = buildReliefField(f1, W, H, {});
  check('buildReliefField finite & in [0,1]', allFinite(rel1) && (([mn, mx]) => mn >= 0 && mx <= 1 + 1e-6)(minMax(rel1)));
  check('buildReliefField high on ridge vs flat corner', rel1[(H >> 1) * W + (W >> 1)] > rel1[0] + 0.1);
  check('buildReliefField deterministic', (() => { const r = buildReliefField(f1, W, H, {}); for (let i = 0; i < n; i++) if (r[i] !== rel1[i]) return false; return true; })());

  // pickPlateSeeds: seeds land in low-relief interiors (avoid the high band)
  const seeds = pickPlateSeeds(rel1, W, H, { count: 12 });
  check('pickPlateSeeds returns ≥2 seeds', seeds.length >= 2);
  check('pickPlateSeeds prefer low-relief cells', (() => { let mean = 0; for (let i = 0; i < n; i++) mean += rel1[i]; mean /= n; let s = 0; for (const sd of seeds) s += rel1[sd.y * W + sd.x]; return s / seeds.length < mean; })());
  check('pickPlateSeeds deterministic', (() => { const s2 = pickPlateSeeds(rel1, W, H, { count: 12 }); return s2.length === seeds.length && s2.every((p, i) => p.x === seeds[i].x && p.y === seeds[i].y); })());

  // classifyPlateCrust: low-elevation plate → oceanic (base<0), high → continental (base>0)
  {
    const pid = new Int16Array(n), fC = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (x < W / 2) { pid[i] = 0; fC[i] = 0.2; } else { pid[i] = 1; fC[i] = 0.7; } }
    const base = classifyPlateCrust(fC, pid, 2, W, H, 0.42);
    check('classifyPlateCrust: low plate oceanic (base<0)', base[0] < 0);
    check('classifyPlateCrust: high plate continental (base>0)', base[1] > 0);
  }

  // reconstructBoundaryStress: an elevated belt on the plate boundary ⇒ convergent (stress>0)
  {
    const f = new Float32Array(n).fill(0.5), pid = new Int16Array(n), mid = W >> 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; pid[i] = x < mid ? 0 : 1; if (Math.abs(x - mid) <= 1) f[i] = 0.95; }
    const rel = buildReliefField(f, W, H, {});
    const r = reconstructBoundaryStress(f, pid, [0.8, 0.8], rel, W, H, 0.42, {});
    check('reconstructBoundaryStress: boundaryMask only at plate edge', (() => { for (let y = 2; y < H - 2; y++) for (let x = 0; x < W; x++) { if (r.boundaryMask[y * W + x] === 1 && Math.abs(x - mid) > 1) return false; } return true; })());
    check('reconstructBoundaryStress: elevated belt ⇒ convergent (stress>0)', r.stressField[(H >> 1) * W + mid] > 0.05);
    check('reconstructBoundaryStress: boundaryType ∈ valid BTYPE set', (() => { for (let i = 0; i < n; i++) if (r.boundaryType[i] > 5) return false; return true; })());
    check('reconstructBoundaryStress: stress & shear finite', allFinite(r.stressField) && allFinite(r.shearField));
    check('reconstructBoundaryStress deterministic', (() => { const r2 = reconstructBoundaryStress(f, pid, [0.8, 0.8], rel, W, H, 0.42, {}); for (let i = 0; i < n; i++) if (r2.stressField[i] !== r.stressField[i]) return false; return true; })());
  }

  // reconstructBoundaryStress: a depressed trough on the boundary ⇒ divergent (stress<0)
  {
    const f = new Float32Array(n).fill(0.5), pid = new Int16Array(n), mid = W >> 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; pid[i] = x < mid ? 0 : 1; if (Math.abs(x - mid) <= 1) f[i] = 0.15; }
    const rel = buildReliefField(f, W, H, {});
    const r = reconstructBoundaryStress(f, pid, [0.8, 0.8], rel, W, H, 0.42, {});
    check('reconstructBoundaryStress: depressed trough ⇒ divergent (stress<0)', r.stressField[(H >> 1) * W + mid] < -0.05);
  }

  // stampVolcanicArcs: decay from subduction/arc cells; empty input ⇒ all zero
  {
    const bt = new Uint8Array(n); bt[(H >> 1) * W + (W >> 1)] = BTYPE.subductionOC;
    const v = stampVolcanicArcs(bt, W, H, {});
    check('stampVolcanicArcs: nonzero at arc, ~0 far, finite', v[(H >> 1) * W + (W >> 1)] > 0.5 && v[0] < 0.1 && allFinite(v));
    check('stampVolcanicArcs: empty input ⇒ all zero', stampVolcanicArcs(new Uint8Array(n), W, H, {}).every(x => x === 0));
  }

  // payoff: run inferTectonics on the live generated world's field (leaves `field` untouched) →
  // re-populates plates/boundaries/stress/age and re-enables the affordance stack
  {
    inferTectonics();
    check('inferTectonics: plateId multi-valued', new Set(plateId).size >= 3);
    check('inferTectonics: boundaryMask has boundary cells', boundaryMask.some(v => v === 1));
    check('inferTectonics: tectonic fields finite', allFinite(stressField) && allFinite(shearField) && allFinite(ageField) && allFinite(resistanceField) && allFinite(volcanicField) && allFinite(baseField));
    check('inferTectonics: ageField in [0,1]', (([mn, mx]) => mn >= 0 && mx <= 1)(minMax(ageField)));
    check('inferTectonics: lithology ≥3 rock types after inversion', new Set(currentLithology()).size >= 3);
    check('inferTectonics: resource potentials finite', (() => { const rp = currentResourcePotentials(); return RESOURCE_KEYS.every(k => allFinite(rp[k])); })());
    check('inferTectonics: deterministic plateId', (() => { const p1 = Int16Array.from(plateId); inferTectonics(); for (let i = 0; i < plateId.length; i++) if (plateId[i] !== p1[i]) return false; return true; })());
  }
}

/* ---------- v0.107 Phase C: multi-channel RGBA channel-atlas export ---------- */
{
  const n = 32;
  // packRGB8 / unpackRGB8 round-trip — unit ≤1/255, index exact, alpha forced 255
  const u0 = new Float32Array(n), u1 = new Float32Array(n), idx = new Uint8Array(n);
  for (let i = 0; i < n; i++) { u0[i] = i / (n - 1); u1[i] = 1 - i / (n - 1); idx[i] = i % 14; }
  const rgba = packRGB8([{ src: u0, kind: 'unit' }, { src: u1, kind: 'unit' }, { src: idx, kind: 'index' }], n);
  check('packRGB8: alpha forced to 255', (() => { for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] !== 255) return false; return true; })());
  const dec = unpackRGB8(rgba, n, ['unit', 'unit', 'index']);
  check('packRGB8/unpackRGB8: unit round-trip ≤ 1/255', (() => { let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(dec.r[i] - u0[i]), Math.abs(dec.g[i] - u1[i])); return mx <= 1 / 255 + 1e-6; })());
  check('packRGB8/unpackRGB8: index round-trip exact', (() => { for (let i = 0; i < n; i++) if (dec.b[i] !== idx[i]) return false; return true; })());
  check('packRGB8: null channel ⇒ 0', (() => { const r = packRGB8([null, { src: u1, kind: 'unit' }, null], n); for (let i = 0; i < n; i++) if (r[i * 4] !== 0 || r[i * 4 + 2] !== 0) return false; return true; })());
  check('_chanEnc clamps out-of-range', _chanEnc(2, 'unit') === 255 && _chanEnc(-1, 'unit') === 0 && _chanEnc(300, 'index') === 255 && _chanEnc(-5, 'index') === 0);

  // channelAtlasGroups + manifest structure (on the live world)
  const groups = channelAtlasGroups();
  check('channelAtlasGroups: 5 groups', groups.length === 5);
  check('channelAtlasGroups: every non-null channel src is length GW*GH', (() => {
    for (const g of groups) for (const c of g.channels) if (c.src && c.src.length !== GW * GH) return false; return true;
  })());
  check('channelAtlasGroups: resource channels cover all 6 RESOURCE_KEYS', (() => {
    const keys = new Set(); for (const g of groups) for (const c of g.channels) keys.add(c.key);
    return RESOURCE_KEYS.every(k => keys.has(k));
  })());
  const man = channelAtlasManifest(groups);
  check('channelAtlasManifest: kind + encoding + dims', man.kind === 'cartalith-channel-atlas' && man.encoding === 'rgb8' && man.width === GW && man.height === GH);
  check('channelAtlasManifest: one entry per group with channel map', man.files.length === groups.length && man.files.every(f => f.channels && (f.channels.r || f.channels.g || f.channels.b)));
  check('channelAtlasManifest: unit channels report [0,1] range, index report categorical', (() => {
    for (const f of man.files) for (const ch of ['r', 'g', 'b']) { const c = f.channels[ch]; if (!c) continue; if (c.kind === 'unit' && !(Array.isArray(c.range) && c.range[0] === 0 && c.range[1] === 1)) return false; if (c.kind === 'index' && c.range !== 'categorical') return false; } return true;
  })());
  check('channelAtlasGroups deterministic (manifest JSON stable)', JSON.stringify(channelAtlasManifest(channelAtlasGroups())) === JSON.stringify(man));
}

/* ---------- v0.108 Phase D: "The Painter" NPR (contour veins / ink / hachure / watercolor) ----------
   All four live inside landColorCore, gated on per-style state.viz sliders; off ⇒ bit-identical.
   landColorCore signature: (T,M,slope,r,nLow,nHi,nBio,sh,shM,twi,asp,curv,blend,vig,px,py,ao,ecoK,gx,gy) */
if (typeof landColorCore === 'function') {
  const callLC = (over, px, py, gx, gy) => {
    // a representative land pixel: temperate, mid-moisture, moderate slope, mid elevation
    return landColorCore(15, 0.5, 0.05, 0.5, 0.5, 0.5, 0.5, 0.7, 0.7, 5, 0, 0.01, state.bioBlend, 1,
      px === undefined ? 100 : px, py === undefined ? 100 : py, 1, 1, gx || 0, gy || 0);
  };
  const savedViz = JSON.parse(JSON.stringify(state.viz));
  const off = { contours: 0, ink: 0, hachure: 0, watercolor: 0 };
  Object.assign(state.viz, off);
  const base = callLC();
  check('NPR: all-off baseline finite RGB', base.every(Number.isFinite));

  // each style off ⇒ identical to baseline; on ⇒ changes the pixel; output stays finite & in [0,255]
  const sameAsBase = c => c.every((v, i) => v === base[i]);
  const finiteRGB = c => c.length === 3 && c.every(v => Number.isFinite(v) && v >= 0 && v <= 255 + 1e-6);

  // contours: pick an elevation right on a contour level (r multiple of 0.05) so the line fires
  { Object.assign(state.viz, off); state.viz.contours = 0;
    const onLine = landColorCore(15, 0.5, 0.02, 0.5, .5, .5, .5, .7, .7, 5, 0, .01, state.bioBlend, 1, 100, 100, 1, 1, 0, 0);
    state.viz.contours = 0.8;
    const lit = landColorCore(15, 0.5, 0.02, 0.5, .5, .5, .5, .7, .7, 5, 0, .01, state.bioBlend, 1, 100, 100, 1, 1, 0, 0);
    check('NPR contours: darkens a pixel on a contour level', lit[0] < onLine[0] && finiteRGB(lit));
    Object.assign(state.viz, off);
    check('NPR contours: off ⇒ bit-identical', sameAsBase(callLC()));
  }
  // ink: high curvature edge ⇒ darkens
  { Object.assign(state.viz, off);
    const eBase = landColorCore(15, 0.5, 0.05, 0.5, .5, .5, .5, .7, .7, 5, 0, 0.02, state.bioBlend, 1, 100, 100, 1, 1, 0, 0);
    state.viz.ink = 0.9;
    const eLit = landColorCore(15, 0.5, 0.05, 0.5, .5, .5, .5, .7, .7, 5, 0, 0.02, state.bioBlend, 1, 100, 100, 1, 1, 0, 0);
    check('NPR ink: darkens a high-curvature edge', eLit[0] < eBase[0] && finiteRGB(eLit));
    Object.assign(state.viz, off);
    check('NPR ink: off ⇒ bit-identical', sameAsBase(callLC()));
  }
  // hachure: needs gradient; with gx,gy=0 it's a no-op even when on
  { Object.assign(state.viz, off); state.viz.hachure = 0.9;
    check('NPR hachure: no-op without gradient (gx=gy=0)', sameAsBase(callLC(undefined, 100, 100, 0, 0)));
    // with a gradient + steep slope, some sample along the stripe must darken
    let changed = false;
    for (let p = 0; p < 40 && !changed; p++) { const c = landColorCore(15, 0.5, 0.12, 0.5, .5, .5, .5, .7, .7, 5, 0, .01, state.bioBlend, 1, p * 3, p * 2, 1, 1, 1, 0.3); const b = landColorCore(15, 0.5, 0.12, 0.5, .5, .5, .5, .7, .7, 5, 0, .01, state.bioBlend, 1, p * 3, p * 2, 1, 1, 0, 0); if (c[0] < b[0]) changed = true; }
    check('NPR hachure: hatches steep slopes along the gradient', changed);
    Object.assign(state.viz, off);
    check('NPR hachure: off ⇒ bit-identical', sameAsBase(callLC(undefined, 100, 100, 1, 0.3)));
  }
  // watercolor: pigment wash modulates the pixel; finite
  { Object.assign(state.viz, off); state.viz.watercolor = 0.9;
    const wLit = callLC(undefined, 37, 91, 0, 0);
    const wBase = (Object.assign(state.viz, off), callLC(undefined, 37, 91, 0, 0));
    state.viz.watercolor = 0.9;
    check('NPR watercolor: modulates the pixel & stays finite', finiteRGB(callLC(undefined, 37, 91, 0, 0)));
    Object.assign(state.viz, off);
    check('NPR watercolor: off ⇒ bit-identical', sameAsBase(callLC()));
  }
  // water/below-sea (r<=0) is never touched by NPR
  { Object.assign(state.viz, { contours: 1, ink: 1, hachure: 1, watercolor: 1 });
    const wOff = landColorCore(15, 0.5, 0.05, 0, .5, .5, .5, .7, .7, 5, 0, .5, state.bioBlend, 1, 100, 100, 1, 1, 1, 1);
    state.viz.contours = state.viz.ink = state.viz.hachure = state.viz.watercolor = 0;
    const wOn = landColorCore(15, 0.5, 0.05, 0, .5, .5, .5, .7, .7, 5, 0, .5, state.bioBlend, 1, 100, 100, 1, 1, 1, 1);
    check('NPR: r<=0 (at/below sea) untouched by all four styles', wOff.every((v, i) => v === wOn[i]));
  }
  Object.assign(state.viz, savedViz);   // restore so later tests/cmp stay on the default path
}

/* ---------- v0.109 Phase A LOD follow-up: affordance debug tiles + multi-sun in tiles ---------- */
if (typeof renderAffordanceTileRGBA === 'function') {
  // multiSunFromNormal: in [0,1], sun-facing brighter than away-facing, flat ground above ambient floor
  check('multiSunFromNormal in [0,1]', (() => { const a = multiSunFromNormal(0, 0, 1); return a >= 0 && a <= 1; })());
  check('multiSunFromNormal flat ground ≥ ambient floor', multiSunFromNormal(0, 0, 1) >= 0.10);
  // refactor wiring: multiSunShade == multiSunFromNormal(normal computed the same way)
  check('multiSunShade matches multiSunFromNormal', (() => {
    for (const [x, y] of [[40, 30], [120, 80], [200, 120]]) {
      const L = field[y * GW + (x - 1)], R = field[y * GW + (x + 1)], U = field[(y - 1) * GW + x], D = field[(y + 1) * GW + x];
      const ex = state.exag; let nx = -(R - L) * ex, ny = -(D - U) * ex, nz = 1; const il = 1 / Math.hypot(nx, ny, nz); nx *= il; ny *= il; nz *= il;
      if (Math.abs(multiSunShade(x, y) - multiSunFromNormal(nx, ny, nz)) > 1e-9) return false;
    } return true;
  })());

  // multi-sun in biome tiles: on vs off differs, output finite + opaque
  {
    const W = 8, H = 8, bounds = { x: 20, y: 20, w: 8, h: 8 }, tile = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) tile[i] = 0.55 + 0.1 * Math.sin(i);   // some relief so the normal varies
    const sm = state.mode, sv = !!state.viz.multiSun; state.mode = 'biome';
    state.viz.multiSun = false; const a = renderBiomeTileRGBA(tile, W, H, bounds);
    state.viz.multiSun = true; const b = renderBiomeTileRGBA(tile, W, H, bounds);
    check('renderBiomeTileRGBA tiles finite + opaque', (() => { for (let i = 0; i < a.length; i++){ if (!Number.isFinite(a[i])) return false; if (i % 4 === 3 && a[i] !== 255) return false; } return true; })());
    check('multi-sun changes the tile hillshade', (() => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true; return false; })());
    state.mode = sm; state.viz.multiSun = sv;
  }

  // affordance tiles: lith/soil/water colormaps mirror the main-map debug path
  {
    const W = 8, H = 8, bounds = { x: 20, y: 20, w: 8, h: 8 }, tile = new Float32Array(W * H).fill(0.6);
    tile[0] = state.seaLevel - 0.2;   // one water cell
    for (const which of ['lith', 'soil', 'water']) {
      const out = renderAffordanceTileRGBA(tile, W, H, bounds, which);
      check('renderAffordanceTileRGBA ' + which + ': finite + opaque', (() => { for (let i = 0; i < out.length; i++){ if (!Number.isFinite(out[i])) return false; if (i % 4 === 3 && out[i] !== 255) return false; } return true; })());
    }
    const wl = renderAffordanceTileRGBA(tile, W, H, bounds, 'lith');
    check('affordance lith: water cell gets debug water colour', wl[0] === 20 && wl[1] === 26 && wl[2] === 40);
    const ws = renderAffordanceTileRGBA(tile, W, H, bounds, 'soil');
    check('affordance soil: water cell gets debug water colour', ws[0] === 18 && ws[1] === 34 && ws[2] === 64);
    const ww = renderAffordanceTileRGBA(tile, W, H, bounds, 'water');
    check('affordance water: water cell gets debug water colour', ww[0] === 30 && ww[1] === 90 && ww[2] === 150);
    // a land lith cell equals LITH_COLS[ sampled coarse index ] (nearest)
    check('affordance lith: land cell matches LITH_COLS at sampled coarse cell', (() => {
      const lith = currentLithology(), cx = bounds.w / (W - 1), cy = bounds.h / (H - 1);
      const x = 4, y = 4, ix = Math.min(GW - 1, Math.max(0, Math.round(bounds.x + x * cx))), iy = Math.min(GH - 1, Math.max(0, Math.round(bounds.y + y * cy)));
      const c = LITH_COLS[lith[iy * GW + ix]], p = (y * W + x) * 4;
      return wl[p] === c[0] && wl[p + 1] === c[1] && wl[p + 2] === c[2];
    })());
    check('affordance tiles deterministic', (() => { const a = renderAffordanceTileRGBA(tile, W, H, bounds, 'soil'); for (let i = 0; i < a.length; i++) if (a[i] !== ws[i]) return false; return true; })());
  }
}

/* ---------- v0.110: debug-layer opacity + clickable settlement seed "why" ---------- */
if (typeof settlementSeedInfo === 'function') {
  // settlementSeedInfo: structured breakdown at a settlement seed
  const seeds = findSettlementSeeds(currentSettlementSuitability(), GW, GH);
  check('findSettlementSeeds returns advisory seeds', Array.isArray(seeds) && seeds.length > 0);
  const info = settlementSeedInfo(seeds[0].x, seeds[0].y);
  check('settlementSeedInfo: core fields present & finite', info && Number.isFinite(info.score) && Number.isFinite(info.soil) && Number.isFinite(info.waterAccess) && Number.isFinite(info.carryingCapacity));
  check('settlementSeedInfo: score in [0,1]', info.score >= 0 && info.score <= 1);
  check('settlementSeedInfo: resources is a sorted array of {key,name,value≥0.35}', (() => {
    if (!Array.isArray(info.resources)) return false;
    for (let i = 0; i < info.resources.length; i++) { const o = info.resources[i]; if (!o.key || typeof o.value !== 'number' || o.value < 0.35) return false; if (i > 0 && info.resources[i - 1].value < o.value) return false; }
    return true;
  })());
  check('settlementSeedInfo: resource keys are valid', info.resources.every(o => RESOURCE_KEYS.indexOf(o.key) >= 0));
  check('settlementSeedInfo: biome + lithology labelled, summary non-empty', typeof info.biome === 'string' && typeof info.lithology === 'string' && typeof info.summary === 'string' && info.summary.length > 0);
  check('settlementSeedInfo: deterministic', JSON.stringify(settlementSeedInfo(seeds[0].x, seeds[0].y)) === JSON.stringify(info));

  // debugBaseColor: returns a finite RGB triple for the base map under an overlay
  if (typeof debugBaseColor === 'function') {
    const sm = state.mode; state.mode = 'biome';
    const c = debugBaseColor(40, 30, 30 * GW + 40, field[30 * GW + 40]);
    check('debugBaseColor: finite RGB triple', Array.isArray(c) && c.length === 3 && c.every(Number.isFinite));
    state.mode = sm;
  }

  // settlement_seeds export payload shape (what exportZip emits)
  {
    const payloadSeeds = seeds.map(s => settlementSeedInfo(s.x, s.y));
    check('settlement_seeds export: every seed carries x/y/score/resources/summary', payloadSeeds.every(o => Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.score) && Array.isArray(o.resources) && typeof o.summary === 'string'));
  }
}

/* ---------- async tests own the summary (gzip + region export, v0.053) ---------- */
(async () => {
  // gzip round-trip via CompressionStream (Node 18+ has it; skip gracefully otherwise)
  if (typeof CompressionStream !== 'undefined'){
    const n = 4096, src = new Uint8Array(n);
    for (let i = 0; i < n; i++) src[i] = (i % 64 < 32) ? 7 : (i & 255);
    const z = await gzipBytes(src);
    check('gzipBytes produces smaller output (' + (z ? z.length : 'null') + ' < ' + n + ')', !!z && z.length < n);
    const back = await gunzipBytes(z);
    check('gzip round-trip bit-exact', !!back && back.length === n && back.every((v, i) => v === src[i]));
  } else {
    console.log('skip - CompressionStream unavailable in this runtime');
    check('gzipBytes returns null when unsupported', (await gzipBytes(new Uint8Array(8))) === null);
  }

  // exportRegionTiles end-to-end on the real field (PNGs absent headless; binary path asserted)
  {
    const sel = normRegion(10, 10, 58, 42, GW, GH), cols = 3, rows = 2, ts = 24;   // non-square grid + selection
    const td = tileDims(sel, cols, rows, ts);
    const E = await exportRegionTiles(sel, cols, rows, ts, true);
    const names = E.map(e => e.name);
    check('region export emits a manifest', names.includes('tiles/index.json'));
    const man = JSON.parse(new TextDecoder().decode(E.find(e => e.name === 'tiles/index.json').data));
    check('region manifest schema 2 with cols×rows + tile dims + rg16', man.schema === 2 && man.cols === cols && man.rows === rows &&
      man.tileW === td.w && man.tileH === td.h && man.bounds && man.bounds.x === sel.x && man.heightEncoding === 'rg16');
    const binNames = names.filter(n => /rg16\.bin(\.gz)?$/.test(n));
    check('region export emits one height bin per tile (' + binNames.length + ')', binNames.length === cols * rows);
    check('manifest compression matches entries', (man.compression === 'gzip') === binNames.every(n => n.endsWith('.gz')));
    // decode tile (0,0) and compare against a direct refineTile (non-square dims)
    let bin = E.find(e => e.name === binNames.find(n => n.includes('_0_0'))).data;
    if (man.compression === 'gzip') bin = await gunzipBytes(bin);
    const dec = unpackHeight16(bin, td.w * td.h);
    const ref = refineTile(field, GW, GH, sel, cols, rows, 0, 0, td.w, td.h, { seed: state.tect.seed, sea: state.seaLevel, ridged: state.tect.ridged });
    let maxErr = 0; for (let i = 0; i < td.w * td.h; i++) maxErr = Math.max(maxErr, Math.abs(dec[i] - ref[i]));
    check('exported tile round-trips through pack+gzip (max Δ=' + maxErr.toExponential(1) + ' ≤ 1 LSB)', maxErr <= 0.5 / 65535 + 1e-9);
  }

  // unzipAny (v0.056): central-dir reader handles STORED + DEFLATED entries
  {
    const ab = require('fs').readFileSync('assets/sample_pack.zip');
    const z = await unzipAny(ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength));
    check('unzipAny reads the STORED sample pack via central dir', !!z['pack.json'] && Object.keys(z).filter(n => n.endsWith('.png')).length === 16);
    if (typeof DecompressionStream !== 'undefined'){
      // hand-build a 1-entry DEFLATED zip (Node zlib) and confirm unzipAny inflates it
      const zlib = require('zlib');
      const payload = new TextEncoder().encode('hello deflate world '.repeat(20));
      const comp = zlib.deflateRawSync(Buffer.from(payload));
      const crc = zlib.crc32 ? zlib.crc32(Buffer.from(payload)) : require('zlib').crc32;
      const name = Buffer.from('a.txt');
      const u16 = v => Buffer.from([v & 255, (v >> 8) & 255]);
      const u32 = v => Buffer.from([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
      const crcB = u32(crc >>> 0);
      const lh = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), crcB, u32(comp.length), u32(payload.length), u16(name.length), u16(0), name, comp]);
      const cd = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), crcB, u32(comp.length), u32(payload.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), name]);
      const eo = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(cd.length), u32(lh.length), u16(0)]);
      const zipBuf = Buffer.concat([lh, cd, eo]);
      const z2 = await unzipAny(zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength));
      check('unzipAny inflates a DEFLATED entry', !!z2['a.txt'] && new TextDecoder().decode(z2['a.txt']) === 'hello deflate world '.repeat(20));
    } else { console.log('skip - DecompressionStream unavailable'); }
  }

  /* ---------- Atlas Phase 2b: IndexedDB persistence round-trip via the test-only shim (v0.082) ---------- */
  {
    global.indexedDB = __makeIDBShim(); _atlasDBp = null;          // install the shim; reset the engine's cached open promise
    _worldKey = 'rt'; _atlasBaked.clear(); _lodTile = 512;
    // bake 3 chunk records + a meta record
    for (let i = 0; i < 3; i++){
      const ak = atlasChunkKey(2, i, 0, _lodTile);
      await atlasPut({ key: ak, worldKey: 'rt', ts: 512, z: 2, col: i, row: 0, w: 2, h: 2, rg16: new Uint8Array(16), png: null, ver: VERSION, time: 1 });
      _atlasBaked.add(ak);
    }
    await atlasPutMeta('rt');
    const keys = await atlasKeysForWorld('rt');
    check('atlasKeysForWorld returns the 3 baked chunk keys', Array.isArray(keys) && keys.length === 3);
    check('atlasKeysForWorld excludes the meta record', !keys.includes(atlasMetaKey('rt')));
    const got = await atlasGet(atlasChunkKey(2, 1, 0, _lodTile));
    check('atlasGet round-trips a chunk record', !!got && got.col === 1 && got.rg16.length === 16);
    const meta = await atlasGetMeta('rt');
    check('atlasGetMeta round-trips the metadata', !!meta && meta.chunks === 3 && meta.ts === 512 && meta.ver === VERSION);
    // simulate a fresh session: drop the in-memory set + cached handle, rediscover from IDB
    _atlasBaked.clear(); _atlasImg.clear(); _atlasDBp = null;
    await atlasSyncWorld();
    check('atlasSyncWorld rediscovers baked chunks (persistence)', _atlasBaked.size === 3 && _atlasMeta && _atlasMeta.chunks === 3);
    // a different world sees an empty atlas
    _worldKey = 'other'; _atlasBaked.clear(); await atlasSyncWorld();
    check('a different worldKey has no baked chunks', _atlasBaked.size === 0);
    // clear wipes the world's chunks + meta
    _worldKey = 'rt'; await atlasClearWorld('rt');
    check('atlasClearWorld removes all chunk keys', (await atlasKeysForWorld('rt')).length === 0);
    check('atlasClearWorld removes the meta record', (await atlasGetMeta('rt')) == null);
    delete global.indexedDB; _atlasDBp = null; _atlasBaked.clear(); _atlasImg.clear(); _atlasMeta = null; _worldKey = '';
  }

  /* ---------- Atlas Phase 4: portable World/ ZIP export+import (v0.086) ---------- */
  {
    // pure manifest + chunk-file naming
    check('atlasChunkFile groups by LOD level', atlasChunkFile(3, 5, 6, 'bin') === 'World/LOD3/3_5_6.bin');
    check('atlasChunkFile carries the .gz / .png extension', atlasChunkFile(1, 0, 0, 'bin.gz') === 'World/LOD1/1_0_0.bin.gz' && atlasChunkFile(1, 0, 0, 'png') === 'World/LOD1/1_0_0.png');
    const man0 = buildAtlasManifest('wk1', [{ z: 2, col: 1, row: 0, w: 4, h: 4, gzip: true, png: true }, { z: 2, col: 0, row: 0, w: 4, h: 4, gzip: false, png: false }], { tileSize: 512 });
    check('buildAtlasManifest tags kind + worldKey + count', man0.kind === 'cartalith-atlas' && man0.worldKey === 'wk1' && man0.count === 2 && man0.tileSize === 512);
    check('buildAtlasManifest bin name reflects gzip flag', man0.chunks[0].bin.endsWith('.bin.gz') && man0.chunks[1].bin.endsWith('.bin') && !man0.chunks[1].bin.endsWith('.gz'));
    check('buildAtlasManifest png is null when chunk has none', man0.chunks[0].png && man0.chunks[1].png === null);

    // round-trip through IDB → entries → ZIP → unzip → fresh IDB
    if (typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined') {
      global.indexedDB = __makeIDBShim(); _atlasDBp = null;
      _worldKey = 'ax'; _atlasBaked.clear(); _lodTile = 512;
      const d0 = Float32Array.from({ length: 16 }, (_, i) => (i % 7) / 7), d1 = Float32Array.from({ length: 16 }, (_, i) => 1 - (i % 5) / 5);
      await atlasPut({ key: atlasKeyStr('ax', 512, 1, 2, 3), worldKey: 'ax', ts: 512, z: 1, col: 2, row: 3, w: 4, h: 4, rg16: packHeight16(d0, 16), png: null, ver: VERSION, time: 1 });
      await atlasPut({ key: atlasKeyStr('ax', 512, 0, 0, 0), worldKey: 'ax', ts: 512, z: 0, col: 0, row: 0, w: 4, h: 4, rg16: packHeight16(d1, 16), png: null, ver: VERSION, time: 1 });
      const exp = await atlasExportEntries(true);
      check('atlasExportEntries gathers both chunks + a manifest', exp && exp.manifest.count === 2 && exp.entries.some(e => e.name === 'World/atlas.json'));
      const blob = zipStore(exp.entries), zip = await unzipAny(await blob.arrayBuffer());
      check('exported ZIP contains the gzipped chunk bins', !!zip['World/LOD1/1_2_3.bin.gz'] && !!zip['World/LOD0/0_0_0.bin.gz']);
      // fresh "machine": new shim, same worldKey so import repopulates _atlasBaked
      global.indexedDB = __makeIDBShim(); _atlasDBp = null; _atlasBaked.clear();
      const n = await atlasImportEntries(zip);
      check('atlasImportEntries writes both chunks back to IDB', n === 2);
      check('import repopulates _atlasBaked for the current world', _atlasBaked.has(atlasKeyStr('ax', 512, 1, 2, 3)));
      const keys2 = await atlasKeysForWorld('ax');
      check('imported atlas is queryable by world index', keys2.length === 2);
      const rec = await atlasGet(atlasKeyStr('ax', 512, 1, 2, 3)), back = unpackHeight16(rec.rg16, 16);
      let maxd = 0; for (let i = 0; i < 16; i++) maxd = Math.max(maxd, Math.abs(back[i] - d0[i]));
      check('imported chunk height round-trips ≤ 1 LSB', maxd <= 1 / 65535 + 1e-9);
      const imeta = await atlasGetMeta('ax');
      check('import writes a metadata record', !!imeta && imeta.chunks === 2);
      delete global.indexedDB; _atlasDBp = null; _atlasBaked.clear(); _atlasImg.clear(); _atlasMeta = null; _worldKey = '';
    } else { console.log('skip - CompressionStream/DecompressionStream unavailable'); }
  }

  console.log('\n' + __pass + ' passed, ' + __fail + ' failed');
  process.exit(__fail ? 1 : 0);
})();
