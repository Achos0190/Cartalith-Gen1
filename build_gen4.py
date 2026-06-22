#!/usr/bin/env python3
"""
Cartalith Gen1 v0.04 — assembler (same-page Shadow-DOM mount; NO iframes).

For each tool it extracts the <style>, the body markup, library scripts (fflate) and the app script(s),
transforms the tool CSS for shadow-root injection (:root/html/body -> :host), appends an export tail that
captures the tool's public surface, escapes </script, and emits typed carriers that gen1_harness.js mounts
into per-tool Shadow DOM hosts.

  python3 build_gen4.py   ->   "Cartalith Gen1 v0.04.html"
"""
import re, sys, os

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(ROOT, "Cartalith Gen1 v0.04.html")

SOURCES = {
    "generate":   "elevation_foundation_v0.144.html",
    "cartograph": "Cartalith_V1.915.html",
    "assets":     "asset_pack_compiler.html",
}

# Public surface captured per tool (top-level function declarations -> __X exports object).
EXPORT_TAIL = {
    "generate": [
        "generate", "exportZip", "loadZip", "buildCartBiome", "buildCartTerrain",
        "encodeBiomeRLE", "decodeBiomeRLE", "cartalithGridManifest", "loadAssetPack", "clearAssetPack",
    ],
    "cartograph": ["loadFromZip"],
    "assets": ["exportPack"],
}

def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return f.read()

def esc(s):   return re.sub(r'</(script)', lambda m: '<\\/' + m.group(1), s, flags=re.IGNORECASE)
def unesc(s): return re.sub(r'<\\/(script)', lambda m: '</' + m.group(1), s, flags=re.IGNORECASE)


# ── asset compiler patches (carried from v0.03) ───────────────────────────────
SAMPLE_OLD = """\
function sampleColorAt(sx, sy){
  const x = Math.max(0, Math.min(sheet.w-1, Math.floor(sx)));
  const y = Math.max(0, Math.min(sheet.h-1, Math.floor(sy)));
  const p = sheet.ctx.getImageData(x, y, 1, 1).data;
  chroma.color = [p[0], p[1], p[2]];
  chroma.enabled = true; $('chEnable').checked = true;
  updateSwatch(); drawSliceGrid();
  toast(`Keyed colour rgb(${p[0]},${p[1]},${p[2]}) → transparent.`, 'ok');
}"""
SAMPLE_NEW = """\
function sampleColorAt(sx, sy){
  // Circle-average over radius 7 px for robust background sampling on non-solid backgrounds
  const R = 7;
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  let rSum = 0, gSum = 0, bSum = 0, n = 0;
  for(let dy = -R; dy <= R; dy++){
    for(let dx = -R; dx <= R; dx++){
      if(dx*dx + dy*dy > R*R) continue;
      const px = Math.max(0, Math.min(sheet.w-1, x0+dx));
      const py = Math.max(0, Math.min(sheet.h-1, y0+dy));
      const p = sheet.ctx.getImageData(px, py, 1, 1).data;
      rSum += p[0]; gSum += p[1]; bSum += p[2]; n++;
    }
  }
  const r = Math.round(rSum/n), g = Math.round(gSum/n), b = Math.round(bSum/n);
  chroma.color = [r, g, b];
  chroma.enabled = true; $('chEnable').checked = true;
  updateSwatch(); drawSliceGrid();
  toast(`Keyed colour rgb(${r},${g},${b}) → transparent. (${n}-px circle avg)`, 'ok');
}"""

HEADER_OLD = """\
  <button id="sliceBtn" class="ghost">✂ Slice sheet…</button>
  <button id="buildBtn" class="primary">Build &amp; Export Asset Pack</button>
</header>"""
HEADER_NEW = """\
  <button id="importPackBtn" class="ghost">📂 Import Pack…</button>
  <button id="sliceBtn" class="ghost">✂ Slice sheet…</button>
  <button id="buildBtn" class="primary">Build &amp; Export Asset Pack</button>
  <input type="file" id="importPackFile" accept=".zip" style="display:none">
</header>"""

IMPORT_HANDLER_OLD = "$('buildBtn').addEventListener('click', exportPack);"
IMPORT_HANDLER_NEW = """\
$('buildBtn').addEventListener('click', exportPack);

/* ---- Import existing pack.zip ------------------------------------------ */
$('importPackBtn').addEventListener('click', () => $('importPackFile').click());
$('importPackFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if(!file) return;
  toast('Reading pack…', 'ok');
  try {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset);
    let eocd = -1;
    for(let i = u8.length - 22; i >= 0; i--){ if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; } }
    if(eocd < 0){ toast('Not a valid ZIP file.', 'err'); return; }
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    for(let n = 0; n < count; n++){
      if(dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize  = dv.getUint32(p + 20, true);
      const nlen   = dv.getUint16(p + 28, true);
      const elen   = dv.getUint16(p + 30, true);
      const clen   = dv.getUint16(p + 32, true);
      const lho    = dv.getUint32(p + 42, true);
      const name   = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      const lnlen  = dv.getUint16(lho + 26, true);
      const lelen  = dv.getUint16(lho + 28, true);
      const dstart = lho + 30 + lnlen + lelen;
      let data     = u8.subarray(dstart, dstart + csize);
      if(method === 8){
        try {
          const ds = new DecompressionStream('deflate-raw');
          const w = ds.writable.getWriter(); w.write(data); w.close();
          const chunks = []; const rd = ds.readable.getReader();
          while(true){ const {done,value} = await rd.read(); if(done) break; chunks.push(value); }
          let total = 0; for(const c of chunks) total += c.length;
          const o = new Uint8Array(total); let off = 0;
          for(const c of chunks){ o.set(c, off); off += c.length; }
          data = o;
        } catch(ex){ p += 46 + nlen + elen + clen; continue; }
      }
      entries[name] = data.slice();
      p += 46 + nlen + elen + clen;
    }
    const jsonEntry = entries['pack.json'];
    if(!jsonEntry){ toast('No pack.json found in ZIP — not an asset pack.', 'err'); return; }
    let manifest;
    try { manifest = JSON.parse(new TextDecoder().decode(jsonEntry)); } catch(ex){ toast('pack.json parse error.', 'err'); return; }
    let loaded = 0, failed = 0, total = 0;
    function tryLoad(path, uid, multi){
      const data = entries[path]; if(!data) return false;
      total++;
      const blob = new Blob([data], {type:'image/png'});
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onload = () => {
        const fam = SLOT_REG[uid] && SLOT_REG[uid].fam;
        const item = {name: path.split('/').pop(), img, w: img.naturalWidth || (fam&&fam.size||256), h: img.naturalHeight || (fam&&fam.size||256), t: defaultTransform()};
        if(fam && fam.anchor === 'bottom') fitToBottom(item, fam.size);
        if(multi) store[uid].push(item); else store[uid] = [item];
        loaded++; updateCount(SLOT_REG[uid].fam.key); afterLoad(uid, loaded, failed, total);
      };
      img.onerror = () => { URL.revokeObjectURL(url); failed++; afterLoad(uid, loaded, failed, total); };
      img.src = url; return true;
    }
    if(manifest.textures) for(const [slotId, path] of Object.entries(manifest.textures)){
      const uid = Object.keys(SLOT_REG).find(k => SLOT_REG[k].slot && SLOT_REG[k].slot.id === slotId && SLOT_REG[k].fam.kind === 'texture');
      if(uid && path) tryLoad(path, uid, false);
    }
    if(manifest.icons) for(const [slotId, paths] of Object.entries(manifest.icons)){
      const uid = Object.keys(SLOT_REG).find(k => SLOT_REG[k].slot && SLOT_REG[k].slot.id === slotId && SLOT_REG[k].fam.kind !== 'texture');
      if(!uid) continue;
      const arr = Array.isArray(paths) ? paths : [paths];
      store[uid] = [];
      for(const pp of arr) tryLoad(pp, uid, true);
    }
    if(manifest.name)    $('packName').value    = manifest.name;
    if(manifest.author)  $('packAuthor').value  = manifest.author;
    if(manifest.license) $('packLicense').value = manifest.license;
    if(total === 0) toast('Pack imported (no matching standard slots found).', 'ok');
    else toast(`Importing ${total} asset${total!==1?'s':''} from "${manifest.name||file.name}"…`, 'ok');
  } catch(err){ toast('Import error: ' + err.message, 'err'); }
});"""

def patch_assets(src):
    n = 0
    if SAMPLE_OLD in src: src = src.replace(SAMPLE_OLD, SAMPLE_NEW, 1); n += 1; print("  patched: circle-average color picker (r=7)")
    else: print("  WARN: sampleColorAt target not found")
    if HEADER_OLD in src: src = src.replace(HEADER_OLD, HEADER_NEW, 1); n += 1; print("  patched: Import Pack… button")
    else: print("  WARN: header target not found")
    if IMPORT_HANDLER_OLD in src: src = src.replace(IMPORT_HANDLER_OLD, IMPORT_HANDLER_NEW, 1); n += 1; print("  patched: import handler")
    else: print("  WARN: import handler target not found")
    return src


# ── tool parsing ──────────────────────────────────────────────────────────────
def parse_tool(src):
    """Return dict: css, body, libs[], app  (app = concatenated app scripts)."""
    css_blocks = re.findall(r'<style\b[^>]*>(.*?)</style>', src, re.DOTALL | re.IGNORECASE)
    css = "\n".join(css_blocks)
    # all inline scripts (no src=)
    scripts = []
    for m in re.finditer(r'<script\b([^>]*)>(.*?)</script>', src, re.DOTALL | re.IGNORECASE):
        if 'src=' in m.group(1).lower():
            continue
        scripts.append(m.group(2))
    libs, apps = [], []
    for s in scripts:
        head = s[:220]
        if 'fflate' in head:
            libs.append(s)               # the vendored zip lib runs as a real global
        elif len(s.strip()) < 400 and 'localStorage' in s:
            libs.append(s)               # tiny theme-bootstrap head script -> run global (sets real <html>)
        else:
            apps.append(s)
    app = "\n;\n".join(apps)             # shared closure so later app scripts see earlier decls (Cartalith)
    # body markup = inside <body>, minus <script>/<style>
    bm = re.search(r'<body\b[^>]*>(.*)</body>', src, re.DOTALL | re.IGNORECASE)
    body = bm.group(1) if bm else ""
    body = re.sub(r'<script\b[^>]*>.*?</script>', '', body, flags=re.DOTALL | re.IGNORECASE)
    body = re.sub(r'<style\b[^>]*>.*?</style>', '', body, flags=re.DOTALL | re.IGNORECASE)
    return {"css": css, "body": body, "libs": libs, "app": app}


# ── CSS transform: :root / html / body  ->  :host  (for shadow-root injection) ──
def transform_part(p):
    p = p.strip()
    if p == "" or p == "*" or p.startswith("@") or p.startswith("from") or p.startswith("to") or re.match(r'^\d', p):
        return p
    # leading html / body token, possibly with a compound (.cls, :pseudo, [attr]) and/or descendant rest
    m = re.match(r'^(html|body)((?:\.[\w-]+|:[\w-]+|\[[^\]]+\])*)(\s.*|>.*|~.*|\+.*)?$', p)
    if m:
        compound = m.group(2) or ""
        rest = m.group(3) or ""
        host = ":host(" + compound + ")" if compound else ":host"
        return host + rest
    return p

def transform_css(css):
    # :root variants first (longest match wins)
    css = css.replace(":root:not([data-theme])", ":host(:not([data-theme]))")
    css = css.replace(":root", ":host")
    # rewrite leading html/body selectors. Match "SELECTOR_LIST {" where the list has no { } ;
    def repl(m):
        sel = m.group(1)
        parts = [transform_part(x) for x in sel.split(",")]
        seen, out = set(), []
        for p in parts:                       # dedupe (html,body -> :host,:host -> :host)
            if p not in seen: seen.add(p); out.append(p)
        return ",".join(out) + "{"
    css = re.sub(r'([^{}};]+)\{', repl, css)
    return css


# ── shell assembly ────────────────────────────────────────────────────────────
def build_shell(carriers_html, harness_js):
    s = read("rc_shell.html")
    # truncate everything from the inert-carrier comment onward; we re-emit carriers + harness
    cut = s.find("<!-- inert source carriers")
    if cut < 0:
        print("FATAL: could not find carrier region in rc_shell.html"); sys.exit(1)
    s = s[:cut]

    # branding
    s = s.replace("<title>Cartalith — RC v0.01</title>", "<title>Cartalith — Gen1 v0.04</title>")
    s = s.replace('<b>Cartalith</b><span class="rc">RC v0.01</span>',
                  '<b>Cartalith</b><span class="rc">Gen1 v0.04</span>')
    s = s.replace("Release Candidate v0.01 · created by V. Post", "Gen1 v0.04 · created by V. Post")
    s = s.replace("Cartalith RC v0.01 — integration build. Component\n      engines run isolated and unmodified; a later release will fuse them into a single namespace\n      (see <code>docs/DEEP_MERGE_PLAN.md</code>).",
                  "Cartalith Gen1 v0.04 — single-page integration. The three engines run in the same document,\n      each isolated in its own Shadow DOM, sharing one project save and seamless handoffs.")
    s = s.replace("Each tool runs intact; a generated world flows straight into the", "Each engine runs intact in one page; a generated world flows straight into the")

    # add a theme toggle + .tool-host CSS
    s = s.replace('<div class="spacer"></div>\n  <div class="menu" id="projMenu">',
                  '<div class="spacer"></div>\n  <button class="mbtn" id="themeBtn" style="margin-right:8px">◑ Light</button>\n  <div class="menu" id="projMenu">')
    s = s.replace(".pane iframe{width:100%;height:100%;border:0;display:block;background:var(--deepest)}",
                  ".pane iframe{width:100%;height:100%;border:0;display:block;background:var(--deepest)}\n  .pane .tool-host{position:absolute;inset:0;display:block;overflow:hidden}")
    # booting placeholders stay; harness replaces pane content on mount

    # the harness's own comments mention </script — escape so they don't close the script early
    # (harmless inside JS // comments; the parser then reads the whole harness as one script body)
    tail = (
        carriers_html
        + '\n\n<script>\n' + esc(harness_js) + '\n</script>\n\n</body>\n</html>\n'
    )
    return s + tail


# ── MAIN ───────────────────────────────────────────────────────────────────────
def main():
    carriers = []
    report = []
    for tool, file in SOURCES.items():
        print(f"Processing {tool} <- {file} …")
        src = read(file)
        if tool == "assets":
            src = patch_assets(src)
        t = parse_tool(src)

        css = transform_css(t["css"])
        app = t["app"]
        # export tail (captures public surface into __X)
        tails = []
        for name in EXPORT_TAIL.get(tool, []):
            tails.append("try{__X." + name + "=" + name + ";}catch(e){}")
        if tool == "generate":
            tails.append("try{Object.defineProperty(__X,'state',{get:function(){return state;}});}catch(e){}")
        app = app + "\n;\n/* --- Gen1 export tail --- */\n" + "\n".join(tails) + "\n"

        # emit carriers (escaped)
        carriers.append('<script type="text/cartalith-css" data-tool="' + tool + '">' + esc(css) + '</script>')
        carriers.append('<script type="text/cartalith-body" data-tool="' + tool + '">' + esc(t["body"]) + '</script>')
        for lib in t["libs"]:
            carriers.append('<script type="text/cartalith-lib" data-tool="' + tool + '">' + esc(lib) + '</script>')
        carriers.append('<script type="text/cartalith-app" data-tool="' + tool + '">' + esc(app) + '</script>')

        report.append((tool, file, len(t["css"]), len(t["body"]), len(t["libs"]), len(app)))
        print(f"  css={len(css)//1024}KB body={len(t['body'])//1024}KB libs={len(t['libs'])} app={len(app)//1024}KB")

    harness = read("gen1_harness.js")
    carriers_html = ("<!-- inert source carriers; each tool's parts (css/body/lib/app), closing script "
                     "tags backslash-escaped, mounted into per-tool Shadow DOM by the harness below -->\n"
                     + "\n".join(carriers))
    shell = build_shell(carriers_html, harness)

    # guards
    closes = len(re.findall(r'</script', shell, flags=re.IGNORECASE))
    n_app = sum(1 for c in carriers if 'cartalith-app' in c[:60])
    n_css = sum(1 for c in carriers if 'cartalith-css' in c[:60])
    n_body = sum(1 for c in carriers if 'cartalith-body' in c[:60])
    n_lib = sum(1 for c in carriers if 'cartalith-lib' in c[:60])
    n_carrier = n_app + n_css + n_body + n_lib
    expected_closes = n_carrier + 1   # each carrier + the harness <script>
    if closes != expected_closes:
        print(f"FATAL: {closes} </script tokens, expected {expected_closes} ({n_carrier} carriers + 1 harness)")
        print("  A bare </script in a carrier would close it early and dump code as text.")
        sys.exit(1)
    print(f"OK: {closes} </script tokens = {n_carrier} carriers ({n_css}css+{n_body}body+{n_lib}lib+{n_app}app) + 1 harness")

    # round-trip every carrier
    for c in carriers:
        m = re.match(r'<script[^>]*>(.*)</script>', c, re.DOTALL)
        if unesc(m.group(1)) and ('</script' in unesc(m.group(1)).lower()) != ('</script' in m.group(1).lower()):
            pass

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(shell)

    size_mb = os.path.getsize(OUT) / 1024 / 1024
    print(f"\nAssembled: {OUT}")
    for tool, file, c, b, l, a in report:
        print(f"  {tool:<11} <- {file:<40} css={c//1024}KB body={b//1024}KB libs={l} app={a//1024}KB")
    print(f"  TOTAL OUTPUT: {size_mb:.2f} MB")

if __name__ == "__main__":
    main()
