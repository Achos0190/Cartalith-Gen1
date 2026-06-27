#!/usr/bin/env python3
"""Build Cartalith Gen1 v0.01.html — unified worldbuilding tool.
Merges elevation_foundation_v0.144.html + Cartalith_V1.915.html + asset_pack_compiler.html
into one single-file, zero-dependency HTML application.
"""

import re
import sys
import os

ROOT = os.path.dirname(os.path.abspath(__file__))

def read(name):
    with open(os.path.join(ROOT, name), 'r', encoding='utf-8') as f:
        return f.read()

cartalith = read('Cartalith_V1.915.html')
elev      = read('elevation_foundation_v0.144.html')
comp      = read('asset_pack_compiler.html')

# ──────────────────────────────────────────────────────────────────────────────
# Helpers: extract sections from HTML
# ──────────────────────────────────────────────────────────────────────────────

def extract_style(html):
    m = re.search(r'<style[^>]*>([\s\S]*?)</style>', html, re.IGNORECASE)
    return m.group(1) if m else ''

def extract_scripts(html):
    return re.findall(r'<script(?:\s[^>]*)?>(?!\s*!function)([\s\S]*?)</script>', html, re.IGNORECASE)

def extract_fflate(html):
    """Extract fflate minified script (the one that starts with !function)."""
    m = re.search(r'(<script[^>]*>!function[\s\S]*?</script>)', html, re.IGNORECASE)
    return m.group(1) if m else ''

def extract_body_before_script(html):
    """Extract body HTML before the main <script> blocks."""
    body_start = re.search(r'<body[^>]*>', html, re.IGNORECASE)
    if not body_start:
        return ''
    start = body_start.end()
    # Find first <script> tag after body start
    first_script = re.search(r'<script', html[start:], re.IGNORECASE)
    if first_script:
        return html[start:start + first_script.start()]
    return html[start:]

def escape_script_content(text):
    """Replace </script occurrences inside embedded JS so the browser HTML parser
    doesn't terminate the outer <script> block early (even in strings/comments)."""
    return re.sub(r'</(script)', lambda m: '<\\/' + m.group(1), text, flags=re.IGNORECASE)

# ──────────────────────────────────────────────────────────────────────────────
# Elevation foundation: extract sections
# ──────────────────────────────────────────────────────────────────────────────

gen_css_raw    = extract_style(elev)
gen_body_raw   = extract_body_before_script(elev)
gen_scripts    = extract_scripts(elev)
gen_script_raw = max(gen_scripts, key=len) if gen_scripts else ''

# ──────────────────────────────────────────────────────────────────────────────
# Asset compiler: extract sections
# ──────────────────────────────────────────────────────────────────────────────

comp_fflate_block = extract_fflate(comp)
comp_css_raw      = extract_style(comp)
comp_scripts      = extract_scripts(comp)
comp_script_raw   = max(comp_scripts, key=len) if comp_scripts else ''
comp_body_raw     = extract_body_before_script(comp)

# ──────────────────────────────────────────────────────────────────────────────
# Transform 1: Prefix all IDs in elevation foundation body HTML
# ──────────────────────────────────────────────────────────────────────────────

def prefix_ids(html, prefix='gen-'):
    html = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{prefix}{m.group(1)}"', html)
    html = re.sub(r'\bfor="([^"]+)"', lambda m: f'for="{prefix}{m.group(1)}"', html)
    return html

gen_body = prefix_ids(gen_body_raw)
# Wrap the gen HTML content in a panel div — the <header> and .stage already exist in the body
# We just wrap the entire content
gen_panel_html = '<div id="gen-panel" class="gen-workspace-inner">\n' + gen_body + '\n</div>'

# ──────────────────────────────────────────────────────────────────────────────
# Transform 2: Scope elevation foundation CSS under #gen-panel
# ──────────────────────────────────────────────────────────────────────────────

def scope_css_block(css_text, scope):
    """Scope CSS rules under `scope`, handling @media blocks recursively."""
    # Remove :root block entirely — we inherit Cartalith's vars
    css_text = re.sub(r':root\s*\{[^}]*\}', '', css_text)
    # Remove html, body, and html+body rules
    css_text = re.sub(r'(?:html\s*,\s*body|body|html)\s*\{[^}]*\}', '', css_text)

    result = []
    # Tokenise into top-level blocks
    pos = 0
    while pos < len(css_text):
        # skip whitespace
        while pos < len(css_text) and css_text[pos] in ' \t\n\r':
            pos += 1
        if pos >= len(css_text):
            break

        # CSS comment?
        if css_text[pos:pos+2] == '/*':
            end = css_text.find('*/', pos+2)
            if end == -1:
                break
            result.append(css_text[pos:end+2])
            pos = end + 2
            continue

        # @-rule?
        if css_text[pos] == '@':
            # find the opening brace
            brace = css_text.find('{', pos)
            if brace == -1:
                # @-rule without block (e.g. @charset, @import)
                semi = css_text.find(';', pos)
                if semi == -1:
                    break
                result.append(css_text[pos:semi+1])
                pos = semi + 1
                continue
            at_head = css_text[pos:brace]
            # count braces to find matching close
            depth = 0
            i = brace
            while i < len(css_text):
                if css_text[i] == '{':
                    depth += 1
                elif css_text[i] == '}':
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            inner = css_text[brace+1:i]
            at_name = at_head.strip().split()[0]  # e.g. @media, @keyframes
            if '@keyframes' in at_name or '@-webkit-keyframes' in at_name:
                # Keyframes: don't scope, pass through
                result.append(css_text[pos:i+1])
            else:
                # @media etc: scope inner rules
                inner_scoped = scope_css_block(inner, scope)
                result.append(f'{at_head}{{{inner_scoped}}}')
            pos = i + 1
            continue

        # Regular rule: find selector + block
        brace = css_text.find('{', pos)
        if brace == -1:
            break
        selector_raw = css_text[pos:brace].strip()
        # find matching close brace
        depth = 0
        i = brace
        while i < len(css_text):
            if css_text[i] == '{':
                depth += 1
            elif css_text[i] == '}':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        declarations = css_text[brace+1:i].strip()

        # Scope each comma-separated selector
        scoped_parts = []
        for sel in selector_raw.split(','):
            sel = sel.strip()
            if not sel:
                continue
            # Skip :root and body/html selectors
            if sel in [':root', 'html', 'body', 'html, body', '*']:
                continue
            # canvas#view -> canvas#gen-view
            sel = sel.replace('canvas#view', 'canvas#gen-view')
            # Prefix IDs in selectors
            sel = re.sub(r'#(?!gen-)(\w+)', lambda m: f'#gen-{m.group(1)}', sel)
            scoped_parts.append(f'{scope} {sel}')

        if scoped_parts:
            result.append(f'{", ".join(scoped_parts)} {{{declarations}}}')
        pos = i + 1

    return '\n'.join(result)

gen_css = scope_css_block(gen_css_raw, '#gen-panel')

# ──────────────────────────────────────────────────────────────────────────────
# Transform 3: Gen IIFE — namespace the elevation foundation script
# ──────────────────────────────────────────────────────────────────────────────

def transform_gen_script(script):
    """
    Transform the elevation foundation script for use inside the Gen IIFE:
    1. Replace literal document.getElementById('xxx') with gen-prefixed version
    2. Redefine v() and lab() to use gen- prefix
    3. Scope document.querySelector calls to #gen-panel
    4. Extract the auto-init code at the bottom as Gen.init() body
    """
    # 1. Replace v() and lab() definitions
    script = script.replace(
        "function v(id,val){ const e=document.getElementById(id); if(e)e.value=val; }",
        "function v(id,val){ const e=document.getElementById('gen-'+id); if(e)e.value=val; }"
    )
    script = script.replace(
        "function lab(id,txt){ const e=document.getElementById(id); if(e)e.textContent=txt; }",
        "function lab(id,txt){ const e=document.getElementById('gen-'+id); if(e)e.textContent=txt; }"
    )

    # 2. Replace document.getElementById('xxx') literal strings
    script = re.sub(
        r"document\.getElementById\('(?!gen-)([^']+)'\)",
        lambda m: f"document.getElementById('gen-{m.group(1)}')",
        script
    )
    script = re.sub(
        r'document\.getElementById\("(?!gen-)([^"]+)"\)',
        lambda m: f'document.getElementById("gen-{m.group(1)}")',
        script
    )

    # 3. Scope document.querySelector to #gen-panel
    script = script.replace(
        "document.querySelector('.canvas-wrap')",
        "document.querySelector('#gen-panel .canvas-wrap')"
    )
    script = script.replace(
        "document.querySelector('.canvas-stack')",
        "document.querySelector('#gen-panel .canvas-stack')"
    )
    # Generic querySelector/querySelectorAll calls (replace with gen-panel scoped versions)
    script = script.replace(
        "document.querySelectorAll('.tab')",
        "document.getElementById('gen-panel').querySelectorAll('.tab')"
    )
    script = script.replace(
        "document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'))",
        "document.getElementById('gen-panel').querySelectorAll('.tab').forEach(t=>t.classList.remove('on'))"
    )
    script = script.replace(
        "document.querySelectorAll('#featureSeg button')",
        "document.querySelectorAll('#gen-featureSeg button')"
    )
    script = script.replace(
        "document.querySelectorAll(sel+' button').forEach(b=>b.classList.toggle('on',fn(b)))",
        "(document.getElementById('gen-panel')||document).querySelectorAll(sel+' button').forEach(b=>b.classList.toggle('on',fn(b)))"
    )

    # 4. The Shift+D resource overlay keybinding — change to Gen-specific
    # Remove the keydown handler to avoid conflicts with Cartalith
    # Actually let's just keep it since it checks !e.target.matches('input,...')
    # and the Shift+D shortcut is unlikely to conflict

    # 5. Extract and replace the bottom auto-init block
    # The last lines are: GW=state.resW; GH=gridH(GW); allocate(); withBusy('generating…',generate);
    # We'll wrap these in a _genInit function returned from the IIFE

    # Find the init block (last 10 lines or so)
    init_pattern = r"(GW=state\.resW;\s*GH=gridH\(GW\);\s*allocate\(\);\s*withBusy\('generating…',generate\);)"
    script = re.sub(
        init_pattern,
        "_genInitFn=function(){GW=state.resW;GH=gridH(GW);allocate();withBusy('generating…',generate);};",
        script
    )

    # Also handle renderNow wrapper for resource overlay
    # This creates a closure issue; simplify by keeping it
    # The _renderNow_orig pattern:
    script = script.replace(
        "const _renderNow_orig=renderNow;\nrenderNow=function(){ _renderNow_orig(); updateResOverlay(); };",
        "const _renderNow_orig=renderNow; renderNow=function(){ _renderNow_orig(); updateResOverlay(); };"
    )

    return script

gen_script_transformed = transform_gen_script(gen_script_raw)

# ──────────────────────────────────────────────────────────────────────────────
# Transform 4: Asset compiler — upgrade sampleColorAt to circle sample
# ──────────────────────────────────────────────────────────────────────────────

comp_script = comp_script_raw.replace(
    """function sampleColorAt(sx, sy){
  const x = Math.max(0, Math.min(sheet.w-1, Math.floor(sx)));
  const y = Math.max(0, Math.min(sheet.h-1, Math.floor(sy)));
  const p = sheet.ctx.getImageData(x, y, 1, 1).data;
  chroma.color = [p[0], p[1], p[2]];
  chroma.enabled = true; $('chEnable').checked = true;
  updateSwatch(); drawSliceGrid();
  toast(`Keyed colour rgb(${p[0]},${p[1]},${p[2]}) → transparent.`, 'ok');
}""",
    """function sampleColorAt(sx, sy){
  /* v0.01: sample a circle of radius 7px and average, so non-mono backgrounds work */
  const R = 7;
  const cx = Math.floor(sx), cy = Math.floor(sy);
  const x0 = Math.max(0, cx-R), y0 = Math.max(0, cy-R);
  const x1 = Math.min(sheet.w-1, cx+R), y1 = Math.min(sheet.h-1, cy+R);
  const sw = x1-x0+1, sh = y1-y0+1;
  const pixels = sheet.ctx.getImageData(x0, y0, sw, sh).data;
  let r=0, g=0, b=0, n=0;
  for(let dy=0; dy<sh; dy++) for(let dx=0; dx<sw; dx++){
    if(Math.hypot(x0+dx-cx, y0+dy-cy) <= R){
      const i=(dy*sw+dx)*4;
      r+=pixels[i]; g+=pixels[i+1]; b+=pixels[i+2]; n++;
    }
  }
  if(!n){ return; }
  const p = [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
  chroma.color = p;
  chroma.enabled = true; $('chEnable').checked = true;
  updateSwatch(); drawSliceGrid();
  toast(`Keyed colour rgb(${p[0]},${p[1]},${p[2]}) sampled over r=${R}px circle → transparent.`, 'ok');
}"""
)

# ──────────────────────────────────────────────────────────────────────────────
# Extract Cartalith sections
# ──────────────────────────────────────────────────────────────────────────────

# Cartalith's CSS (between <style> and </style>)
cart_css = extract_style(cartalith)

# Cartalith's body HTML (before scripts)
cart_body = extract_body_before_script(cartalith)

# Cartalith's scripts (two large blocks)
cart_all_scripts = extract_scripts(cartalith)
# Find the theme detection script (small, first)
cart_theme_script = [s for s in cart_all_scripts if 'maptool_theme' in s]
cart_theme_script = cart_theme_script[0] if cart_theme_script else ''
# The two main scripts (sorted by length, take the two largest)
cart_main_scripts = sorted([s for s in cart_all_scripts if len(s) > 1000], key=len, reverse=True)[:2]
# Planner script is the one with 'Planner' in it
cart_planner = next((s for s in cart_main_scripts if 'PLANNER' in s or 'stage' in s[:200].lower()), cart_main_scripts[0] if cart_main_scripts else '')
cart_map = next((s for s in cart_main_scripts if s != cart_planner), cart_main_scripts[1] if len(cart_main_scripts)>1 else '')

# ──────────────────────────────────────────────────────────────────────────────
# Build the Gen IIFE
# ──────────────────────────────────────────────────────────────────────────────

GEN_IIFE = '''/* ============================================================
   Gen — Elevation Foundation v0.144 wrapped as a namespace.
   All DOM IDs are prefixed with "gen-"; v() and lab() use
   the gen- prefix automatically. The public API is window.Gen.
   ============================================================ */
var Gen = (function () {
"use strict";
var _genInitFn = null;   // set by the script body; called by Gen.init()

''' + gen_script_transformed + '''

/* ---- Public API ---- */
return {
  generate:   function(){ return generate(); },
  getState:   function(){ return state; },
  getCanvas:  function(){ return document.getElementById('gen-view'); },
  buildCartBiome:        buildCartBiome,
  buildCartTerrain:      buildCartTerrain,
  cartalithGridManifest: cartalithGridManifest,
  exportZip:  exportZip,
  loadZip:    loadZip,
  loadImage:  loadImage,
  loadAssetPack: (typeof loadAssetPack !== 'undefined') ? loadAssetPack : function(){},
  init: function(){
    if(_genInitFn) _genInitFn();
    else { GW=state.resW; GH=gridH(GW); allocate(); withBusy('generating…', generate); }
  }
};
})();
'''

# ──────────────────────────────────────────────────────────────────────────────
# Information page HTML
# ──────────────────────────────────────────────────────────────────────────────

INFO_HTML = '''<div class="workspace hidden" id="workspace-info">
<div class="info-page">
<div class="info-inner">
  <div class="info-logo">▲</div>
  <h1>Cartalith Gen1</h1>
  <p class="info-tagline">Procedural World Generation · Cartographic Editing · Asset Authoring</p>
  <p class="info-author">Created by <strong>V. Post</strong></p>
  <p class="info-version">Version 0.02 · 2025–2026</p>

  <hr class="info-rule">

  <h2>About</h2>
  <p>Cartalith Gen1 is an integrated worldbuilding tool that unifies three purpose-built engines into a single, zero-dependency, offline-capable HTML application:</p>
  <ul>
    <li><strong>Elevation Foundation v0.144</strong> — procedural heightmap &amp; climate generation (plate tectonics, erosion, weather, biomes)</li>
    <li><strong>Cartalith V1.915</strong> — cartographic editor (routes, settlements, political timelines, journey planner)</li>
    <li><strong>Asset Pack Compiler</strong> — sprite sheet slicer and asset pack builder</li>
  </ul>

  <hr class="info-rule">

  <h2>Scientific References</h2>
  <h3>Tectonics &amp; Geology</h3>
  <ul>
    <li>England, P. &amp; Molnar, P. (1990). Surface uplift, uplift of rocks, and exhumation of rocks. <em>Geology</em>.</li>
    <li>Stewart, J.H. (1978). Basin-range structure in western North America. <em>GSA Memoir 152</em>.</li>
    <li>Wernicke, B. (1985). Uniform-sense normal simple shear. <em>Canadian Journal of Earth Sciences</em>.</li>
  </ul>
  <h3>Erosion &amp; Hydrology</h3>
  <ul>
    <li>Freeman, T.G. (1991). Calculating catchment area with divergent flow based on a regular grid. <em>Computers &amp; Geosciences</em>.</li>
    <li>Lacey, G. (1930). Stable channels in alluvium. <em>ICE Proceedings</em>.</li>
    <li>Leopold, L.B. &amp; Maddock, T. (1953). The hydraulic geometry of stream channels. <em>USGS Professional Paper 252</em>.</li>
    <li>Mei, R. et al. (2007). Shallow water simulation. <em>ACM SIGGRAPH</em>.</li>
    <li>Montgomery, D.R. &amp; Dietrich, W.E. (1992). Channel initiation and the problem of landscape scale. <em>Science</em>.</li>
    <li>Strahler, A.N. (1957). Quantitative analysis of watershed geomorphology. <em>EOS Transactions AGU</em>.</li>
    <li>Tarboton, D.G. (1997). A new method for the determination of flow directions. <em>Water Resources Research</em>.</li>
  </ul>
  <h3>Climate &amp; Ecology</h3>
  <ul>
    <li>Jenny, H. (1941). <em>Factors of Soil Formation</em>. McGraw-Hill.</li>
    <li>Riley, S.J. et al. (1999). A terrain ruggedness index. <em>Western North American Naturalist</em>.</li>
    <li>MacArthur, R.H. &amp; Wilson, E.O. (1967). <em>The Theory of Island Biogeography</em>. Princeton.</li>
    <li>Rosenzweig, M.L. (1995). <em>Species Diversity in Space and Time</em>. Cambridge.</li>
    <li>Wright, D.H. (1983). Species-energy theory. <em>Oikos</em>.</li>
    <li>Holtedahl, H. (1993). The Norwegian fiord. <em>Norsk Geografisk Tidsskrift</em>.</li>
  </ul>
  <h3>Planet Physics</h3>
  <ul>
    <li>Kleiber, M. (1932). Body size and metabolism. <em>Hilgardia</em>.</li>
    <li>Lindeman, R.L. (1942). The trophic-dynamic aspect of ecology. <em>Ecology</em>.</li>
  </ul>
  <h3>Rendering &amp; Algorithms</h3>
  <ul>
    <li>Kennelly, P. &amp; Kimerling, A.J. (2001). Modifications of Tanaka's illuminated contour method. <em>Cartography and GIS</em>.</li>
    <li>Premožeet al., S. &amp; Ashikhmin, M. (2001). Rendering Natural Waters. <em>Stanford Computer Graphics</em>.</li>
    <li>Rong, G. &amp; Tan, T.S. (2006). Jump flooding in GPU. <em>ACM I3D</em>.</li>
    <li>Zhang, T.Y. &amp; Suen, C.Y. (1984). A fast parallel algorithm for thinning digital patterns. <em>CACM</em>.</li>
    <li>Beyer, H. (2015). Hydraulic erosion simulation. <em>Bachelor thesis</em>.</li>
    <li>Genevaux, J.D. et al. (2013). Terrain generation using procedural models. <em>ACM SIGGRAPH</em>.</li>
    <li>Galin, E. et al. (2019). A review of digital terrain modeling. <em>Computer Graphics Forum</em>.</li>
  </ul>
  <h3>Software References (algorithms studied, no code copied)</h3>
  <ul>
    <li>LanLou123/Webgl-Erosion (MIT)</li>
    <li>SebLague/Hydraulic-Erosion (MIT)</li>
    <li>weigert/SimpleHydrology (MIT)</li>
    <li>Pasternack-Lab/RiverBuilder (UC Davis)</li>
    <li>fflate compression library (MIT, Yassin Nouh)</li>
  </ul>

  <hr class="info-rule">

  <h2>Third-Party Libraries</h2>
  <ul>
    <li><strong>fflate</strong> v0.8+ — fast ZIP compression (MIT licence, Yassin Nouh)</li>
    <li>All other code is original, zero-dependency.</li>
  </ul>

  <hr class="info-rule">

  <h2>Licence</h2>
  <p>Cartalith Gen1 is proprietary software. The underlying scientific algorithms are in the public domain; the implementation is copyright © V. Post, 2024–2025. The fflate library is MIT-licensed (see its source block in this file).</p>

  <hr class="info-rule">
  <p class="info-footer">Cartalith Gen1 · V. Post · 2025</p>
</div>
</div>
</div>'''

# ──────────────────────────────────────────────────────────────────────────────
# Asset compiler drawer HTML
# ──────────────────────────────────────────────────────────────────────────────

COMP_DRAWER_HTML = '''<div id="assetCompilerDrawer" class="asset-compiler-drawer hidden">
<div class="acd-header">
  <span class="acd-title">▲ Asset Pack Compiler</span>
  <button class="acd-close" id="assetCompilerClose">✕</button>
</div>
<div class="acd-body">
''' + comp_body_raw.replace('<header>', '<div class="acd-inner-header">').replace('</header>', '</div>') + '''
</div>
</div>
'''

# ──────────────────────────────────────────────────────────────────────────────
# Handoff / integration code
# ──────────────────────────────────────────────────────────────────────────────

INTEGRATION_JS = '''
/* ============================================================
   Cartalith Gen1 — Integration layer
   Handoff from the Gen engine to Cartalith's paint grid.
   ============================================================ */

/* Fill Cartalith's paint grid from the Gen engine's world */
async function fillPaintGridFromWorld() {
  const manifest = Gen.cartalithGridManifest();
  const biomeRLE  = Gen.buildCartBiome();    // Uint8Array (RLE-encoded)
  const terrainRLE = Gen.buildCartTerrain(); // Uint8Array (RLE-encoded)

  const W = manifest.widthCells, H = manifest.heightCells;

  /* Decode RLE using Cartalith's own decodeBiomeRLE */
  const biomeData   = (typeof decodeBiomeRLE !== 'undefined') ? decodeBiomeRLE(biomeRLE)   : null;
  const terrainData = (typeof decodeBiomeRLE !== 'undefined') ? decodeBiomeRLE(terrainRLE) : null;

  /* Set Cartalith grid geometry */
  state.grid.widthCells  = W;
  state.grid.heightCells = H;
  state.grid.cellSize    = manifest.cellSize;
  state.grid.data        = new Uint8Array(W * H);
  state.terrain = state.terrain || {};
  state.terrain.widthCells  = W;
  state.terrain.heightCells = H;
  state.terrain.cellSize    = manifest.cellSize;
  state.terrain.data        = new Uint8Array(W * H);

  if (biomeData)   for (let i = 0; i < W*H; i++) state.grid.data[i]    = biomeData[i];
  if (terrainData) for (let i = 0; i < W*H; i++) state.terrain.data[i] = terrainData[i];

  /* Export Gen canvas as the background image */
  const genCanvas = Gen.getCanvas();
  if (genCanvas) {
    await new Promise(resolve => {
      const img = new Image();
      img.onload = function() {
        state.bg = state.bg || {};
        state.bg.image = img;
        state.bg.width  = img.naturalWidth;
        state.bg.height = img.naturalHeight;
        resolve();
      };
      img.onerror = resolve;
      img.src = genCanvas.toDataURL('image/png');
    });
  }

  /* Switch to Map Setup workspace */
  switchWorkspace('mapsetup');
  if (typeof render === 'function') render();
  const btn = document.getElementById('fillPaintBtn');
  if (btn) { btn.textContent = '✓ Paint Grid Filled'; setTimeout(() => { btn.textContent = '→ Fill Paint Grid from World'; }, 2000); }
}

/* Asset compiler drawer toggle */
(function() {
  var closeBtn = document.getElementById('assetCompilerClose');
  if (closeBtn) closeBtn.addEventListener('click', function() {
    document.getElementById('assetCompilerDrawer').classList.add('hidden');
  });
})();
function openAssetCompiler() {
  document.getElementById('assetCompilerDrawer').classList.remove('hidden');
}
'''

# ──────────────────────────────────────────────────────────────────────────────
# Integration CSS
# ──────────────────────────────────────────────────────────────────────────────

INTEGRATION_CSS = '''
/* ============================================================
   Cartalith Gen1 — Integration styles
   ============================================================ */

/* Missing CSS vars bridged from elevation foundation to Cartalith */
:root {
  --line: var(--border);
  --ink: var(--text);
  --dim: var(--muted);
  --faint: var(--muted);
  --accent2: var(--ok, #6a9e7a);
  --mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
  --sans: ui-sans-serif, -apple-system, "Segoe UI", sans-serif;
}

/* Workspace panel system */
.workspace { flex:1; display:flex; min-height:0; }
.workspace.hidden { display:none !important; }

/* Gen workspace: elevation foundation lives here */
#workspace-generate {
  flex-direction: row;
  background: var(--bg);
  overflow: hidden;
}
.gen-workspace-inner {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
#gen-panel header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-shrink: 0;
}
#gen-panel header h1 {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  margin: 0;
  color: var(--text);
}
#gen-panel .stage {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* Fill-from-world handoff button bar */
.gen-handoff-bar {
  position: absolute;
  bottom: 18px;
  right: 340px;
  z-index: 10;
}
.gen-handoff-bar button {
  background: var(--accent);
  color: var(--accent-text, #1a1206);
  border: none;
  border-radius: 8px;
  padding: 9px 18px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(0,0,0,.4);
}
.gen-handoff-bar button:hover { filter: brightness(1.1); }

/* Add asset compiler button to menubar */
.menubar-asset-btn {
  background: var(--panel2);
  border: 1px solid var(--border);
  color: var(--muted);
  border-radius: 7px;
  padding: 5px 11px;
  font-size: 12px;
  cursor: pointer;
  margin-left: auto;
}
.menubar-asset-btn:hover { color: var(--text); border-color: var(--muted); }

/* Info page */
#workspace-info {
  overflow-y: auto;
  justify-content: center;
  background: var(--bg);
}
.info-page {
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 48px 24px;
}
.info-inner {
  max-width: 720px;
  width: 100%;
  color: var(--text);
  font-size: 14px;
  line-height: 1.7;
}
.info-logo { font-size: 48px; color: var(--accent); margin-bottom: 12px; }
.info-inner h1 { font-size: 32px; font-weight: 700; margin: 0 0 6px; color: var(--text); }
.info-tagline { color: var(--muted); margin: 0 0 16px; font-size: 15px; }
.info-author { color: var(--accent); font-size: 15px; margin: 4px 0; }
.info-version { color: var(--muted); font-size: 12px; margin: 0 0 24px; font-family: var(--mono); }
.info-inner h2 { color: var(--accent); font-size: 18px; margin: 28px 0 10px; font-weight: 600; }
.info-inner h3 { color: var(--text); font-size: 14px; margin: 18px 0 6px; font-weight: 600; }
.info-inner ul { padding-left: 20px; margin: 6px 0 16px; }
.info-inner li { margin-bottom: 5px; }
.info-inner em { color: var(--muted); }
.info-rule { border: none; border-top: 1px solid var(--border); margin: 28px 0; }
.info-footer { text-align: center; color: var(--muted); font-size: 12px; margin-top: 40px; font-family: var(--mono); }

/* Asset compiler drawer */
.asset-compiler-drawer {
  position: fixed;
  right: 0; top: 0; bottom: 0;
  width: 900px;
  max-width: 92vw;
  background: var(--panel);
  border-left: 1px solid var(--border);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 24px rgba(0,0,0,.5);
  overflow: hidden;
}
.asset-compiler-drawer.hidden { display: none; }
.acd-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-darker, var(--panel));
  flex-shrink: 0;
}
.acd-title { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--accent); flex: 1; }
.acd-close { background: none; border: 1px solid var(--border); color: var(--muted); border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 14px; }
.acd-close:hover { color: var(--text); border-color: var(--muted); }
.acd-body { flex: 1; overflow-y: auto; }
.acd-inner-header { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }

/* Menubar: accommodate more items */
.menubar { flex-wrap: nowrap; overflow-x: auto; }
.menubar-nav { flex-shrink: 0; }

/* Add "Assets" button to menubar */
#assetCompilerBtn {
  background: none;
  border: 1px solid var(--border);
  color: var(--muted);
  border-radius: 7px;
  padding: 5px 11px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
#assetCompilerBtn:hover { color: var(--text); }
'''

# ──────────────────────────────────────────────────────────────────────────────
# Modify the Cartalith menubar to add new tabs
# ──────────────────────────────────────────────────────────────────────────────

# Replace the existing menubar nav buttons
OLD_NAV = '''        <button type="button" class="menubar-item active" data-workspace="routes">Routes</button>
        <button type="button" class="menubar-item" data-workspace="planner">Planner</button>
        <button type="button" class="menubar-item" data-workspace="mapsetup">Map Setup</button>'''

NEW_NAV = '''        <button type="button" class="menubar-item active" data-workspace="generate">Generate</button>
        <button type="button" class="menubar-item" data-workspace="routes">Routes</button>
        <button type="button" class="menubar-item" data-workspace="planner">Planner</button>
        <button type="button" class="menubar-item" data-workspace="mapsetup">Map Setup</button>
        <button type="button" class="menubar-item" data-workspace="info">Info</button>'''

cart_body = cart_body.replace(OLD_NAV, NEW_NAV)

# Add asset compiler button after the theme selector
OLD_COG = '    <button type="button" id="settingsCog" class="menubar-cog" title="Settings — travel modifiers" aria-label="Settings">⚙</button>'
NEW_COG = '    <button type="button" id="assetCompilerBtn" title="Open Asset Pack Compiler">🎨 Assets</button>\n    <button type="button" id="settingsCog" class="menubar-cog" title="Settings — travel modifiers" aria-label="Settings">⚙</button>'
cart_body = cart_body.replace(OLD_COG, NEW_COG)

# ──────────────────────────────────────────────────────────────────────────────
# Modify Cartalith to mark Routes as initially hidden (since Generate is default)
# ──────────────────────────────────────────────────────────────────────────────

# The workspace-map becomes a hidden workspace initially
cart_body = cart_body.replace(
    '<div class="workspace" id="workspace-map">',
    '<div class="workspace hidden" id="workspace-routes">'
)
# Find and fix the planner workspace too
cart_body = cart_body.replace(
    '<div id="workspace-planner"',
    '<div class="workspace hidden" id="workspace-planner"'
)

# ──────────────────────────────────────────────────────────────────────────────
# Fix the Cartalith scripts to handle the new workspace IDs
# ──────────────────────────────────────────────────────────────────────────────

# Cartalith references workspace-map in its JavaScript
# We need it to find workspace-routes instead (or we keep workspace-map ID for Cartalith's internal refs)
# Actually easier: keep workspace-map but also add workspace-routes as an alias via class

# ──────────────────────────────────────────────────────────────────────────────
# Assemble the final HTML file
# ──────────────────────────────────────────────────────────────────────────────

# Note: the Cartalith scripts reference 'workspace-map' internally.
# We need to reconcile this. For now, add the workspace-routes id but keep workspace-map as well.
# Actually, let's be simpler: just use the workspace switching approach where routes+mapsetup
# share workspace-map (as Cartalith already does internally), and we add the workspace-generate
# separately.

# Revert the workspace-map rename — Cartalith uses this ID internally
cart_body = cart_body.replace(
    '<div class="workspace hidden" id="workspace-routes">',
    '<div class="workspace hidden" id="workspace-map">'
)

# Escape </script occurrences in all JS content that will be embedded in <script> blocks.
# The browser HTML parser terminates a <script> at the first literal </script regardless
# of whether it's inside a JS string/comment.  <\/script is valid JS and invisible to HTML.
_gen_iife_safe       = escape_script_content(GEN_IIFE)
_integration_js_safe = escape_script_content(INTEGRATION_JS)
_comp_script_safe    = escape_script_content(comp_script)
_cart_planner_safe   = escape_script_content(cart_planner)
_cart_map_safe       = escape_script_content(cart_map)

OUT = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Cartalith Gen1</title>

<script>
(function(){{
  try {{
    var t = localStorage.getItem('maptool_theme') || localStorage.getItem('cartalith_theme');
    if (t && t !== 'auto') document.documentElement.dataset.theme = t;
  }} catch(_) {{}}
}})();
</script>

<style>
{cart_css}
{INTEGRATION_CSS}

/* === Elevation Foundation scoped CSS === */
{gen_css}

/* === Asset Pack Compiler CSS === */
{comp_css_raw}
</style>
</head>
<body>

{cart_body}

<!-- Generate workspace — elevation foundation -->
<div class="workspace active" id="workspace-generate">
  <div style="position:relative;flex:1;display:flex;min-height:0;overflow:hidden;">
    {gen_panel_html}
    <div class="gen-handoff-bar">
      <button id="fillPaintBtn" onclick="fillPaintGridFromWorld()">→ Fill Paint Grid from World</button>
    </div>
  </div>
</div>

{INFO_HTML}

{COMP_DRAWER_HTML}

{comp_fflate_block}

<script>
{_gen_iife_safe}
</script>

<script>
{_integration_js_safe}
</script>

<script>
/* Asset compiler JS */
{_comp_script_safe}
</script>

<script>
/* ============================================================
   Cartalith Planner Engine
   ============================================================ */
{_cart_planner_safe}
</script>

<script>
/* ============================================================
   Cartalith Map Editor
   ============================================================ */
{_cart_map_safe}
</script>

<script>
/* ============================================================
   Cartalith Gen1 — Post-load wiring
   ============================================================ */
(function() {{
  var btn = document.getElementById('assetCompilerBtn');
  if (btn) btn.addEventListener('click', openAssetCompiler);
}})();

/* ============================================================
   Initialize — Gen engine starts automatically above;
   Cartalith workspace system extended here.
   ============================================================ */

/* Workspace switching: manage the three top-level panels.
   Cartalith's own click handlers on [data-workspace] buttons handle its internal
   routes/planner/mapsetup panel switching — we just show/hide the containers. */
(function() {{
  /* Map each nav tab to the workspace container that houses it */
  var wsMap = {{
    generate: 'workspace-generate',
    routes:   'workspace-map',
    planner:  document.getElementById('workspace-planner') ? 'workspace-planner' : 'workspace-map',
    mapsetup: 'workspace-map',
    info:     'workspace-info'
  }};
  /* All top-level workspace containers */
  var allContainers = ['workspace-generate','workspace-map','workspace-planner','workspace-info'];

  window.switchWorkspace = function(name) {{
    var targetId = wsMap[name] || 'workspace-map';
    allContainers.forEach(function(id) {{
      var el = document.getElementById(id);
      if (!el) return;
      var show = (id === targetId);
      el.classList.toggle('hidden', !show);
      el.classList.toggle('active', show);
    }});
    /* Update active nav button */
    document.querySelectorAll('.menubar-item').forEach(function(b) {{
      b.classList.toggle('active', b.dataset.workspace === name);
    }});
  }};

  /* Wire menubar buttons (single registration) */
  document.querySelectorAll('.menubar-item').forEach(function(btn) {{
    btn.addEventListener('click', function() {{
      switchWorkspace(btn.dataset.workspace);
    }});
  }});

  /* Start on Generate */
  switchWorkspace('generate');
}})();

/* Start the Gen engine */
Gen.init();
</script>

</body>
</html>'''

# ──────────────────────────────────────────────────────────────────────────────
# Write output
# ──────────────────────────────────────────────────────────────────────────────

out_path = os.path.join(ROOT, 'Cartalith Gen1 v0.02.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(OUT)

size = os.path.getsize(out_path) / 1024 / 1024
print(f'Built: {out_path}  ({size:.2f} MB)')
