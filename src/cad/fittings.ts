/**
 * 12 Clean-Room MIT Procedural 3D CAD Builders for Plumbing Fittings & Valves
 * plus the Swept 3D Sloped Pipe-Run Builder (`buildPipeRunCad`).
 * Zero React or `@pascal-app/editor` imports.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import type { Vec3 } from '../ipc/framing-interop'
import {
  type PipeMaterial,
  type PipeNominalSize,
  type PlumbingSystem,
  getPipeOuterDiameterM,
} from '../ipc/tables'
import { createPlumbingMaterialPool, pipeRunMaterialForSystem } from './materials'

export type FittingCadKind =
  | 'p-trap'
  | 'sanitary-tee'
  | 'wye-combo'
  | 'long-sweep-90'
  | 'cleanout-tee'
  | 'roof-vent-flashing'
  | 'aav-studor'
  | 'ball-valve'
  | 'angle-stop'
  | 'mixing-valve'
  | 'gas-drip-leg'
  | 'pipe-hanger-clevis'

export function buildFittingCad(kind: FittingCadKind): Group {
  const pool = createPlumbingMaterialPool()
  const g = new Group()
  g.name = `plumbing-fitting-${kind}`

  const add = (mesh: Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    g.add(mesh)
    return mesh
  }

  switch (kind) {
    case 'p-trap': {
      add(new Mesh(new CylinderGeometry(0.025, 0.025, 0.12, 16), pool.pvcWhite), -0.055, 0.06, 0)
      add(new Mesh(new TorusGeometry(0.055, 0.025, 12, 20, Math.PI), pool.pvcWhite), 0, 0, 0).rotation.x = Math.PI
      add(new Mesh(new CylinderGeometry(0.025, 0.025, 0.09, 16), pool.pvcWhite), 0.055, 0.045, 0)
      add(new Mesh(new CylinderGeometry(0.025, 0.025, 0.14, 16), pool.pvcWhite), 0.11, 0.09, 0).rotation.z = Math.PI / 2
      break
    }
    case 'sanitary-tee': {
      add(new Mesh(new CylinderGeometry(0.046, 0.046, 0.24, 18), pool.pvcWhite), 0, 0, 0)
      add(new Mesh(new CylinderGeometry(0.036, 0.036, 0.12, 16), pool.pvcWhite), 0.07, 0.01, 0).rotation.z = Math.PI / 2
      break
    }
    case 'wye-combo': {
      add(new Mesh(new CylinderGeometry(0.046, 0.046, 0.28, 18), pool.pvcWhite), 0, 0, 0)
      add(new Mesh(new CylinderGeometry(0.036, 0.036, 0.16, 16), pool.pvcWhite), 0.07, 0.05, 0).rotation.z = -Math.PI / 4
      break
    }
    case 'long-sweep-90': {
      add(new Mesh(new TorusGeometry(0.09, 0.038, 14, 24, Math.PI / 2), pool.pvcWhite), 0, 0, 0)
      break
    }
    case 'cleanout-tee': {
      add(new Mesh(new CylinderGeometry(0.052, 0.052, 0.24, 18), pool.pvcWhite), 0, 0, 0)
      add(new Mesh(new CylinderGeometry(0.056, 0.056, 0.07, 18), pool.pvcWhite), 0.06, 0, 0).rotation.z = Math.PI / 2
      add(new Mesh(new BoxGeometry(0.04, 0.04, 0.04), pool.brass), 0.11, 0, 0)
      break
    }
    case 'roof-vent-flashing': {
      add(new Mesh(new BoxGeometry(0.36, 0.012, 0.42), pool.galvanizedSteel), 0, 0, 0)
      add(new Mesh(new CylinderGeometry(0.05, 0.085, 0.16, 18), pool.darkRubber), 0, 0.08, 0)
      add(new Mesh(new CylinderGeometry(0.045, 0.045, 0.34, 16), pool.ventGreen), 0, 0.18, 0)
      break
    }
    case 'aav-studor': {
      add(new Mesh(new CylinderGeometry(0.025, 0.025, 0.09, 14), pool.pvcWhite), 0, 0, 0)
      add(new Mesh(new CylinderGeometry(0.042, 0.038, 0.07, 18), pool.pvcWhite), 0, 0.075, 0)
      break
    }
    case 'ball-valve': {
      add(new Mesh(new CylinderGeometry(0.022, 0.022, 0.10, 16), pool.brass), 0, 0, 0).rotation.z = Math.PI / 2
      add(new Mesh(new SphereGeometry(0.028, 16, 12), pool.brass), 0, 0, 0)
      add(new Mesh(new BoxGeometry(0.11, 0.012, 0.02), pool.pexColdBlue), 0.04, 0.045, 0)
      break
    }
    case 'angle-stop': {
      add(new Mesh(new CylinderGeometry(0.014, 0.014, 0.06, 14), pool.chrome), 0, 0, 0).rotation.x = Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.012, 0.012, 0.05, 14), pool.chrome), 0, 0.025, 0.02)
      add(new Mesh(new CylinderGeometry(0.022, 0.018, 0.015, 14), pool.chrome), 0, 0, 0.045).rotation.x = Math.PI / 2
      break
    }
    case 'mixing-valve': {
      add(new Mesh(new CylinderGeometry(0.024, 0.024, 0.12, 16), pool.brass), 0, 0, 0).rotation.z = Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.022, 0.022, 0.09, 16), pool.brass), 0, 0.04, 0)
      add(new Mesh(new CylinderGeometry(0.028, 0.028, 0.04, 16), pool.darkRubber), 0, 0.10, 0)
      break
    }
    case 'gas-drip-leg': {
      // IFGC 408.4 tee + vertical 4" sediment trap nipple + cap + yellow shutoff handle
      add(new Mesh(new CylinderGeometry(0.018, 0.018, 0.24, 14), pool.blackIron), 0, 0, 0)
      add(new Mesh(new CylinderGeometry(0.024, 0.024, 0.03, 14), pool.blackIron), 0, -0.13, 0)
      add(new Mesh(new CylinderGeometry(0.018, 0.018, 0.14, 14), pool.blackIron), 0.07, 0.03, 0).rotation.z = Math.PI / 2
      add(new Mesh(new BoxGeometry(0.08, 0.014, 0.02), pool.csstYellow), -0.02, 0.08, 0.03)
      break
    }
    case 'pipe-hanger-clevis': {
      add(new Mesh(new TorusGeometry(0.042, 0.006, 8, 18), pool.galvanizedSteel), 0, 0, 0)
      add(new Mesh(new CylinderGeometry(0.005, 0.005, 0.18, 8), pool.galvanizedSteel), 0, 0.13, 0)
      break
    }
  }

  return g
}

const UP = new Vector3(0, 1, 0)

/**
 * Build a swept 3D cylindrical pipe run with smooth corner joints, coupling hubs,
 * periodic hangers, and system color coding.
 */
export function buildPipeRunCad(params: {
  id: string
  path: ReadonlyArray<Vec3>
  system: PlumbingSystem
  material: PipeMaterial
  nominalSize: PipeNominalSize
  hasCleanout?: boolean
  penetrations?: ReadonlyArray<{
    position: Vec3
    pipeDirection: Vec3
    holeSawIn: number
    needsNailPlate: boolean
    codeCompliant: boolean
    memberKind: 'stud' | 'sole-plate' | 'top-plate' | 'floor-joist'
  }>
}): Group {
  const { id, path, system, material, nominalSize, hasCleanout = false, penetrations = [] } = params
  const pool = createPlumbingMaterialPool()
  const g = new Group()
  g.name = `plumbing-pipe-run-${id}`

  if (path.length < 2) return g

  const mat = pipeRunMaterialForSystem(pool, system, material)
  const odM = getPipeOuterDiameterM(nominalSize, material)
  const radius = Math.max(0.009, odM / 2)
  const hubRadius = radius * 1.18
  const isRigid = material !== 'pex-a' && material !== 'pex-b' && material !== 'csst'

  for (let i = 1; i < path.length; i++) {
    const a = new Vector3(path[i - 1]![0], path[i - 1]![1], path[i - 1]![2])
    const b = new Vector3(path[i]![0], path[i]![1], path[i]![2])
    const delta = new Vector3().subVectors(b, a)
    const len = delta.length()
    if (len < 0.005) continue

    const dir = delta.clone().normalize()
    const quat = new Quaternion().setFromUnitVectors(UP, dir)
    const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5)

    const seg = new Mesh(new CylinderGeometry(radius, radius, len, 12), mat)
    seg.position.copy(mid)
    seg.quaternion.copy(quat)
    seg.castShadow = true
    seg.receiveShadow = true
    g.add(seg)

    // Smooth elbow/wye joint sphere at vertices
    if (i < path.length - 1) {
      const joint = new Mesh(new SphereGeometry(isRigid ? hubRadius : radius * 1.06, 12, 10), mat)
      joint.position.copy(b)
      g.add(joint)
    }

    // Coupling hubs every ~3.05 m (10 ft) on rigid pipe
    if (isRigid && len > 3.2) {
      const hubs = Math.floor(len / 3.05)
      for (let h = 1; h <= hubs; h++) {
        const pt = a.clone().addScaledVector(dir, h * 3.05)
        const collar = new Mesh(new CylinderGeometry(hubRadius, hubRadius, 0.055, 12), mat)
        collar.position.copy(pt)
        collar.quaternion.copy(quat)
        g.add(collar)
      }
    }
  }

  // Optional cleanout plug boss at start of stack/building drain
  if (hasCleanout && path.length >= 2) {
    const p0 = path[0]!
    const plug = new Mesh(new CylinderGeometry(hubRadius * 1.15, hubRadius * 1.15, 0.08, 14), pool.brass)
    plug.position.set(p0[0], p0[1] + 0.06, p0[2] + hubRadius)
    plug.rotation.x = Math.PI / 2
    g.add(plug)
  }

  // Framing Penetration 3D Bore Sleeves & IRC R602.6 / IPC 305.6 Nail Plates
  for (const pen of penetrations) {
    const boreR = Math.max(radius * 1.15, (pen.holeSawIn * 0.0254) / 2)
    const pDir = new Vector3(pen.pipeDirection[0], pen.pipeDirection[1], pen.pipeDirection[2]).normalize()
    const quat = new Quaternion().setFromUnitVectors(UP, pDir)
    const sleeveMat = pen.codeCompliant ? pool.darkRubber : pool.pexHotRed
    const sleeveLen = pen.memberKind === 'top-plate' ? 0.082 : 0.044 // Proud of 1.5" stud or 3" double top plate by ~3 mm
    const sleeve = new Mesh(new CylinderGeometry(boreR, boreR, sleeveLen, 16, 1, true), sleeveMat)
    sleeve.position.set(pen.position[0], pen.position[1], pen.position[2])
    sleeve.quaternion.copy(quat)
    g.add(sleeve)

    // Protective steel nail plate on stud face when edge clearance < 1-1/4"
    if (pen.needsNailPlate && pen.memberKind === 'stud') {
      const plate = new Mesh(new BoxGeometry(0.042, 0.127, 0.005), pool.galvanizedSteel)
      plate.position.set(pen.position[0], pen.position[1], pen.position[2] + 0.058)
      g.add(plate)
    }
  }

  return g
}
