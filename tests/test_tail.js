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
  check('biome raster length = GW×GH', raster.length === GW * GH);
  let valid = true, oceanMatchesSea = true, distinct = new Set();
  const maxIdx = BIOME_KEYS.length; // ocean=0, biomes 1..maxIdx
  for (let i = 0; i < raster.length; i++){
    const v = raster[i];
    if (v < 0 || v > maxIdx || (v | 0) !== v){ valid = false; break; }
    distinct.add(v);
    const isSea = field[i] < state.seaLevel;
    if (isSea !== (v === 0)){ oceanMatchesSea = false; }
  }
  check('biome raster values are valid indices (0..' + maxIdx + ')', valid);
  check('biome raster: index 0 ⇔ below sea level', oceanMatchesSea);
  check('biome raster has multiple biomes (' + distinct.size + ' distinct)', distinct.size >= 3);
  const man = biomeIndexManifest();
  check('manifest covers every index in the raster', [...distinct].every(v => man.indices[String(v)] !== undefined));
  check('manifest index order is frozen (ocean=0, ice=1, tropWet=12)',
    man.indices['0'].key === 'ocean' && man.indices['1'].key === 'ice' && man.indices[String(BIOME_KEYS.length)].key === 'tropWet');
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

console.log('\n' + __pass + ' passed, ' + __fail + ' failed');
process.exit(__fail ? 1 : 0);
