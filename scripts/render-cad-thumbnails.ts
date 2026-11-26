/**
 * Renders a studio-lit 47-item WebGL contact sheet (`assets/cad-material-catalog.png`)
 * and 47 individual studio thumbnails (`assets/cad/thumbnails/<id>.png`) by loading every
 * exported `.glb` via Three.js `GLTFLoader` in headless Chrome, proving all 47 GLBs parse
 * and render cleanly in a real browser.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const cadDir = path.join(rootDir, 'assets', 'cad')
const thumbDir = path.join(cadDir, 'thumbnails')
fs.mkdirSync(thumbDir, { recursive: true })

const catalogPath = path.join(cadDir, 'catalog.json')
if (!fs.existsSync(catalogPath)) {
  console.error('Missing assets/cad/catalog.json; run `bun run export:cad` first.')
  process.exit(1)
}
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
  items: Array<{
    id: string
    slug: string
    name: string
    category: string
    codeRef: string
    dimensionsMm: [number, number, number]
    glbBytes: number
  }>
}

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 20px;
    background: #0f172a;
    color: #e2e8f0;
    font-family: system-ui, -apple-system, sans-serif;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 14px;
    border-bottom: 1px solid rgba(148,163,184,0.22);
    padding-bottom: 10px;
  }
  h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  .sub { font-size: 12px; color: #94a3b8; }
  .grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 12px;
  }
  .card {
    background: #1e293b;
    border: 1px solid rgba(148,163,184,0.2);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .thumb {
    width: 100%;
    height: 170px;
    background: radial-gradient(circle at 50% 35%, #334155 0%, #0f172a 100%);
    display: block;
  }
  .meta { padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
  .title { font-size: 11px; font-weight: 700; color: #f8fafc; line-height: 1.25; }
  .row { display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
  .badge { color: #38bdf8; font-weight: 600; }
  .summary-card {
    grid-column: span 3;
    background: linear-gradient(135deg, #16243d 0%, #0f172a 100%);
    border: 1px solid rgba(56,189,248,0.35);
    border-radius: 10px;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 12px;
  }
  .summary-card h2 {
    margin: 0;
    font-size: 18px;
    color: #f8fafc;
    letter-spacing: -0.01em;
  }
  .summary-card p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: #cbd5e1;
  }
  .summary-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .summary-pill {
    padding: 5px 10px;
    border-radius: 999px;
    background: rgba(56,189,248,0.14);
    border: 1px solid rgba(56,189,248,0.35);
    color: #7dd3fc;
    font-size: 11px;
    font-weight: 600;
  }
</style>
<script type="importmap">
{
  "imports": {
    "three": "/three/build/three.module.js",
    "three/addons/": "/three/examples/jsm/"
  }
}
</script>
</head>
<body>
  <header>
    <h1>@kruschdev/pascal-plugin-plumbing: 47 Clean-Room MIT Plumbing CAD Models (.glb)</h1>
    <div class="sub">Water Heaters &amp; Mechanical · PEX/Copper/CSST Manifolds · Fixtures · DWV Fittings · Valves · 2x6 Wet-Wall Cutaway</div>
  </header>
  <div id="grid" class="grid"></div>
  <script type="module">
    import * as THREE from 'three';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

    const catalog = await (await fetch('/cad/catalog.json')).json();
    const grid = document.getElementById('grid');

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(320, 240);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const loader = new GLTFLoader();
    let rendered = 0;

    for (const item of catalog.items) {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xf8fafc, 0x334155, 1.35));
      const key = new THREE.DirectionalLight(0xffffff, 1.85);
      key.position.set(2.5, 4, 3.2);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0x93c5fd, 0.8);
      fill.position.set(-3, 1.5, -2);
      scene.add(fill);

      const gltf = await loader.loadAsync('/cad/' + item.slug + '.glb');
      const root = gltf.scene;
      scene.add(root);

      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const maxDim = Math.max(size.x, size.y, size.z, 0.05);
      const camera = new THREE.PerspectiveCamera(34, 320 / 240, 0.005, 50);
      const dist = maxDim * 2.05;

      const isFloorOrBasin =
        item.slug === 'fixture-floor-drain' ||
        item.slug === 'fixture-bathtub' ||
        item.slug === 'fixture-shower' ||
        item.slug === 'fixture-kitchen-sink' ||
        item.slug === 'fixture-grease-interceptor' ||
        item.slug === 'sump-pump-basin' ||
        item.slug === 'sewage-ejector-basin';
      const isManifoldOrCutaway =
        item.slug.includes('manifold') ||
        item.slug.includes('header') ||
        item.slug === 'assembly-wet-wall-manifold-cutaway';

      const camPos = isFloorOrBasin
        ? new THREE.Vector3(center.x + dist * 0.72, center.y + dist * 0.88, center.z + dist * 0.82)
        : isManifoldOrCutaway
          ? new THREE.Vector3(center.x + dist * 0.36, center.y + dist * 0.14, center.z + dist * 1.02)
          : new THREE.Vector3(center.x + dist * 0.68, center.y + dist * 0.45, center.z + dist * 0.9);

      camera.position.copy(camPos);
      camera.lookAt(center);

      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/png');

      await fetch('/save-thumb/' + item.slug, {
        method: 'POST',
        body: dataUrl,
      });

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        '<img class="thumb" src="' + dataUrl + '" />' +
        '<div class="meta">' +
          '<div class="title">' + item.name + '</div>' +
          '<div class="row"><span class="badge">' + item.codeRef + '</span><span>' + (item.glbBytes / 1024).toFixed(1) + ' KB</span></div>' +
          '<div class="row"><span>' + item.slug + '</span><span>' + item.dimensionsMm.join('x') + 'mm</span></div>' +
        '</div>';
      grid.appendChild(card);
      rendered += 1;
    }

    const summary = document.createElement('div');
    summary.className = 'summary-card';
    summary.innerHTML =
      '<h2>Clean-Room MIT Procedural Three.js Plumbing CAD Library</h2>' +
      '<p>All 47 binary .glb assets are generated purely in Three.js (@kruschdev/pascal-plugin-plumbing/cad) with zero third-party meshes, zero React dependencies, and verified single-component geometry. Ready for Pascal Editor Plugin API v1, standalone Three.js viewers, and headless MCP workflows.</p>' +
      '<div class="summary-pills">' +
        '<span class="summary-pill">12 Mechanical &amp; Water Heaters</span>' +
        '<span class="summary-pill">4 PEX / Copper / CSST Manifolds</span>' +
        '<span class="summary-pill">18 Res &amp; Comm Fixtures</span>' +
        '<span class="summary-pill">7 DWV Fittings &amp; Cleanouts</span>' +
        '<span class="summary-pill">4 Supply &amp; Gas Valves</span>' +
        '<span class="summary-pill">2 Hanger &amp; 2x6 Wet-Wall Cutaway</span>' +
      '</div>';
    grid.appendChild(summary);

    document.title = 'READY:' + rendered;
    await fetch('/done');
  </script>
</body>
</html>`

let resolveDone: () => void = () => {}
let doneReceived = false
const donePromise = new Promise<void>((r) => {
  resolveDone = r
})
let savedCount = 0

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/') {
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname.startsWith('/three/')) {
      const rel = url.pathname.slice('/three/'.length)
      const full = path.join(rootDir, 'node_modules', 'three', rel)
      if (fs.existsSync(full)) {
        return new Response(Bun.file(full), {
          headers: { 'content-type': 'application/javascript; charset=utf-8' },
        })
      }
    }
    if (url.pathname.startsWith('/cad/')) {
      const rel = url.pathname.slice('/cad/'.length)
      const full = path.join(cadDir, rel)
      if (fs.existsSync(full)) {
        return new Response(Bun.file(full))
      }
    }
    if (url.pathname.startsWith('/save-thumb/') && req.method === 'POST') {
      const slug = url.pathname.slice('/save-thumb/'.length).replace(/[^a-z0-9-]/g, '')
      const dataUrl = await req.text()
      const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
      fs.writeFileSync(path.join(thumbDir, `${slug}.png`), Buffer.from(b64, 'base64'))
      savedCount += 1
      return new Response('ok')
    }
    if (url.pathname === '/done') {
      doneReceived = true
      resolveDone()
      return new Response('ok')
    }
    return new Response('Not found', { status: 404 })
  },
})

const outSheet = path.join(rootDir, 'assets', 'cad-material-catalog.png')
const chromeBin = process.env.CHROME_BIN || '/usr/bin/google-chrome'
const angleBackend = process.env.CHROME_ANGLE_BACKEND || 'gl-egl'
const chromeArgs = [
  chromeBin,
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--use-gl=angle',
  `--use-angle=${angleBackend}`,
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--virtual-time-budget=35000',
  '--window-size=1680,2560',
  `--screenshot=${outSheet}`,
  `http://127.0.0.1:${server.port}/`,
]

const proc = Bun.spawn(chromeArgs, {
  stdout: 'ignore',
  stderr: 'pipe',
})
const exitCode = await proc.exited
const stderrText = await new Response(proc.stderr).text()

server.stop(true)
if (exitCode !== 0 || !fs.existsSync(outSheet)) {
  console.error('Chrome render failed:', stderrText)
  process.exit(1)
}

if (doneReceived) {
  await donePromise
}
if (savedCount !== catalog.items.length) {
  throw new Error(
    `Incomplete CAD thumbnail render: saved ${savedCount}/${catalog.items.length} thumbnails (done signal ${doneReceived ? 'received' : 'not received'}).`,
  )
}
console.log(
  `Rendered ${savedCount}/${catalog.items.length} individual thumbnails + contact sheet (${Math.round(fs.statSync(outSheet).size / 1024)} KB) at ${outSheet}`,
)
