#!/usr/bin/env python3
"""
Cartalith Gen1 v0.03 — assembler.

Stitches three unmodified tools into one single-file worldbuilding shell
using the proven srcdoc-iframe approach (identical to build_rc.js):
  - injects rc_bridge.js into each tool before </body>
  - escapes </script -> <\/script in each embedded document
  - substitutes the <!--SRC_*--> markers in the shell template

Patches applied to asset_pack_compiler.html BEFORE embedding:
  1. sampleColorAt: circle-average r=7px instead of single pixel
  2. Import Pack button + handler

Re-run after any source/bridge/shell change:  python3 build_gen3.py
"""
import re, sys, os

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(ROOT, "Cartalith Gen1 v0.03.html")

SOURCES = {
    "generate":   "elevation_foundation_v0.144.html",
    "cartograph": "Cartalith_V1.915.html",
    "assets":     "asset_pack_compiler.html",
}

def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return f.read()

def esc(s):
    """</script → <\/script  (case-preserving, fully reversible)"""
    return re.sub(r'</(script)', lambda m: '<\\/' + m.group(1), s, flags=re.IGNORECASE)

def unesc(s):
    return re.sub(r'<\\/(script)', lambda m: '</' + m.group(1), s, flags=re.IGNORECASE)

def inject_bridge(src, tool):
    bridge = read("rc_bridge.js")
    block = (
        "\n<script>window.__RC_TOOL__=" + repr(tool) + ";\n"
        + bridge
        + "\n</script>\n"
    )
    # repr() gives Python single-quoted string; we want JS string
    block = block.replace("window.__RC_TOOL__=" + repr(tool),
                          "window.__RC_TOOL__=" + '"' + tool + '"')
    if re.search(r'</body>', src, flags=re.IGNORECASE):
        return re.sub(r'</body>', block + '</body>', src, flags=re.IGNORECASE, count=1)
    return src + block


# ── Patch 1: circle-average color picker (r=7px) ──────────────────────────────
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
  // Circle-average over radius 7 px for more robust background colour sampling
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


# ── Patch 2: Import Pack button in header + hidden file input + handler ────────
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

IMPORT_HANDLER_OLD = """\
$('buildBtn').addEventListener('click', exportPack);"""

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
    // Minimal STORED zip reader (same as the engine's unzipStore)
    const dv = new DataView(u8.buffer, u8.byteOffset);
    // Find end-of-central-directory
    let eocd = -1;
    for(let i = u8.length - 22; i >= 0; i--){
      if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
    }
    if(eocd < 0){ toast('Not a valid ZIP file.', 'err'); return; }
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    for(let n = 0; n < count; n++){
      if(dv.getUint32(p, true) !== 0x02014b50) break;
      const method   = dv.getUint16(p + 10, true);
      const csize    = dv.getUint32(p + 20, true);
      const nlen     = dv.getUint16(p + 28, true);
      const elen     = dv.getUint16(p + 30, true);
      const clen     = dv.getUint16(p + 32, true);
      const lho      = dv.getUint32(p + 42, true);
      const name     = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      const lnlen    = dv.getUint16(lho + 26, true);
      const lelen    = dv.getUint16(lho + 28, true);
      const dstart   = lho + 30 + lnlen + lelen;
      let data       = u8.subarray(dstart, dstart + csize);
      if(method === 8){
        // DEFLATED — decompress via DecompressionStream if available
        try {
          const ds = new DecompressionStream('deflate-raw');
          const w = ds.writable.getWriter(); w.write(data); w.close();
          const chunks = []; const r = ds.readable.getReader();
          while(true){ const {done,value} = await r.read(); if(done) break; chunks.push(value); }
          let total = 0; for(const c of chunks) total += c.length;
          const out = new Uint8Array(total); let off = 0;
          for(const c of chunks){ out.set(c, off); off += c.length; }
          data = out;
        } catch(ex){ /* skip compressed entries we can't decompress */ p += 46 + nlen + elen + clen; continue; }
      }
      entries[name] = data.slice();
      p += 46 + nlen + elen + clen;
    }

    // Parse manifest
    const jsonEntry = entries['pack.json'] || entries['PACK.JSON'];
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
        if(multi) store[uid].push(item);
        else       store[uid] = [item];
        loaded++;
        updateCount(SLOT_REG[uid].fam.key);
        afterLoad(uid, loaded, failed, total);
      };
      img.onerror = () => { URL.revokeObjectURL(url); failed++; afterLoad(uid, loaded, failed, total); };
      img.src = url;
      return true;
    }

    // Load textures
    if(manifest.textures) for(const [slotId, path] of Object.entries(manifest.textures)){
      const uid = Object.keys(SLOT_REG).find(k => SLOT_REG[k].slot && SLOT_REG[k].slot.id === slotId && SLOT_REG[k].fam.kind === 'texture');
      if(uid && path) tryLoad(path, uid, false);
    }
    // Load icons
    if(manifest.icons) for(const [slotId, paths] of Object.entries(manifest.icons)){
      const uid = Object.keys(SLOT_REG).find(k => SLOT_REG[k].slot && SLOT_REG[k].slot.id === slotId && SLOT_REG[k].fam.kind !== 'texture');
      if(!uid) continue;
      const arr = Array.isArray(paths) ? paths : [paths];
      store[uid] = [];
      for(const p of arr) tryLoad(p, uid, true);
    }

    // Pack name/author/license
    if(manifest.name)    $('packName').value    = manifest.name;
    if(manifest.author)  $('packAuthor').value  = manifest.author;
    if(manifest.license) $('packLicense').value = manifest.license;

    if(total === 0) toast('Pack imported (no matching standard slots found — custom slots not restored).', 'ok');
    else toast(`Importing ${total} asset${total!==1?'s':''} from "${manifest.name||file.name}"…`, 'ok');
  } catch(err){ toast('Import error: ' + err.message, 'err'); }
});"""


def patch_assets(src):
    """Apply both patches to asset_pack_compiler.html."""
    # Patch 1: circle color picker
    if SAMPLE_OLD not in src:
        print("WARN: sampleColorAt patch target not found — skipping circle-picker patch")
    else:
        src = src.replace(SAMPLE_OLD, SAMPLE_NEW, 1)
        print("  patched: sampleColorAt → circle-average r=7")

    # Patch 2: import button + handler
    if HEADER_OLD not in src:
        print("WARN: header patch target not found — skipping import button patch")
    else:
        src = src.replace(HEADER_OLD, HEADER_NEW, 1)
        print("  patched: Import Pack… button added to header")

    if IMPORT_HANDLER_OLD not in src:
        print("WARN: import handler target not found — skipping import handler patch")
    else:
        src = src.replace(IMPORT_HANDLER_OLD, IMPORT_HANDLER_NEW, 1)
        print("  patched: import pack handler added")

    return src


def make_shell():
    """Read rc_shell.html and apply Gen1 v0.03 branding."""
    s = read("rc_shell.html")
    # Update branding
    s = s.replace('<title>Cartalith — RC v0.01</title>',
                  '<title>Cartalith — Gen1 v0.03</title>')
    s = s.replace('<b>Cartalith</b><span class="rc">RC v0.01</span>',
                  '<b>Cartalith</b><span class="rc">Gen1 v0.03</span>')
    s = s.replace('rcVersion:"0.01"', 'rcVersion:"0.03"')
    s = s.replace("kind:\"cartalith-rc-project\"", "kind:\"cartalith-gen1-project\"")
    # Info page: update version mentions
    s = s.replace('Release Candidate v0.01 · created by V. Post',
                  'Gen1 v0.03 · created by V. Post')
    s = s.replace('Cartalith RC v0.01 — integration build. Component',
                  'Cartalith Gen1 v0.03 — integration build. Component')
    s = s.replace("Component\n      engines run isolated and unmodified; a later release will fuse them into a single namespace\n      (see <code>docs/DEEP_MERGE_PLAN.md</code>).",
                  "Component engines run isolated and unmodified in their own srcdoc iframes;\n      a later deep-merge release will fuse them into one shared namespace.")
    # Tool card: update RC ref
    s = s.replace('Cartalith RC v0.01</title>', 'Cartalith Gen1 v0.03</title>')
    # manifest reference
    s = s.replace('"Cartalith Compiler"', '"V. Post"')
    # Project file extension hint
    s = s.replace('.cartalith', '.cartalith')
    return s


# ── MAIN ─────────────────────────────────────────────────────────────────────
shell = make_shell()
report = []

for tool, file in SOURCES.items():
    print(f"Processing {tool} <- {file} …")
    raw = read(file)
    if tool == "assets":
        raw = patch_assets(raw)

    injected = inject_bridge(raw, tool)
    escaped  = esc(injected)

    # hard guarantees
    if unesc(escaped) != injected:
        print(f"FATAL: escape not reversible for {tool}"); sys.exit(1)
    if re.search(r'</script', escaped, flags=re.IGNORECASE):
        print(f"FATAL: bare </script survived escaping for {tool}"); sys.exit(1)

    marker = f"<!--SRC_{tool.upper()}-->"
    if marker not in shell:
        print(f"FATAL: marker {marker} missing in shell"); sys.exit(1)

    # Use a function replacer pattern to avoid $ interpretation
    idx = shell.index(marker)
    shell = shell[:idx] + escaped + shell[idx + len(marker):]
    report.append((tool, file, len(raw), len(escaped)))
    print(f"  embedded {len(raw)//1024}KB → {len(escaped)//1024}KB (escaped)")

# Verify all markers were filled
for marker in ["<!--SRC_GENERATE-->", "<!--SRC_CARTOGRAPH-->", "<!--SRC_ASSETS-->"]:
    if marker in shell:
        print(f"FATAL: unfilled marker {marker}"); sys.exit(1)

# Critical: exactly 4 </script tokens
closes = len(re.findall(r'</script', shell, flags=re.IGNORECASE))
if closes != 4:
    print(f"FATAL: expected exactly 4 </script tokens, found {closes}")
    print("  A literal '</script' in the shell's JS strings/comments closes <script> early.")
    sys.exit(1)
print(f"OK: exactly {closes} </script tokens (3 carriers + 1 parent shell)")

with open(OUT, "w", encoding="utf-8") as f:
    f.write(shell)

size_mb = os.path.getsize(OUT) / 1024 / 1024
print(f"\nAssembled: {OUT}")
for tool, file, raw, escd in report:
    print(f"  {tool:<11} <- {file:<40} {raw//1024}KB  (embedded {escd//1024}KB)")
print(f"  TOTAL OUTPUT: {size_mb:.2f} MB")
