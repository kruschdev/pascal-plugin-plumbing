/**
 * 14 Clean-Room MIT Procedural 3D CAD Builders for Residential & Commercial Plumbing Fixtures.
 * Zero React or `@pascal-app/editor` imports.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, TorusGeometry } from 'three'
import type { FixtureKind } from '../ipc/tables'
import { createPlumbingMaterialPool } from './materials'

export function buildFixtureCad(params: { fixtureKind: FixtureKind }): Group {
  const { fixtureKind } = params
  const pool = createPlumbingMaterialPool()
  const g = new Group()
  g.name = `plumbing-fixture-${fixtureKind}`

  const add = (mesh: Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    g.add(mesh)
    return mesh
  }

  switch (fixtureKind) {
    case 'water-closet': {
      // Base pedestal, elongated bowl, rear tank, chrome flush lever, cold supply stub
      add(new Mesh(new CylinderGeometry(0.14, 0.17, 0.36, 20), pool.porcelain), 0, 0.18, 0.06)
      add(new Mesh(new CylinderGeometry(0.19, 0.15, 0.12, 22), pool.porcelain), 0, 0.38, 0.12)
      add(new Mesh(new BoxGeometry(0.40, 0.38, 0.19), pool.porcelain), 0, 0.56, -0.18)
      add(new Mesh(new BoxGeometry(0.42, 0.03, 0.21), pool.porcelain), 0, 0.76, -0.18)
      add(new Mesh(new BoxGeometry(0.06, 0.015, 0.02), pool.chrome), -0.15, 0.68, -0.075)
      add(new Mesh(new CylinderGeometry(0.010, 0.010, 0.26, 10), pool.chrome), -0.14, 0.22, -0.26)
      break
    }

    case 'lavatory':
    case 'bar-sink': {
      const w = fixtureKind === 'bar-sink' ? 0.46 : 0.60
      const d = fixtureKind === 'bar-sink' ? 0.44 : 0.48
      // Counter/basin deck + faucet + chrome P-trap & dual angle stops beneath
      add(new Mesh(new BoxGeometry(w, 0.08, d), pool.porcelain), 0, 0.80, 0)
      add(new Mesh(new CylinderGeometry(0.14, 0.10, 0.16, 20), pool.porcelain), 0, 0.70, 0.02)
      add(new Mesh(new CylinderGeometry(0.016, 0.018, 0.14, 12), pool.chrome), 0, 0.89, -d * 0.34)
      add(new Mesh(new CylinderGeometry(0.012, 0.012, 0.10, 12), pool.chrome), 0, 0.94, -d * 0.22).rotation.x = Math.PI / 2
      // Under-sink P-trap & H/C supplies
      add(new Mesh(new CylinderGeometry(0.020, 0.020, 0.26, 12), pool.pvcWhite), 0, 0.50, 0)
      add(new Mesh(new TorusGeometry(0.045, 0.019, 10, 16, Math.PI), pool.pvcWhite), 0, 0.37, -0.045).rotation.x = Math.PI
      add(new Mesh(new CylinderGeometry(0.009, 0.009, 0.34, 8), pool.pexHotRed), -0.10, 0.56, -0.14)
      add(new Mesh(new CylinderGeometry(0.009, 0.009, 0.34, 8), pool.pexColdBlue), 0.10, 0.56, -0.14)
      break
    }

    case 'kitchen-sink':
    case 'laundry-sink': {
      const isKitchen = fixtureKind === 'kitchen-sink'
      const w = isKitchen ? 0.84 : 0.62
      add(new Mesh(new BoxGeometry(w, 0.05, 0.54), pool.chrome), 0, 0.88, 0)
      add(new Mesh(new BoxGeometry(w - 0.08, 0.22, 0.44), pool.galvanizedSteel), 0, 0.75, 0)
      // High-arc gooseneck faucet
      add(new Mesh(new CylinderGeometry(0.018, 0.022, 0.24, 14), pool.chrome), 0, 1.01, -0.21)
      add(new Mesh(new TorusGeometry(0.08, 0.014, 10, 18, Math.PI), pool.chrome), 0, 1.13, -0.13).rotation.y = Math.PI / 2
      // Drain tailpiece & P-trap
      add(new Mesh(new CylinderGeometry(0.024, 0.024, 0.28, 12), pool.pvcWhite), 0, 0.52, 0)
      add(new Mesh(new CylinderGeometry(0.010, 0.010, 0.36, 8), pool.pexHotRed), -0.12, 0.58, -0.16)
      add(new Mesh(new CylinderGeometry(0.010, 0.010, 0.36, 8), pool.pexColdBlue), 0.12, 0.58, -0.16)
      break
    }

    case 'bathtub':
    case 'tub-shower-combo': {
      add(new Mesh(new BoxGeometry(1.52, 0.46, 0.76), pool.porcelain), 0, 0.23, 0)
      add(new Mesh(new BoxGeometry(1.36, 0.34, 0.60), pool.enamelSteel), 0, 0.31, 0)
      // Tub spout & mixing valve at head end
      add(new Mesh(new CylinderGeometry(0.055, 0.055, 0.025, 16), pool.chrome), -0.74, 0.86, 0).rotation.z = Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.018, 0.018, 0.12, 12), pool.chrome), -0.68, 0.62, 0).rotation.z = Math.PI / 2
      if (fixtureKind === 'tub-shower-combo') {
        // Shower riser & head
        add(new Mesh(new CylinderGeometry(0.012, 0.012, 1.15, 10), pool.copper), -0.76, 1.42, 0)
        add(new Mesh(new CylinderGeometry(0.045, 0.025, 0.06, 16), pool.chrome), -0.64, 1.96, 0).rotation.z = -Math.PI / 4
      }
      break
    }

    case 'shower': {
      add(new Mesh(new BoxGeometry(0.96, 0.10, 0.96), pool.porcelain), 0, 0.05, 0)
      add(new Mesh(new CylinderGeometry(0.055, 0.055, 0.02, 16), pool.chrome), 0, 0.105, 0)
      add(new Mesh(new CylinderGeometry(0.014, 0.014, 1.10, 12), pool.copper), 0, 1.40, -0.45)
      add(new Mesh(new CylinderGeometry(0.06, 0.06, 0.025, 18), pool.chrome), 0, 1.15, -0.43).rotation.x = Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.055, 0.024, 0.06, 16), pool.chrome), 0, 1.98, -0.34).rotation.x = Math.PI / 4
      break
    }

    case 'clothes-washer': {
      // Recessed washer outlet box + red/blue quarter-turn ball valves + 2" standpipe
      add(new Mesh(new BoxGeometry(0.24, 0.22, 0.10), pool.pvcWhite), 0, 0, 0)
      add(new Mesh(new CylinderGeometry(0.018, 0.018, 0.06, 10), pool.pexHotRed), -0.06, 0.02, 0.03)
      add(new Mesh(new CylinderGeometry(0.018, 0.018, 0.06, 10), pool.pexColdBlue), 0.06, 0.02, 0.03)
      add(new Mesh(new CylinderGeometry(0.029, 0.029, 0.65, 14), pool.pvcWhite), 0, -0.42, 0)
      break
    }

    case 'dishwasher': {
      add(new Mesh(new BoxGeometry(0.58, 0.82, 0.56), pool.galvanizedSteel), 0, 0.41, 0)
      add(new Mesh(new BoxGeometry(0.46, 0.04, 0.03), pool.chrome), 0, 0.74, 0.29)
      break
    }

    case 'garbage-disposal': {
      add(new Mesh(new CylinderGeometry(0.095, 0.085, 0.30, 18), pool.absBlack), 0, 0, 0)
      add(new Mesh(new CylinderGeometry(0.048, 0.048, 0.05, 16), pool.chrome), 0, 0.17, 0)
      add(new Mesh(new CylinderGeometry(0.020, 0.020, 0.10, 12), pool.pvcWhite), 0.11, 0.02, 0).rotation.z = Math.PI / 2
      break
    }

    case 'hose-bibb': {
      // Frost-proof 12" stem + brass flange + angled sillcock + vacuum breaker cap
      add(new Mesh(new CylinderGeometry(0.014, 0.014, 0.30, 12), pool.copper), 0, 0, -0.12).rotation.x = Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.038, 0.038, 0.016, 16), pool.brass), 0, 0, 0.02).rotation.x = Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.018, 0.018, 0.09, 12), pool.brass), 0, -0.02, 0.07).rotation.x = Math.PI / 3
      add(new Mesh(new CylinderGeometry(0.022, 0.022, 0.03, 14), pool.chrome), 0, 0.035, 0.05) // Anti-siphon vacuum breaker
      add(new Mesh(new TorusGeometry(0.032, 0.008, 8, 16), pool.pexColdBlue), 0, 0.01, 0.11) // Handwheel
      break
    }

    case 'floor-drain': {
      add(new Mesh(new CylinderGeometry(0.08, 0.08, 0.02, 20), pool.chrome), 0, 0.01, 0)
      add(new Mesh(new CylinderGeometry(0.032, 0.032, 0.22, 16), pool.castIron), 0, -0.11, 0)
      break
    }

    case 'bidet': {
      add(new Mesh(new CylinderGeometry(0.14, 0.15, 0.36, 20), pool.porcelain), 0, 0.18, 0)
      add(new Mesh(new SphereGeometry(0.18, 18, 12), pool.porcelain), 0, 0.34, 0.04)
      add(new Mesh(new CylinderGeometry(0.014, 0.014, 0.08, 12), pool.chrome), 0, 0.42, -0.15)
      break
    }

    case 'urinal': {
      add(new Mesh(new BoxGeometry(0.36, 0.56, 0.28), pool.porcelain), 0, 0.65, 0)
      add(new Mesh(new CylinderGeometry(0.025, 0.025, 0.24, 14), pool.chrome), 0, 1.05, -0.08)
      add(new Mesh(new BoxGeometry(0.10, 0.02, 0.02), pool.chrome), 0.06, 1.08, -0.08)
      break
    }

    case 'mop-sink': {
      add(new Mesh(new BoxGeometry(0.61, 0.28, 0.61), pool.porcelain), 0, 0.14, 0)
      add(new Mesh(new CylinderGeometry(0.045, 0.045, 0.02, 14), pool.chrome), 0, 0.05, 0)
      add(new Mesh(new BoxGeometry(0.22, 0.06, 0.08), pool.chrome), 0, 0.68, -0.28)
      break
    }

    case 'drinking-fountain': {
      add(new Mesh(new BoxGeometry(0.46, 0.48, 0.42), pool.galvanizedSteel), 0, 0.72, 0)
      add(new Mesh(new CylinderGeometry(0.014, 0.014, 0.09, 10), pool.chrome), 0.10, 0.99, 0.08)
      break
    }

    case 'grease-interceptor': {
      add(new Mesh(new BoxGeometry(0.84, 0.46, 0.56), pool.enamelBlue), 0, 0.23, 0)
      add(new Mesh(new BoxGeometry(0.86, 0.04, 0.58), pool.castIron), 0, 0.48, 0)
      add(new Mesh(new CylinderGeometry(0.042, 0.042, 0.14, 14), pool.castIron), -0.48, 0.30, 0).rotation.z = Math.PI / 2
      add(new Mesh(new CylinderGeometry(0.042, 0.042, 0.14, 14), pool.castIron), 0.48, 0.26, 0).rotation.z = Math.PI / 2
      break
    }
  }

  return g
}
