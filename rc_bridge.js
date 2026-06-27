/* =====================================================================================================
 * Cartalith RC — in-frame BRIDGE (injected, unmodified-app-side).
 * Runs inside each embedded tool's document. Talks to the parent shell over postMessage only
 * (frames are isolated; no shared globals), driving each tool's OWN native save/load/export so the
 * unified project uses each engine's own, fully-tested format verbatim. window.__RC_TOOL__ is set by
 * the assembler to 'generate' | 'cartograph' | 'assets'.
 * ===================================================================================================== */
(function () {
  "use strict";
  var NS = "cartalith-rc";
  var TOOL = window.__RC_TOOL__ || "unknown";

  function send(msg) { msg.ns = NS; msg.tool = TOOL; try { parent.postMessage(msg, "*"); } catch (e) {} }
  function u8(b) { return (b instanceof Uint8Array) ? b : new Uint8Array(b); }
  function fileFrom(bytes, name, mime) {
    var arr = u8(bytes);
    try { return new File([arr], name, { type: mime || "application/octet-stream" }); }
    catch (e) { var bl = new Blob([arr], { type: mime || "application/octet-stream" }); bl.name = name; return bl; }
  }

  /* Capture a native download (the apps all save via a blob-URL <a download>.click()) WITHOUT
     letting the browser actually download it — we want the bytes for the unified bundle. */
  function captureDownload(trigger) {
    return new Promise(function (resolve) {
      var captured = null;
      var proto = HTMLAnchorElement.prototype;
      var orig = proto.click;
      proto.click = function () {
        try {
          if (this.download && this.href && /^blob:/.test(this.href)) { captured = { url: this.href, name: this.download }; return; }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      var finish = function () {
        proto.click = orig;
        if (!captured) { resolve(null); return; }
        fetch(captured.url).then(function (r) { return r.arrayBuffer(); })
          .then(function (ab) { resolve({ name: captured.name, bytes: new Uint8Array(ab) }); })
          .catch(function () { resolve(null); });
      };
      var r;
      try { r = trigger(); } catch (e) { proto.click = orig; resolve(null); return; }
      if (r && typeof r.then === "function") { r.then(function () { setTimeout(finish, 80); }, function () { proto.click = orig; resolve(null); }); }
      else { setTimeout(finish, 80); }
    });
  }

  /* ---- native SAVE per tool (full-fidelity, the engine's own format) ---- */
  function doSave() {
    if (TOOL === "generate")   return captureDownload(function () { return window.exportZip && window.exportZip(); });
    if (TOOL === "cartograph") return captureDownload(function () { var b = document.getElementById("saveBtn"); if (b) b.click(); });
    if (TOOL === "assets")     return captureDownload(function () { return window.exportPack && window.exportPack(); });
    return Promise.resolve(null);
  }

  /* ---- native LOAD per tool ---- */
  function doLoadProject(bytes) {
    if (TOOL === "generate" && window.loadZip) return window.loadZip(fileFrom(bytes, "world.zip", "application/zip"));
    if (TOOL === "cartograph" && window.loadFromZip) { window.loadFromZip(u8(bytes).slice().buffer); return Promise.resolve(); }
    return Promise.resolve();
  }

  /* ---- generate: light extract for the Cartograph handoff (no heavy bake) ---- */
  function extractWorld() {
    var view = document.getElementById("view");
    var gw = view ? view.width : 0, gh = view ? view.height : 0, km = 800;
    var imageDataUrl = null, biomeRLE = null, terrainRLE = null;
    try { imageDataUrl = view ? view.toDataURL("image/png") : null; } catch (e) {}
    try { biomeRLE = u8(window.encodeBiomeRLE(window.buildCartBiome())); } catch (e) {}
    try { terrainRLE = u8(window.encodeBiomeRLE(window.buildCartTerrain())); } catch (e) {}
    try { var m = window.cartalithGridManifest(); gw = m.widthCells; gh = m.heightCells; km = m.mapWidthKm; } catch (e) {}
    return { gw: gw, gh: gh, mapWidthKm: km, imageDataUrl: imageDataUrl, biomeRLE: biomeRLE, terrainRLE: terrainRLE };
  }

  /* ---- generate: load an asset pack into the live engine ---- */
  function loadPack(bytes, name) {
    if (window.loadAssetPack) return window.loadAssetPack(fileFrom(bytes, name || "pack.zip", "application/zip"));
    return Promise.resolve();
  }

  /* never let a synchronous throw escape a handler — always resolve so the parent's await can't hang */
  function run(fn) { try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); } }

  window.addEventListener("message", function (e) {
    var d = e.data; if (!d || d.ns !== NS) return;
    switch (d.cmd) {
      case "save":
        run(doSave).then(function (res) { send(res && res.bytes ? { cmd: "saveResult", name: res.name, bytes: res.bytes } : { cmd: "saveResult", empty: true }); }, function () { send({ cmd: "saveResult", empty: true }); });
        break;
      case "loadProject":
        run(function () { return doLoadProject(d.bytes); }).then(function () { send({ cmd: "loadResult", ok: true }); }, function () { send({ cmd: "loadResult", ok: false }); });
        break;
      case "extractWorld":
        if (TOOL === "generate") run(extractWorld).then(function (p) { send({ cmd: "worldParts", parts: p }); }, function () { send({ cmd: "worldParts", parts: null }); });
        break;
      case "loadPack":
        if (TOOL === "generate") run(function () { return loadPack(d.bytes, d.name); }).then(function () { send({ cmd: "packLoaded", ok: true }); }, function () { send({ cmd: "packLoaded", ok: false }); });
        break;
      case "extractPack":
        if (TOOL === "assets") run(doSave).then(function (res) { send(res && res.bytes ? { cmd: "packBytes", name: res.name, bytes: res.bytes } : { cmd: "packBytes", empty: true }); }, function () { send({ cmd: "packBytes", empty: true }); });
        break;
    }
  });

  function announce() { send({ cmd: "ready" }); }
  if (document.readyState === "complete") setTimeout(announce, 350);
  else window.addEventListener("load", function () { setTimeout(announce, 350); });
})();
