#!/usr/bin/env node
/* Verifies "Cartalith Gen1 v0.04.html":
 *   1. harness script unescapes to valid JS (node --check)
 *   2. each tool's APP carrier compiles as a `new Function('window','document','self','__X', src)` body
 *      — i.e. the IIFE-wrapping mount will at least parse (catches concat/strict/dup-decl errors)
 *   3. each tool's LIB carrier compiles standalone
 *   4. body carriers contain no live <script>; css carriers are shadow-ready (:host, no :root)
 *   5. the export tail captured the expected public names
 */
const fs = require("fs");
const cp = require("child_process");
const out = fs.readFileSync("Cartalith Gen1 v0.04.html", "utf8");
const unesc = (s) => s.replace(/<\\\/(script)/gi, (m, g) => "</" + g);
let ok = true;
const fail = (m) => { console.error("✗ " + m); ok = false; };
const pass = (m) => console.log("✓ " + m);

const KNOWN = new Set(["generate", "cartograph", "assets"]);
function carriers(type) {
  // scan only the carrier region (before the harness <script>) so the harness's own doc comment,
  // which contains an example `<script type="text/cartalith-body" data-tool="X">`, isn't mistaken for one
  const region = out.slice(0, out.indexOf("\n\n<script>\n"));
  const re = new RegExp('<script type="text/cartalith-' + type + '" data-tool="([^"]+)">([\\s\\S]*?)</script>', "g");
  const res = []; let m;
  while ((m = re.exec(region))) if (KNOWN.has(m[1])) res.push({ tool: m[1], body: unesc(m[2]) });
  return res;
}

// 1. harness
const hm = out.match(/<script>\n([\s\S]*?)\n<\/script>\n\n<\/body>/);
if (!hm) fail("could not locate harness script");
else {
  fs.writeFileSync("/tmp/gen4_harness.js", unesc(hm[1]));
  try { cp.execSync("node --check /tmp/gen4_harness.js", { stdio: "pipe" }); pass("harness script is valid JS"); }
  catch (e) { fail("harness syntax:\n" + (e.stderr || e.message)); }
}

// 2. app carriers compile as Function bodies
const EXPECT = {
  generate: ["generate", "exportZip", "loadZip", "buildCartBiome", "buildCartTerrain", "encodeBiomeRLE", "decodeBiomeRLE", "cartalithGridManifest", "loadAssetPack", "clearAssetPack"],
  cartograph: ["loadFromZip"],
  assets: ["exportPack"],
};
for (const c of carriers("app")) {
  try {
    new Function("window", "document", "self", "__X", c.body);   // construct only, never call
    pass(`${c.tool} app compiles as new Function body (${(c.body.length / 1024) | 0}KB)`);
  } catch (e) { fail(`${c.tool} app compile: ${e.message}`); }
  // export tail present
  for (const name of EXPECT[c.tool]) {
    if (!c.body.includes("__X." + name + "=" + name)) fail(`${c.tool} export tail missing ${name}`);
  }
}
pass("export tails present for all tools");

// 3. lib carriers compile
for (const c of carriers("lib")) {
  try { new Function(c.body); pass(`${c.tool} lib compiles (${(c.body.length / 1024) | 0}KB)`); }
  catch (e) { fail(`${c.tool} lib compile: ${e.message}`); }
}

// 4. body carriers: no live <script>; css: shadow-ready
for (const c of carriers("body")) {
  if (/<script[\s>]/i.test(c.body)) fail(`${c.tool} body still has a <script>`);
}
pass("body carriers contain no live <script>");
for (const c of carriers("css")) {
  if (/:root\b/.test(c.body)) fail(`${c.tool} css still has :root (should be :host)`);
  if (!c.body.includes(":host")) fail(`${c.tool} css has no :host`);
}
pass("css carriers are shadow-ready (:host, no :root)");

// 5. structural: 4 tabs, theme button, panes, carriers present
for (const id of ["pane-generate", "pane-cartograph", "pane-assets", "pane-info", "themeBtn", "tabs", "projMenu"])
  if (!out.includes('id="' + id + '"')) fail("shell missing #" + id);
pass("shell chrome present (tabs, panes, theme, project menu)");

// asset patches carried
if (!out.includes("Circle-average over radius 7 px")) fail("asset circle-picker patch missing");
if (!out.includes("importPackBtn")) fail("asset import button missing");
pass("asset compiler patches present (circle picker + import)");

console.log(ok ? "\n✓ GEN1 v0.04 VERIFIED" : "\n✗ VERIFICATION FAILED");
process.exit(ok ? 0 : 1);
