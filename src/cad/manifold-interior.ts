/**
 * 4 Clean-Room MIT Procedural 3D CAD Builders for Plumbing Manifolds +
 * Interactive 3D PEX Manifold & Wet-Wall Cutaway View Builder (`buildWiredManifoldCutawayCad`).
 *
 * Plumbing's signature interactive 3D showcase parallel to Electrical's Cover-Off Panel Interior View.
 * Zero React or `@pascal-app/editor` imports.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh } from 'three'
import type { ManifoldKind } from '../ipc/tables'
import { createPlumbingMaterialPool } from './materials'

export type ManifoldPortAssignment = {
  portIndex: number
  side: 'hot' | 'cold' | 'gas'
  label: string
  pipeSize: string
  active: boolean
}

export type ManifoldCutawayViewMode = 'open-manifold' | 'enclosure-closed' | 'wet-wall-cutaway'

export function buildManifoldCad(params: {
  manifoldKind: ManifoldKind
  portCount?: number
  coverRemoved?: boolean
}): Group {
  const { manifoldKind, portCount = 12, coverRemoved = false } = params
  return buildWiredManifoldCutawayCad({
    manifoldKind,
    portCount,
    viewMode: coverRemoved ? 'open-manifold' : 'enclosure-closed',
    ports: [],
  })
}

/**
 * Build a detailed 3D PEX Home-Run Manifold, Copper Header, or CSST Gas Manifold,
 * optionally mounted inside an exposed 2x6 wet-wall framing cutaway with active hot/cold
 * home-run PEX loops, brass quarter-turn ball valves, nail plates, and adjacent 3" PVC stack.
 */
export function buildWiredManifoldCutawayCad(params: {
  manifoldKind: ManifoldKind
  portCount?: number
  viewMode?: ManifoldCutawayViewMode
  ports?: ReadonlyArray<ManifoldPortAssignment>
}): Group {
  const {
    manifoldKind,
    portCount = 12,
    viewMode = 'open-manifold',
    ports = [],
  } = params
  const pool = createPlumbingMaterialPool()
  const g = new Group()
  g.name = `plumbing-manifold-${manifoldKind}-${viewMode}`

  const add = (mesh: Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    g.add(mesh)
    return mesh
  }

  const perSide = Math.max(4, Math.min(18, Math.ceil(portCount / 2)))
  const cabinetW = manifoldKind === 'gas-csst' ? 0.36 : 0.44
  const cabinetH = Math.max(0.56, 0.22 + perSide * 0.048)
  const cabinetD = 0.11

  // Optional 2x6 Wet-Wall Framing Cutaway Surround
  if (viewMode === 'wet-wall-cutaway') {
    const bayW = 0.72
    const wallH = Math.max(1.35, cabinetH + 0.55)
    // Left, center, and right 2x6 wood studs (1.5" x 5.5" = 0.0381 x 0.1397 m)
    add(new Mesh(new BoxGeometry(0.038, wallH, 0.14), pool.woodStud), -bayW / 2, 0, -0.02)
    add(new Mesh(new BoxGeometry(0.038, wallH, 0.14), pool.woodStud), bayW / 2, 0, -0.02)
    add(new Mesh(new BoxGeometry(0.038, wallH, 0.14), pool.woodStud), bayW / 2 + 0.406, 0, -0.02)
    // Bottom sole plate + double top plate
    add(new Mesh(new BoxGeometry(bayW + 0.50, 0.038, 0.14), pool.woodStud), 0.20, -wallH / 2, -0.02)
    add(new Mesh(new BoxGeometry(bayW + 0.50, 0.076, 0.14), pool.woodStud), 0.20, wallH / 2, -0.02)
    // Galvanized steel nail plates (IRC R602.6 protection)
    add(new Mesh(new BoxGeometry(0.042, 0.13, 0.004), pool.galvanizedSteel), -bayW / 2, -0.18, 0.052)
    add(new Mesh(new BoxGeometry(0.042, 0.13, 0.004), pool.galvanizedSteel), bayW / 2, -0.18, 0.052)
    // Adjacent 3" PVC DWV Soil/Vent Stack in neighboring 2x6 bay
    add(new Mesh(new CylinderGeometry(0.044, 0.044, wallH + 0.12, 20), pool.pvcWhite), bayW / 2 + 0.20, 0, -0.02)
    add(new Mesh(new CylinderGeometry(0.052, 0.052, 0.10, 20), pool.pvcWhite), bayW / 2 + 0.20, -0.25, -0.02)
    // Drywall backing sheet
    add(new Mesh(new BoxGeometry(bayW + 0.52, wallH, 0.012), pool.drywallWhite), 0.20, 0, -0.095)
  }

  // Open-front recessed steel manifold backbox (thin backplate + 4 side flanges so headers & valves are 100% visible!)
  const wallT = 0.012
  add(new Mesh(new BoxGeometry(cabinetW, cabinetH, wallT), pool.galvanizedSteel), 0, 0, -cabinetD / 2)
  add(new Mesh(new BoxGeometry(cabinetW, wallT, cabinetD), pool.galvanizedSteel), 0, cabinetH / 2, 0)
  add(new Mesh(new BoxGeometry(cabinetW, wallT, cabinetD), pool.galvanizedSteel), 0, -cabinetH / 2, 0)
  add(new Mesh(new BoxGeometry(wallT, cabinetH, cabinetD), pool.galvanizedSteel), -cabinetW / 2, 0, 0)
  add(new Mesh(new BoxGeometry(wallT, cabinetH, cabinetD), pool.galvanizedSteel), cabinetW / 2, 0, 0)

  if (manifoldKind === 'gas-csst') {
    // Brass CSST gas distribution block with yellow shutoffs
    add(new Mesh(new BoxGeometry(0.06, cabinetH - 0.16, 0.05), pool.brass), 0, 0, 0.02)
    add(new Mesh(new CylinderGeometry(0.016, 0.016, 0.16, 12), pool.blackIron), 0, -cabinetH / 2 - 0.04, 0.02)
    for (let i = 0; i < Math.min(8, portCount); i++) {
      const y = cabinetH / 2 - 0.12 - i * 0.052
      const side = i % 2 === 0 ? -1 : 1
      add(new Mesh(new CylinderGeometry(0.010, 0.010, 0.09, 10), pool.brass), side * 0.06, y, 0.02).rotation.z =
        Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.009, 0.009, 0.16, 10), pool.csstYellow), side * 0.14, y - 0.05, 0.02)
    }
  } else {
    // Hot (Red, left) & Cold (Blue, right) vertical distribution trunks
    const headerH = cabinetH - 0.14
    const hotMat = manifoldKind === 'copper-header' ? pool.copper : pool.pexHotRed
    const coldMat = manifoldKind === 'copper-header' ? pool.copper : pool.pexColdBlue

    add(new Mesh(new CylinderGeometry(0.022, 0.022, headerH, 16), hotMat), -0.085, 0, 0.02)
    add(new Mesh(new CylinderGeometry(0.022, 0.022, headerH, 16), coldMat), 0.085, 0, 0.02)

    // Bottom 3/4" main feed risers + main brass isolation ball valves
    add(new Mesh(new CylinderGeometry(0.015, 0.015, 0.18, 12), pool.pexHotRed), -0.085, -cabinetH / 2 - 0.05, 0.02)
    add(new Mesh(new CylinderGeometry(0.015, 0.015, 0.18, 12), pool.pexColdBlue), 0.085, -cabinetH / 2 - 0.05, 0.02)
    add(new Mesh(new CylinderGeometry(0.022, 0.022, 0.05, 12), pool.brass), -0.085, -cabinetH / 2 + 0.03, 0.02)
    add(new Mesh(new CylinderGeometry(0.022, 0.022, 0.05, 12), pool.brass), 0.085, -cabinetH / 2 + 0.03, 0.02)

    // Per-port quarter-turn ball valves + color-coded PEX home-run stubs
    const hotPortCount = Math.max(perSide, ports.filter((p) => p.side === 'hot').length)
    const coldPortCount = Math.max(perSide, ports.filter((p) => p.side === 'cold').length)
    const rows = Math.min(14, Math.max(hotPortCount, coldPortCount))

    for (let i = 0; i < rows; i++) {
      const y = headerH / 2 - 0.04 - i * ((headerH - 0.08) / Math.max(1, rows - 1))

      // Hot side port (left)
      add(new Mesh(new CylinderGeometry(0.009, 0.009, 0.075, 10), pool.brass), -0.13, y, 0.02).rotation.z = Math.PI / 2
      add(new Mesh(new BoxGeometry(0.026, 0.009, 0.012), pool.pexHotRed), -0.13, y + 0.014, 0.036)
      if (viewMode !== 'enclosure-closed') {
        add(new Mesh(new CylinderGeometry(0.008, 0.008, 0.14, 8), pool.pexHotRed), -0.175, y - 0.05, 0.02)
      }

      // Cold side port (right)
      add(new Mesh(new CylinderGeometry(0.009, 0.009, 0.075, 10), pool.brass), 0.13, y, 0.02).rotation.z = Math.PI / 2
      add(new Mesh(new BoxGeometry(0.026, 0.009, 0.012), pool.pexColdBlue), 0.13, y + 0.014, 0.036)
      if (viewMode !== 'enclosure-closed') {
        add(new Mesh(new CylinderGeometry(0.008, 0.008, 0.14, 8), pool.pexColdBlue), 0.175, y - 0.05, 0.02)
      }
    }
  }

  // Hinged steel access door when closed
  if (viewMode === 'enclosure-closed') {
    add(new Mesh(new BoxGeometry(cabinetW + 0.02, cabinetH + 0.02, 0.016), pool.enamelSteel), 0, 0, 0.055)
    add(new Mesh(new BoxGeometry(0.16, 0.04, 0.005), pool.enamelBlue), 0, cabinetH * 0.34, 0.065)
    add(new Mesh(new BoxGeometry(0.018, 0.06, 0.018), pool.chrome), cabinetW * 0.42, 0, 0.068)
  }

  return g
}
