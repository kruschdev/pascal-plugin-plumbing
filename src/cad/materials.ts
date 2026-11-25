/**
 * Fresh per-build PBR material factory for clean-room MIT plumbing 3D CAD models.
 * Editor-free and React-free: zero React or `@pascal-app/*` imports.
 */

import { MeshStandardMaterial } from 'three'
import { PLUMBING_SYSTEM_COLORS, type PipeMaterial, type PlumbingSystem } from '../ipc/tables'

export type PlumbingMaterialPool = {
  pvcWhite: MeshStandardMaterial
  absBlack: MeshStandardMaterial
  castIron: MeshStandardMaterial
  copper: MeshStandardMaterial
  brass: MeshStandardMaterial
  chrome: MeshStandardMaterial
  porcelain: MeshStandardMaterial
  enamelSteel: MeshStandardMaterial
  enamelBlue: MeshStandardMaterial
  galvanizedSteel: MeshStandardMaterial
  blackIron: MeshStandardMaterial
  csstYellow: MeshStandardMaterial
  pexColdBlue: MeshStandardMaterial
  pexHotRed: MeshStandardMaterial
  pexRecircOrange: MeshStandardMaterial
  ventGreen: MeshStandardMaterial
  condensateCyan: MeshStandardMaterial
  darkRubber: MeshStandardMaterial
  woodStud: MeshStandardMaterial
  drywallWhite: MeshStandardMaterial
  aluminumRigid: MeshStandardMaterial
  dispose: () => void
}

export function createPlumbingMaterialPool(): PlumbingMaterialPool {
  const created: MeshStandardMaterial[] = []
  const make = (params: ConstructorParameters<typeof MeshStandardMaterial>[0]) => {
    const m = new MeshStandardMaterial(params)
    created.push(m)
    return m
  }

  return {
    pvcWhite: make({ color: 0xf1f5f9, roughness: 0.42, metalness: 0.04 }),
    absBlack: make({ color: 0x1e293b, roughness: 0.48, metalness: 0.06 }),
    castIron: make({ color: 0x27272a, roughness: 0.72, metalness: 0.55 }),
    copper: make({ color: 0xc87544, roughness: 0.28, metalness: 0.88 }),
    brass: make({ color: 0xd4a024, roughness: 0.30, metalness: 0.86 }),
    chrome: make({ color: 0xe2e8f0, roughness: 0.16, metalness: 0.94 }),
    porcelain: make({ color: 0xffffff, roughness: 0.14, metalness: 0.05 }),
    enamelSteel: make({ color: 0xdbeafe, roughness: 0.35, metalness: 0.35 }),
    enamelBlue: make({ color: 0x1d4ed8, roughness: 0.38, metalness: 0.30 }),
    galvanizedSteel: make({ color: 0x94a3b8, roughness: 0.44, metalness: 0.72 }),
    blackIron: make({ color: 0x334155, roughness: 0.62, metalness: 0.68 }),
    csstYellow: make({ color: 0xeab308, roughness: 0.40, metalness: 0.12 }),
    pexColdBlue: make({ color: 0x2563eb, roughness: 0.45, metalness: 0.05 }),
    pexHotRed: make({ color: 0xdc2626, roughness: 0.45, metalness: 0.05 }),
    pexRecircOrange: make({ color: 0xf97316, roughness: 0.45, metalness: 0.05 }),
    ventGreen: make({ color: 0x16a34a, roughness: 0.46, metalness: 0.05 }),
    condensateCyan: make({ color: 0x06b6d4, roughness: 0.42, metalness: 0.06 }),
    darkRubber: make({ color: 0x18181b, roughness: 0.82, metalness: 0.05 }),
    woodStud: make({ color: 0xd4a373, roughness: 0.78, metalness: 0.02 }),
    drywallWhite: make({ color: 0xe5e7eb, roughness: 0.88, metalness: 0.0 }),
    aluminumRigid: make({ color: 0xcbd5e1, roughness: 0.32, metalness: 0.82 }),
    dispose: () => {
      for (const m of created) m.dispose()
    },
  }
}

export function pipeRunMaterialForSystem(
  pool: PlumbingMaterialPool,
  system: PlumbingSystem,
  material: PipeMaterial,
): MeshStandardMaterial {
  switch (system) {
    case 'cold-water':
      return material === 'copper-l' || material === 'copper-m' ? pool.copper : pool.pexColdBlue
    case 'hot-water':
      return material === 'copper-l' || material === 'copper-m' ? pool.copper : pool.pexHotRed
    case 'hot-recirc':
      return pool.pexRecircOrange
    case 'dwv-drain':
      return material === 'abs-dwv'
        ? pool.absBlack
        : material === 'cast-iron'
          ? pool.castIron
          : pool.pvcWhite
    case 'dwv-vent':
      return pool.ventGreen
    case 'fuel-gas':
      return material === 'csst' ? pool.csstYellow : pool.blackIron
    case 'condensate':
      return pool.condensateCyan
    case 'dryer-vent':
      return pool.aluminumRigid
  }
}

export function systemColorMeta(system: PlumbingSystem) {
  return PLUMBING_SYSTEM_COLORS[system]
}
