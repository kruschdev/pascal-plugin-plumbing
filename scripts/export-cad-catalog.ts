/**
 * Export all 47 clean-room MIT procedural plumbing 3D CAD models to binary `.glb` files
 * in `assets/cad/<id>.glb` plus `assets/cad/catalog.json` metadata.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Box3, Scene, Vector3 } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { PLUMBING_CAD_CATALOG } from '../src/cad/catalog'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const outDir = path.join(rootDir, 'assets', 'cad')
fs.mkdirSync(outDir, { recursive: true })

// Minimal FileReader polyfill for Three.js GLTFExporter binary export under Bun/Node
if (typeof globalThis.FileReader === 'undefined') {
  class NodeFileReader {
    result: ArrayBuffer | string | null = null
    onloadend: (() => void) | null = null
    onerror: ((err: unknown) => void) | null = null
    readAsArrayBuffer(blob: Blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf
          this.onloadend?.()
        })
        .catch((err) => this.onerror?.(err))
    }
    readAsDataURL(blob: Blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          const b64 = Buffer.from(buf).toString('base64')
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`
          this.onloadend?.()
        })
        .catch((err) => this.onerror?.(err))
    }
  }
  ;(globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader
}

const exporter = new GLTFExporter()

const manifest: Array<{
  id: string
  slug: string
  name: string
  category: string
  codeRef: string
  dimensionsMm: [number, number, number]
  glbBytes: number
  modelPath: string
  thumbnailPath: string
}> = []

for (const part of PLUMBING_CAD_CATALOG) {
  const group = part.build()
  const box = new Box3().setFromObject(group)
  const size = new Vector3()
  const center = new Vector3()
  box.getSize(size)
  box.getCenter(center)
  // Center horizontally and rest bottom cleanly on y = 0 for studio rendering and placement
  group.position.set(-center.x, -box.min.y, -center.z)

  const scene = new Scene()
  scene.name = part.id
  scene.add(group)

  const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      scene,
      (res) => {
        if (res instanceof ArrayBuffer) resolve(res)
        else reject(new Error(`Expected binary ArrayBuffer for ${part.id}`))
      },
      (err) => reject(err),
      { binary: true },
    )
  })
  const buf = Buffer.from(glb)
  fs.writeFileSync(path.join(outDir, `${part.id}.glb`), buf)

  manifest.push({
    id: part.id,
    slug: part.id,
    name: part.title,
    category: part.category,
    codeRef: part.codeRef,
    dimensionsMm: [
      Math.max(1, Math.round(size.x * 1000)),
      Math.max(1, Math.round(size.y * 1000)),
      Math.max(1, Math.round(size.z * 1000)),
    ],
    glbBytes: buf.byteLength,
    modelPath: `./${part.id}.glb`,
    thumbnailPath: `./thumbnails/${part.id}.png`,
  })
}

fs.writeFileSync(
  path.join(outDir, 'catalog.json'),
  `${JSON.stringify({ version: 1, license: 'MIT', count: manifest.length, items: manifest }, null, 2)}\n`,
)

const totalKb = Math.round(manifest.reduce((s, m) => s + m.glbBytes, 0) / 1024)
console.log(
  `Exported ${manifest.length}/${PLUMBING_CAD_CATALOG.length} binary .glb plumbing CAD models (${totalKb} KB total) + catalog.json into assets/cad/.`,
)
