/**
 * Renders a high-resolution 4-panel showcase (`assets/demo-manifold-cutaway.png`)
 * of the 3D PEX Manifold & 2x6 Wet-Wall Cutaway CAD models (2x6 Wet-Wall & 3" Stack Cutaway,
 * Extreme Zoom PEX-A Ball Valves & IRC R602.6 Nail Plates, 24-Port PEX Manifold Steel Enclosure,
 * and 8-Port CSST Fuel-Gas Manifold) via Three.js GLTFLoader in headless Chrome.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const cadDir = path.join(rootDir, 'assets', 'cad')
const outImg = path.join(rootDir, 'assets', 'demo-manifold-cutaway.png')

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 20px;
    background: #0b1220;
    color: #e2e8f0;
    font-family: system-ui, -apple-system, sans-serif;
    overflow: hidden;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(148,163,184,0.22);
  }
  h1 { margin: 0; font-size: 19px; }
  .sub { font-size: 12px; color: #94a3b8; }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
  }
  .panel {
    background: #111c32;
    border: 1px solid rgba(148,163,184,0.25);
    border-radius: 12px;
    overflow: hidden;
  }
  img { width: 100%; height: 555px; object-fit: cover; display: block; background: #0b1220; }
  .cap { padding: 10px 14px; }
  .cap strong { display: block; font-size: 13px; color: #f8fafc; margin-bottom: 3px; }
  .cap span { font-size: 11px; color: #94a3b8; }
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
    <h1>3D PEX Manifold &amp; 2x6 Wet-Wall Cutaway: Open Manifold, Ball Valves, Steel Enclosure, and CSST Gas</h1>
    <div class="sub">Interactive in Pascal Plumbing Schedule ("3D Manifold Cutaway") with Red/Blue PEX-A valves, IRC R602.6 nail plates, and 3" PVC stack</div>
  </header>
  <div id="grid" class="grid"></div>
  <script type="module">
    import * as THREE from 'three';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

    const shots = [
      {
        slug: 'assembly-wet-wall-manifold-cutaway',
        title: '1. 2x6 Wet-Wall & 3" Stack Cutaway',
        sub: 'Recessed 12-port PEX manifold, 2x6 framing cleats, IRC R602.6 nail plates & 3" PVC stack',
        camOffset: [0.38, 0.08, 2.72],
        targetOffset: [0.0, 0.0, 0.02],
      },
      {
        slug: 'assembly-wet-wall-manifold-cutaway',
        title: '2. Zoom: PEX-A Ball Valves & Stud Cleats',
        sub: 'Color-coded Red Hot & Blue Cold quarter-turn brass valves, 3/4" feed risers & nail plates',
        camOffset: [0.24, 0.02, 1.12],
        targetOffset: [-0.14, -0.02, 0.04],
      },
      {
        slug: 'pex-manifold-24-closed',
        title: '3. 24-Port Manifold (Enclosure Closed)',
        sub: 'Flush recessed enamel steel access door, identification nameplate & chrome quarter-turn latch',
        camOffset: [0.28, 0.05, 1.72],
        targetOffset: [0.0, 0.0, 0.02],
      },
      {
        slug: 'csst-gas-manifold',
        title: '4. 8-Port CSST Fuel-Gas Manifold',
        sub: 'Machined brass distribution block, black-iron main inlet & yellow jacketed CSST branch ports',
        camOffset: [-0.26, 0.05, 1.32],
        targetOffset: [0.0, 0.0, 0.02],
      },
    ];

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(460, 620);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const loader = new GLTFLoader();
    const grid = document.getElementById('grid');

    for (const s of shots) {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b1220);
      scene.add(new THREE.HemisphereLight(0xf8fafc, 0x334155, 1.4));
      const key = new THREE.DirectionalLight(0xffffff, 1.9);
      key.position.set(1.8, 2.5, 3.0);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0x93c5fd, 0.85);
      fill.position.set(-2.2, 0.8, 2.0);
      scene.add(fill);

      const gltf = await loader.loadAsync('/cad/' + s.slug + '.glb');
      scene.add(gltf.scene);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const camera = new THREE.PerspectiveCamera(36, 460 / 620, 0.01, 20);
      const target = new THREE.Vector3(
        center.x + size.x * s.targetOffset[0],
        center.y + size.y * s.targetOffset[1],
        center.z + s.targetOffset[2],
      );
      camera.position.set(
        target.x + s.camOffset[0],
        target.y + s.camOffset[1],
        target.z + s.camOffset[2],
      );
      camera.lookAt(target);
      renderer.render(scene, camera);

      const card = document.createElement('div');
      card.className = 'panel';
      card.innerHTML =
        '<img src="' + renderer.domElement.toDataURL('image/png') + '" />' +
        '<div class="cap"><strong>' + s.title + '</strong><span>' + s.sub + '</span></div>';
      grid.appendChild(card);
    }
    document.title = 'DONE';
  </script>
</body>
</html>`

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/') {
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname.startsWith('/three/')) {
      const full = path.join(rootDir, 'node_modules', 'three', url.pathname.slice('/three/'.length))
      if (fs.existsSync(full)) {
        return new Response(Bun.file(full), { headers: { 'content-type': 'application/javascript; charset=utf-8' } })
      }
    }
    if (url.pathname.startsWith('/cad/')) {
      const full = path.join(cadDir, url.pathname.slice('/cad/'.length))
      if (fs.existsSync(full)) return new Response(Bun.file(full))
    }
    return new Response('Not found', { status: 404 })
  },
})

const chromeBin = process.env.CHROME_BIN || '/usr/bin/google-chrome'
const angleBackend = process.env.CHROME_ANGLE_BACKEND || 'gl-egl'
const proc = Bun.spawn(
  [
    chromeBin,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-gl=angle',
    `--use-angle=${angleBackend}`,
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--virtual-time-budget=20000',
    '--window-size=1920,760',
    `--screenshot=${outImg}`,
    `http://127.0.0.1:${server.port}/`,
  ],
  { stdout: 'ignore', stderr: 'pipe' },
)

const code = await proc.exited
server.stop(true)
if (code !== 0 || !fs.existsSync(outImg)) {
  console.error('Close-up render failed:', await new Response(proc.stderr).text())
  process.exit(1)
}
console.log(`Rendered manifold cutaway close-up (${Math.round(fs.statSync(outImg).size / 1024)} KB) at ${outImg}`)
