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

console.log('\n' + __pass + ' passed, ' + __fail + ' failed');
process.exit(__fail ? 1 : 0);
