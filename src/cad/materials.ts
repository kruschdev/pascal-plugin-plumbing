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

const MATERIAL_SPECS = {
  pvcWhite: { color: 0xf1f5f9, roughness: 0.42, metalness: 0.04 },
  absBlack: { color: 0x1e293b, roughness: 0.48, metalness: 0.06 },
  castIron: { color: 0x27272a, roughness: 0.72, metalness: 0.55 },
  copper: { color: 0xc87544, roughness: 0.28, metalness: 0.88 },
  brass: { color: 0xd4a024, roughness: 0.30, metalness: 0.86 },
  chrome: { color: 0xe2e8f0, roughness: 0.16, metalness: 0.94 },
  porcelain: { color: 0xffffff, roughness: 0.14, metalness: 0.05 },
  enamelSteel: { color: 0xdbeafe, roughness: 0.35, metalness: 0.35 },
  enamelBlue: { color: 0x1d4ed8, roughness: 0.38, metalness: 0.30 },
  galvanizedSteel: { color: 0x94a3b8, roughness: 0.44, metalness: 0.72 },
  blackIron: { color: 0x334155, roughness: 0.62, metalness: 0.68 },
  csstYellow: { color: 0xeab308, roughness: 0.40, metalness: 0.12 },
  pexColdBlue: { color: 0x2563eb, roughness: 0.45, metalness: 0.05 },
  pexHotRed: { color: 0xdc2626, roughness: 0.45, metalness: 0.05 },
  pexRecircOrange: { color: 0xf97316, roughness: 0.45, metalness: 0.05 },
  ventGreen: { color: 0x16a34a, roughness: 0.46, metalness: 0.05 },
  condensateCyan: { color: 0x06b6d4, roughness: 0.42, metalness: 0.06 },
  darkRubber: { color: 0x18181b, roughness: 0.82, metalness: 0.05 },
  woodStud: { color: 0xd4a373, roughness: 0.78, metalness: 0.02 },
  drywallWhite: { color: 0xe5e7eb, roughness: 0.88, metalness: 0.0 },
  aluminumRigid: { color: 0xcbd5e1, roughness: 0.32, metalness: 0.82 },
} as const

type MaterialKey = keyof typeof MATERIAL_SPECS

/**
 * Lazy per-build PBR material pool: instantiates each `MeshStandardMaterial` only on first
 * property access so simple pipe runs allocate 1-3 GPU materials instead of all 21.
 */
export function createPlumbingMaterialPool(): PlumbingMaterialPool {
  const cache = new Map<MaterialKey, MeshStandardMaterial>()
  const get = (key: MaterialKey): MeshStandardMaterial => {
    let m = cache.get(key)
    if (!m) {
      m = new MeshStandardMaterial(MATERIAL_SPECS[key])
      cache.set(key, m)
    }
    return m
  }

  const pool = {
    dispose: () => {
      for (const m of cache.values()) m.dispose()
      cache.clear()
    },
  } as PlumbingMaterialPool

  for (const key of Object.keys(MATERIAL_SPECS) as MaterialKey[]) {
    Object.defineProperty(pool, key, {
      enumerable: true,
      get: () => get(key),
    })
  }
  return pool
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
