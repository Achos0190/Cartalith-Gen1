/* Headless browser stub for running elevation_foundation's <script> under Node.
 * Provides just enough DOM for module-level code: elements with value/checked/
 * style/classList, canvas with a 2D context, and a webgl2 context that returns
 * null so all GPU paths fall back to CPU. Prepend to the extracted JS. */
'use strict';

function makeClassList(){
  const s = new Set();
  return {
    add(c){ s.add(c); }, remove(c){ s.delete(c); },
    toggle(c, force){ const on = force === undefined ? !s.has(c) : !!force; on ? s.add(c) : s.delete(c); return on; },
    contains(c){ return s.has(c); }
  };
}

function make2dCtx(canvas){
  return {
    canvas,
    createImageData(w, h){ return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    getImageData(x, y, w, h){ return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(){}, drawImage(){},
    fillRect(){}, strokeRect(){}, clearRect(){},
    beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, arc(){}, rect(){},
    quadraticCurveTo(){}, bezierCurveTo(){}, ellipse(){},
    stroke(){}, fill(){}, setLineDash(){},
    save(){}, restore(){}, scale(){}, translate(){}, setTransform(){},
    measureText(){ return { width: 0 }; }, fillText(){}, strokeText(){}
  };
}

function makeEl(id, tag){
  const el = {
    id, tagName: (tag || 'div').toUpperCase(),
    value: '', textContent: '', innerHTML: '',
    checked: false, disabled: false,
    style: {}, dataset: {}, options: [], children: [],
    classList: makeClassList(),
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){},
    appendChild(c){ this.children.push(c); return c; }, removeChild(){},
    closest(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; },
    setAttribute(){}, getAttribute(){ return null; }, focus(){}, blur(){}, click(){},
    getBoundingClientRect(){ return { left: 0, top: 0, width: this.width || 512, height: this.height || 328 }; }
  };
  return el;
}

function makeCanvas(id){
  const c = makeEl(id, 'canvas');
  c.width = 300; c.height = 150;
  c.getContext = function(type){ return type === '2d' ? make2dCtx(c) : null; }; // webgl2 → null ⇒ CPU fallback
  c.toBlob = function(cb){ cb(null); };
  c.toDataURL = function(){ return 'data:,'; };
  return c;
}

const __els = new Map();
const CANVAS_IDS = new Set(['view', 'polyOverlay']);

global.document = {
  getElementById(id){
    if (!__els.has(id)) __els.set(id, CANVAS_IDS.has(id) ? makeCanvas(id) : makeEl(id));
    return __els.get(id);
  },
  createElement(tag){ return tag === 'canvas' ? makeCanvas() : makeEl(undefined, tag); },
  querySelector(){ return null; },
  querySelectorAll(){ return []; },
  addEventListener(){},
  body: makeEl('body')
};

global.window = new Proxy(global, { get: (t, k) => (k === 'devicePixelRatio' ? 1 : t[k]) });
if (!global.addEventListener){ global.addEventListener = () => {}; global.removeEventListener = () => {}; }
global.requestAnimationFrame = fn => setTimeout(fn, 0);
global.cancelAnimationFrame = id => clearTimeout(id);
global.Image = class { constructor(){ this.onload = null; this.onerror = null; } set src(_){} };
global.FileReader = class { readAsArrayBuffer(){} readAsDataURL(){} };
global.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };
try { global.navigator = { userAgent: 'node-headless' }; } catch (_) { /* node ≥21: read-only global, built-in is fine */ }
if (!global.URL.createObjectURL){ global.URL.createObjectURL = () => 'blob:stub'; global.URL.revokeObjectURL = () => {}; }
if (typeof global.alert === 'undefined') global.alert = () => {};
// IndexedDB is intentionally NOT stubbed: the Atlas (v0.081+) feature-detects `typeof indexedDB==='undefined'`
// and no-ops headless, so the engine stays bit-identical to the no-IDB path. Only the pure cores are tested here.
