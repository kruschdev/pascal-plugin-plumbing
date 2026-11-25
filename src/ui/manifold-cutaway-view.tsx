/**
 * Interactive 3D PEX Manifold & 2x6 Wet-Wall Framing Cutaway Viewer (`src/ui/manifold-cutaway-view.tsx`).
 * Plumbing's signature interactive 3D cutaway view inside the split-pane Plumbing Schedule.
 */

import { useEffect, useRef } from 'react'
import {
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import {
  type ManifoldCutawayViewMode,
  type ManifoldPortAssignment,
  buildWiredManifoldCutawayCad,
} from '../cad/manifold-interior'
import type { ManifoldKind } from '../ipc/tables'

export default function ManifoldCutawayView({
  manifoldKind,
  portCount,
  viewMode,
  ports,
  onChangeViewMode,
}: {
  manifoldKind: ManifoldKind
  portCount: number
  viewMode: ManifoldCutawayViewMode
  ports: ReadonlyArray<ManifoldPortAssignment>
  onChangeViewMode: (m: ManifoldCutawayViewMode) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const width = Math.max(320, el.clientWidth || 520)
    const height = 340

    const scene = new Scene()
    scene.background = new Color(0x0f172a)

    const camera = new PerspectiveCamera(42, width / height, 0.05, 20)
    camera.position.set(0.35, 0.25, 1.45)
    camera.lookAt(0.06, 0, 0)

    const renderer = new WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    el.innerHTML = ''
    el.appendChild(renderer.domElement)

    scene.add(new AmbientLight(0xffffff, 0.85))
    const key = new DirectionalLight(0xffffff, 1.3)
    key.position.set(2, 3, 4)
    scene.add(key)

    const model = buildWiredManifoldCutawayCad({
      manifoldKind,
      portCount,
      viewMode,
      ports,
    })
    scene.add(model)

    let dragging = false
    let prevX = 0
    let rotY = -0.18
    model.rotation.y = rotY

    const onDown = (e: PointerEvent) => {
      dragging = true
      prevX = e.clientX
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      rotY += (e.clientX - prevX) * 0.01
      prevX = e.clientX
      model.rotation.y = rotY
      renderer.render(scene, camera)
    }
    const onUp = () => {
      dragging = false
    }

    renderer.domElement.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    renderer.render(scene, camera)

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      renderer.dispose()
    }
  }, [manifoldKind, portCount, viewMode, ports])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12 }}>3D Cutaway Mode:</strong>
        {(
          [
            ['wet-wall-cutaway', '2x6 Wet-Wall & 3" Stack Cutaway'],
            ['open-manifold', 'Manifold Cover Off'],
            ['enclosure-closed', 'Steel Enclosure Closed'],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChangeViewMode(mode)}
            style={{
              padding: '4px 9px',
              borderRadius: 6,
              fontSize: 11,
              cursor: 'pointer',
              border: '1px solid rgba(56,189,248,0.5)',
              background: viewMode === mode ? 'rgba(56,189,248,0.25)' : 'transparent',
              color: 'inherit',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: 340,
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid var(--border, rgba(255,255,255,0.16))',
          cursor: 'grab',
        }}
      />

      <div style={{ fontSize: 11, opacity: 0.8 }}>
        Drag horizontally to orbit. Shows color-coded Red Hot &amp; Blue Cold PEX-A home-run quarter-turn ball valves,
        galvanized steel nail plates (IRC R602.6), and adjacent 3&quot; PVC DWV stack inside a 2x6 wet wall.
      </div>
    </div>
  )
}
