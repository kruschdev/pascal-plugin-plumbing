/**
 * Pure TypeScript interoperability helpers for:
 * 1. Pascal's `@pascal-app/plugin-bones` (`bones:framing` and `bones:service` nodes)
 * 2. Cross-trade electrical power coordination (`electricalDemand` contract shared with
 *    `@kruschdev/pascal-plugin-electrical` and future `@kruschdev/pascal-plugin-hvac`)
 *
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import {
  type EquipmentKind,
  type FixtureKind,
  INCHES_TO_METERS,
  type PipeMaterial,
  type PipeNominalSize,
  getPipeOuterDiameterM,
} from './tables'

export type Vec3 = readonly [number, number, number]

export type SceneNodeLike = {
  id: string
  type: string
  name?: string
  parentId?: string | null
  position?: readonly [number, number, number]
  rotation?: number | readonly [number, number, number]
  start?: readonly [number, number]
  end?: readonly [number, number]
  height?: number
  thickness?: number
  width?: number
  depth?: number
  polygon?: ReadonlyArray<readonly [number, number]>
  path?: ReadonlyArray<readonly [number, number, number]>
  children?: readonly string[]
  [key: string]: unknown
}

/**
 * Standardized cross-trade electrical power demand payload published by powered
 * plumbing (and future HVAC) equipment/fixture nodes so `@kruschdev/pascal-plugin-electrical`
 * can automatically allocate breakers, panel schedules, NEC 220 loads, and 3D power runs
 * with zero hard package dependency.
 */
export type ElectricalPowerDemand = {
  required: boolean
  voltage: 120 | 208 | 240 | 480
  poles: 1 | 2 | 3
  breakerAmps: number
  loadVa: number
  continuous: boolean
  dedicatedCircuit: boolean
  gfciRequired: boolean
  afciRequired: boolean
  loadCategory: 'fixed' | 'appliance' | 'motor' | 'hvac-heating' | 'hvac-cooling' | 'heat-pump'
  label: string
}

const NEC_STANDARD_BREAKERS = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200] as const

/**
 * Compute minimum NEC 240.6(A) standard breaker rating for a continuous 240V water-heating load
 * per NEC 422.11(E) / 422.13 (125% of nameplate current).
 */
export function standardNec240BreakerAmps(watts: number, voltage = 240): number {
  const minAmps = (Math.max(100, watts) / voltage) * 1.25
  for (const std of NEC_STANDARD_BREAKERS) {
    if (std >= minAmps) return std
  }
  return 200
}

/**
 * Default NEC-compliant electrical power demands for powered plumbing equipment.
 */
export function getEquipmentElectricalDemand(
  kind: EquipmentKind,
  customWatts?: number,
): ElectricalPowerDemand | null {
  switch (kind) {
    case 'water-heater-tank-electric': {
      const watts = customWatts && customWatts > 0 ? customWatts : 4500
      const amps = Math.max(30, standardNec240BreakerAmps(watts, 240))
      return {
        required: true,
        voltage: 240,
        poles: 2,
        breakerAmps: amps,
        loadVa: watts,
        continuous: true,
        dedicatedCircuit: true,
        gfciRequired: false,
        afciRequired: false,
        loadCategory: 'fixed',
        label: `Electric Water Heater (${(watts / 1000).toFixed(1)} kW)`,
      }
    }
    case 'water-heater-hpwh': {
      const watts = customWatts && customWatts > 0 ? customWatts : 4500
      const amps = Math.max(30, standardNec240BreakerAmps(watts, 240))
      return {
        required: true,
        voltage: 240,
        poles: 2,
        breakerAmps: amps,
        loadVa: watts,
        continuous: true,
        dedicatedCircuit: true,
        gfciRequired: false,
        afciRequired: false,
        loadCategory: 'fixed',
        label: 'Heat Pump Water Heater (Hybrid)',
      }
    }
    case 'water-heater-tankless-gas':
      return {
        required: true,
        voltage: 120,
        poles: 1,
        breakerAmps: 15,
        loadVa: 300,
        continuous: false,
        dedicatedCircuit: false,
        gfciRequired: true,
        afciRequired: false,
        loadCategory: 'appliance',
        label: 'Tankless Gas WH Ignition / Blower',
      }
    case 'sump-pump':
      return {
        required: true,
        voltage: 120,
        poles: 1,
        breakerAmps: 20,
        loadVa: 1200,
        continuous: false,
        dedicatedCircuit: true,
        gfciRequired: true,
        afciRequired: false,
        loadCategory: 'motor',
        label: 'Sump Pump (Dedicated GFCI)',
      }
    case 'sewage-ejector':
      return {
        required: true,
        voltage: 120,
        poles: 1,
        breakerAmps: 20,
        loadVa: 1440,
        continuous: false,
        dedicatedCircuit: true,
        gfciRequired: true,
        afciRequired: false,
        loadCategory: 'motor',
        label: 'Sewage Ejector Pump (Dedicated GFCI)',
      }
    case 'recirc-pump':
      return {
        required: true,
        voltage: 120,
        poles: 1,
        breakerAmps: 15,
        loadVa: 180,
        continuous: true,
        dedicatedCircuit: false,
        gfciRequired: true,
        afciRequired: false,
        loadCategory: 'motor',
        label: 'Hot Water Recirculation Pump',
      }
    case 'water-softener':
      return {
        required: true,
        voltage: 120,
        poles: 1,
        breakerAmps: 15,
        loadVa: 150,
        continuous: false,
        dedicatedCircuit: false,
        gfciRequired: true,
        afciRequired: false,
        loadCategory: 'appliance',
        label: 'Water Softener Control Head',
      }
    default:
      return null
  }
}

/**
 * Default NEC-compliant electrical power demands for powered plumbing fixtures.
 */
export function getFixtureElectricalDemand(kind: FixtureKind): ElectricalPowerDemand | null {
  switch (kind) {
    case 'dishwasher':
      return {
        required: true,
        voltage: 120,
        poles: 1,
        breakerAmps: 20,
        loadVa: 1500,
        continuous: false,
        dedicatedCircuit: true,
        gfciRequired: true,
        afciRequired: true,
        loadCategory: 'appliance',
        label: 'Dishwasher (NEC 210.8(D) GFCI)',
      }
    case 'garbage-disposal':
      return {
        required: true,
        voltage: 120,
        poles: 1,
        breakerAmps: 20,
        loadVa: 1000,
        continuous: false,
        dedicatedCircuit: true,
        gfciRequired: true,
        afciRequired: true,
        loadCategory: 'appliance',
        label: 'Garbage Disposal (3/4 HP)',
      }
    case 'clothes-washer':
      return {
        required: true,
        voltage: 120,
        poles: 1,
        breakerAmps: 20,
        loadVa: 1500,
        continuous: false,
        dedicatedCircuit: true,
        gfciRequired: true,
        afciRequired: true,
        loadCategory: 'appliance',
        label: 'Laundry Washer Branch (NEC 210.11(C)(2))',
      }
    case 'bidet':
      return {
        required: true,
        voltage: 120,
        poles: 1,
        breakerAmps: 15,
        loadVa: 1200,
        continuous: false,
        dedicatedCircuit: true, // NEC 210.23(B)(2): 1200 VA > 50% of 15A branch rating
        gfciRequired: true,
        afciRequired: false,
        loadCategory: 'appliance',
        label: 'Heated Bidet Seat (Dedicated GFCI)',
      }
    default:
      return null
  }
}

export type BonesWallConstruction = 'framed' | 'lgs' | 'cmu' | 'skip'

export type BonesWallRule = {
  construction: BonesWallConstruction
  spacingIn: 12 | 16 | 24
  studThicknessM: number
  /** Per-wall stud cavity depth in inches from `structural:assembly.wallOverrides[id].studSize` (`5.5` for 2x6, `3.5` for 2x4). */
  studDepthIn?: number
  isLoadBearing?: boolean
  isWetWall?: boolean
}

export type BonesPlumbingServiceType = 'water-heater' | 'water-entry' | 'sewer-exit'

export type BonesPlumbingServiceAnchor = {
  nodeId: string
  serviceType: BonesPlumbingServiceType
  wallId?: string
  wallT?: number
  heightAff?: number
  position?: Vec3
}

export type BonesPlumbingContext = {
  framingPresent: boolean
  /** Authoritative source of framing rules (`structural` takes Priority #1 over `bones`). */
  source?: 'structural' | 'bones' | 'default'
  defaultSpacingIn: 12 | 16 | 24
  /** Authoritative stud cavity depth in inches from Priority #1 `structural:assembly` (`5.5` for 2x6, `3.5` for 2x4). */
  defaultStudDepthIn?: number
  framingSystem: 'lumber' | 'lgs'
  floorSystem?: 'dimensional' | 'tji-ijoist' | 'open-web-truss'
  wallRules: ReadonlyMap<string, BonesWallRule>
  waterHeaterAnchor: BonesPlumbingServiceAnchor | null
  waterEntryAnchor: BonesPlumbingServiceAnchor | null
  sewerExitAnchor: BonesPlumbingServiceAnchor | null
  hasPlumbingSchematic: boolean
}

export const DRESSED_STUD_THICKNESS_M = 1.5 * INCHES_TO_METERS
/** Standard 2x4 cavity depth = 3.5" (0.0889 m); finished 2x4 wall = ~4.5" (0.114 m). */
export const WALL_2X4_MAX_THICKNESS_M = 0.125
/** Standard 2x6 cavity depth = 5.5" (0.1397 m); finished 2x6 wall = ~6.5" (0.165 m). */
export const WALL_2X6_MIN_THICKNESS_M = 0.14

export function belongsToLevel(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  node: SceneNodeLike,
  levelId: string | null,
): boolean {
  if (!levelId) return true
  if (node.id === levelId || node.parentId === levelId) return true
  let cur: SceneNodeLike | undefined = node
  let guard = 0
  while (cur?.parentId && guard < 12) {
    if (cur.parentId === levelId) return true
    cur = nodes[cur.parentId]
    guard += 1
  }
  return false
}

export function resolveNodeLevelId(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  node: SceneNodeLike,
): string | null {
  if (node.type === 'level') return node.id
  let cur: SceneNodeLike | undefined = node
  let guard = 0
  while (cur?.parentId && guard < 12) {
    const parent: SceneNodeLike | undefined = nodes[cur.parentId]
    if (!parent) return cur.parentId
    if (parent.type === 'level') return parent.id
    cur = parent
    guard += 1
  }
  return null
}

const bonesContextCache = new WeakMap<
  Readonly<Record<string, SceneNodeLike>>,
  Map<string, BonesPlumbingContext>
>()

/**
 * Extract `@pascal-app/plugin-bones` framing rules and authoritative `bones:service` plumbing anchors
 * (`water-heater`, `water-entry`, `sewer-exit`) for a level. WeakMap-memoized per scene nodes object.
 */
export function extractBonesPlumbingContext(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null = null,
): BonesPlumbingContext {
  const key = levelId ?? '__all__'
  let byLevel = bonesContextCache.get(nodes)
  if (!byLevel) {
    byLevel = new Map()
    bonesContextCache.set(nodes, byLevel)
  }
  const cached = byLevel.get(key)
  if (cached) return cached

  const all = Object.values(nodes)
  // Priority #1: Dedicated `@kruschdev/pascal-plugin-structural` (`structural:assembly`) takes precedence over `bones:framing`.
  const structuralNode = all.find(
    (n) => n.type === 'structural:assembly' && belongsToLevel(nodes, n, levelId),
  )
  const bonesNode = all.find(
    (n) => n.type === 'bones:framing' && belongsToLevel(nodes, n, levelId),
  )
  const framingNode = structuralNode ?? bonesNode
  const source: 'structural' | 'bones' | 'default' = structuralNode
    ? 'structural'
    : bonesNode
      ? 'bones'
      : 'default'

  const defaultSpacingIn: 12 | 16 | 24 =
    framingNode?.studSpacingIn === 12
      ? 12
      : framingNode?.studSpacingIn === 24
        ? 24
        : 16
  const defaultStudDepthIn: number | undefined =
    structuralNode?.studSize === '2x6'
      ? 5.5
      : structuralNode?.studSize === '2x4'
        ? 3.5
        : undefined
  const framingSystem: 'lumber' | 'lgs' = framingNode?.framingSystem === 'lgs' ? 'lgs' : 'lumber'
  const floorSystem =
    structuralNode?.floorSystem === 'tji-ijoist' ||
    structuralNode?.floorSystem === 'open-web-truss' ||
    structuralNode?.floorSystem === 'dimensional'
      ? structuralNode.floorSystem
      : undefined
  const wallRules = new Map<string, BonesWallRule>()

  const rawOverrides = framingNode?.wallOverrides
  if (rawOverrides && typeof rawOverrides === 'object') {
    for (const [wallId, rawRule] of Object.entries(rawOverrides as Record<string, unknown>)) {
      if (typeof rawRule === 'string') {
        const construction: BonesWallConstruction =
          rawRule === 'lgs' || rawRule === 'cmu' || rawRule === 'skip' ? rawRule : 'framed'
        wallRules.set(wallId, {
          construction,
          spacingIn: defaultSpacingIn,
          studThicknessM: DRESSED_STUD_THICKNESS_M,
          isLoadBearing: rawRule === 'shear-wall',
          isWetWall: false,
        })
        continue
      }
      if (!rawRule || typeof rawRule !== 'object') continue
      const r = rawRule as Record<string, unknown>
      const construction: BonesWallConstruction =
        r.construction === 'lgs' || r.construction === 'cmu' || r.construction === 'skip'
          ? r.construction
          : 'framed'
      const rawSpacing = r.studSpacingIn ?? r.spacingIn
      const spacingIn: 12 | 16 | 24 =
        rawSpacing === 12
          ? 12
          : rawSpacing === 16
            ? 16
            : rawSpacing === 24
              ? 24
              : defaultSpacingIn
      const studDepthIn: number | undefined =
        r.studSize === '2x6' ? 5.5 : r.studSize === '2x4' ? 3.5 : undefined
      wallRules.set(wallId, {
        construction,
        spacingIn,
        studThicknessM: DRESSED_STUD_THICKNESS_M,
        ...(typeof studDepthIn === 'number' ? { studDepthIn } : {}),
        isLoadBearing: Boolean(r.isLoadBearing || r.isShearWall || r.construction === 'shear-wall'),
        isWetWall: Boolean(r.isWetWall),
      })
    }
  }

  let waterHeaterAnchor: BonesPlumbingServiceAnchor | null = null
  let waterEntryAnchor: BonesPlumbingServiceAnchor | null = null
  let sewerExitAnchor: BonesPlumbingServiceAnchor | null = null

  for (const n of all) {
    if (n.type !== 'bones:service' || !belongsToLevel(nodes, n, levelId)) continue
    const st = n.serviceType
    if (st !== 'water-heater' && st !== 'water-entry' && st !== 'sewer-exit') continue
    const pos = Array.isArray(n.position) && n.position.length >= 3
      ? ([Number(n.position[0]), Number(n.position[1]), Number(n.position[2])] as Vec3)
      : undefined
    const anchor: BonesPlumbingServiceAnchor = {
      nodeId: n.id,
      serviceType: st,
      wallId: typeof n.wallId === 'string' ? n.wallId : undefined,
      wallT: typeof n.wallT === 'number' ? n.wallT : undefined,
      heightAff: typeof n.heightAff === 'number' ? n.heightAff : undefined,
      position: pos,
    }
    if (st === 'water-heater' && !waterHeaterAnchor) waterHeaterAnchor = anchor
    if (st === 'water-entry' && !waterEntryAnchor) waterEntryAnchor = anchor
    if (st === 'sewer-exit' && !sewerExitAnchor) sewerExitAnchor = anchor
  }

  const ctx: BonesPlumbingContext = {
    framingPresent: Boolean(framingNode),
    source,
    defaultSpacingIn,
    defaultStudDepthIn,
    framingSystem,
    floorSystem,
    wallRules,
    waterHeaterAnchor,
    waterEntryAnchor,
    sewerExitAnchor,
    hasPlumbingSchematic: Boolean(waterHeaterAnchor || waterEntryAnchor || sewerExitAnchor),
  }
  byLevel.set(key, ctx)
  return ctx
}

/**
 * Resolve effective wall thickness (m) honoring per-wall `structural:assembly` `wallOverrides[id].studSize`
 * first (without inflating a `2x4` interior partition to a global `2x6` default), falling back to global
 * `defaultStudDepthIn` when no per-wall override is present.
 */
export function resolveEffectiveWallThicknessM(
  wallThicknessM: number,
  bonesContext?: BonesPlumbingContext | null,
  wallRule?: BonesWallRule,
): number {
  if (typeof wallRule?.studDepthIn === 'number') {
    return wallRule.studDepthIn * INCHES_TO_METERS + INCHES_TO_METERS
  }
  if (bonesContext?.source === 'structural' && typeof bonesContext.defaultStudDepthIn === 'number') {
    return Math.max(wallThicknessM, bonesContext.defaultStudDepthIn * INCHES_TO_METERS + INCHES_TO_METERS)
  }
  return wallThicknessM
}

/**
 * IRC R602.6 / IPC wet-wall cavity check:
 * - A 3" or 4" PVC/ABS DWV pipe (3.5" / 4.5" OD + hub) cannot fit inside a 2x4 stud wall (3.5" cavity).
 * - Boring through load-bearing studs is limited to 40% of stud depth (60% non-load-bearing), measured on drilled hole diameter.
 * - Steel nail shield plates are required when the edge of the bored hole is < 1-1/4" (1.25") from the stud face (IRC R602.6 / IPC 305.6).
 */
export function checkWetWallPipeFit(params: {
  wallThicknessM: number
  pipeSize: PipeNominalSize
  material: PipeMaterial
  isLoadBearing?: boolean
  isHorizontalBore?: boolean
}): {
  fits: boolean
  needs2x6WetWall: boolean
  needsNailPlate: boolean
  borePctOfStud: number
  codeRef: string
  reason?: string
} {
  const {
    wallThicknessM,
    pipeSize,
    material,
    isLoadBearing = false,
    isHorizontalBore = false,
  } = params
  // Approximate stud cavity depth = wallThickness - 1" total drywall (0.0254 m)
  const cavityDepthM = Math.max(0.0889, wallThicknessM - 0.0254)
  const pipeOdM = getPipeOuterDiameterM(pipeSize, material)
  const boreM = recommendHoleSawIn(pipeSize, material) * INCHES_TO_METERS
  const hubAllowanceM = material === 'pvc-dwv' || material === 'abs-dwv' || material === 'cast-iron' ? 0.014 : 0
  const requiredCavityM = pipeOdM + hubAllowanceM
  const borePct = Math.round(((isHorizontalBore ? boreM : pipeOdM) / cavityDepthM) * 100)
  const maxBorePct = isLoadBearing ? 40 : 60
  const needsNailPlate = (cavityDepthM - boreM) / 2 < 1.25 * INCHES_TO_METERS

  if (requiredCavityM > cavityDepthM + 0.002) {
    return {
      fits: false,
      needs2x6WetWall: true,
      needsNailPlate: true,
      borePctOfStud: borePct,
      codeRef: 'IRC R602.6 / Wet Wall',
      reason: `${pipeSize} ${material.toUpperCase()} (${(requiredCavityM * 39.37).toFixed(2)}" w/ hub) exceeds ${(cavityDepthM * 39.37).toFixed(1)}" stud cavity; upgrade to 2x6 wet wall (5.5" cavity) or pipe chase.`,
    }
  }

  if (isHorizontalBore && borePct > maxBorePct) {
    return {
      fits: false,
      needs2x6WetWall: cavityDepthM < 0.13,
      needsNailPlate,
      borePctOfStud: borePct,
      codeRef: 'IRC R602.6',
      reason: `Horizontal bore (${(boreM / INCHES_TO_METERS).toFixed(2)}" hole = ${borePct}% of stud depth) exceeds ${maxBorePct}% ${isLoadBearing ? 'load-bearing' : 'non-load-bearing'} limit.`,
    }
  }

  return {
    fits: true,
    needs2x6WetWall: false,
    needsNailPlate,
    borePctOfStud: borePct,
    codeRef: 'IRC R602.6',
  }
}

/**
 * Resolve a `bones:service` anchor into level-local 3D coordinates using wall geometry when wall-anchored.
 */
export function resolveBonesAnchorPosition(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  anchor: BonesPlumbingServiceAnchor,
  fallbackY = 0,
): Vec3 | null {
  const pos = anchor.position
  const hasExplicitPos =
    pos && (Math.abs(pos[0]) > 1e-4 || Math.abs(pos[1]) > 1e-4 || Math.abs(pos[2]) > 1e-4)
  if (hasExplicitPos) {
    return pos
  }
  if (anchor.wallId && nodes[anchor.wallId]) {
    const w = nodes[anchor.wallId]!
    if (Array.isArray(w.start) && Array.isArray(w.end)) {
      const t = typeof anchor.wallT === 'number' ? Math.max(0.05, Math.min(0.95, anchor.wallT)) : 0.5
      const x = w.start[0] + (w.end[0] - w.start[0]) * t
      const z = w.start[1] + (w.end[1] - w.start[1]) * t
      const y = typeof anchor.heightAff === 'number' ? anchor.heightAff : fallbackY
      return [x, y, z]
    }
  }
  return pos ?? null
}

export type FramingMemberKind = 'stud' | 'sole-plate' | 'top-plate' | 'floor-joist'

export type FramingPenetration = {
  id: string
  pipeRunId: string
  wallId?: string
  memberKind: FramingMemberKind
  memberLabel: string
  position: Vec3
  /** Direction vector along the pipe at penetration (unit vector). */
  pipeDirection: Vec3
  /** Unit normal `[nx, nz]` perpendicular to the penetrated wall plane for nail-plate orientation. */
  wallNormal: readonly [number, number]
  /** Nominal stud cavity depth (m) for accurate front/back nail-plate surface offset. */
  studDepthM: number
  pipeSize: PipeNominalSize
  material: PipeMaterial
  /** Recommended drill bit / hole-saw diameter in inches (OD + 1/4" clearance, rounded to 1/8"). */
  holeSawIn: number
  borePctOfStud: number
  needsNailPlate: boolean
  codeCompliant: boolean
  codeRef: string
  note?: string
}

/**
 * Compute recommended hole-saw / auger-bit diameter (inches) for a nominal pipe & material.
 */
export function recommendHoleSawIn(pipeSize: PipeNominalSize, material: PipeMaterial): number {
  const odIn = getPipeOuterDiameterM(pipeSize, material) / INCHES_TO_METERS
  const clearance = odIn >= 1.5 ? 0.25 : 0.1875
  return Math.ceil((odIn + clearance) * 8) / 8
}

/**
 * Compute exact 3D stud, sole-plate, and top-plate penetrations where a pipe run
 * crosses `@pascal-app/plugin-bones` framing members (16" or 24" OC studs + plates).
 */
export function computePipeFramingPenetrations(params: {
  pipeRunId: string
  path: ReadonlyArray<Vec3>
  pipeSize: PipeNominalSize
  material: PipeMaterial
  walls: ReadonlyArray<{
    id: string
    start: readonly [number, number]
    end: readonly [number, number]
    lengthM: number
    thicknessM: number
    heightM: number
    ux: number
    uz: number
    nx: number
    nz: number
  }>
  bonesContext?: BonesPlumbingContext | null
}): FramingPenetration[] {
  const { pipeRunId, path, pipeSize, material, walls, bonesContext } = params
  if (path.length < 2) return []

  const penetrations: FramingPenetration[] = []
  const holeSawIn = recommendHoleSawIn(pipeSize, material)
  const defaultSpacingIn = bonesContext?.defaultSpacingIn ?? 16
  let seq = 1

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const dz = b[2] - a[2]
    const segLen = Math.hypot(dx, dy, dz)
    if (segLen < 0.02) continue
    const dir: Vec3 = [dx / segLen, dy / segLen, dz / segLen]

    for (const wall of walls) {
      const rule = bonesContext?.wallRules.get(wall.id)
      if (rule?.construction === 'skip' || rule?.construction === 'cmu') continue
      const spacingM = (rule?.spacingIn ?? defaultSpacingIn) * INCHES_TO_METERS
      const effectiveWallThicknessM = resolveEffectiveWallThicknessM(wall.thicknessM, bonesContext, rule)
      const studDepthM = Math.max(0.0889, effectiveWallThicknessM - INCHES_TO_METERS)
      const halfThick = effectiveWallThicknessM / 2 + 0.04

      // Project endpoints into wall-local coordinates (u along wall, n perpendicular to wall)
      const ua = (a[0] - wall.start[0]) * wall.ux + (a[2] - wall.start[1]) * wall.uz
      const na = (a[0] - wall.start[0]) * wall.nx + (a[2] - wall.start[1]) * wall.nz
      const ub = (b[0] - wall.start[0]) * wall.ux + (b[2] - wall.start[1]) * wall.uz
      const nb = (b[0] - wall.start[0]) * wall.nx + (b[2] - wall.start[1]) * wall.nz

      // Check if segment travels inside or right along this wall cavity
      const minAbsN = Math.min(Math.abs(na), Math.abs(nb))
      const crossesWallPlane = na * nb <= 0
      if (minAbsN > halfThick && !crossesWallPlane) continue

      const uMin = Math.min(ua, ub)
      const uMax = Math.max(ua, ub)
      if (uMax < 0 || uMin > wall.lengthM) continue

      // 1. Vertical crossings of Sole Plate (y = 0.02 m) and Double Top Plate (y = wall.heightM - 0.04 m)
      const yMin = Math.min(a[1], b[1])
      const yMax = Math.max(a[1], b[1])
      if (Math.abs(dy) > 0.05) {
        const plateHeights: Array<{ kind: FramingMemberKind; label: string; y: number }> = [
          { kind: 'sole-plate', label: `Sole Plate (${wall.id})`, y: 0.02 },
          { kind: 'top-plate', label: `Double Top Plate (${wall.id})`, y: wall.heightM - 0.04 },
        ]
        for (const plate of plateHeights) {
          if (yMin <= plate.y && yMax >= plate.y) {
            const t = (plate.y - a[1]) / dy
            const px = a[0] + dx * t
            const pz = a[2] + dz * t
            const pu = (px - wall.start[0]) * wall.ux + (pz - wall.start[1]) * wall.uz
            const pn = Math.abs((px - wall.start[0]) * wall.nx + (pz - wall.start[1]) * wall.nz)
            if (pu >= 0 && pu <= wall.lengthM && pn <= halfThick) {
              const fit = checkWetWallPipeFit({
                wallThicknessM: effectiveWallThicknessM,
                pipeSize,
                material,
                isLoadBearing: rule?.isLoadBearing ?? false,
                isHorizontalBore: false,
              })
              const firestopNote =
                bonesContext?.source === 'structural'
                  ? 'IRC R302.11(5) firestop collar / intumescent caulk required at plate penetration.'
                  : undefined
              penetrations.push({
                id: `${pipeRunId}_pen_${seq++}`,
                pipeRunId,
                wallId: wall.id,
                memberKind: plate.kind,
                memberLabel: plate.label,
                position: [px, plate.y, pz],
                pipeDirection: dir,
                wallNormal: [wall.nx, wall.nz],
                studDepthM,
                pipeSize,
                material,
                holeSawIn,
                borePctOfStud: fit.borePctOfStud,
                needsNailPlate: fit.needsNailPlate,
                codeCompliant: fit.fits,
                codeRef: bonesContext?.source === 'structural' ? 'IRC R602.6 / R302.11(5)' : fit.codeRef,
                note: [fit.reason, firestopNote].filter(Boolean).join(' ') || undefined,
              })
            }
          }
        }
      }

      // 2. Horizontal crossings of individual 16"/24" OC wall studs
      const du = ub - ua
      if (Math.abs(du) > 0.05 && yMax > 0.05 && yMin < wall.heightM - 0.08) {
        const firstIdx = Math.max(1, Math.ceil(uMin / spacingM))
        const lastIdx = Math.min(Math.floor((wall.lengthM - 0.05) / spacingM), Math.floor(uMax / spacingM))
        for (let studIdx = firstIdx; studIdx <= lastIdx; studIdx++) {
          const studU = studIdx * spacingM
          const t = (studU - ua) / du
          if (t < 0 || t > 1) continue
          const py = a[1] + dy * t
          if (py <= 0.05 || py >= wall.heightM - 0.08) continue
          const px = a[0] + dx * t
          const pz = a[2] + dz * t
          const pn = Math.abs((px - wall.start[0]) * wall.nx + (pz - wall.start[1]) * wall.nz)
          if (pn > halfThick) continue

          const fit = checkWetWallPipeFit({
            wallThicknessM: effectiveWallThicknessM,
            pipeSize,
            material,
            isLoadBearing: rule?.isLoadBearing ?? false,
            isHorizontalBore: true,
          })
          penetrations.push({
            id: `${pipeRunId}_pen_${seq++}`,
            pipeRunId,
            wallId: wall.id,
            memberKind: 'stud',
            memberLabel: `Stud #${studIdx} @ ${Math.round(studU / INCHES_TO_METERS)}" OC`,
            position: [px, py, pz],
            pipeDirection: dir,
            wallNormal: [wall.nx, wall.nz],
            studDepthM,
            pipeSize,
            material,
            holeSawIn,
            borePctOfStud: fit.borePctOfStud,
            needsNailPlate: fit.needsNailPlate,
            codeCompliant: fit.fits,
            codeRef: fit.codeRef,
            note: fit.reason,
          })
        }
      }
    }
  }

  return penetrations
}
