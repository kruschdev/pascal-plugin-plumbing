/**
 * One-Click IPC/UPC Auto-Populate & Bones Schematic Ingestion (`src/ipc/autopopulate.ts`).
 *
 * Scans Pascal scene rooms, walls, slabs, placed Pascal `item`/`cabinet` fixtures,
 * and optional `@pascal-app/plugin-bones` (`bones:framing`, `bones:service`) anchors to generate
 * a complete, code-compliant 3D plumbing network:
 *   - Main water entry (shutoff + PRV + backflow)
 *   - Water heater (tank / tankless / HPWH) + thermal expansion tank
 *   - PEX Home-Run Manifold (or Copper/PEX Trunk-and-Branch)
 *   - Wet-wall fixture rough-ins + minimum 2 exterior frost-proof hose bibbs
 *   - Gravity-sloped DWV drains (1/4"/ft / 1/8"/ft), 3" main vent stack, dry re-vents (>= 6" above flood rim), & cleanouts
 *   - Optional Fuel Gas (IFGC) & Rigid 4" Dryer Vent (IRC M1502.4)
 *   - Full `electricalDemand` payloads on every powered unit for automatic Electrical Panel coordination!
 *
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import {
  type LegalCavityGraph,
  compileBuildingAnatomy,
  compileLegalCavityGraph,
  evaluatePlacementCandidate,
} from '@kruschdev/pascal-mep-kernel'
import {
  type ElectricalPowerDemand,
  type SceneNodeLike,
  type Vec3,
  belongsToLevel,
  checkWetWallPipeFit,
  extractBonesPlumbingContext,
  getEquipmentElectricalDemand,
  getFixtureElectricalDemand,
  getLowerWalledLevelIds,
  isGroundOrLowestWalledLevel,
  resolveBonesAnchorPosition,
  resolveEffectiveWallThicknessM,
} from './framing-interop'

export { isGroundOrLowestWalledLevel } from './framing-interop'
import {
  type PlumbingCavityContext,
  type RoomPolygon2D,
  type WallOpeningSpan,
  type WallSegment2D,
  countPathElbows,
  extractRoomPolygons,
  extractWallSegments,
  mapCanonicalWallsToOpenings,
  mapOccupancyObstaclesToPlumbing,
  nearestWallToPoint,
  pointInPolygon2D,
  resolveLevelHeightM,
  routeDwvDrainRun,
  routePressurizedPipeRun,
  routeVentRun,
} from './routing'
import { IPC_RULE_THRESHOLDS, getIpcRuleById } from './rules'
import {
  checkDryerVentRun,
  sizeBuildingDrain,
  sizeDrainBranch,
  sizeFuelGasPipe,
  sizeSupplyPipe,
  sizeVentStack,
  sizeWaterHeater,
} from './sizing'
import {
  type CodeEdition,
  type EquipmentKind,
  FIXTURE_SPECS,
  type FixtureKind,
  type FoundationType,
  type ManifoldKind,
  type OccupancyType,
  PIPE_NOMINAL_INCHES,
  type PipeMaterial,
  type PipeNominalSize,
  type PlumbingSystem,
  type SupplyTopology,
  getFixtureDfu,
  getFixtureWsfu,
  getPipeOuterDiameterM,
  round2,
} from './tables'

export type BonesIngestionMode = 'auto' | 'import-only' | 'ignore'

export type PlumbingAutoPopulateOptions = {
  levelId?: string | null
  occupancy?: OccupancyType
  codeEdition?: CodeEdition
  supplyTopology?: SupplyTopology
  supplyMaterial?: 'pex-a' | 'pex-b' | 'copper-l' | 'cpvc'
  dwvMaterial?: 'pvc-dwv' | 'abs-dwv' | 'cast-iron'
  foundationType?: FoundationType
  waterHeaterKind?:
    | 'water-heater-tank-electric'
    | 'water-heater-tank-gas'
    | 'water-heater-tankless-gas'
    | 'water-heater-hpwh'
  includeFuelGas?: boolean
  includeDryerVent?: boolean
  includeHotRecirc?: boolean
  bonesMode?: BonesIngestionMode
}

export type PlannedEquipmentSpec = {
  id: string
  name: string
  equipmentKind: EquipmentKind
  position: Vec3
  rotation: number
  roomName: string
  capacityGal?: number
  gasBtuh?: number
  watts?: number
  hasDrainPan?: boolean
  hasTpDischarge?: boolean
  hasExpansionTank?: boolean
  electricalDemand?: ElectricalPowerDemand | null
}

export type PlannedManifoldSpec = {
  id: string
  name: string
  manifoldKind: ManifoldKind
  position: Vec3
  rotation: number
  portCount: number
  supplyMaterial: PipeMaterial
  coverRemoved: boolean
}

export type PlannedFixtureSpec = {
  id: string
  name: string
  fixtureKind: FixtureKind
  position: Vec3
  rotation: number
  roomName: string
  wallId?: string
  dfu: number
  wsfuCold: number
  wsfuHot: number
  wsfuTotal: number
  trapSize: PipeNominalSize | null
  drainSize: PipeNominalSize | null
  ventSize: PipeNominalSize | null
  supplySize: PipeNominalSize | null
  hasVacuumBreaker: boolean
  hasPTrap: boolean
  electricalDemand?: ElectricalPowerDemand | null
}

export type PlannedPipeRunSpec = {
  id: string
  name: string
  system: PlumbingSystem
  material: PipeMaterial
  nominalSize: PipeNominalSize
  path: Vec3[]
  slopeInPerFt: number
  dfuLoad: number
  wsfuLoad: number
  gasBtuh: number
  sourceNodeId?: string
  targetNodeId?: string
  hasCleanout: boolean
  hasSedimentTrap: boolean
  hasShutoffWithin6Ft: boolean
  isHorizontalSanTee: boolean
  isMainVentStack: boolean
  trapArmLengthFt?: number
  wallId?: string
}

export type PlumbingAutoPopulatePlan = {
  levelId: string | null
  codeEdition: CodeEdition
  supplyTopology: SupplyTopology
  foundationType: FoundationType
  equipment: PlannedEquipmentSpec[]
  manifolds: PlannedManifoldSpec[]
  fixtures: PlannedFixtureSpec[]
  pipeRuns: PlannedPipeRunSpec[]
  bonesAnchorsUsed: string[]
  summary: string
}

function inferFixtureKindFromPascalItem(node: SceneNodeLike): FixtureKind | null {
  const hay = `${node.name ?? ''} ${String(node.assetId ?? '')} ${String(node.category ?? '')} ${String(node.kind ?? '')}`.toLowerCase()
  // Exclude bathroom decor/accessories and outdoor decorative fountains that share fixture keywords
  if (
    /\brug\b|\bmat\b|towel|curtain|paper|\broll\b|brush|holder|caddy|soap|dispenser|sculpture|statue|ornate|mirror|\bshelf\b/.test(
      hay,
    )
  ) {
    return null
  }
  if (/toilet|water.?closet|\bwc\b/.test(hay)) return 'water-closet'
  if (/urinal/.test(hay)) return 'urinal'
  if (/bidet/.test(hay)) return 'bidet'
  if (/tub.*shower|shower.*tub|(?:bath|tub|shower).{0,16}combo|combo.{0,16}(?:bath|tub|shower)/.test(hay)) {
    return 'tub-shower-combo'
  }
  if (/bathtub|soaking.?tub|\btub\b/.test(hay)) return 'bathtub'
  if (/shower/.test(hay)) return 'shower'
  if (/kitchen.?sink/.test(hay)) return 'kitchen-sink'
  if (/laundry.?sink|utility.?sink|mop.?sink/.test(hay)) return /mop/.test(hay) ? 'mop-sink' : 'laundry-sink'
  if (/bar.?sink/.test(hay)) return 'bar-sink'
  if (/vanity|lavatory|basin|bathroom.?sink|\bsink\b/.test(hay)) return 'lavatory'
  if (/dishwasher/.test(hay)) return 'dishwasher'
  if (/washing.?machine|clothes.?washer|\bwasher\b/.test(hay)) return 'clothes-washer'
  return null
}

function defaultFixturesForRoom(room: RoomPolygon2D): FixtureKind[] {
  switch (room.category) {
    case 'master-bath':
      return ['water-closet', 'lavatory', 'lavatory', 'shower', 'bathtub']
    case 'bathroom':
      return ['water-closet', 'lavatory', 'tub-shower-combo']
    case 'half-bath':
      return ['water-closet', 'lavatory']
    case 'commercial-restroom':
      return ['water-closet', 'water-closet', 'urinal', 'lavatory', 'lavatory', 'floor-drain']
    case 'kitchen':
      return ['kitchen-sink', 'dishwasher', 'garbage-disposal']
    case 'commercial-kitchen':
      return ['kitchen-sink', 'dishwasher', 'mop-sink', 'grease-interceptor', 'floor-drain']
    case 'laundry':
      return ['clothes-washer', 'laundry-sink']
    case 'utility':
      return ['floor-drain']
    default:
      return []
  }
}

function yawFacingRoom(wall: WallSegment2D, roomCentroid: readonly [number, number]): number {
  const mx = (wall.start[0] + wall.end[0]) / 2
  const mz = (wall.start[1] + wall.end[1]) / 2
  const toCx = roomCentroid[0] - mx
  const toCz = roomCentroid[1] - mz
  const dot = toCx * wall.nx + toCz * wall.nz
  const nx = dot >= 0 ? wall.nx : -wall.nx
  const nz = dot >= 0 ? wall.nz : -wall.nz
  return round2(Math.atan2(nx, nz))
}

function sceneBounds(walls: ReadonlyArray<WallSegment2D>, rooms: ReadonlyArray<RoomPolygon2D>): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  cx: number
  cz: number
} {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  // Always derive building envelope from actual walled footprint when walls exist,
  // so outer yard / terrace / pool / balcony / spawn zones never inflate indoor bounds.
  if (walls.length > 0) {
    for (const w of walls) {
      minX = Math.min(minX, w.start[0], w.end[0])
      maxX = Math.max(maxX, w.start[0], w.end[0])
      minZ = Math.min(minZ, w.start[1], w.end[1])
      maxZ = Math.max(maxZ, w.start[1], w.end[1])
    }
  } else {
    const nonExterior = rooms.filter((r) => r.category !== 'exterior')
    const roomPool = nonExterior.length > 0 ? nonExterior : rooms
    for (const r of roomPool) {
      for (const [x, z] of r.polygon) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      }
    }
  }
  if (!Number.isFinite(minX)) {
    return { minX: -4, maxX: 4, minZ: -3, maxZ: 3, cx: 0, cz: 0 }
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
  }
}

/**
 * Plan a complete IPC/UPC/IFGC plumbing layout for a Pascal level.
 */
export function planPlumbingAutoPopulate(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  options: PlumbingAutoPopulateOptions = {},
): PlumbingAutoPopulatePlan {
  const {
    levelId = null,
    occupancy = 'residential',
    codeEdition = 'IPC-2021',
    supplyTopology = 'manifold',
    supplyMaterial = 'pex-a',
    dwvMaterial = 'pvc-dwv',
    foundationType = 'crawlspace',
    waterHeaterKind = 'water-heater-tank-electric',
    includeDryerVent = true,
    includeHotRecirc = false,
    bonesMode = 'auto',
  } = options

  const sceneGasAppliances: Array<{ id: string; name: string; pos: Vec3; btuh: number }> = []
  for (const n of Object.values(nodes)) {
    if (!belongsToLevel(nodes, n, levelId)) continue
    if (
      (n.type === 'hvac:equipment' || (n.type === 'plumbing:equipment' && n.equipmentKind !== 'gas-meter')) &&
      typeof n.gasBtuh === 'number' &&
      n.gasBtuh > 0 &&
      Array.isArray(n.position) &&
      n.position.length >= 3
    ) {
      sceneGasAppliances.push({
        id: n.id,
        name: typeof n.name === 'string' && n.name ? n.name : n.id,
        pos: [Number(n.position[0]), Math.max(0.45, Number(n.position[1]) + 0.45), Number(n.position[2])],
        btuh: n.gasBtuh,
      })
    }
  }
  const hasGasWaterHeater =
    waterHeaterKind === 'water-heater-tank-gas' || waterHeaterKind === 'water-heater-tankless-gas'
  const includeFuelGas = options.includeFuelGas ?? (hasGasWaterHeater || sceneGasAppliances.length > 0)

  const walls = extractWallSegments(nodes, levelId)
  const wallById = new Map<string, WallSegment2D>(walls.map((w) => [w.id, w]))
  const rooms = extractRoomPolygons(nodes, levelId, occupancy)
  const levelH = resolveLevelHeightM(nodes, levelId)
  const wetWallFitRule = getIpcRuleById('irc-r602-6-wet-wall-fit')
  const dryerVentRule = getIpcRuleById('irc-m1502-4-dryer-vent')
  const dryerVentMaterialRule = getIpcRuleById('irc-m1502-4-1-dryer-vent-material')

  // Layer 2 — Shared WeakMap-cached BuildingAnatomy, LegalCavityGraph & TradeOccupancyGrid
  const anatomy = compileBuildingAnatomy(nodes)
  const subFloorElevationM = foundationType === 'slab' ? -0.35 : -0.24
  const legalCavityGraph: LegalCavityGraph | undefined =
    walls.length > 0
      ? compileLegalCavityGraph(anatomy, levelId, {
          roofClearanceM: 0.1,
          subFloorElevationM,
        })
      : undefined
  const occupancyGrid = anatomy.createOccupancyGrid(levelId, { forTrade: 'plumbing' })
  const obstacles = mapOccupancyObstaclesToPlumbing(occupancyGrid.obstacles)
  const cavityContext: PlumbingCavityContext = {
    nodes,
    levelId,
    anatomy,
    ...(legalCavityGraph ? { graph: legalCavityGraph } : {}),
    occupancy: occupancyGrid,
  }
  const wallOpenings = mapCanonicalWallsToOpenings(anatomy.getWalls(levelId))
  const openingsByWall = new Map<string, WallOpeningSpan[]>()
  for (const op of wallOpenings) {
    let list = openingsByWall.get(op.wallId)
    if (!list) {
      list = []
      openingsByWall.set(op.wallId, list)
    }
    list.push(op)
  }
  const bones =
    bonesMode === 'ignore'
      ? null
      : extractBonesPlumbingContext(nodes, levelId)
  const bounds = sceneBounds(walls, rooms)
  const lowerWalledLevelIds = getLowerWalledLevelIds(nodes, levelId)
  const isGroundStory = isGroundOrLowestWalledLevel(nodes, levelId)
  const lowerWaterHeater = !isGroundStory
    ? (Object.values(nodes).find(
        (n) =>
          n.type === 'plumbing:equipment' &&
          typeof n.equipmentKind === 'string' &&
          n.equipmentKind.startsWith('water-heater-') &&
          lowerWalledLevelIds.some((lid) => belongsToLevel(nodes, n, lid)),
      ) ?? null)
    : null
  const emitMainShutoff = isGroundStory
  const emitWaterHeater = isGroundStory || !lowerWaterHeater
  const clampToBoundsXZ = (x: number, z: number, margin = 0.15): readonly [number, number] => {
    const minX = bounds.minX + margin
    const maxX = bounds.maxX - margin
    const minZ = bounds.minZ + margin
    const maxZ = bounds.maxZ - margin
    return [
      round2(minX <= maxX ? Math.max(minX, Math.min(maxX, x)) : bounds.cx),
      round2(minZ <= maxZ ? Math.max(minZ, Math.min(maxZ, z)) : bounds.cz),
    ]
  }

  // Filter out exterior zones (pools, patios, terraces, balconies, yards, outdoor spawns) and
  // any zone whose centroid sits outside the walled building envelope.
  const indoorRooms = rooms.filter((r) => {
    if (r.category === 'exterior') return false
    if (walls.length > 0) {
      const [cx, cz] = r.centroid
      if (
        cx < bounds.minX - 0.15 ||
        cx > bounds.maxX + 0.15 ||
        cz < bounds.minZ - 0.15 ||
        cz > bounds.maxZ + 0.15
      ) {
        return false
      }
    }
    return true
  })

  // Determine roof clearance envelope (explicit roof-segment + pitched/flat fallback) for the active level
  // so indoor supply & re-vent pipes stay strictly below the roof plane (only Main DWV Stack penetrates).
  const levelAssembly = Object.values(nodes).find(
    (n) => n.type === 'structural:assembly' && belongsToLevel(nodes, n, levelId),
  )
  const roofPitchRise =
    typeof levelAssembly?.roofPitchRise === 'number' &&
    Number.isFinite(levelAssembly.roofPitchRise) &&
    levelAssembly.roofPitchRise >= 0
      ? levelAssembly.roofPitchRise
      : 6
  const maxRoofYAt = anatomy.getRoofShell(levelId, {
    wallBounds: bounds,
    fallbackPitchRiseOver12: roofPitchRise,
    clampOverhangToEave: true,
  }).roofEnvelopeY

  // Spatial clearance predicates covering ALL structural obstacles (floor girders, door/window headers,
  // ceiling/ridge beams, structural columns) + NEC 110.26(E) dedicated electrical spaces + Pascal wall openings.
  const floorBeamsForNudge = obstacles.filter((o) => o.category === 'structural' && o.box.minY < 0.15)
  const hitsFloorBeamXZ = (cx: number, cz: number, pad = 0.28): boolean =>
    floorBeamsForNudge.some(
      (b) =>
        cx >= b.box.minX - pad &&
        cx <= b.box.maxX + pad &&
        cz >= b.box.minZ - pad &&
        cz <= b.box.maxZ + pad,
    )
  const hitsAnyObstacleXZ = (cx: number, cz: number, pad = 0.28): boolean =>
    obstacles.some(
      (o) =>
        cx >= o.box.minX - pad &&
        cx <= o.box.maxX + pad &&
        cz >= o.box.minZ - pad &&
        cz <= o.box.maxZ + pad,
    )
  const hitsWallOpening = (
    wallId: string,
    alongM: number,
    pad = 0.28,
    allowWindows = false,
  ): boolean => {
    const ops = openingsByWall.get(wallId)
    if (!ops || ops.length === 0) return false
    return ops.some((op) => {
      if (allowWindows && op.kind === 'window') return false
      return alongM >= op.startU - pad && alongM <= op.endU + pad
    })
  }
  const hitsAnyWallOpeningXZ = (
    cx: number,
    cz: number,
    pad = 0.28,
    allowWindows = false,
  ): boolean => {
    for (const w of walls) {
      const ops = openingsByWall.get(w.id)
      if (!ops || ops.length === 0) continue
      const dx = cx - w.start[0]
      const dz = cz - w.start[1]
      const along = dx * w.ux + dz * w.uz
      const perp = Math.abs(dx * w.nx + dz * w.nz)
      if (perp > w.thicknessM / 2 + pad) continue
      if (
        ops.some(
          (op) =>
            !(allowWindows && op.kind === 'window') &&
            along >= op.startU - pad &&
            along <= op.endU + pad,
        )
      ) {
        return true
      }
    }
    return false
  }
  const nudgeOffFloorGirder = (
    x: number,
    z: number,
    pad = 0.16,
    maxShifts: ReadonlyArray<number> = [0.22, -0.22, 0.36, -0.36, 0.52, -0.52],
    roomPoly?: ReadonlyArray<readonly [number, number]>,
  ): readonly [number, number] => {
    if (floorBeamsForNudge.length === 0 || !hitsFloorBeamXZ(x, z, pad)) return [round2(x), round2(z)]
    const isValidNudge = (nx: number, nz: number): boolean => {
      if (
        nx < bounds.minX + 0.12 ||
        nx > bounds.maxX - 0.12 ||
        nz < bounds.minZ + 0.12 ||
        nz > bounds.maxZ - 0.12
      ) {
        return false
      }
      if (roomPoly && roomPoly.length >= 3 && !pointInPolygon2D(nx, nz, roomPoly)) {
        return false
      }
      return true
    }
    for (const d of maxShifts) {
      if (isValidNudge(x + d, z) && !hitsFloorBeamXZ(x + d, z, pad)) return [round2(x + d), round2(z)]
      if (isValidNudge(x, z + d) && !hitsFloorBeamXZ(x, z + d, pad)) return [round2(x), round2(z + d)]
    }
    for (const d of maxShifts) {
      if (isValidNudge(x + d, z + d) && !hitsFloorBeamXZ(x + d, z + d, pad)) return [round2(x + d), round2(z + d)]
      if (isValidNudge(x + d, z - d) && !hitsFloorBeamXZ(x + d, z - d, pad)) return [round2(x + d), round2(z - d)]
    }
    return [round2(x), round2(z)]
  }

  const equipment: PlannedEquipmentSpec[] = []
  const manifolds: PlannedManifoldSpec[] = []
  const fixtures: PlannedFixtureSpec[] = []
  const pipeRuns: PlannedPipeRunSpec[] = []
  const bonesAnchorsUsed: string[] = []

  const seq = { eq: 1, man: 1, fix: 1, pipe: 1 }
  const allocId = (prefix: string, key: keyof typeof seq) => {
    while (nodes[`${prefix}_${seq[key]}`]) seq[key] += 1
    return `${prefix}_${seq[key]++}`
  }
  const nextEqId = () => allocId('plumbeq_auto', 'eq')
  const nextManId = () => allocId('plumbman_auto', 'man')
  const nextFixId = () => allocId('plumbfix_auto', 'fix')
  const nextPipeId = () => allocId('plumbpipe_auto', 'pipe')

  // 1. Discover placed Pascal fixtures (`item` / `cabinet`) first
  const placedFixtures: Array<{ kind: FixtureKind; pos: Vec3; roomName: string; rot: number; wallId?: string }> = []
  for (const n of Object.values(nodes)) {
    if ((n.type !== 'item' && n.type !== 'cabinet') || !belongsToLevel(nodes, n, levelId)) continue
    const kind = inferFixtureKindFromPascalItem(n)
    if (!kind) continue
    if (!Array.isArray(n.position) || n.position.length < 3) continue
    let rawPx = Number(n.position[0])
    let rawPz = Number(n.position[2])
    const hostWall = typeof n.parentId === 'string' ? wallById.get(n.parentId) : undefined
    if (hostWall) {
      // Wall-parented Pascal items (e.g. wall-mounted showerheads / sinks) store wall-local [u, y, localZ].
      const uClamped = Math.max(0.05, Math.min(hostWall.lengthM - 0.05, rawPx))
      const localZ = Math.max(-0.5, Math.min(0.5, rawPz))
      rawPx = hostWall.start[0] + hostWall.ux * uClamped + hostWall.nx * localZ
      rawPz = hostWall.start[1] + hostWall.uz * uClamped + hostWall.nz * localZ
      if (walls.length > 0) {
        const [clampedX, clampedZ] = clampToBoundsXZ(rawPx, rawPz, 0.15)
        rawPx = clampedX
        rawPz = clampedZ
      }
    } else if (
      walls.length > 0 &&
      (rawPx < bounds.minX - 0.15 ||
        rawPx > bounds.maxX + 0.15 ||
        rawPz < bounds.minZ - 0.15 ||
        rawPz > bounds.maxZ + 0.15)
    ) {
      // Skip outdoor items located outside the walled building envelope
      continue
    }
    const room = indoorRooms.find((r) => pointInPolygon2D(rawPx, rawPz, r.polygon))
    const [px, pz] = nudgeOffFloorGirder(rawPx, rawPz, 0.14, undefined, room?.polygon)
    const nearWall = hostWall
      ? { wall: hostWall, t: 0.5, point: [px, pz] as const, distanceM: 0 }
      : nearestWallToPoint(px, pz, walls)
    const spec = FIXTURE_SPECS[kind]
    const rot =
      typeof n.rotation === 'number'
        ? n.rotation
        : Array.isArray(n.rotation) && n.rotation.length >= 2
          ? Number(n.rotation[1])
          : nearWall && room
            ? yawFacingRoom(nearWall.wall, room.centroid)
            : 0
    placedFixtures.push({
      kind,
      pos: [round2(px), spec.roughInHeightM, round2(pz)],
      roomName: room?.name ?? 'Main',
      rot,
      wallId: nearWall?.wall.id,
    })
  }

  // 2. Supplement wet rooms that lack placed Pascal items (or fallback residential core if empty scene)
  const populatedRoomNames = new Set(placedFixtures.map((f) => f.roomName))
  const wetRooms = indoorRooms.filter((r) => defaultFixturesForRoom(r).length > 0)

  const targetWetRooms: RoomPolygon2D[] =
    wetRooms.length > 0
      ? wetRooms
      : placedFixtures.length === 0
        ? [
            {
              id: 'synth_bath',
              name: 'Bathroom',
              category: 'bathroom',
              polygon: [
                [bounds.minX + 0.5, bounds.minZ + 0.5],
                [bounds.cx, bounds.minZ + 0.5],
                [bounds.cx, bounds.cz],
                [bounds.minX + 0.5, bounds.cz],
              ],
              centroid: [(bounds.minX + bounds.cx) / 2, (bounds.minZ + bounds.cz) / 2],
              areaSqm: 5.5,
              areaSqft: 60,
            },
            {
              id: 'synth_kitchen',
              name: 'Kitchen',
              category: 'kitchen',
              polygon: [
                [bounds.cx, bounds.minZ + 0.5],
                [bounds.maxX - 0.5, bounds.minZ + 0.5],
                [bounds.maxX - 0.5, bounds.cz],
                [bounds.cx, bounds.cz],
              ],
              centroid: [(bounds.cx + bounds.maxX) / 2, (bounds.minZ + bounds.cz) / 2],
              areaSqm: 12,
              areaSqft: 130,
            },
          ]
        : []

  const flushType: 'flush-tank' | 'flushometer' = occupancy === 'commercial' ? 'flushometer' : 'flush-tank'

  for (const pf of placedFixtures) {
    const spec = FIXTURE_SPECS[pf.kind]
    const wsfu = getFixtureWsfu(pf.kind, occupancy)
    fixtures.push({
      id: nextFixId(),
      name: `${pf.roomName} ${spec.label}`,
      fixtureKind: pf.kind,
      position: pf.pos,
      rotation: pf.rot,
      roomName: pf.roomName,
      wallId: pf.wallId,
      dfu: getFixtureDfu(pf.kind, codeEdition),
      wsfuCold: wsfu.cold,
      wsfuHot: wsfu.hot,
      wsfuTotal: wsfu.total,
      trapSize: spec.minTrapIn,
      drainSize: spec.minDrainIn,
      ventSize: spec.minVentIn,
      supplySize: spec.supplySizeIn,
      hasVacuumBreaker: pf.kind === 'hose-bibb',
      hasPTrap: spec.needsPTrap,
      electricalDemand: getFixtureElectricalDemand(pf.kind),
    })
  }

  if (bonesMode !== 'import-only') {
    for (const room of targetWetRooms) {
      if (populatedRoomNames.has(room.name) && bonesMode !== 'auto') continue
      const existingInRoom = fixtures.filter((f) => f.roomName === room.name).map((f) => f.fixtureKind)
      const defaults = defaultFixturesForRoom(room)
      const missing = defaults.filter((k) => {
        const idx = existingInRoom.indexOf(k)
        if (idx >= 0) {
          existingInRoom.splice(idx, 1)
          return false
        }
        return true
      })
      if (missing.length === 0) continue

      const nearWall = nearestWallToPoint(room.centroid[0], room.centroid[1], walls)
      const count = missing.length

      for (let i = 0; i < count; i++) {
        const kind = missing[i]!
        const spec = FIXTURE_SPECS[kind]
        const wsfu = getFixtureWsfu(kind, occupancy)
        const allowUnderWindow = kind === 'kitchen-sink'
        let px = room.centroid[0]
        let pz = room.centroid[1]
        let chosenWall = nearWall?.wall
        let rot = chosenWall ? yawFacingRoom(chosenWall, room.centroid) : 0

        if (nearWall) {
          const wall = nearWall.wall
          const span = Math.min(wall.lengthM * 0.72, Math.max(0.8, count * 0.65))
          const frac = count === 1 ? 0.5 : i / (count - 1)
          const offsetAlong = (frac - 0.5) * span
          const baseT = Math.max(0.15, Math.min(0.85, nearWall.t))
          let alongM = Math.max(0.28, Math.min(wall.lengthM - 0.28, wall.lengthM * baseT + offsetAlong))
          const toCx = room.centroid[0] - (wall.start[0] + wall.ux * alongM)
          const toCz = room.centroid[1] - (wall.start[1] + wall.uz * alongM)
          const dot = toCx * wall.nx + toCz * wall.nz
          const sign = dot >= 0 ? 1 : -1
          const inward = wall.thicknessM / 2 + Math.min(0.28, spec.dimensionsM[2] / 2)
          px = wall.start[0] + wall.ux * alongM + wall.nx * sign * inward
          pz = wall.start[1] + wall.uz * alongM + wall.nz * sign * inward

          const isFixtureSpotBlocked = (
            w: WallSegment2D,
            candAlong: number,
            cx: number,
            cz: number,
            pad: number,
            allowWin: boolean,
          ): boolean =>
            hitsAnyObstacleXZ(cx, cz, pad) ||
            hitsWallOpening(w.id, candAlong, pad, allowWin) ||
            hitsAnyWallOpeningXZ(cx, cz, Math.min(0.2, pad), allowWin)

          // Keep vertical fixture risers & rough-ins strictly inside `room.polygon` and clear of ALL
          // structural beams (floor girders AND door/window headers), columns, and wall openings (IRC R502.8 / R602).
          const initialOutsideRoom = room.polygon.length >= 3 && !pointInPolygon2D(px, pz, room.polygon)
          if (initialOutsideRoom || isFixtureSpotBlocked(wall, alongM, px, pz, 0.26, false)) {
            let foundClear = false
            const maxStep = Math.ceil(wall.lengthM / 0.25)
            // Pass 1: stay strictly inside room.polygon and clear of ALL obstacles + doors/windows on primary wall
            for (let step = 1; step <= maxStep && !foundClear; step++) {
              for (const dir of [1, -1] as const) {
                const candAlong = alongM + dir * step * 0.25
                if (candAlong < 0.28 || candAlong > wall.lengthM - 0.28) continue
                const cx = wall.start[0] + wall.ux * candAlong + wall.nx * sign * inward
                const cz = wall.start[1] + wall.uz * candAlong + wall.nz * sign * inward
                if (room.polygon.length >= 3 && !pointInPolygon2D(cx, cz, room.polygon)) continue
                if (!isFixtureSpotBlocked(wall, candAlong, cx, cz, 0.26, false)) {
                  alongM = candAlong
                  px = cx
                  pz = cz
                  foundClear = true
                  break
                }
              }
            }
            // Pass 2: if primary wall sits directly over a floor girder or is full of openings, try other nearby walls
            if (!foundClear && walls.length > 1) {
              const altWalls = walls
                .filter((w) => w.id !== wall.id && w.lengthM >= 0.7)
                .map((w) => {
                  const proj = nearestWallToPoint(room.centroid[0], room.centroid[1], [w])!
                  return { wall: w, t: proj.t, dist: proj.distanceM }
                })
                .filter((c) => c.dist <= Math.max(4.5, nearWall.distanceM + 2.5))
                .sort((a, b) => a.dist - b.dist)

              for (const alt of altWalls) {
                const w = alt.wall
                const baseA = Math.max(0.28, Math.min(w.lengthM - 0.28, w.lengthM * alt.t + offsetAlong * 0.5))
                const aToCx = room.centroid[0] - (w.start[0] + w.ux * baseA)
                const aToCz = room.centroid[1] - (w.start[1] + w.uz * baseA)
                const aSign = aToCx * w.nx + aToCz * w.nz >= 0 ? 1 : -1
                const aInward = w.thicknessM / 2 + Math.min(0.28, spec.dimensionsM[2] / 2)
                const steps = Math.ceil(w.lengthM / 0.25)
                for (let step = 0; step <= steps && !foundClear; step++) {
                  const dirs = step === 0 ? ([0] as const) : ([1, -1] as const)
                  for (const dir of dirs) {
                    const candAlong = baseA + dir * step * 0.25
                    if (candAlong < 0.28 || candAlong > w.lengthM - 0.28) continue
                    const cx = w.start[0] + w.ux * candAlong + w.nx * aSign * aInward
                    const cz = w.start[1] + w.uz * candAlong + w.nz * aSign * aInward
                    if (room.polygon.length >= 3 && !pointInPolygon2D(cx, cz, room.polygon)) {
                      continue
                    }
                    if (!isFixtureSpotBlocked(w, candAlong, cx, cz, 0.24, allowUnderWindow)) {
                      chosenWall = w
                      rot = yawFacingRoom(w, room.centroid)
                      px = cx
                      pz = cz
                      foundClear = true
                      break
                    }
                  }
                }
                if (foundClear) break
              }
            }
            // Pass 3: keep fixture inside room.polygon & off doorways, then nudge off any floor girder
            if (!foundClear) {
              if (
                (room.polygon.length >= 3 && !pointInPolygon2D(px, pz, room.polygon)) ||
                hitsWallOpening(wall.id, alongM, 0.24, allowUnderWindow)
              ) {
                px = room.centroid[0]
                pz = room.centroid[1]
              }
              const [nx, nz] = nudgeOffFloorGirder(px, pz, 0.22, undefined, room.polygon)
              px = nx
              pz = nz
            }
          }
        } else {
          px = room.centroid[0] + (i - (count - 1) / 2) * 0.75
          if (room.polygon.length >= 3 && !pointInPolygon2D(px, pz, room.polygon)) {
            px = room.centroid[0]
            pz = room.centroid[1]
          }
          const [nx, nz] = nudgeOffFloorGirder(px, pz, 0.22, undefined, room.polygon)
          px = nx
          pz = nz
        }
        fixtures.push({
          id: nextFixId(),
          name: `${room.name} ${spec.label}`,
          fixtureKind: kind,
          position: [round2(px), spec.roughInHeightM, round2(pz)],
          rotation: rot,
          roomName: room.name,
          wallId: chosenWall?.id,
          dfu: getFixtureDfu(kind, codeEdition),
          wsfuCold: wsfu.cold,
          wsfuHot: wsfu.hot,
          wsfuTotal: wsfu.total,
          trapSize: spec.minTrapIn,
          drainSize: spec.minDrainIn,
          ventSize: spec.minVentIn,
          supplySize: spec.supplySizeIn,
          hasVacuumBreaker: kind === 'hose-bibb',
          hasPTrap: spec.needsPTrap,
          electricalDemand: getFixtureElectricalDemand(kind),
        })
      }
    }

    // 3. Minimum 2 Frost-Proof Exterior Hose Bibbs (Front & Rear per IPC / best practice)
    // Ground / lowest walled story only: never place exterior frost-proof hose bibbs on upper stories!
    // Always snap flush onto an actual exterior wall segment (never floating in concave L-cutouts or U-courtyards),
    // and keep the hose bibb + cold supply tap (+0.06m X) clear of floor girders, headers, and openings.
    if (isGroundStory) {
      const hoseBibbSpec = FIXTURE_SPECS['hose-bibb']
      const hoseWsfu = getFixtureWsfu('hose-bibb', occupancy)
      const pickClearHoseBibbOnSide = (
        side: 'front' | 'rear',
      ): { position: Vec3; rotation: number; wallId?: string } => {
        const targetZ = side === 'front' ? bounds.maxZ : bounds.minZ
        const defaultZOffset = side === 'front' ? 0.08 : -0.08
        const defaultRot = side === 'front' ? 0 : Math.PI

        const horizCandidates = walls
          .filter((w) => w.lengthM >= 0.6 && Math.abs(w.uz) < 0.35)
          .map((w) => {
            const midZ = (w.start[1] + w.end[1]) / 2
            const onSide = side === 'front' ? midZ >= bounds.cz - 0.1 : midZ <= bounds.cz + 0.1
            return { wall: w, distToTarget: Math.abs(midZ - targetZ), onSide }
          })
          .filter((c) => c.onSide)
          .sort((a, b) => a.distToTarget - b.distToTarget || b.wall.lengthM - a.wall.lengthM)

        const angledFallback = walls
          .filter((w) => w.lengthM >= 0.6)
          .map((w) => {
            const extZ = side === 'front' ? Math.max(w.start[1], w.end[1]) : Math.min(w.start[1], w.end[1])
            return { wall: w, distToTarget: Math.abs(extZ - targetZ) }
          })
          .sort((a, b) => a.distToTarget - b.distToTarget || b.wall.lengthM - a.wall.lengthM)

        const rankedWalls: Array<{ wall: WallSegment2D; distToTarget: number }> = []
        const seenWallIds = new Set<string>()
        for (const c of horizCandidates) {
          if (!seenWallIds.has(c.wall.id)) {
            seenWallIds.add(c.wall.id)
            rankedWalls.push({ wall: c.wall, distToTarget: c.distToTarget })
          }
        }
        for (const c of angledFallback) {
          if (!seenWallIds.has(c.wall.id)) {
            seenWallIds.add(c.wall.id)
            rankedWalls.push({ wall: c.wall, distToTarget: c.distToTarget })
          }
        }

        const resolveOutwardNormal = (w: WallSegment2D): { outNx: number; outNz: number; rot: number } => {
          if (Math.abs(w.uz) < 0.35 && Math.abs(w.nz) > 0.25) {
            const desiredZ = side === 'front' ? 1 : -1
            const sign = w.nz * desiredZ >= 0 ? 1 : -1
            const outNx = w.nx * sign
            const outNz = w.nz * sign
            const rot = Math.abs(outNx) < 1e-3 ? (outNz >= 0 ? 0 : Math.PI) : round2(Math.atan2(outNx, outNz))
            return { outNx, outNz, rot }
          }
          const mx = (w.start[0] + w.end[0]) / 2
          const mz = (w.start[1] + w.end[1]) / 2
          const sign = (mx - bounds.cx) * w.nx + (mz - bounds.cz) * w.nz >= 0 ? 1 : -1
          const outNx = w.nx * sign
          const outNz = w.nz * sign
          return { outNx, outNz, rot: round2(Math.atan2(outNx, outNz)) }
        }

        const isClearAt = (
          x: number,
          z: number,
          w: WallSegment2D | null,
          alongM: number,
          pad: number,
        ): boolean =>
          !hitsFloorBeamXZ(x, z, pad) &&
          !hitsFloorBeamXZ(x + 0.06, z, pad) &&
          !hitsAnyObstacleXZ(x, z, pad * 0.7) &&
          !hitsAnyObstacleXZ(x + 0.06, z, pad * 0.7) &&
          (!w || !hitsWallOpening(w.id, alongM, 0.22, false)) &&
          !hitsAnyWallOpeningXZ(x, z, 0.22, false)

        if (rankedWalls.length > 0) {
          const minDist = rankedWalls[0]!.distToTarget
          const outerBand = rankedWalls.filter((c) => c.distToTarget <= minDist + 0.5).map((c) => c.wall)
          const innerFallback = rankedWalls.filter((c) => c.distToTarget > minDist + 0.5).map((c) => c.wall)

          const sampleWall = (
            w: WallSegment2D,
            pad: number,
          ): { position: Vec3; rotation: number; wallId: string } | null => {
            const { outNx, outNz, rot } = resolveOutwardNormal(w)
            const outOffset = Math.max(0.08, Math.min(0.14, w.thicknessM / 2))
            const margin = Math.min(0.35, w.lengthM * 0.25)
            const projAlong = (bounds.cx - w.start[0]) * w.ux + (targetZ - w.start[1]) * w.uz
            const baseAlong = Math.max(margin, Math.min(w.lengthM - margin, projAlong))
            for (const shift of [0, 0.55, -0.55, 0.95, -0.95, 1.4, -1.4, 2.0, -2.0, 2.6, -2.6]) {
              const candAlong = Math.max(margin, Math.min(w.lengthM - margin, baseAlong + shift))
              const bx = round2(w.start[0] + w.ux * candAlong + outNx * outOffset)
              const bz = round2(w.start[1] + w.uz * candAlong + outNz * outOffset)
              if (isClearAt(bx, bz, w, candAlong, pad)) {
                return {
                  position: [bx, hoseBibbSpec.roughInHeightM, bz],
                  rotation: rot,
                  wallId: w.id,
                }
              }
            }
            return null
          }

          // Prefer outer exterior facade walls before any recessed wall segments
          for (const wallGroup of [outerBand, innerFallback]) {
            for (const pad of [0.30, 0.16]) {
              for (const w of wallGroup) {
                const hit = sampleWall(w, pad)
                if (hit) return hit
              }
            }
          }

          // Guaranteed wall-snapped fallback on the closest exterior wall segment
          const firstWall = outerBand[0] ?? rankedWalls[0]!.wall
          const { outNx, outNz, rot } = resolveOutwardNormal(firstWall)
          const outOffset = Math.max(0.08, Math.min(0.14, firstWall.thicknessM / 2))
          const margin = Math.min(0.35, firstWall.lengthM * 0.25)
          const projAlong = (bounds.cx - firstWall.start[0]) * firstWall.ux + (targetZ - firstWall.start[1]) * firstWall.uz
          const baseAlong = Math.max(margin, Math.min(firstWall.lengthM - margin, projAlong))
          return {
            position: [
              round2(firstWall.start[0] + firstWall.ux * baseAlong + outNx * outOffset),
              hoseBibbSpec.roughInHeightM,
              round2(firstWall.start[1] + firstWall.uz * baseAlong + outNz * outOffset),
            ],
            rotation: rot,
            wallId: firstWall.id,
          }
        }

        // Wall-less scene fallback
        const wallZ = round2(targetZ + defaultZOffset)
        const minX = bounds.minX + 0.35
        const maxX = bounds.maxX - 0.35
        const baseX = bounds.cx
        for (const pad of [0.30, 0.16]) {
          for (const shift of [0, 0.55, -0.55, 0.95, -0.95, 1.4, -1.4, 2.0, -2.0, 2.6, -2.6]) {
            const cx = round2(Math.max(minX, Math.min(maxX, baseX + shift)))
            if (isClearAt(cx, wallZ, null, 0, pad)) {
              return { position: [cx, hoseBibbSpec.roughInHeightM, wallZ], rotation: defaultRot }
            }
          }
        }
        return { position: [round2(baseX), hoseBibbSpec.roughInHeightM, wallZ], rotation: defaultRot }
      }
      const frontBibb = pickClearHoseBibbOnSide('front')
      const rearBibb = pickClearHoseBibbOnSide('rear')
      fixtures.push(
        {
          id: nextFixId(),
          name: 'Exterior Front Hose Bibb (Frost-Proof)',
          fixtureKind: 'hose-bibb',
          position: frontBibb.position,
          rotation: frontBibb.rotation,
          roomName: 'Exterior Front',
          wallId: frontBibb.wallId,
          dfu: 0,
          wsfuCold: hoseWsfu.cold,
          wsfuHot: 0,
          wsfuTotal: hoseWsfu.total,
          trapSize: null,
          drainSize: null,
          ventSize: null,
          supplySize: '1/2"',
          hasVacuumBreaker: true,
          hasPTrap: false,
          electricalDemand: null,
        },
        {
          id: nextFixId(),
          name: 'Exterior Rear Hose Bibb (Frost-Proof)',
          fixtureKind: 'hose-bibb',
          position: rearBibb.position,
          rotation: rearBibb.rotation,
          roomName: 'Exterior Rear',
          wallId: rearBibb.wallId,
          dfu: 0,
          wsfuCold: hoseWsfu.cold,
          wsfuHot: 0,
          wsfuTotal: hoseWsfu.total,
          trapSize: null,
          drainSize: null,
          ventSize: null,
          supplySize: '1/2"',
          hasVacuumBreaker: true,
          hasPTrap: false,
          electricalDemand: null,
        },
      )
    }
  }

  // 4. Place Mechanical Core: Water Entry (PRV + Shutoff), Water Heater, Expansion Tank, PEX Manifold, optional Gas Meter
  // Prefer a dedicated Utility/Garage/Laundry room; when none exists, tuck the mechanical core cleanly into
  // a corner alcove of the wet core (Kitchen/Bath) instead of dropping a water heater in the middle of a Living Room,
  // and stay strictly inside the walled building bounds and clear of floor HVAC / NEC 110.26 panels.
  const dedicatedMechRoom =
    indoorRooms.find((r) => r.category === 'utility' || r.category === 'garage' || r.category === 'laundry') ?? null
  const mechRoom =
    dedicatedMechRoom ??
    indoorRooms.find((r) => r.category === 'kitchen' || r.category === 'commercial-kitchen') ??
    indoorRooms.find((r) => r.category === 'bathroom' || r.category === 'master-bath' || r.category === 'commercial-restroom') ??
    indoorRooms[0] ??
    null

  const crossTradeFloorEquip: Array<{ x: number; z: number; minClearM: number }> = []
  for (const n of Object.values(nodes)) {
    if (!belongsToLevel(nodes, n, levelId)) continue
    if (!Array.isArray(n.position) || n.position.length < 3) continue
    const ny = Number(n.position[1] ?? 0)
    // Ignore attic/roof-mounted HVAC equipment (y >= levelH - 0.1) so floor plumbing can stack neatly below an attic core
    if (n.type === 'hvac:equipment' && ny < levelH - 0.1) {
      crossTradeFloorEquip.push({ x: Number(n.position[0]), z: Number(n.position[2]), minClearM: 1.05 })
    } else if (n.type === 'electrical:panel') {
      crossTradeFloorEquip.push({ x: Number(n.position[0]), z: Number(n.position[2]), minClearM: 1.0 })
    }
  }

  const minClearCrossTrade = (cx: number, cz: number): number => {
    let best = Infinity
    for (const eq of crossTradeFloorEquip) {
      const d = Math.hypot(cx - eq.x, cz - eq.z) - eq.minClearM
      if (d < best) best = d
    }
    for (const f of fixtures) {
      const d = Math.hypot(cx - f.position[0], cz - f.position[2]) - 0.65
      if (d < best) best = d
    }
    return best
  }

  const pickWallTuckedMechCorner = (room: RoomPolygon2D | null): [number, number] => {
    if (!room || room.polygon.length < 3) {
      // When no indoor zone polygons exist, anchor near the first indoor fixture (tucked inward)
      // or cleanly inside the walled building bounds.
      const indoorFix = fixtures.find((f) => f.fixtureKind !== 'hose-bibb')
      if (indoorFix) {
        const nw = nearestWallToPoint(indoorFix.position[0], indoorFix.position[2], walls)
        if (nw) {
          const w = nw.wall
          const toCx = bounds.cx - nw.point[0]
          const toCz = bounds.cz - nw.point[1]
          const sign = toCx * w.nx + toCz * w.nz >= 0 ? 1 : -1
          const [cx, cz] = clampToBoundsXZ(
            nw.point[0] + w.nx * sign * 0.45,
            nw.point[1] + w.nz * sign * 0.45,
            0.25,
          )
          return [cx, cz]
        }
        const [cx, cz] = clampToBoundsXZ(indoorFix.position[0], indoorFix.position[2], 0.25)
        return [cx, cz]
      }
      const [cx, cz] = clampToBoundsXZ(bounds.minX + 0.55, bounds.minZ + 0.55, 0.25)
      return [cx, cz]
    }
    const inset = 0.42
    const candidates: Array<readonly [number, number]> = []
    for (let i = 0; i < room.polygon.length; i++) {
      const a = room.polygon[i]!
      const b = room.polygon[(i + 1) % room.polygon.length]!
      const dxC = room.centroid[0] - a[0]
      const dzC = room.centroid[1] - a[1]
      const lenC = Math.hypot(dxC, dzC)
      if (lenC > inset * 1.1) {
        candidates.push([round2(a[0] + (dxC / lenC) * inset), round2(a[1] + (dzC / lenC) * inset)])
      }
      const mx = (a[0] + b[0]) / 2
      const mz = (a[1] + b[1]) / 2
      const dxM = room.centroid[0] - mx
      const dzM = room.centroid[1] - mz
      const lenM = Math.hypot(dxM, dzM)
      if (lenM > inset * 1.1) {
        candidates.push([round2(mx + (dxM / lenM) * inset), round2(mz + (dzM / lenM) * inset)])
      }
    }
    let best: [number, number] | null = null
    let bestScore = -Infinity
    for (const [cx, cz] of candidates) {
      if (!pointInPolygon2D(cx, cz, room.polygon)) continue
      if (cx < bounds.minX + 0.2 || cx > bounds.maxX - 0.2 || cz < bounds.minZ + 0.2 || cz > bounds.maxZ - 0.2) continue
      const beamPenalty = hitsFloorBeamXZ(cx, cz, 0.35) ? -80 : 40
      const clear = minClearCrossTrade(cx, cz)
      const clearScore = clear >= 0 ? 60 + Math.min(1.5, clear) * 10 : clear * 60
      // Prefer exterior wall corners for short water-entry / condensate / flue runs
      const extDist = Math.min(
        Math.abs(cx - bounds.minX),
        Math.abs(bounds.maxX - cx),
        Math.abs(cz - bounds.minZ),
        Math.abs(bounds.maxZ - cz),
      )
      const score = beamPenalty + clearScore - extDist * 2.5
      if (score > bestScore) {
        bestScore = score
        best = [cx, cz]
      }
    }
    if (best) return best
    const [fx, fz] = clampToBoundsXZ(room.centroid[0], room.centroid[1], 0.2)
    return [fx, fz]
  }

  const mechNudgeShifts: ReadonlyArray<number> = [0.55, -0.55, 0.95, -0.95]

  const [cornerWhX, cornerWhZ] = pickWallTuckedMechCorner(mechRoom)
  let whPos: Vec3 = [cornerWhX, 0, cornerWhZ]
  if (bones?.waterHeaterAnchor) {
    const resolved = resolveBonesAnchorPosition(nodes, bones.waterHeaterAnchor, 0)
    if (resolved) {
      whPos = [round2(resolved[0]), 0, round2(resolved[2])]
      bonesAnchorsUsed.push(`water-heater (${bones.waterHeaterAnchor.nodeId})`)
    }
  } else {
    const [nx, nz] = nudgeOffFloorGirder(whPos[0], whPos[2], 0.35, mechNudgeShifts, mechRoom?.polygon)
    const [cx, cz] = clampToBoundsXZ(nx, nz, 0.15)
    whPos = [cx, 0, cz]
  }

  let waterEntryPos: Vec3 = [round2(bounds.minX + 0.15), 0.75, round2(whPos[2])]
  if (emitMainShutoff) {
    if (bones?.waterEntryAnchor) {
      const resolved = resolveBonesAnchorPosition(nodes, bones.waterEntryAnchor, 0.75)
      if (resolved) {
        waterEntryPos = [round2(resolved[0]), round2(resolved[1] || 0.75), round2(resolved[2])]
        bonesAnchorsUsed.push(`water-entry (${bones.waterEntryAnchor.nodeId})`)
      }
    } else {
      const [nx, nz] = nudgeOffFloorGirder(waterEntryPos[0], waterEntryPos[2], 0.35, mechNudgeShifts)
      const [ex, ez] = clampToBoundsXZ(nx, nz, 0.15)
      waterEntryPos = [ex, 0.75, ez]
    }
  }

  // Ground-story building sewer exit: snap onto actual East exterior wall span on concave L/U footprints
  // so the horizontal sewer exit never crosses an empty L-cutout, and keep strictly below slab (y <= -0.45m).
  const eastWalls = walls
    .filter((w) => Math.abs(w.start[0] - w.end[0]) < 0.25 && Math.abs(w.end[1] - w.start[1]) >= 0.8)
    .map((w) => ({
      x: (w.start[0] + w.end[0]) / 2,
      minZ: Math.min(w.start[1], w.end[1]),
      maxZ: Math.max(w.start[1], w.end[1]),
    }))
    .sort((a, b) => Math.abs(a.x - bounds.maxX) - Math.abs(b.x - bounds.maxX))
  const eastOuterWall = eastWalls[0] && Math.abs(eastWalls[0].x - bounds.maxX) < 0.5 ? eastWalls[0] : null
  const sewerMinZ = eastOuterWall ? eastOuterWall.minZ + 0.35 : bounds.minZ + 0.35
  const sewerMaxZ = eastOuterWall ? eastOuterWall.maxZ - 0.35 : bounds.maxZ - 0.35
  const sewerBaseZ = sewerMinZ <= sewerMaxZ ? Math.max(sewerMinZ, Math.min(sewerMaxZ, bounds.cz)) : bounds.cz
  let sewerExitZ = round2(sewerBaseZ)
  if (isGroundStory && !bones?.sewerExitAnchor && hitsFloorBeamXZ(bounds.maxX, sewerExitZ, 0.35)) {
    for (const shift of [0.65, -0.65, 1.15, -1.15, 1.75, -1.75]) {
      const cz = round2(Math.max(sewerMinZ, Math.min(sewerMaxZ, sewerBaseZ + shift)))
      if (!hitsFloorBeamXZ(bounds.maxX, cz, 0.35)) {
        sewerExitZ = cz
        break
      }
    }
  }
  let sewerExitPos: Vec3 = [round2(bounds.maxX + 1.2), foundationType === 'slab' ? -0.55 : -0.45, sewerExitZ]
  if (isGroundStory && bones?.sewerExitAnchor) {
    const resolved = resolveBonesAnchorPosition(nodes, bones.sewerExitAnchor, -0.45)
    if (resolved) {
      sewerExitPos = [round2(resolved[0]), foundationType === 'slab' ? -0.55 : -0.45, round2(resolved[2])]
      bonesAnchorsUsed.push(`sewer-exit (${bones.sewerExitAnchor.nodeId})`)
    }
  }

  const wcCount = fixtures.filter((f) => f.fixtureKind === 'water-closet').length
  const totalDfu = fixtures.reduce((s, f) => s + f.dfu, 0)
  const totalWsfu = fixtures.reduce((s, f) => s + f.wsfuTotal, 0)
  const whFuel =
    waterHeaterKind === 'water-heater-tank-gas'
      ? 'gas'
      : waterHeaterKind === 'water-heater-tankless-gas'
        ? 'tankless-gas'
        : waterHeaterKind === 'water-heater-hpwh'
          ? 'hpwh'
          : 'electric'
  const whSizing = sizeWaterHeater({
    bathrooms: Math.max(1, wcCount),
    bedrooms: Math.max(2, wcCount + 1),
    occupancy,
    fuelType: whFuel,
  })

  let waterEntryId: string | undefined
  if (emitMainShutoff) {
    waterEntryId = nextEqId()
    equipment.push({
      id: waterEntryId,
      name: 'Main Water Shutoff, PRV & Check Valve',
      equipmentKind: 'main-shutoff-prv',
      position: waterEntryPos,
      rotation: 0,
      roomName: mechRoom?.name ?? 'Utility',
      electricalDemand: null,
    })
  }

  let whId: string | undefined
  if (emitWaterHeater) {
    whId = nextEqId()
    equipment.push({
      id: whId,
      name:
        waterHeaterKind === 'water-heater-tankless-gas'
          ? `Tankless Gas Water Heater (${whSizing.recommendedTanklessGpm} GPM)`
          : waterHeaterKind === 'water-heater-hpwh'
            ? `Hybrid Heat Pump Water Heater (${whSizing.recommendedTankGal} gal)`
            : `${whFuel === 'gas' ? 'Gas' : 'Electric'} Water Heater (${whSizing.recommendedTankGal} gal)`,
      equipmentKind: waterHeaterKind,
      position: whPos,
      rotation: 0,
      roomName: mechRoom?.name ?? 'Utility',
      capacityGal: waterHeaterKind === 'water-heater-tankless-gas' ? 0 : whSizing.recommendedTankGal,
      gasBtuh: whSizing.gasBtuh,
      watts: whSizing.electricalLoadWatts,
      hasDrainPan: true,
      hasTpDischarge: true,
      hasExpansionTank: true,
      electricalDemand: getEquipmentElectricalDemand(waterHeaterKind, whSizing.electricalLoadWatts),
    })
  }

  const pickInwardDir = (distM: number): readonly [number, number] => {
    const dirs: ReadonlyArray<readonly [number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    for (const [dx, dz] of dirs) {
      const tx = round2(whPos[0] + dx * distM)
      const tz = round2(whPos[2] + dz * distM)
      const inBounds =
        tx >= bounds.minX + 0.15 &&
        tx <= bounds.maxX - 0.15 &&
        tz >= bounds.minZ + 0.15 &&
        tz <= bounds.maxZ - 0.15
      if (!inBounds) continue
      if (!mechRoom || pointInPolygon2D(tx, tz, mechRoom.polygon)) {
        return [dx, dz]
      }
    }
    for (const [dx, dz] of dirs) {
      const tx = round2(whPos[0] + dx * distM)
      const tz = round2(whPos[2] + dz * distM)
      if (
        tx >= bounds.minX + 0.15 &&
        tx <= bounds.maxX - 0.15 &&
        tz >= bounds.minZ + 0.15 &&
        tz <= bounds.maxZ - 0.15
      ) {
        return [dx, dz]
      }
    }
    return [0, 0]
  }
  const [mechDirX, mechDirZ] = pickInwardDir(0.68)

  if (emitWaterHeater) {
    const [expX, expZ] = clampToBoundsXZ(whPos[0] + mechDirX * 0.35, whPos[2] + mechDirZ * 0.35, 0.15)
    const expTankY = round2(Math.min(1.65, Math.max(1.1, levelH - 0.7)))
    const expTankId = nextEqId()
    equipment.push({
      id: expTankId,
      name: `Thermal Expansion Tank (${whSizing.expansionTankGal} gal, IPC 607.3)`,
      equipmentKind: 'expansion-tank',
      position: [expX, expTankY, expZ],
      rotation: 0,
      roomName: mechRoom?.name ?? 'Utility',
      capacityGal: whSizing.expansionTankGal,
      electricalDemand: null,
    })
  }

  let manifoldId: string | undefined
  const [rawManifoldX, rawManifoldZ] = emitWaterHeater
    ? clampToBoundsXZ(whPos[0] + mechDirX * 0.65, whPos[2] + mechDirZ * 0.65, 0.15)
    : [whPos[0], whPos[2]]
  const [nudgedManX, nudgedManZ] = nudgeOffFloorGirder(
    rawManifoldX,
    rawManifoldZ,
    0.25,
    mechNudgeShifts,
    mechRoom?.polygon,
  )
  const [manX, manZ] = clampToBoundsXZ(nudgedManX, nudgedManZ, 0.15)
  const manifoldPos: Vec3 = [manX, 1.35, manZ]
  if (supplyTopology === 'manifold') {
    manifoldId = nextManId()
    const neededPorts = Math.max(12, Math.ceil((fixtures.length * 1.6) / 6) * 6)
    manifolds.push({
      id: manifoldId,
      name: `PEX Home-Run Manifold (${neededPorts}-Port)`,
      manifoldKind: 'pex-homerun',
      position: manifoldPos,
      rotation: 0,
      portCount: Math.min(36, neededPorts),
      supplyMaterial,
      coverRemoved: false,
    })
  }

  // 5. Route Main Cold Supply Service (ground story) or Interior Supply Risers (upper stories)
  const supplyPlaneY = foundationType === 'slab' ? levelH - 0.25 : -0.16
  const mainColdSized = sizeSupplyPipe({
    wsfu: Math.max(1, totalWsfu),
    material: supplyMaterial,
    isHot: false,
    minSize: '3/4"',
    flushType,
  })
  const totalHotWsfu = round2(fixtures.reduce((s, f) => s + f.wsfuHot, 0))
  const hotMainSized = sizeSupplyPipe({
    wsfu: Math.max(1, totalHotWsfu),
    material: supplyMaterial,
    isHot: true,
    minSize: '3/4"',
    flushType,
  })

  let coldRiserId: string | undefined
  let hotRiserId: string | undefined

  if (emitWaterHeater && whId) {
    const coldSourcePos: Vec3 = emitMainShutoff ? waterEntryPos : [whPos[0], supplyPlaneY, whPos[2]]
    const mainColdRoute = routePressurizedPipeRun({
      from: coldSourcePos,
      to: [whPos[0], 1.55, whPos[2]],
      routingPlaneY: supplyPlaneY,
      nominalSize: mainColdSized.size,
      material: supplyMaterial,
      euclideanInCavity: false,
      obstacles,
      buildingBounds: bounds,
      maxRoofYAt,
      cavityContext,
    })
    pipeRuns.push({
      id: nextPipeId(),
      name: emitMainShutoff
        ? `${mainColdSized.size} Main Cold Water Service`
        : `${mainColdSized.size} Upper-Story Cold Supply Riser`,
      system: 'cold-water',
      material: supplyMaterial,
      nominalSize: mainColdSized.size,
      path: mainColdRoute.path,
      slopeInPerFt: 0,
      dfuLoad: 0,
      wsfuLoad: round2(totalWsfu),
      gasBtuh: 0,
      sourceNodeId: waterEntryId,
      targetNodeId: whId,
      hasCleanout: false,
      hasSedimentTrap: false,
      hasShutoffWithin6Ft: true,
      isHorizontalSanTee: false,
      isMainVentStack: false,
    })

    if (manifoldId) {
      const whToManifoldHot = routePressurizedPipeRun({
        from: [whPos[0] + 0.1, 1.55, whPos[2]],
        to: [manifoldPos[0] - 0.12, manifoldPos[1], manifoldPos[2]],
        routingPlaneY: 1.65,
        nominalSize: hotMainSized.size,
        material: supplyMaterial,
        euclideanInCavity: false,
        obstacles,
        buildingBounds: bounds,
        maxRoofYAt,
        cavityContext,
      })
      pipeRuns.push({
        id: nextPipeId(),
        name: `${hotMainSized.size} Hot Header (WH -> PEX Manifold)`,
        system: 'hot-water',
        material: supplyMaterial,
        nominalSize: hotMainSized.size,
        path: whToManifoldHot.path,
        slopeInPerFt: 0,
        dfuLoad: 0,
        wsfuLoad: totalHotWsfu,
        gasBtuh: 0,
        sourceNodeId: whId,
        targetNodeId: manifoldId,
        hasCleanout: false,
        hasSedimentTrap: false,
        hasShutoffWithin6Ft: true,
        isHorizontalSanTee: false,
        isMainVentStack: false,
      })
    }
  } else {
    // Upper story served by lower-level water heater: tie into vertical interior Cold & Hot supply risers
    // strictly inside the building footprint at the upper-story manifold / wet core.
    const riserAnchorX = manifoldId ? manifoldPos[0] : whPos[0]
    const riserAnchorZ = manifoldId ? manifoldPos[2] : whPos[2]
    const riserTopY = manifoldId ? manifoldPos[1] : 1.45
    const [coldRiserX, coldRiserZ] = clampToBoundsXZ(riserAnchorX + 0.08, riserAnchorZ, 0.15)
    const coldRiserRoute = routePressurizedPipeRun({
      from: [coldRiserX, supplyPlaneY, coldRiserZ],
      to: [coldRiserX, riserTopY, coldRiserZ],
      routingPlaneY: supplyPlaneY,
      nominalSize: mainColdSized.size,
      material: supplyMaterial,
      euclideanInCavity: false,
      obstacles,
      buildingBounds: bounds,
      maxRoofYAt,
      cavityContext,
    })
    coldRiserId = nextPipeId()
    pipeRuns.push({
      id: coldRiserId,
      name: `${mainColdSized.size} Upper-Story Cold Supply Riser`,
      system: 'cold-water',
      material: supplyMaterial,
      nominalSize: mainColdSized.size,
      path: coldRiserRoute.path,
      slopeInPerFt: 0,
      dfuLoad: 0,
      wsfuLoad: round2(totalWsfu),
      gasBtuh: 0,
      targetNodeId: manifoldId,
      hasCleanout: false,
      hasSedimentTrap: false,
      hasShutoffWithin6Ft: true,
      isHorizontalSanTee: false,
      isMainVentStack: false,
    })

    if (totalHotWsfu > 0) {
      const [hotRiserX, hotRiserZ] = clampToBoundsXZ(riserAnchorX - 0.08, riserAnchorZ, 0.15)
      const hotRiserRoute = routePressurizedPipeRun({
        from: [hotRiserX, supplyPlaneY + 0.04, hotRiserZ],
        to: [hotRiserX, riserTopY, hotRiserZ],
        routingPlaneY: supplyPlaneY + 0.04,
        nominalSize: hotMainSized.size,
        material: supplyMaterial,
        euclideanInCavity: false,
        obstacles,
        buildingBounds: bounds,
        maxRoofYAt,
        cavityContext,
      })
      hotRiserId = nextPipeId()
      pipeRuns.push({
        id: hotRiserId,
        name: `${hotMainSized.size} Upper-Story Hot Supply Riser`,
        system: 'hot-water',
        material: supplyMaterial,
        nominalSize: hotMainSized.size,
        path: hotRiserRoute.path,
        slopeInPerFt: 0,
        dfuLoad: 0,
        wsfuLoad: totalHotWsfu,
        gasBtuh: 0,
        targetNodeId: manifoldId,
        hasCleanout: false,
        hasSedimentTrap: false,
        hasShutoffWithin6Ft: true,
        isHorizontalSanTee: false,
        isMainVentStack: false,
      })
    }
  }

  // Trunk-and-branch spine routing: build a sized 3/4"/1" main Cold Trunk and Hot Trunk along the wet-room corridor,
  // then tap short 1/2" branches from the nearest trunk point to each fixture!
  let coldTrunkId: string | undefined
  let hotTrunkId: string | undefined
  let coldTrunkSpine: Vec3[] = []
  let hotTrunkSpine: Vec3[] = []

  const nearestPointOnSpine = (spine: ReadonlyArray<Vec3>, x: number, z: number, fallbackY: number): Vec3 => {
    let bestPt: Vec3 = spine[0] ?? [x, fallbackY, z]
    let bestDist = Infinity
    for (let i = 1; i < spine.length; i++) {
      const a = spine[i - 1]!
      const b = spine[i]!
      const dx = b[0] - a[0]
      const dz = b[2] - a[2]
      const lenSq = dx * dx + dz * dz
      if (lenSq < 1e-4) continue
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / lenSq))
      const px = a[0] + dx * t
      const py = a[1] + (b[1] - a[1]) * t
      const pz = a[2] + dz * t
      const d = Math.hypot(x - px, z - pz)
      if (d < bestDist) {
        bestDist = d
        bestPt = [round2(px), round2(py), round2(pz)]
      }
    }
    return bestPt
  }

  if (supplyTopology === 'trunk-and-branch' && fixtures.length > 0) {
    const supplyFixtures = fixtures.filter((f) => f.supplySize !== null)
    if (supplyFixtures.length > 0) {
      const furthestFix = supplyFixtures.reduce((far, f) => {
        const dFar = Math.hypot(far.position[0] - whPos[0], far.position[2] - whPos[2])
        const dCur = Math.hypot(f.position[0] - whPos[0], f.position[2] - whPos[2])
        return dCur > dFar ? f : far
      }, supplyFixtures[0]!)
      const spineEndX = round2(furthestFix.position[0])
      const spineEndZ = round2(furthestFix.position[2])

      const coldTrunkRoute = routePressurizedPipeRun({
        from: [whPos[0] + 0.08, 1.45, whPos[2]],
        to: [spineEndX, supplyPlaneY, spineEndZ],
        routingPlaneY: supplyPlaneY,
        nominalSize: mainColdSized.size,
        material: supplyMaterial,
        euclideanInCavity: false,
        obstacles,
        buildingBounds: bounds,
        maxRoofYAt,
        cavityContext,
      })
      coldTrunkId = nextPipeId()
      coldTrunkSpine = coldTrunkRoute.path
      pipeRuns.push({
        id: coldTrunkId,
        name: `${mainColdSized.size} Main Cold Distribution Trunk`,
        system: 'cold-water',
        material: supplyMaterial,
        nominalSize: mainColdSized.size,
        path: coldTrunkRoute.path,
        slopeInPerFt: 0,
        dfuLoad: 0,
        wsfuLoad: round2(totalWsfu),
        gasBtuh: 0,
        sourceNodeId: whId ?? coldRiserId,
        hasCleanout: false,
        hasSedimentTrap: false,
        hasShutoffWithin6Ft: true,
        isHorizontalSanTee: false,
        isMainVentStack: false,
      })

      if (totalHotWsfu > 0) {
        const hotTrunkRoute = routePressurizedPipeRun({
          from: [whPos[0] - 0.08, 1.45, whPos[2]],
          to: [spineEndX, supplyPlaneY + 0.04, spineEndZ],
          routingPlaneY: supplyPlaneY + 0.04,
          nominalSize: hotMainSized.size,
          material: supplyMaterial,
          euclideanInCavity: false,
          obstacles,
          buildingBounds: bounds,
          maxRoofYAt,
          cavityContext,
        })
        hotTrunkId = nextPipeId()
        hotTrunkSpine = hotTrunkRoute.path
        pipeRuns.push({
          id: hotTrunkId,
          name: `${hotMainSized.size} Main Hot Distribution Trunk`,
          system: 'hot-water',
          material: supplyMaterial,
          nominalSize: hotMainSized.size,
          path: hotTrunkRoute.path,
          slopeInPerFt: 0,
          dfuLoad: 0,
          wsfuLoad: totalHotWsfu,
          gasBtuh: 0,
          sourceNodeId: whId ?? hotRiserId,
          hasCleanout: false,
          hasSedimentTrap: false,
          hasShutoffWithin6Ft: true,
          isHorizontalSanTee: false,
          isMainVentStack: false,
        })
      }
    }
  }

  // 6. Place Main 3"/4" Vent Stack near Wet-Fixture Centroid & Route Gravity DWV + Re-Vents + Supply
  const drainFixtures = fixtures.filter((f) => f.drainSize !== null)
  const stackX =
    drainFixtures.length > 0
      ? round2(drainFixtures.reduce((s, f) => s + f.position[0], 0) / drainFixtures.length)
      : round2(bounds.cx)
  const stackZ =
    drainFixtures.length > 0
      ? round2(drainFixtures.reduce((s, f) => s + f.position[2], 0) / drainFixtures.length)
      : round2(bounds.cz)

  const buildingDrainSizing = sizeBuildingDrain({
    totalDfu,
    slopeInPerFt: 0.25,
    hasWaterCloset: wcCount > 0,
    waterClosetCount: wcCount,
    codeEdition,
  })
  const mainVentSizing = sizeVentStack({ totalDfu, isMainStack: true })
  const stackPipeRadiusM = getPipeOuterDiameterM(mainVentSizing.recommendedSize, dwvMaterial) / 2

  const canWallFitPipe = (wall: WallSegment2D, pipeSize: PipeNominalSize, pos: Vec3): boolean => {
    const nominalIn = PIPE_NOMINAL_INCHES[pipeSize] ?? 2
    const wallRule = bones?.wallRules.get(wall.id)
    const effectiveThicknessM = resolveEffectiveWallThicknessM(wall.thicknessM, bones, wallRule)
    const decl = evaluatePlacementCandidate(
      [wetWallFitRule],
      {
        kind: 'plumbing:pipe-run',
        system: 'dwv-drain',
        pos,
        nominalSizeIn: nominalIn,
        wallThicknessM: effectiveThicknessM,
      },
      'placement',
    )
    if (!decl.legal) return false
    return checkWetWallPipeFit({
      wallThicknessM: effectiveThicknessM,
      pipeSize,
      material: dwvMaterial,
      isLoadBearing: wallRule?.isLoadBearing ?? false,
    }).fits
  }

  // Prefer a 2x6 wet wall satisfying `irc-r602-6-wet-wall-fit` for the 3"/4" Main DWV Soil & Vent Stack,
  // and guard the vertical stack centerline strictly against ALL NEC 110.26(E) electrical panel dedicated
  // spaces, structural beams/headers/columns, and Pascal door/window openings (IRC R502.8 / R602).
  const wetCapableWalls = walls.filter((w) =>
    canWallFitPipe(w, mainVentSizing.recommendedSize, [stackX, 1.0, stackZ]),
  )
  const stackWallPool = wetCapableWalls.length > 0 ? wetCapableWalls : walls
  const stackNearWall = nearestWallToPoint(stackX, stackZ, stackWallPool)
  let stackPt: readonly [number, number] = stackNearWall
    ? [round2(stackNearWall.point[0]), round2(stackNearWall.point[1])]
    : [stackX, stackZ]
  let stackWallId: string | undefined = stackNearWall?.wall.id

  const electricalDedicatedSpaces = obstacles.filter((o) => o.category === 'electrical-dedicated-space')
  const hitsElectricalDedicatedSpace = (cx: number, cz: number): boolean => {
    if (electricalDedicatedSpaces.length === 0) return false
    const necPad = stackPipeRadiusM + 0.06
    for (const panelSpace of electricalDedicatedSpaces) {
      if (
        cx >= panelSpace.box.minX - necPad &&
        cx <= panelSpace.box.maxX + necPad &&
        cz >= panelSpace.box.minZ - necPad &&
        cz <= panelSpace.box.maxZ + necPad
      ) {
        return true
      }
    }
    return false
  }

  const isStackPointClear = (cx: number, cz: number, wall: WallSegment2D | null, alongM: number, pad: number): boolean => {
    if (hitsElectricalDedicatedSpace(cx, cz)) return false
    if (hitsAnyObstacleXZ(cx, cz, pad)) return false
    if (wall && hitsWallOpening(wall.id, alongM, pad, false)) return false
    if (hitsAnyWallOpeningXZ(cx, cz, Math.min(0.24, pad), false)) return false
    return true
  }

  const initialAlong = stackNearWall ? stackNearWall.wall.lengthM * stackNearWall.t : 0
  if (!isStackPointClear(stackPt[0], stackPt[1], stackNearWall?.wall ?? null, initialAlong, 0.28)) {
    let cleared = false
    const fallbackWalls =
      wetCapableWalls.length > 0 && wetCapableWalls.length < walls.length
        ? [...wetCapableWalls, ...walls.filter((w) => !wetCapableWalls.includes(w))]
        : stackWallPool
    const orderedWalls = fallbackWalls
      .map((w) => {
        const proj = nearestWallToPoint(stackX, stackZ, [w])!
        const isWetCapable = wetCapableWalls.includes(w) ? 0 : 1
        return { wall: w, t: proj.t, dist: proj.distanceM, isWetCapable }
      })
      .sort((a, b) => a.isWetCapable - b.isWetCapable || a.dist - b.dist)

    // Pass 0 (Layer 2 Legal Cavity Piers): prefer a solid king-stud riser pier on a wet wall clear of
    // openings, structural beams, and NEC 110.26(E) electrical panel dedicated spaces.
    if (legalCavityGraph) {
      const pierCandidates: Array<{
        wall: WallSegment2D
        x: number
        z: number
        t: number
        dist: number
        isWetCapable: number
      }> = []
      for (const entry of orderedWalls) {
        const piers = legalCavityGraph.wallRiserPiers.get(entry.wall.id)
        if (!piers || piers.length === 0) continue
        for (const pier of piers) {
          pierCandidates.push({
            wall: entry.wall,
            x: round2(pier.x),
            z: round2(pier.z),
            t: pier.t,
            dist: Math.hypot(pier.x - stackX, pier.z - stackZ),
            isWetCapable: entry.isWetCapable,
          })
        }
      }
      pierCandidates.sort((a, b) => a.isWetCapable - b.isWetCapable || a.dist - b.dist)
      for (const pier of pierCandidates) {
        if (isStackPointClear(pier.x, pier.z, pier.wall, pier.t, 0.24)) {
          stackPt = [pier.x, pier.z]
          stackWallId = pier.wall.id
          cleared = true
          break
        }
      }
    }

    // Pass 1: >= 0.28 m stud-bay clearance from headers/beams/openings/panels; Pass 2: tighter >= 0.15 m clearance
    for (const pad of [0.28, 0.15]) {
      if (cleared) break
      for (const cand of orderedWalls) {
        const w = cand.wall
        if (w.lengthM < 0.45) continue
        const edgeMargin = Math.min(0.24, w.lengthM * 0.2)
        const baseAlong = Math.max(edgeMargin, Math.min(w.lengthM - edgeMargin, w.lengthM * cand.t))
        const maxSteps = Math.ceil(w.lengthM / 0.2)
        for (let step = 0; step <= maxSteps; step++) {
          const dirs = step === 0 ? ([0] as const) : ([1, -1] as const)
          for (const dir of dirs) {
            const along = baseAlong + dir * step * 0.2
            if (along < edgeMargin || along > w.lengthM - edgeMargin) continue
            const cx = round2(w.start[0] + w.ux * along)
            const cz = round2(w.start[1] + w.uz * along)
            if (isStackPointClear(cx, cz, w, along, pad)) {
              stackPt = [cx, cz]
              stackWallId = w.id
              cleared = true
              break
            }
          }
          if (cleared) break
        }
        if (cleared) break
      }
    }

    // Fallback: if every wall on the level is blocked by openings/beams/panels, place an interior pipe chase
    // clear of ALL structural beams, headers, columns, openings, and NEC 110.26(E) dedicated spaces.
    if (!cleared) {
      const [bx, bz] = stackPt
      for (const pad of [0.28, 0.14]) {
        for (const r of [0.35, 0.65, 0.95, 1.35, 1.8, 2.4, 3.2]) {
          const offsets: ReadonlyArray<readonly [number, number]> = [
            [r, 0],
            [-r, 0],
            [0, r],
            [0, -r],
            [r, r],
            [r, -r],
            [-r, r],
            [-r, -r],
          ]
          for (const [dx, dz] of offsets) {
            const cx = round2(bx + dx)
            const cz = round2(bz + dz)
            if (cx < bounds.minX + 0.15 || cx > bounds.maxX - 0.15 || cz < bounds.minZ + 0.15 || cz > bounds.maxZ - 0.15) {
              continue
            }
            if (isStackPointClear(cx, cz, null, 0, pad)) {
              stackPt = [cx, cz]
              stackWallId = undefined
              cleared = true
              break
            }
          }
          if (cleared) break
        }
        if (cleared) break
      }
      if (!cleared) {
        const nudged = nudgeOffFloorGirder(stackPt[0], stackPt[1], 0.35, mechNudgeShifts)
        stackPt = nudged
        stackWallId = undefined
      }
    }
  }

  // Enforce `irc-r602-6-wet-wall-fit` on stack wall tag: never falsely tag a 3"/4" stack inside a 2x4 wall cavity
  if (stackWallId) {
    const chosenStackWall = wallById.get(stackWallId)
    if (
      chosenStackWall &&
      !canWallFitPipe(chosenStackWall, mainVentSizing.recommendedSize, [stackPt[0], 1.0, stackPt[1]])
    ) {
      stackWallId = undefined
    }
  }

  // Allocate stack ID first, route fixture branches to find lowest arrival invert
  // so the Main Building Drain ALWAYS starts at or below every arriving branch drain invert!
  const defaultStackBaseY = foundationType === 'slab' ? -0.45 : -0.34
  const stackId = nextPipeId()
  const mainDrainId = isGroundStory ? nextPipeId() : undefined

  // Route every fixture's DWV branch, Re-Vent, Cold Supply, and Hot Supply
  const supplySourcePos: Vec3 = manifoldId ? manifoldPos : [whPos[0], 1.45, whPos[2]]
  const coldSupplySourceId = manifoldId ?? whId ?? coldRiserId
  const hotSupplySourceId = manifoldId ?? whId ?? hotRiserId
  let furthestHotFixture: PlannedFixtureSpec | null = null
  let maxHotDist = 0
  let minBranchArrivalY = defaultStackBaseY
  const branchPipeRuns: PlannedPipeRunSpec[] = []

  for (const fix of fixtures) {
    const spec = FIXTURE_SPECS[fix.fixtureKind]

    // DWV Drain & Re-Vent
    if (fix.drainSize) {
      const branchSizing = sizeDrainBranch({
        dfu: fix.dfu,
        hasWaterCloset: fix.fixtureKind === 'water-closet',
        minUpstreamSize: fix.drainSize,
        codeEdition,
      })
      const branchStartY = foundationType === 'slab' ? -0.35 : -0.24
      const dwvRoute = routeDwvDrainRun({
        from: fix.position,
        to: [stackPt[0], branchStartY, stackPt[1]],
        nominalSize: branchSizing.recommendedSize,
        material: dwvMaterial,
        foundationType,
        slopeInPerFt: 0.25,
        obstacles,
        buildingBounds: bounds,
        cavityContext,
      })
      const arrivalY = dwvRoute.path[dwvRoute.path.length - 1]?.[1]
      if (typeof arrivalY === 'number' && arrivalY < minBranchArrivalY) {
        minBranchArrivalY = arrivalY
      }
      const trapArmFt = fix.ventSize ? 1.5 : dwvRoute.lengthFt
      // Single-source `irc-r602-6-wet-wall-fit` check: if host wall is <= 0.125 m 2x4 (or too thin for 3" WC branch),
      // omit `wallId` so the 3" drain routes cleanly as an under-slab/chased vertical drop rather than falsely
      // tagging inside a 2x4 stud cavity (preventing IRC R602.6 wet-wall audit errors by construction).
      const hostWallForBranch = fix.wallId ? wallById.get(fix.wallId) : undefined
      const safeDrainWallId =
        hostWallForBranch && canWallFitPipe(hostWallForBranch, branchSizing.recommendedSize, fix.position)
          ? fix.wallId
          : undefined
      branchPipeRuns.push({
        id: nextPipeId(),
        name: `${branchSizing.recommendedSize} DWV Drain (${fix.name})`,
        system: 'dwv-drain',
        material: dwvMaterial,
        nominalSize: branchSizing.recommendedSize,
        path: dwvRoute.path,
        slopeInPerFt: dwvRoute.slopeInPerFt,
        dfuLoad: fix.dfu,
        wsfuLoad: 0,
        gasBtuh: 0,
        sourceNodeId: fix.id,
        targetNodeId: stackId,
        hasCleanout: false,
        hasSedimentTrap: false,
        hasShutoffWithin6Ft: false,
        isHorizontalSanTee: false,
        isMainVentStack: false,
        trapArmLengthFt: trapArmFt,
        ...(safeDrainWallId !== undefined ? { wallId: safeDrainWallId } : {}),
      })

      if (fix.ventSize) {
        const ventRoute = routeVentRun({
          from: fix.position,
          stackPoint: stackPt,
          floodRimHeightM: spec.floodRimHeightM,
          ceilingHeightM: levelH,
          nominalSize: fix.ventSize,
          material: dwvMaterial,
          obstacles,
          buildingBounds: bounds,
          maxRoofYAt,
          cavityContext,
        })
        const safeVentWallId =
          hostWallForBranch && canWallFitPipe(hostWallForBranch, fix.ventSize, fix.position)
            ? fix.wallId
            : undefined
        branchPipeRuns.push({
          id: nextPipeId(),
          name: `${fix.ventSize} Re-Vent (${fix.name})`,
          system: 'dwv-vent',
          material: dwvMaterial,
          nominalSize: fix.ventSize,
          path: ventRoute.path,
          slopeInPerFt: 0,
          dfuLoad: fix.dfu,
          wsfuLoad: 0,
          gasBtuh: 0,
          sourceNodeId: fix.id,
          targetNodeId: stackId,
          hasCleanout: false,
          hasSedimentTrap: false,
          hasShutoffWithin6Ft: false,
          isHorizontalSanTee: false,
          isMainVentStack: false,
          ...(safeVentWallId !== undefined ? { wallId: safeVentWallId } : {}),
        })
      }
    }

    // Cold Water Supply (velocity-checked; taps nearest trunk spine point in trunk-and-branch mode)
    if (fix.supplySize && fix.wsfuCold > 0) {
      const coldSized = sizeSupplyPipe({
        wsfu: fix.wsfuCold,
        material: supplyMaterial,
        isHot: false,
        minSize: fix.supplySize,
        flushType,
      })
      const coldOrigin: Vec3 =
        supplyTopology === 'trunk-and-branch' && coldTrunkSpine.length >= 2
          ? nearestPointOnSpine(coldTrunkSpine, fix.position[0] + 0.06, fix.position[2], supplyPlaneY)
          : [supplySourcePos[0] + 0.08, supplySourcePos[1], supplySourcePos[2]]
      const coldRoute = routePressurizedPipeRun({
        from: coldOrigin,
        to: [fix.position[0] + 0.06, fix.position[1], fix.position[2]],
        routingPlaneY: supplyPlaneY,
        nominalSize: coldSized.size,
        material: supplyMaterial,
        euclideanInCavity: false,
        obstacles,
        buildingBounds: bounds,
        maxRoofYAt,
        cavityContext,
      })
      branchPipeRuns.push({
        id: nextPipeId(),
        name: `${coldSized.size} Cold ${supplyTopology === 'trunk-and-branch' ? 'Branch' : 'Supply'} (${fix.name})`,
        system: 'cold-water',
        material: supplyMaterial,
        nominalSize: coldSized.size,
        path: coldRoute.path,
        slopeInPerFt: 0,
        dfuLoad: 0,
        wsfuLoad: fix.wsfuCold,
        gasBtuh: 0,
        sourceNodeId: coldTrunkId ?? coldSupplySourceId,
        targetNodeId: fix.id,
        hasCleanout: false,
        hasSedimentTrap: false,
        hasShutoffWithin6Ft: true,
        isHorizontalSanTee: false,
        isMainVentStack: false,
      })
    }

    // Hot Water Supply (velocity-checked; taps nearest trunk spine point in trunk-and-branch mode)
    if (fix.supplySize && fix.wsfuHot > 0) {
      const hotSized = sizeSupplyPipe({
        wsfu: fix.wsfuHot,
        material: supplyMaterial,
        isHot: true,
        minSize: fix.supplySize,
        flushType,
      })
      const hotOrigin: Vec3 =
        supplyTopology === 'trunk-and-branch' && hotTrunkSpine.length >= 2
          ? nearestPointOnSpine(hotTrunkSpine, fix.position[0] - 0.06, fix.position[2], supplyPlaneY + 0.04)
          : [supplySourcePos[0] - 0.08, supplySourcePos[1], supplySourcePos[2]]
      const hotRoute = routePressurizedPipeRun({
        from: hotOrigin,
        to: [fix.position[0] - 0.06, fix.position[1], fix.position[2]],
        routingPlaneY: supplyPlaneY + 0.04,
        nominalSize: hotSized.size,
        material: supplyMaterial,
        euclideanInCavity: false,
        obstacles,
        buildingBounds: bounds,
        maxRoofYAt,
        cavityContext,
      })
      const distFromWh = Math.hypot(fix.position[0] - whPos[0], fix.position[2] - whPos[2])
      if (distFromWh > maxHotDist) {
        maxHotDist = distFromWh
        furthestHotFixture = fix
      }
      branchPipeRuns.push({
        id: nextPipeId(),
        name: `${hotSized.size} Hot ${supplyTopology === 'trunk-and-branch' ? 'Branch' : 'Supply'} (${fix.name})`,
        system: 'hot-water',
        material: supplyMaterial,
        nominalSize: hotSized.size,
        path: hotRoute.path,
        slopeInPerFt: 0,
        dfuLoad: 0,
        wsfuLoad: fix.wsfuHot,
        gasBtuh: 0,
        sourceNodeId: hotTrunkId ?? hotSupplySourceId,
        targetNodeId: fix.id,
        hasCleanout: false,
        hasSedimentTrap: false,
        hasShutoffWithin6Ft: true,
        isHorizontalSanTee: false,
        isMainVentStack: false,
      })
    }
  }

  // Main 3"/4" Soil/Vent Stack (anchored at or below the lowest branch arrival invert -> through roof)
  const stackBaseY = Math.floor(Math.min(defaultStackBaseY, minBranchArrivalY) * 10000) / 10000
  pipeRuns.push({
    id: stackId,
    name: isGroundStory
      ? `${mainVentSizing.recommendedSize} Main DWV Soil & Vent Stack (Through Roof)`
      : `${mainVentSizing.recommendedSize} DWV Soil & Vent Stack Riser`,
    system: 'dwv-vent',
    material: dwvMaterial,
    nominalSize: mainVentSizing.recommendedSize,
    path: [
      [stackPt[0], stackBaseY, stackPt[1]],
      [stackPt[0], round2(levelH + 0.45), stackPt[1]],
    ],
    slopeInPerFt: 0,
    dfuLoad: round2(totalDfu),
    wsfuLoad: 0,
    gasBtuh: 0,
    hasCleanout: true, // Stack-base cleanout per IPC 708.1
    hasSedimentTrap: false,
    hasShutoffWithin6Ft: false,
    isHorizontalSanTee: false,
    isMainVentStack: true,
    wallId: stackWallId,
  })

  // Main Building Drain (Stack Base -> Sewer Exit, 1/4"/ft slope, with cleanout)
  // Ground / lowest walled story only: upper stories discharge strictly into the interior vertical soil stack
  // so no exterior sewer lateral ever juts into mid-air outside upper floors.
  if (isGroundStory && mainDrainId) {
    const mainDrainRoute = routeDwvDrainRun({
      from: [stackPt[0], stackBaseY, stackPt[1]],
      to: sewerExitPos,
      nominalSize: buildingDrainSizing.recommendedSize,
      material: dwvMaterial,
      foundationType,
      slopeInPerFt: 0.25,
      obstacles,
    })
    pipeRuns.push({
      id: mainDrainId,
      name: `${buildingDrainSizing.recommendedSize} Main Building Drain (${totalDfu} DFU -> Sewer Exit)`,
      system: 'dwv-drain',
      material: dwvMaterial,
      nominalSize: buildingDrainSizing.recommendedSize,
      path: mainDrainRoute.path,
      slopeInPerFt: mainDrainRoute.slopeInPerFt,
      dfuLoad: round2(totalDfu),
      wsfuLoad: 0,
      gasBtuh: 0,
      sourceNodeId: stackId,
      hasCleanout: true,
      hasSedimentTrap: false,
      hasShutoffWithin6Ft: false,
      isHorizontalSanTee: false,
      isMainVentStack: false,
    })
  }
  pipeRuns.push(...branchPipeRuns)

  // 7. Optional Hot Water Recirculation Return Loop (for long hot runs > 40 ft or when requested)
  if (includeHotRecirc && emitWaterHeater && furthestHotFixture) {
    const recircId = nextEqId()
    const rawRecircX = whPos[0] - 0.35 >= bounds.minX + 0.15 ? whPos[0] - 0.35 : whPos[0] + mechDirX * 0.35
    const rawRecircZ = whPos[0] - 0.35 >= bounds.minX + 0.15 ? whPos[2] : whPos[2] + mechDirZ * 0.35
    const [recX, recZ] = clampToBoundsXZ(rawRecircX, rawRecircZ, 0.15)
    const recircPos: Vec3 = [recX, 1.25, recZ]
    equipment.push({
      id: recircId,
      name: 'Hot Water Recirculation Pump',
      equipmentKind: 'recirc-pump',
      position: recircPos,
      rotation: 0,
      roomName: mechRoom?.name ?? 'Utility',
      electricalDemand: getEquipmentElectricalDemand('recirc-pump'),
    })
    const recircRoute = routePressurizedPipeRun({
      from: furthestHotFixture.position,
      to: recircPos,
      routingPlaneY: supplyPlaneY + 0.08,
      nominalSize: '1/2"',
      material: supplyMaterial,
      euclideanInCavity: false,
      obstacles,
      buildingBounds: bounds,
      maxRoofYAt,
      cavityContext,
    })
    pipeRuns.push({
      id: nextPipeId(),
      name: `1/2" Hot Recirculation Return (${furthestHotFixture.name})`,
      system: 'hot-recirc',
      material: supplyMaterial,
      nominalSize: '1/2"',
      path: recircRoute.path,
      slopeInPerFt: 0,
      dfuLoad: 0,
      wsfuLoad: 0,
      gasBtuh: 0,
      sourceNodeId: furthestHotFixture.id,
      targetNodeId: recircId,
      hasCleanout: false,
      hasSedimentTrap: false,
      hasShutoffWithin6Ft: true,
      isHorizontalSanTee: false,
      isMainVentStack: false,
    })
  }

  // 8. Optional IFGC Fuel Gas Distribution (only route to actual gas appliances/furnaces; never into electric/HPWH WH!)
  const gasTargets: Array<{ id: string; name: string; pos: Vec3; btuh: number }> = [
    ...(emitWaterHeater && whId && hasGasWaterHeater && whSizing.gasBtuh > 0
      ? [{ id: whId, name: 'Gas Water Heater', pos: [whPos[0], 0.65, whPos[2]] as Vec3, btuh: whSizing.gasBtuh }]
      : []),
    ...sceneGasAppliances,
  ]
  if (includeFuelGas && gasTargets.length > 0) {
    let gasSourcePos: Vec3 = [whPos[0], supplyPlaneY - 0.06, whPos[2]]
    let gasSourceId: string | undefined
    if (isGroundStory) {
      const rawGasMeterZ = whPos[2] + 0.8 <= bounds.maxZ - 0.15 ? whPos[2] + 0.8 : whPos[2] - 0.8
      const [, gasMeterZ] = clampToBoundsXZ(bounds.minX, rawGasMeterZ, 0.15)
      gasSourcePos = [round2(bounds.minX - 0.15), 0.9, gasMeterZ]
      gasSourceId = nextEqId()
      const totalGasBtuh = gasTargets.reduce((sum, t) => sum + t.btuh, 0)
      equipment.push({
        id: gasSourceId,
        name: `Natural Gas Meter (${Math.round(totalGasBtuh / 1000)} kBTU/hr)`,
        equipmentKind: 'gas-meter',
        position: gasSourcePos,
        rotation: 0,
        roomName: 'Exterior',
        gasBtuh: 0, // Supply meter, not an appliance load (prevents double-counting appliance BTU/hr)
        electricalDemand: null,
      })
    }
    for (const target of gasTargets) {
      const prelimGasSizing = sizeFuelGasPipe({
        totalBtuh: target.btuh,
        longestRunFt: 40,
        material: 'black-iron',
      })
      const gasRoute = routePressurizedPipeRun({
        from: gasSourcePos,
        to: target.pos,
        routingPlaneY: supplyPlaneY - 0.06,
        nominalSize: prelimGasSizing.recommendedSize,
        material: 'black-iron',
        euclideanInCavity: false,
        obstacles,
        buildingBounds: bounds,
        maxRoofYAt,
        cavityContext,
      })
      const gasSizing = sizeFuelGasPipe({
        totalBtuh: target.btuh,
        longestRunFt: Math.max(IPC_RULE_THRESHOLDS.fuelGasMinSizingLengthPlacementFt, gasRoute.lengthFt),
        material: 'black-iron',
      })
      pipeRuns.push({
        id: nextPipeId(),
        name: `${gasSizing.recommendedSize} Fuel Gas Line (${target.name}, ${Math.round(target.btuh / 1000)} kBTU/hr, IFGC 402.4)`,
        system: 'fuel-gas',
        material: 'black-iron',
        nominalSize: gasSizing.recommendedSize,
        path: gasRoute.path,
        slopeInPerFt: 0,
        dfuLoad: 0,
        wsfuLoad: 0,
        gasBtuh: target.btuh,
        sourceNodeId: gasSourceId,
        targetNodeId: target.id,
        hasCleanout: false,
        hasSedimentTrap: true,
        hasShutoffWithin6Ft: true,
        isHorizontalSanTee: false,
        isMainVentStack: false,
      })
    }
  }

  // 9. Optional IRC M1502.4 Rigid 4" Dryer Vent for Clothes Washer / Laundry
  // Evaluates candidate exterior wall exits against `irc-m1502-4-dryer-vent` (<= 35 ft effective length,
  // smooth rigid-aluminum), preferring a clash-free exterior wall exit that satisfies the declarative rule.
  if (includeDryerVent) {
    const washer = fixtures.find((f) => f.fixtureKind === 'clothes-washer')
    if (washer) {
      const dryerOrigin: Vec3 = [washer.position[0], 0.35, washer.position[2]]
      const dryerMaterial: PipeMaterial =
        (IPC_RULE_THRESHOLDS.dryerVentRequiredMaterials[0] as PipeMaterial | undefined) ?? 'rigid-aluminum'
      const exitCandidates: Array<{ distM: number; exitPt: Vec3 }> = (
        [
          { distM: Math.abs(washer.position[0] - bounds.minX), exitPt: [round2(bounds.minX - 0.08), 0.35, washer.position[2]] as Vec3 },
          { distM: Math.abs(bounds.maxX - washer.position[0]), exitPt: [round2(bounds.maxX + 0.08), 0.35, washer.position[2]] as Vec3 },
          { distM: Math.abs(bounds.maxZ - washer.position[2]), exitPt: [washer.position[0], 0.35, round2(bounds.maxZ + 0.08)] as Vec3 },
          { distM: Math.abs(washer.position[2] - bounds.minZ), exitPt: [washer.position[0], 0.35, round2(bounds.minZ - 0.08)] as Vec3 },
        ] satisfies Array<{ distM: number; exitPt: Vec3 }>
      ).sort((a, b) => a.distM - b.distM)

      let bestDryerRoute: {
        path: Vec3[]
        clashes: number
        legal: boolean
        effectiveLengthFt: number
      } | null = null

      for (const cand of exitCandidates) {
        const route = routePressurizedPipeRun({
          from: dryerOrigin,
          to: cand.exitPt,
          routingPlaneY: 0.35,
          nominalSize: '4"',
          material: dryerMaterial,
          euclideanInCavity: false,
          obstacles,
          buildingBounds: bounds,
          maxRoofYAt,
          cavityContext,
          allowedBands: ['under-sill', 'mid-wall', 'overhead-plenum'],
        })
        const { elbows90, elbows45 } = countPathElbows(route.path)
        const check = checkDryerVentRun({ lengthFt: route.lengthFt, elbows90, elbows45 })
        const declEval = evaluatePlacementCandidate(
          [dryerVentRule, dryerVentMaterialRule],
          {
            id: washer.id,
            kind: 'plumbing:pipe-run',
            system: 'dryer-vent',
            material: dryerMaterial,
            pos: cand.exitPt,
            effectiveLengthFt: check.effectiveLengthFt,
          },
          'placement',
        )
        const scored = {
          path: route.path,
          clashes: route.clashes.length,
          legal: declEval.legal,
          effectiveLengthFt: check.effectiveLengthFt,
        }
        if (
          !bestDryerRoute ||
          (scored.legal && !bestDryerRoute.legal) ||
          (scored.legal === bestDryerRoute.legal && scored.clashes < bestDryerRoute.clashes) ||
          (scored.legal === bestDryerRoute.legal &&
            scored.clashes === bestDryerRoute.clashes &&
            scored.effectiveLengthFt < bestDryerRoute.effectiveLengthFt)
        ) {
          bestDryerRoute = scored
        }
        if (scored.legal && scored.clashes === 0 && cand.distM === exitCandidates[0]!.distM) {
          break
        }
      }

      if (bestDryerRoute) {
        pipeRuns.push({
          id: nextPipeId(),
          name: '4" Rigid Aluminum Dryer Vent (IRC M1502.4)',
          system: 'dryer-vent',
          material: dryerMaterial,
          nominalSize: '4"',
          path: bestDryerRoute.path,
          slopeInPerFt: 0,
          dfuLoad: 0,
          wsfuLoad: 0,
          gasBtuh: 0,
          sourceNodeId: washer.id,
          hasCleanout: false,
          hasSedimentTrap: false,
          hasShutoffWithin6Ft: false,
          isHorizontalSanTee: false,
          isMainVentStack: false,
        })
      }
    }
  }

  const poweredCount =
    equipment.filter((e) => e.electricalDemand?.required).length +
    fixtures.filter((f) => f.electricalDemand?.required).length

  return {
    levelId,
    codeEdition,
    supplyTopology,
    foundationType,
    equipment,
    manifolds,
    fixtures,
    pipeRuns,
    bonesAnchorsUsed,
    summary: `Auto-populated ${fixtures.length} plumbing fixtures (${round2(totalDfu)} DFU / ${round2(totalWsfu)} WSFU), ${equipment.length} equipment unit(s), ${manifolds.length} manifold(s), and ${pipeRuns.length} 3D pipe runs (${poweredCount} powered load(s) tagged for Electrical coordination).`,
  }
}
