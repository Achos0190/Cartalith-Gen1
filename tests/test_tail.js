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

/* ---------- erosion pipeline keeps field finite ---------- */
const savedDroplets = state.erosion.droplets;
state.erosion.droplets = 5000;
erode();                 fieldsFinite('dropletErode');
state.erosion.droplets = savedDroplets;
erodeThermal(2);         fieldsFinite('thermal');
hillslopeDiffuse();      fieldsFinite('diffuse');
streamPowerErode();      fieldsFinite('streamPower');
glacialErode();          fieldsFinite('glacial');
coastalProcess();        fieldsFinite('coastal');
computeFlow();           check('flow after erosion finite', allFinite(flowField));
refreshClimate();        check('climate refresh finite', allFinite(tempField) && allFinite(rainField));

/* ---------- render produces a full RGBA buffer ---------- */
renderNow();
check('render wrote opaque pixels', img.data.length === GW * GH * 4 && img.data[3] === 255);

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

console.log('\n' + __pass + ' passed, ' + __fail + ' failed');
process.exit(__fail ? 1 : 0);
