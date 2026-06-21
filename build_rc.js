#!/usr/bin/env node
/* =====================================================================================================
 * Cartalith RC v0.01 — assembler.
 * Stitches the three unmodified tools into one single-file integration shell:
 *   - injects the postMessage bridge (rc_bridge.js) into each tool before </body>
 *   - escapes </script -> <\/script (case-preserving, fully reversible) so each full document can live
 *     inside a <script type="text/html"> carrier in the parent shell
 *   - substitutes the carriers in rc_shell.html
 * The shell un-escapes each carrier at runtime and renders it via iframe.srcdoc.
 *
 * Re-run after changing any source/bridge/shell:  node build_rc.js
 * ===================================================================================================== */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUT = path.join(ROOT, "Cartalith RC v0.01.html");

const SOURCES = {
  generate:   "elevation_foundation_v0.144.html",
  cartograph: "Cartalith_V1.915.html",
  assets:     "asset_pack_compiler.html",
};

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const esc   = (s) => s.replace(/<\/(script)/gi, (m, g) => "<\\/" + g);   // </script -> <\/script
const unesc = (s) => s.replace(/<\\\/(script)/gi, (m, g) => "</" + g);   // inverse (mirrors the shell)

const BRIDGE = read("rc_bridge.js");

function injectBridge(src, tool) {
  const block = "\n<script>window.__RC_TOOL__=" + JSON.stringify(tool) + ";\n" + BRIDGE + "\n</script>\n";
  if (/<\/body>/i.test(src)) return src.replace(/<\/body>/i, block + "</body>");
  return src + block;
}

let shell = read("rc_shell.html");
const report = [];

for (const [tool, file] of Object.entries(SOURCES)) {
  const raw = read(file);
  const injected = injectBridge(raw, tool);
  const escaped = esc(injected);

  // hard guarantees
  if (unesc(escaped) !== injected) { console.error("FATAL: escape not reversible for " + tool); process.exit(1); }
  if (/<\/script/i.test(escaped))  { console.error("FATAL: bare </script survived escaping for " + tool); process.exit(1); }

  const marker = "<!--SRC_" + tool.toUpperCase() + "-->";
  if (!shell.includes(marker)) { console.error("FATAL: marker " + marker + " missing in shell"); process.exit(1); }
  shell = shell.replace(marker, () => escaped);   // function replacer => no $-substitution in payload
  report.push([tool, file, raw.length, escaped.length]);
}

for (const m of ["<!--SRC_GENERATE-->", "<!--SRC_CARTOGRAPH-->", "<!--SRC_ASSETS-->"]) {
  if (shell.includes(m)) { console.error("FATAL: unfilled marker " + m); process.exit(1); }
}

// Critical guard: the browser ends a <script> at the first literal </script (it does NOT understand JS
// comments/strings). Embedded apps are escaped (<\/script), so the ONLY real </script tokens must be the
// 3 carrier closes + 1 parent-shell close. Any extra => a rogue </script in the shell closes a script early.
const closes = (shell.match(/<\/script/gi) || []).length;
if (closes !== 4) {
  console.error("FATAL: expected exactly 4 </script tokens (3 carriers + parent shell), found " + closes +
    ".\n  A literal '</script' in the parent shell's JS strings/comments will close <script> early and dump code as text.");
  process.exit(1);
}

fs.writeFileSync(OUT, shell);

console.log("Assembled: " + OUT);
for (const [tool, file, raw, escd] of report) {
  console.log("  " + tool.padEnd(11) + " <- " + file.padEnd(34) + " " + (raw / 1024).toFixed(0) + "KB  (embedded " + (escd / 1024).toFixed(0) + "KB)");
}
console.log("  TOTAL OUTPUT: " + (fs.statSync(OUT).size / 1024 / 1024).toFixed(2) + " MB");
