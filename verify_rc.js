#!/usr/bin/env node
/* Verifies Cartalith RC v0.01.html: each embedded app must round-trip to its ORIGINAL bytes
 * (app code untouched) with only the bridge inserted. */
const fs = require("fs");
const read = (f) => fs.readFileSync(f, "utf8");
const unesc = (s) => s.replace(/<\\\/(script)/gi, (m, g) => "</" + g);
const BRIDGE = read("rc_bridge.js");
function injectBridge(src, tool) {
  const block = "\n<script>window.__RC_TOOL__=" + JSON.stringify(tool) + ";\n" + BRIDGE + "\n</script>\n";
  return /<\/body>/i.test(src) ? src.replace(/<\/body>/i, block + "</body>") : src + block;
}
const SOURCES = { generate: "elevation_foundation_v0.144.html", cartograph: "Cartalith_V1.915.html", assets: "asset_pack_compiler.html" };
const out = read("Cartalith RC v0.01.html");
let ok = true;
for (const [tool, file] of Object.entries(SOURCES)) {
  const open = 'id="src-' + tool + '">';
  const i = out.indexOf(open);
  if (i < 0) { console.error("MISSING carrier: " + tool); ok = false; continue; }
  const start = i + open.length;
  const end = out.indexOf("</script>", start);     // first real close (payload has none, by construction)
  const recovered = unesc(out.slice(start, end));
  const raw = read(file);
  const block = "\n<script>window.__RC_TOOL__=" + JSON.stringify(tool) + ";\n" + BRIDGE + "\n</script>\n";
  const appOnly = recovered.split(block).join("");
  if (recovered !== injectBridge(raw, tool)) { console.error("ROUND-TRIP MISMATCH: " + tool); ok = false; }
  else if (appOnly !== raw) { console.error("APP NOT BYTE-IDENTICAL: " + tool); ok = false; }
  else console.log("OK  " + tool.padEnd(11) + " app byte-identical to " + file + " (+bridge only)");
}
["<!--SRC_GENERATE-->", "<!--SRC_CARTOGRAPH-->", "<!--SRC_ASSETS-->"].forEach((m) => { if (out.includes(m)) { console.error("LEFTOVER marker: " + m); ok = false; } });
console.log(ok ? "\n✓ ALL EMBEDDED APPS VERIFIED BYTE-IDENTICAL" : "\n✗ VERIFICATION FAILED");
process.exit(ok ? 0 : 1);
