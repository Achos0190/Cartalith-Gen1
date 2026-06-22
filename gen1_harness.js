"use strict";
/* =====================================================================================================
 * Cartalith Gen1 v0.04 — parent shell harness.
 *
 * Mounts three single-file tools into ONE document, each inside its own Shadow DOM host (NO iframes).
 *   - Shadow DOM isolates each tool's CSS + element ids (both tools' #view, .row, .seg coexist).
 *   - Each tool's app script runs in an IIFE (via new Function) with `window`/`document`/`self` shadowed
 *     by proxies, so DOM queries resolve against the tool's shadow root while creation/global calls fall
 *     through to the real document/window. Same-origin (not an iframe), so Web Workers, WebGL2 and
 *     IndexedDB all work normally — which is what the iframe srcdoc build broke under file://.
 *
 * Carriers (emitted by build_gen4.py, `</script` backslash-escaped, reversed at runtime):
 *   <script type="text/cartalith-css"  data-tool="X"> transformed CSS (:root/html/body -> :host) </script>
 *   <script type="text/cartalith-body" data-tool="X"> body markup (no <script>/<style>)          </script>
 *   <script type="text/cartalith-lib"  data-tool="X"> library source (e.g. fflate), run as a global </script>
 *   <script type="text/cartalith-app"  data-tool="X"> app source + export tail                    </script>
 * ===================================================================================================== */

const TOOLS = ["generate", "cartograph", "assets"];
const TOOL_PANE = { generate: "pane-generate", cartograph: "pane-cartograph", assets: "pane-assets" };
const mods = {};        // tool -> exports object (public surface captured by the export tail)
const mounted = {};     // tool -> bool
let activeTab = "generate";

/* ---------- tiny utils ---------- */
function $(id) { return document.getElementById(id); }
function unesc(s) { return s.replace(/<\\\/(script)/gi, "</$1"); }
function strToU8(s) { return new TextEncoder().encode(s); }
function u8(b) { return (b instanceof Uint8Array) ? b : new Uint8Array(b); }
function dataUrlToU8(d) { const i = d.indexOf(","); const bin = atob(d.slice(i + 1)); const a = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k); return a; }
function dateStr() { return new Date().toISOString().slice(0, 10); }
let _toastT = null;
function toast(msg, ms) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); if (_toastT) clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove("show"), ms || 2600); }
function download(bytes, name) { const blob = new Blob([bytes], { type: "application/octet-stream" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }

/* ---------- carrier access ---------- */
function readCarrier(type, tool) {
  const el = document.querySelector('script[type="text/cartalith-' + type + '"][data-tool="' + tool + '"]');
  return el ? unesc(el.textContent) : null;
}
function readCarriers(type, tool) {
  return [...document.querySelectorAll('script[type="text/cartalith-' + type + '"][data-tool="' + tool + '"]')].map((el) => unesc(el.textContent));
}

/* ---------- per-tool document/window proxies ----------
 * The tool's source references bare `document`/`window`; inside new Function these resolve to the proxy
 * params. Query methods go to the shadow root; creation, body, listeners and everything else fall through
 * to the real document/window so canvases, downloads, workers, IndexedDB etc. behave normally. */
function makeDocProxy(root, host) {
  const real = document;
  return new Proxy(real, {
    get(t, prop) {
      switch (prop) {
        case "getElementById": return (id) => root.getElementById(id);
        case "querySelector": return (sel) => root.querySelector(sel);
        case "querySelectorAll": return (sel) => root.querySelectorAll(sel);
        case "getElementsByClassName": return (c) => root.querySelectorAll("." + (window.CSS && CSS.escape ? CSS.escape(c) : c));
        case "getElementsByTagName": return (tn) => root.querySelectorAll(tn);
        case "body": return host;               // the tool's "body" == its shadow host (classList + appends)
        case "activeElement": return root.activeElement;   // focus inside the shadow tree
        case "addEventListener": return (type, fn, opt) => {
          if (type === "DOMContentLoaded" || type === "load") { setTimeout(fn, 0); return; }
          return real.addEventListener(type, fn, opt);
        };
      }
      const v = t[prop];
      return (typeof v === "function") ? v.bind(t) : v;
    },
    set(t, prop, val) { try { t[prop] = val; } catch (e) {} return true; },
  });
}
function makeWinProxy() {
  const real = window;
  return new Proxy(real, {
    get(t, prop) {
      if (prop === "addEventListener") return (type, fn, opt) => {
        if ((type === "DOMContentLoaded" || type === "load") && document.readyState !== "loading") { setTimeout(fn, 0); return; }
        return real.addEventListener(type, fn, opt);
      };
      const v = t[prop];
      return (typeof v === "function") ? v.bind(t) : v;
    },
    set(t, prop, val) { try { t[prop] = val; } catch (e) {} return true; },
  });
}

/* ---------- mount a tool into its pane (lazy, once) ---------- */
function mountTool(tool) {
  if (mounted[tool]) return mods[tool];
  mounted[tool] = true;
  const pane = $(TOOL_PANE[tool]);
  const host = document.createElement("div");
  host.className = "tool-host";
  pane.innerHTML = "";
  pane.appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  // CSS (already transformed :root/html/body -> :host by the build)
  const css = readCarrier("css", tool);
  if (css) { const st = document.createElement("style"); st.textContent = css; root.appendChild(st); }
  syncHostTheme(host);

  // body markup -> shadow tree
  const body = readCarrier("body", tool) || "";
  const tpl = document.createElement("template"); tpl.innerHTML = body;
  root.appendChild(tpl.content);

  // library scripts (e.g. fflate) run as real globals BEFORE the app (the app reads them off window)
  for (const lib of readCarriers("lib", tool)) {
    const s = document.createElement("script"); s.textContent = lib; document.head.appendChild(s); s.remove();
  }

  // app script: run in an IIFE with shadowed window/document/self; capture exports via __X
  const app = readCarrier("app", tool);
  const exportsObj = {};
  const winP = makeWinProxy();
  const docP = makeDocProxy(root, host);
  if (app) {
    try {
      const fn = new Function("window", "document", "self", "__X", app);
      fn(winP, docP, winP, exportsObj);
    } catch (e) {
      console.error("[Gen1 mount " + tool + "]", e);
      toast("The " + tool + " tool failed to start — see console.");
    }
  }
  mods[tool] = exportsObj;
  return exportsObj;
}

/* ---------- theme ---------- */
function currentTheme() { return document.documentElement.getAttribute("data-theme"); }
function syncHostTheme(host) {
  const dt = currentTheme();
  if (dt == null) host.removeAttribute("data-theme"); else host.setAttribute("data-theme", dt);
}
function syncAllHostThemes() { document.querySelectorAll(".tool-host").forEach(syncHostTheme); }
function applyTheme(theme) {
  // theme: 'dark' (attribute present) | null/'auto' (attribute absent => the tools' default/light cascade)
  if (theme == null || theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("maptool_theme", theme || "auto"); } catch (e) {}
  syncAllHostThemes();
  const btn = $("themeBtn"); if (btn) btn.textContent = (currentTheme() ? "◐ Dark" : "◑ Light");
}
function toggleTheme() { applyTheme(currentTheme() ? "auto" : "dark"); }

/* ---------- tabs ---------- */
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".pane").forEach((p) => p.classList.remove("on"));
  $("pane-" + tab).classList.add("on");
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (tab !== "info") mountTool(tab);
  updateFlowbar();
  // tools that size to their container often need a resize nudge once shown
  if (tab !== "info") setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
}

/* ---------- flow / handoff bar ---------- */
function updateFlowbar() {
  const bar = $("flowbar"), msg = $("fbMsg"), btn = $("fbBtn");
  bar.classList.remove("hide"); btn.classList.add("hidden");
  if (activeTab === "generate") {
    msg.innerHTML = "<b>Generate</b> a world, then send it straight into the cartographer as a base map with biome &amp; terrain paint grids.";
    btn.textContent = "Send world → Cartograph"; btn.classList.remove("hidden"); btn.onclick = handoffWorldToCartograph;
  } else if (activeTab === "assets") {
    msg.innerHTML = "<b>Author</b> a texture/icon pack, then push it into the world engine's renderer.";
    btn.textContent = "Send pack → Generate"; btn.classList.remove("hidden"); btn.onclick = handoffPackToGenerate;
  } else if (activeTab === "cartograph") {
    msg.innerHTML = "Draw routes, settlements and politics over your generated world. <b>Project ▾ → Save</b> stores the whole project in one file.";
  } else { bar.classList.add("hide"); }
}

/* ---------- capture a tool's native blob-download without actually downloading ---------- */
function captureDownload(trigger) {
  return new Promise((resolve) => {
    let captured = null;
    const proto = HTMLAnchorElement.prototype;
    const orig = proto.click;
    proto.click = function () {
      try { if (this.download && this.href && /^blob:/.test(this.href)) { captured = { url: this.href, name: this.download }; return; } } catch (e) {}
      return orig.apply(this, arguments);
    };
    const finish = () => {
      proto.click = orig;
      if (!captured) { resolve(null); return; }
      fetch(captured.url).then((r) => r.arrayBuffer()).then((ab) => resolve({ name: captured.name, bytes: new Uint8Array(ab) })).catch(() => resolve(null));
    };
    let r;
    try { r = trigger(); } catch (e) { proto.click = orig; resolve(null); return; }
    if (r && typeof r.then === "function") r.then(() => setTimeout(finish, 80), () => { proto.click = orig; resolve(null); });
    else setTimeout(finish, 80);
  });
}
function shadowOf(tool) { const pane = $(TOOL_PANE[tool]); const host = pane && pane.querySelector(".tool-host"); return host && host.shadowRoot; }

/* ---------- native save per tool (full-fidelity, the engine's own format) ---------- */
function toolSave(tool) {
  if (tool === "generate") { const m = mods.generate; return captureDownload(() => m && m.exportZip && m.exportZip()); }
  if (tool === "cartograph") { return captureDownload(() => { const r = shadowOf("cartograph"); const b = r && r.getElementById("saveBtn"); if (b) b.click(); }); }
  if (tool === "assets") { const m = mods.assets; return captureDownload(() => m && m.exportPack && m.exportPack()); }
  return Promise.resolve(null);
}
function fileFrom(bytes, name, mime) { const arr = u8(bytes); try { return new File([arr], name, { type: mime || "application/octet-stream" }); } catch (e) { const bl = new Blob([arr], { type: mime || "application/octet-stream" }); bl.name = name; return bl; } }
function toolLoadProject(tool, bytes) {
  if (tool === "generate") { const m = mods.generate; if (m && m.loadZip) return m.loadZip(fileFrom(bytes, "world.zip", "application/zip")); }
  if (tool === "cartograph") { const m = mods.cartograph; if (m && m.loadFromZip) { m.loadFromZip(u8(bytes).slice().buffer); return Promise.resolve(); } }
  return Promise.resolve();
}

/* ---------- minimal STORED zip (writer + reader) for the outer .cartalith bundle ---------- */
const _CRC = (function () { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(a) { let c = 0xFFFFFFFF; for (let i = 0; i < a.length; i++) c = _CRC[(c ^ a[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(entries) {
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  for (const e of entries) {
    const nb = enc.encode(e.name); const data = u8(e.data); const crc = crc32(data);
    const lh = new Uint8Array(30 + nb.length); const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true); dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true); dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, nb.length, true); dv.setUint16(28, 0, true);
    lh.set(nb, 30); parts.push(lh, data);
    const ch = new Uint8Array(46 + nb.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nb.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true); cv.setUint32(42, offset, true); ch.set(nb, 46); central.push(ch);
    offset += lh.length + data.length;
  }
  let cSize = 0; for (const c of central) cSize += c.length;
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cSize, true); ev.setUint32(16, offset, true);
  const total = offset + cSize + 22; const out = new Uint8Array(total); let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  for (const c of central) { out.set(c, p); p += c.length; }
  out.set(end, p); return out;
}
function zipRead(buf) {
  const a = u8(buf); const dv = new DataView(a.buffer, a.byteOffset, a.byteLength);
  let i = a.length - 22; for (; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) break; }
  if (i < 0) throw new Error("not a project bundle");
  const count = dv.getUint16(i + 10, true); let p = dv.getUint32(i + 16, true); const out = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(a.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true), dstart = lho + 30 + lnlen + lelen;
    out[name] = a.subarray(dstart, dstart + csize).slice();
    p += 46 + nlen + elen + clen;
  }
  return out;
}

/* ---------- handoff: Generate → Cartograph (direct calls, same page) ---------- */
function extractWorld() {
  const m = mounted.generate ? mods.generate : mountTool("generate");
  const r = shadowOf("generate");
  const view = r && r.getElementById("view");
  let gw = view ? view.width : 0, gh = view ? view.height : 0, km = 800;
  let imageDataUrl = null, biomeRLE = null, terrainRLE = null;
  try { imageDataUrl = view ? view.toDataURL("image/png") : null; } catch (e) {}
  try { biomeRLE = u8(m.encodeBiomeRLE(m.buildCartBiome())); } catch (e) {}
  try { terrainRLE = u8(m.encodeBiomeRLE(m.buildCartTerrain())); } catch (e) {}
  try { const man = m.cartalithGridManifest(); gw = man.widthCells; gh = man.heightCells; km = man.mapWidthKm; } catch (e) {}
  return { gw, gh, mapWidthKm: km, imageDataUrl, biomeRLE, terrainRLE };
}
function buildCartographProject(parts) {
  const gw = parts.gw || 0, gh = parts.gh || 0, km = parts.mapWidthKm || 800;
  const proj = {
    version: 9,
    image: parts.imageDataUrl ? { name: "generated.png", mime: "image/png", width: gw, height: gh } : null,
    grid: { cellSize: 1, appliedCellSize: 1, widthCells: gw, heightCells: gh, baked: true },
    terrain: parts.terrainRLE ? { baked: true } : null,
    calibration: { calibrated: true, pixelsPerUnit: (km > 0 ? gw / km : 1), unit: "km", points: [] },
    routes: [], places: [], ways: [],
    politics: { polities: [], timeline: { start: 1, end: 10, interval: 1 }, activeYear: 1, opacity: 0.5, showInRoutes: true, years: [] },
    activeRouteId: null,
    filters: { settlements: true, pois: true, hiddenClasses: [], hiddenPoiTypes: [] },
  };
  const entries = [{ name: "project.json", data: strToU8(JSON.stringify(proj)) }];
  if (parts.imageDataUrl) entries.push({ name: "image.png", data: dataUrlToU8(parts.imageDataUrl) });
  if (parts.biomeRLE) entries.push({ name: "biome_baked.bin", data: u8(parts.biomeRLE) });
  if (parts.terrainRLE) entries.push({ name: "terrain_baked.bin", data: u8(parts.terrainRLE) });
  return zipStore(entries);
}
async function handoffWorldToCartograph() {
  const btn = $("fbBtn"); btn.disabled = true;
  try {
    toast("Sending world to the cartographer…", 6000);
    const parts = extractWorld();
    if (!parts || (!parts.biomeRLE && !parts.imageDataUrl)) { toast("Could not read the generated world."); return; }
    const zip = buildCartographProject(parts);
    mountTool("cartograph");
    await toolLoadProject("cartograph", zip);
    switchTab("cartograph");
    toast("World opened in Cartograph — base map, biome & terrain grids loaded.");
  } catch (err) { toast("Handoff failed: " + (err && err.message)); }
  finally { btn.disabled = false; }
}

/* ---------- handoff: Asset Packs → Generate ---------- */
async function handoffPackToGenerate() {
  const btn = $("fbBtn"); btn.disabled = true;
  try {
    toast("Packing your assets…", 6000);
    const res = await toolSave("assets");
    if (!res || !res.bytes) { toast("No assets to send — add textures or icons first."); return; }
    const m = mounted.generate ? mods.generate : mountTool("generate");
    if (m && m.loadAssetPack) await m.loadAssetPack(fileFrom(res.bytes, res.name || "pack.zip", "application/zip"));
    switchTab("generate");
    toast("Asset pack loaded into the world engine.");
  } catch (err) { toast("Handoff failed: " + (err && err.message)); }
  finally { btn.disabled = false; }
}

/* ---------- unified SAVE ---------- */
async function saveProject() {
  toast("Gathering all changes (this may bake the world)…", 12000);
  const results = {};
  for (const t of TOOLS) {
    if (!mounted[t]) continue;       // only tools opened this session can hold state
    const res = await toolSave(t);
    if (res && res.bytes) results[t] = res;
  }
  const manifest = { kind: "cartalith-gen1-project", version: "0.04", author: "V. Post", created: new Date().toISOString(), components: {} };
  const entries = [];
  if (results.generate) { entries.push({ name: "generate/world.zip", data: results.generate.bytes }); manifest.components.generate = results.generate.name || "world.zip"; }
  if (results.cartograph) { entries.push({ name: "cartograph/project.zip", data: results.cartograph.bytes }); manifest.components.cartograph = results.cartograph.name || "project.zip"; }
  if (results.assets) { entries.push({ name: "assets/pack.zip", data: results.assets.bytes }); manifest.components.assets = results.assets.name || "pack.zip"; }
  entries.unshift({ name: "manifest.json", data: strToU8(JSON.stringify(manifest, null, 2)) });
  if (entries.length === 1) { toast("Nothing to save yet — generate or edit something first."); return; }
  download(zipStore(entries), "worldbuilding_" + dateStr() + ".cartalith");
  const n = Object.keys(results).length;
  toast("Saved unified project — " + n + " tool" + (n === 1 ? "" : "s") + " bundled.");
}

/* ---------- unified OPEN ---------- */
async function openProject(file) {
  let entries;
  try { entries = zipRead(new Uint8Array(await file.arrayBuffer())); }
  catch (err) { toast("Not a Cartalith project bundle."); return; }
  let any = false, target = null;
  if (entries["generate/world.zip"]) { any = true; mountTool("generate"); await toolLoadProject("generate", entries["generate/world.zip"]); target = target || "generate"; }
  if (entries["assets/pack.zip"]) { any = true; const m = mountTool("generate"); if (m && m.loadAssetPack) await m.loadAssetPack(fileFrom(entries["assets/pack.zip"], "pack.zip", "application/zip")); }
  if (entries["cartograph/project.zip"]) { any = true; mountTool("cartograph"); await toolLoadProject("cartograph", entries["cartograph/project.zip"]); target = "cartograph"; }
  if (!any) { toast("Bundle contained no tool data."); return; }
  switchTab(target || "generate");
  toast("Project opened — all saved tools restored.");
}

/* ---------- wiring ---------- */
function boot() {
  // theme from storage
  let saved = "auto"; try { saved = localStorage.getItem("maptool_theme") || "auto"; } catch (e) {}
  applyTheme(saved);

  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) switchTab(b.dataset.tab); });
  const tb = $("themeBtn"); if (tb) tb.addEventListener("click", toggleTheme);

  const m = $("projMenu"), b = $("projBtn");
  b.addEventListener("click", (e) => { e.stopPropagation(); m.classList.toggle("open"); });
  document.addEventListener("click", () => m.classList.remove("open"));
  $("pmSave").addEventListener("click", () => { m.classList.remove("open"); saveProject(); });
  $("pmOpen").addEventListener("click", () => { m.classList.remove("open"); $("openInput").click(); });
  $("pmInfo").addEventListener("click", () => { m.classList.remove("open"); switchTab("info"); });
  $("pmNew").addEventListener("click", () => { m.classList.remove("open"); if (confirm("Start a new project? Unsaved changes in all tools will be lost.")) location.reload(); });
  $("openInput").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) openProject(f); e.target.value = ""; });

  // boot the default tab's engine immediately so a world generates
  mountTool("generate");
  updateFlowbar();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
