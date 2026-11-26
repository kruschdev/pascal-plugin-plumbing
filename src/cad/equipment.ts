/**
 * 12 Clean-Room MIT Procedural 3D CAD Builders for Plumbing Mechanical Equipment.
 * Zero React or `@pascal-app/editor` imports.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, TorusGeometry } from 'three'
import type { EquipmentKind } from '../ipc/tables'
import { createPlumbingMaterialPool } from './materials'

export function buildEquipmentCad(params: {
  equipmentKind: EquipmentKind
  capacityGal?: number
  hasDrainPan?: boolean
}): Group {
  const { equipmentKind, capacityGal = 50, hasDrainPan = true } = params
  const pool = createPlumbingMaterialPool()
  const g = new Group()
  g.name = `plumbing-equipment-${equipmentKind}`

  const add = (mesh: Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    g.add(mesh)
    return mesh
  }

  switch (equipmentKind) {
    case 'water-heater-tank-electric':
    case 'water-heater-tank-gas':
    case 'water-heater-hpwh': {
      const r = capacityGal >= 70 ? 0.30 : 0.26
      const h = equipmentKind === 'water-heater-hpwh' ? 1.68 : capacityGal >= 70 ? 1.62 : 1.48
      const baseY = hasDrainPan ? 0.04 : 0
      // Drain pan (IPC 504.7)
      if (hasDrainPan) {
        add(new Mesh(new CylinderGeometry(r + 0.045, r + 0.045, 0.05, 24), pool.galvanizedSteel), 0, 0.025, 0)
      }
      // Tank cylinder seated on pan (baseY = 0.04) or directly on floor (baseY = 0)
      const tankH = equipmentKind === 'water-heater-hpwh' ? h - 0.36 : h
      const bodyMat = pool.enamelSteel
      add(new Mesh(new CylinderGeometry(r, r, tankH, 28), bodyMat), 0, baseY + tankH / 2, 0)
      // Blue trim ring
      add(new Mesh(new CylinderGeometry(r + 0.004, r + 0.004, 0.08, 28), pool.enamelBlue), 0, baseY + tankH - 0.12, 0)
      // Top hot/cold nipples
      add(new Mesh(new CylinderGeometry(0.016, 0.016, 0.14, 12), pool.pexColdBlue), 0.1, baseY + tankH + 0.07, 0)
      add(new Mesh(new CylinderGeometry(0.016, 0.016, 0.14, 12), pool.pexHotRed), -0.1, baseY + tankH + 0.07, 0)
      // Side T&P relief valve + copper discharge drop
      add(new Mesh(new CylinderGeometry(0.014, 0.014, 0.09, 10), pool.brass), r + 0.03, baseY + tankH * 0.78, 0).rotation.z = Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.011, 0.011, tankH * 0.72, 10), pool.copper), r + 0.07, baseY + tankH * 0.42, 0)

      if (equipmentKind === 'water-heater-tank-gas') {
        // Draft hood & flue pipe
        add(new Mesh(new CylinderGeometry(0.055, 0.11, 0.14, 16), pool.galvanizedSteel), 0, baseY + tankH + 0.07, 0)
        add(new Mesh(new CylinderGeometry(0.055, 0.055, 0.42, 16), pool.galvanizedSteel), 0, baseY + tankH + 0.34, 0)
        // Lower gas control valve
        add(new Mesh(new BoxGeometry(0.11, 0.11, 0.09), pool.darkRubber), 0, baseY + 0.30, r + 0.04)
      } else if (equipmentKind === 'water-heater-hpwh') {
        // Top compressor heat pump shroud + intake louver
        add(new Mesh(new CylinderGeometry(r + 0.008, r + 0.008, 0.36, 28), pool.galvanizedSteel), 0, baseY + tankH + 0.18, 0)
        add(new Mesh(new BoxGeometry(0.18, 0.10, 0.03), pool.darkRubber), 0, baseY + tankH + 0.18, r + 0.015)
      } else {
        // Electric junction box & element access panels
        add(new Mesh(new BoxGeometry(0.14, 0.18, 0.03), pool.galvanizedSteel), 0, baseY + 0.38, r + 0.01)
        add(new Mesh(new BoxGeometry(0.14, 0.18, 0.03), pool.galvanizedSteel), 0, baseY + 1.01, r + 0.01)
      }
      break
    }

    case 'water-heater-tankless-gas': {
      add(new Mesh(new BoxGeometry(0.38, 0.62, 0.26), pool.enamelSteel), 0, 1.35, 0)
      add(new Mesh(new BoxGeometry(0.12, 0.08, 0.02), pool.darkRubber), 0, 1.35, 0.135)
      // Top concentric vent
      add(new Mesh(new CylinderGeometry(0.045, 0.045, 0.30, 16), pool.pvcWhite), 0, 1.81, 0)
      // Bottom service valves (cold, hot, gas, condensate)
      add(new Mesh(new CylinderGeometry(0.014, 0.014, 0.16, 10), pool.pexColdBlue), 0.10, 0.96, 0)
      add(new Mesh(new CylinderGeometry(0.014, 0.014, 0.16, 10), pool.pexHotRed), -0.10, 0.96, 0)
      add(new Mesh(new CylinderGeometry(0.015, 0.015, 0.16, 10), pool.csstYellow), 0.0, 0.96, 0)
      break
    }

    case 'expansion-tank': {
      add(new Mesh(new CylinderGeometry(0.10, 0.10, 0.24, 20), pool.enamelSteel), 0, 0, 0)
      add(new Mesh(new SphereGeometry(0.10, 20, 14), pool.enamelSteel), 0, 0.12, 0)
      add(new Mesh(new SphereGeometry(0.10, 20, 14), pool.enamelSteel), 0, -0.12, 0)
      add(new Mesh(new CylinderGeometry(0.015, 0.015, 0.07, 10), pool.brass), 0, 0.23, 0)
      break
    }

    case 'main-shutoff-prv': {
      // Copper riser + full-port ball valve + bell-shaped brass PRV + gauge nipple & dial
      add(new Mesh(new CylinderGeometry(0.016, 0.016, 0.56, 14), pool.copper), 0, 0, 0)
      add(new Mesh(new CylinderGeometry(0.028, 0.028, 0.08, 14), pool.brass), 0, -0.14, 0)
      add(new Mesh(new BoxGeometry(0.12, 0.015, 0.02), pool.pexColdBlue), 0.06, -0.14, 0.02)
      // PRV bell housing
      add(new Mesh(new CylinderGeometry(0.024, 0.042, 0.12, 16), pool.brass), 0.06, 0.04, 0).rotation.z = -Math.PI / 2
      // Brass gauge tee nipple + pressure gauge dial
      add(new Mesh(new CylinderGeometry(0.009, 0.009, 0.046, 12), pool.brass), 0, 0.16, 0.022).rotation.x = Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.036, 0.036, 0.024, 18), pool.chrome), 0, 0.16, 0.045).rotation.x = Math.PI / 2
      break
    }

    case 'water-softener': {
      // Resin cylinder tank + control head + square salt brine tank + connecting brine draw tube
      add(new Mesh(new CylinderGeometry(0.14, 0.14, 1.24, 22), pool.enamelBlue), -0.22, 0.62, 0)
      add(new Mesh(new BoxGeometry(0.18, 0.16, 0.16), pool.darkRubber), -0.22, 1.32, 0)
      add(new Mesh(new BoxGeometry(0.38, 0.92, 0.38), pool.pvcWhite), 0.22, 0.46, 0)
      add(new Mesh(new BoxGeometry(0.40, 0.04, 0.40), pool.darkRubber), 0.22, 0.94, 0)
      // Brine draw line connecting control head across to brine tank lid
      add(new Mesh(new CylinderGeometry(0.008, 0.008, 0.42, 10), pool.pexColdBlue), -0.02, 1.28, -0.04).rotation.z = Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.008, 0.008, 0.36, 10), pool.pexColdBlue), 0.18, 1.11, -0.04)
      break
    }

    case 'sump-pump':
    case 'sewage-ejector': {
      const r = equipmentKind === 'sewage-ejector' ? 0.28 : 0.24
      add(new Mesh(new CylinderGeometry(r, r * 0.92, 0.62, 24), pool.absBlack), 0, 0.31, 0)
      add(new Mesh(new CylinderGeometry(r + 0.02, r + 0.02, 0.03, 24), pool.castIron), 0, 0.63, 0)
      // Discharge PVC riser + brass check valve
      add(new Mesh(new CylinderGeometry(0.028, 0.028, 0.65, 14), pool.pvcWhite), 0.08, 0.95, 0)
      add(new Mesh(new CylinderGeometry(0.038, 0.038, 0.11, 14), pool.darkRubber), 0.08, 0.85, 0)
      if (equipmentKind === 'sewage-ejector') {
        // Dedicated 2" vent pipe on sealed sewage ejector cover
        add(new Mesh(new CylinderGeometry(0.028, 0.028, 0.65, 14), pool.ventGreen), -0.09, 0.95, 0)
      }
      break
    }

    case 'recirc-pump': {
      add(new Mesh(new CylinderGeometry(0.065, 0.065, 0.16, 18), pool.pexRecircOrange), 0, 0, 0).rotation.z = Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.055, 0.055, 0.09, 18), pool.brass), -0.09, 0, 0)
      add(new Mesh(new BoxGeometry(0.08, 0.07, 0.06), pool.darkRubber), 0.02, 0.08, 0)
      break
    }

    case 'gas-meter': {
      // Utility gas meter box + dual riser pipes + regulator
      add(new Mesh(new BoxGeometry(0.32, 0.36, 0.22), pool.galvanizedSteel), 0, 0, 0)
      add(new Mesh(new CylinderGeometry(0.018, 0.018, 0.45, 12), pool.blackIron), -0.11, 0.32, 0)
      add(new Mesh(new CylinderGeometry(0.018, 0.018, 0.45, 12), pool.blackIron), 0.11, 0.32, 0)
      add(new Mesh(new TorusGeometry(0.045, 0.014, 10, 18), pool.galvanizedSteel), -0.11, 0.35, 0.03)
      break
    }

    case 'backwater-valve': {
      add(new Mesh(new CylinderGeometry(0.062, 0.062, 0.34, 18), pool.pvcWhite), 0, 0, 0).rotation.z = Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.075, 0.075, 0.14, 18), pool.pvcWhite), 0, 0.08, 0)
      add(new Mesh(new CylinderGeometry(0.08, 0.08, 0.03, 18), pool.absBlack), 0, 0.16, 0)
      break
    }
  }

  return g
}
