#!/usr/bin/env node
/* Verifies Cartalith RC v0.01.html:
 *   1. each embedded app round-trips to its ORIGINAL bytes (app untouched, +bridge only)
 *   2. the output has EXACTLY 4 real </script tokens (3 carriers + parent) — no rogue early-close
 *   3. the FULL parent-shell script is valid JS (greedy extract after stripping carriers, so a rogue
 *      </script in a comment/string can't truncate the check the way a non-greedy match did) */
const fs = require("fs");
const cp = require("child_process");
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

// 1. byte-identity of embedded apps
for (const [tool, file] of Object.entries(SOURCES)) {
  const open = 'id="src-' + tool + '">';
  const i = out.indexOf(open);
  if (i < 0) { console.error("MISSING carrier: " + tool); ok = false; continue; }
  const start = i + open.length;
  const end = out.indexOf("</script>", start);
  const recovered = unesc(out.slice(start, end));
  const raw = read(file);
  const block = "\n<script>window.__RC_TOOL__=" + JSON.stringify(tool) + ";\n" + BRIDGE + "\n</script>\n";
  if (recovered !== injectBridge(raw, tool)) { console.error("ROUND-TRIP MISMATCH: " + tool); ok = false; }
  else if (recovered.split(block).join("") !== raw) { console.error("APP NOT BYTE-IDENTICAL: " + tool); ok = false; }
  else console.log("OK  " + tool.padEnd(11) + " app byte-identical to " + file + " (+bridge only)");
}

// 2. exactly 4 real </script tokens
const closes = (out.match(/<\/script/gi) || []).length;
if (closes !== 4) { console.error("FAIL: " + closes + " </script tokens (expected 4) — a rogue close would dump code as text"); ok = false; }
else console.log("OK  exactly 4 real </script tokens (3 carriers + parent shell)");

// 3. full parent-shell script is valid JS (strip carriers, greedy-extract the remaining executable script)
let stripped = out;
for (const tool of Object.keys(SOURCES)) {
  stripped = stripped.replace(new RegExp('<script type="text/html" id="src-' + tool + '">[\\s\\S]*?</script>'), "");
}
const m = stripped.match(/<script>([\s\S]*)<\/script>/);   // greedy: to the LAST </script>
if (!m) { console.error("FAIL: could not locate parent shell script"); ok = false; }
else {
  fs.writeFileSync("/tmp/_rc_parent.js", m[1]);
  try { cp.execSync("node --check /tmp/_rc_parent.js", { stdio: "pipe" }); console.log("OK  parent shell script is valid JS (full body)"); }
  catch (e) { console.error("FAIL: parent shell script syntax error:\n" + (e.stderr || e.message)); ok = false; }
}

console.log(ok ? "\n✓ RC VERIFIED" : "\n✗ VERIFICATION FAILED");
process.exit(ok ? 0 : 1);
