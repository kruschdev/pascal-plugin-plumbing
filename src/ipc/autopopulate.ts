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
  type ElectricalPowerDemand,
  type SceneNodeLike,
  type Vec3,
  belongsToLevel,
  extractBonesPlumbingContext,
  getEquipmentElectricalDemand,
  getFixtureElectricalDemand,
  resolveBonesAnchorPosition,
} from './framing-interop'
import {
  type RoomPolygon2D,
  type WallSegment2D,
  extractPlumbingObstacles,
  extractRoomPolygons,
  extractWallSegments,
  nearestWallToPoint,
  pointInPolygon2D,
  resolveLevelHeightM,
  routeDwvDrainRun,
  routePressurizedPipeRun,
  routeVentRun,
} from './routing'
import { sizeBuildingDrain, sizeDrainBranch, sizeFuelGasPipe, sizeSupplyPipe, sizeVentStack, sizeWaterHeater } from './sizing'
import {
  type CodeEdition,
  type EquipmentKind,
  FIXTURE_SPECS,
  type FixtureKind,
  type FoundationType,
  type ManifoldKind,
  type OccupancyType,
  type PipeMaterial,
  type PipeNominalSize,
  type PlumbingSystem,
  type SupplyTopology,
  getFixtureDfu,
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
  if (/toilet|water.?closet|\bwc\b/.test(hay)) return 'water-closet'
  if (/urinal/.test(hay)) return 'urinal'
  if (/bidet/.test(hay)) return 'bidet'
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
  for (const w of walls) {
    minX = Math.min(minX, w.start[0], w.end[0])
    maxX = Math.max(maxX, w.start[0], w.end[0])
    minZ = Math.min(minZ, w.start[1], w.end[1])
    maxZ = Math.max(maxZ, w.start[1], w.end[1])
  }
  for (const r of rooms) {
    for (const [x, z] of r.polygon) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
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
    includeFuelGas = waterHeaterKind === 'water-heater-tank-gas' ||
      waterHeaterKind === 'water-heater-tankless-gas',
    includeDryerVent = true,
    includeHotRecirc = false,
    bonesMode = 'auto',
  } = options

  const walls = extractWallSegments(nodes, levelId)
  const rooms = extractRoomPolygons(nodes, levelId)
  const levelH = resolveLevelHeightM(nodes, levelId)
  const obstacles = extractPlumbingObstacles(nodes, levelId)
  const bones =
    bonesMode === 'ignore'
      ? null
      : extractBonesPlumbingContext(nodes, levelId)
  const bounds = sceneBounds(walls, rooms)

  const equipment: PlannedEquipmentSpec[] = []
  const manifolds: PlannedManifoldSpec[] = []
  const fixtures: PlannedFixtureSpec[] = []
  const pipeRuns: PlannedPipeRunSpec[] = []
  const bonesAnchorsUsed: string[] = []

  let eqSeq = 1
  let fixSeq = 1
  let pipeSeq = 1
  const nextEqId = () => `plumbeq_auto_${eqSeq++}`
  const nextFixId = () => `plumbfix_auto_${fixSeq++}`
  const nextPipeId = () => `plumbpipe_auto_${pipeSeq++}`

  // 1. Discover placed Pascal fixtures (`item` / `cabinet`) first
  const placedFixtures: Array<{ kind: FixtureKind; pos: Vec3; roomName: string; rot: number; wallId?: string }> = []
  for (const n of Object.values(nodes)) {
    if ((n.type !== 'item' && n.type !== 'cabinet') || !belongsToLevel(nodes, n, levelId)) continue
    const kind = inferFixtureKindFromPascalItem(n)
    if (!kind) continue
    if (!Array.isArray(n.position) || n.position.length < 3) continue
    const px = Number(n.position[0])
    const pz = Number(n.position[2])
    const room = rooms.find((r) => pointInPolygon2D(px, pz, r.polygon))
    const nearWall = nearestWallToPoint(px, pz, walls)
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
  const wetRooms = rooms.filter((r) => defaultFixturesForRoom(r).length > 0)

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

  for (const pf of placedFixtures) {
    const spec = FIXTURE_SPECS[pf.kind]
    fixtures.push({
      id: nextFixId(),
      name: `${pf.roomName} ${spec.label}`,
      fixtureKind: pf.kind,
      position: pf.pos,
      rotation: pf.rot,
      roomName: pf.roomName,
      wallId: pf.wallId,
      dfu: getFixtureDfu(pf.kind, codeEdition),
      wsfuCold: spec.wsfuCold,
      wsfuHot: spec.wsfuHot,
      wsfuTotal: spec.wsfuTotal,
      trapSize: spec.minTrapIn,
      drainSize: spec.minDrainIn,
      ventSize: spec.minVentIn,
      supplySize: spec.supplySizeIn,
      hasVacuumBreaker: pf.kind === 'hose-bibb',
      hasPTrap: spec.needsPTrap,
      electricalDemand: getFixtureElectricalDemand(pf.kind),
    })
  }

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
    const rot = nearWall ? yawFacingRoom(nearWall.wall, room.centroid) : 0
    const count = missing.length

    for (let i = 0; i < count; i++) {
      const kind = missing[i]!
      const spec = FIXTURE_SPECS[kind]
      let px = room.centroid[0]
      let pz = room.centroid[1]
      if (nearWall) {
        const wall = nearWall.wall
        const span = Math.min(wall.lengthM * 0.72, Math.max(0.8, count * 0.65))
        const frac = count === 1 ? 0.5 : i / (count - 1)
        const offsetAlong = (frac - 0.5) * span
        const baseT = Math.max(0.15, Math.min(0.85, nearWall.t))
        const wx = wall.start[0] + wall.ux * (wall.lengthM * baseT + offsetAlong)
        const wz = wall.start[1] + wall.uz * (wall.lengthM * baseT + offsetAlong)
        // Offset slightly into the room from wall centerline
        const toCx = room.centroid[0] - wx
        const toCz = room.centroid[1] - wz
        const dot = toCx * wall.nx + toCz * wall.nz
        const sign = dot >= 0 ? 1 : -1
        const inward = wall.thicknessM / 2 + Math.min(0.28, spec.dimensionsM[2] / 2)
        px = wx + wall.nx * sign * inward
        pz = wz + wall.nz * sign * inward
      } else {
        px = room.centroid[0] + (i - (count - 1) / 2) * 0.75
      }
      fixtures.push({
        id: nextFixId(),
        name: `${room.name} ${spec.label}`,
        fixtureKind: kind,
        position: [round2(px), spec.roughInHeightM, round2(pz)],
        rotation: rot,
        roomName: room.name,
        wallId: nearWall?.wall.id,
        dfu: getFixtureDfu(kind, codeEdition),
        wsfuCold: spec.wsfuCold,
        wsfuHot: spec.wsfuHot,
        wsfuTotal: spec.wsfuTotal,
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
  const hoseBibbSpec = FIXTURE_SPECS['hose-bibb']
  const frontBibbPos: Vec3 = [round2(bounds.cx), hoseBibbSpec.roughInHeightM, round2(bounds.maxZ + 0.08)]
  const rearBibbPos: Vec3 = [round2(bounds.cx), hoseBibbSpec.roughInHeightM, round2(bounds.minZ - 0.08)]
  fixtures.push(
    {
      id: nextFixId(),
      name: 'Exterior Front Hose Bibb (Frost-Proof)',
      fixtureKind: 'hose-bibb',
      position: frontBibbPos,
      rotation: 0,
      roomName: 'Exterior Front',
      dfu: 0,
      wsfuCold: hoseBibbSpec.wsfuCold,
      wsfuHot: 0,
      wsfuTotal: hoseBibbSpec.wsfuTotal,
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
      position: rearBibbPos,
      rotation: Math.PI,
      roomName: 'Exterior Rear',
      dfu: 0,
      wsfuCold: hoseBibbSpec.wsfuCold,
      wsfuHot: 0,
      wsfuTotal: hoseBibbSpec.wsfuTotal,
      trapSize: null,
      drainSize: null,
      ventSize: null,
      supplySize: '1/2"',
      hasVacuumBreaker: true,
      hasPTrap: false,
      electricalDemand: null,
    },
  )

  // 4. Place Mechanical Core: Water Entry (PRV + Shutoff), Water Heater, Expansion Tank, PEX Manifold, optional Gas Meter
  const mechRoom =
    rooms.find((r) => r.category === 'utility' || r.category === 'garage' || r.category === 'laundry') ??
    rooms[0] ??
    null

  let whPos: Vec3 = mechRoom
    ? [round2(mechRoom.centroid[0]), 0, round2(mechRoom.centroid[1])]
    : [round2(bounds.minX + 0.75), 0, round2(bounds.minZ + 0.75)]
  if (bones?.waterHeaterAnchor) {
    const resolved = resolveBonesAnchorPosition(nodes, bones.waterHeaterAnchor, 0)
    if (resolved) {
      whPos = [round2(resolved[0]), 0, round2(resolved[2])]
      bonesAnchorsUsed.push(`water-heater (${bones.waterHeaterAnchor.nodeId})`)
    }
  }

  let waterEntryPos: Vec3 = [round2(bounds.minX + 0.15), 0.75, round2(whPos[2])]
  if (bones?.waterEntryAnchor) {
    const resolved = resolveBonesAnchorPosition(nodes, bones.waterEntryAnchor, 0.75)
    if (resolved) {
      waterEntryPos = [round2(resolved[0]), round2(resolved[1] || 0.75), round2(resolved[2])]
      bonesAnchorsUsed.push(`water-entry (${bones.waterEntryAnchor.nodeId})`)
    }
  }

  let sewerExitPos: Vec3 = [round2(bounds.maxX + 0.2), foundationType === 'slab' ? -0.55 : -0.45, round2(bounds.cz)]
  if (bones?.sewerExitAnchor) {
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

  const waterEntryId = nextEqId()
  equipment.push({
    id: waterEntryId,
    name: 'Main Water Shutoff, PRV & Check Valve',
    equipmentKind: 'main-shutoff-prv',
    position: waterEntryPos,
    rotation: 0,
    roomName: mechRoom?.name ?? 'Utility',
    electricalDemand: null,
  })

  const whId = nextEqId()
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

  const expTankId = nextEqId()
  equipment.push({
    id: expTankId,
    name: `Thermal Expansion Tank (${whSizing.expansionTankGal} gal, IPC 607.3)`,
    equipmentKind: 'expansion-tank',
    position: [round2(whPos[0] + 0.35), 1.65, round2(whPos[2])],
    rotation: 0,
    roomName: mechRoom?.name ?? 'Utility',
    capacityGal: whSizing.expansionTankGal,
    electricalDemand: null,
  })

  let manifoldId: string | undefined
  const manifoldPos: Vec3 = [round2(whPos[0] + 0.65), 1.35, round2(whPos[2])]
  if (supplyTopology === 'manifold') {
    manifoldId = 'plumbman_auto_1'
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

  // 5. Route Main Cold Supply Service (Water Entry -> Water Heater & Manifold) using true hydraulic velocity sizing
  const supplyPlaneY = foundationType === 'slab' ? levelH - 0.25 : -0.16
  const mainColdSized = sizeSupplyPipe({
    wsfu: Math.max(1, totalWsfu),
    material: supplyMaterial,
    isHot: false,
    minSize: '3/4"',
  })
  const mainColdRoute = routePressurizedPipeRun({
    from: waterEntryPos,
    to: [whPos[0], 1.55, whPos[2]],
    routingPlaneY: supplyPlaneY,
    euclideanInCavity: false,
    obstacles,
  })
  pipeRuns.push({
    id: nextPipeId(),
    name: `${mainColdSized.size} Main Cold Water Service`,
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
    const totalHotWsfu = round2(fixtures.reduce((s, f) => s + f.wsfuHot, 0))
    const hotHeaderSized = sizeSupplyPipe({
      wsfu: Math.max(1, totalHotWsfu),
      material: supplyMaterial,
      isHot: true,
      minSize: '3/4"',
    })
    const whToManifoldHot = routePressurizedPipeRun({
      from: [whPos[0] + 0.1, 1.55, whPos[2]],
      to: [manifoldPos[0] - 0.12, manifoldPos[1], manifoldPos[2]],
      routingPlaneY: 1.65,
      euclideanInCavity: false,
      obstacles,
    })
    pipeRuns.push({
      id: nextPipeId(),
      name: `${hotHeaderSized.size} Hot Header (WH -> PEX Manifold)`,
      system: 'hot-water',
      material: supplyMaterial,
      nominalSize: hotHeaderSized.size,
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
  const stackNearWall = nearestWallToPoint(stackX, stackZ, walls)
  const stackPt: readonly [number, number] = stackNearWall
    ? [round2(stackNearWall.point[0]), round2(stackNearWall.point[1])]
    : [stackX, stackZ]

  const buildingDrainSizing = sizeBuildingDrain({
    totalDfu,
    slopeInPerFt: 0.25,
    hasWaterCloset: wcCount > 0,
    waterClosetCount: wcCount,
    codeEdition,
  })
  const mainVentSizing = sizeVentStack({ totalDfu, isMainStack: true })

  // Main 3"/4" Soil/Vent Stack (stack base -> through roof)
  const stackBaseY = foundationType === 'slab' ? -0.45 : -0.34
  const stackId = nextPipeId()
  pipeRuns.push({
    id: stackId,
    name: `${mainVentSizing.recommendedSize} Main DWV Soil & Vent Stack (Through Roof)`,
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
    wallId: stackNearWall?.wall.id,
  })

  // Main Building Drain (Stack Base -> Sewer Exit, 1/4"/ft slope, with cleanout)
  const mainDrainRoute = routeDwvDrainRun({
    from: [stackPt[0], stackBaseY, stackPt[1]],
    to: sewerExitPos,
    nominalSize: buildingDrainSizing.recommendedSize,
    foundationType,
    slopeInPerFt: 0.25,
    obstacles,
  })
  pipeRuns.push({
    id: nextPipeId(),
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

  // Route every fixture's DWV branch, Re-Vent, Cold Supply, and Hot Supply
  const supplySourcePos: Vec3 = manifoldId ? manifoldPos : [whPos[0], 1.45, whPos[2]]
  const supplySourceId = manifoldId ?? whId
  let furthestHotFixture: PlannedFixtureSpec | null = null
  let maxHotDist = 0

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
      const dwvRoute = routeDwvDrainRun({
        from: fix.position,
        to: [stackPt[0], stackBaseY, stackPt[1]],
        nominalSize: branchSizing.recommendedSize,
        foundationType,
        slopeInPerFt: 0.25,
        obstacles,
      })
      pipeRuns.push({
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
        wallId: fix.wallId,
      })

      if (fix.ventSize) {
        const ventRoute = routeVentRun({
          from: fix.position,
          stackPoint: stackPt,
          floodRimHeightM: spec.floodRimHeightM,
          ceilingHeightM: levelH,
          obstacles,
        })
        pipeRuns.push({
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
          wallId: fix.wallId,
        })
      }
    }

    // Cold Water Supply (velocity-checked)
    if (fix.supplySize && fix.wsfuCold > 0) {
      const coldSized = sizeSupplyPipe({
        wsfu: fix.wsfuCold,
        material: supplyMaterial,
        isHot: false,
        minSize: fix.supplySize,
      })
      const coldRoute = routePressurizedPipeRun({
        from: [supplySourcePos[0] + 0.08, supplySourcePos[1], supplySourcePos[2]],
        to: [fix.position[0] + 0.06, fix.position[1], fix.position[2]],
        routingPlaneY: supplyPlaneY,
        euclideanInCavity: supplyTopology === 'manifold',
        obstacles,
      })
      pipeRuns.push({
        id: nextPipeId(),
        name: `${coldSized.size} Cold Supply (${fix.name})`,
        system: 'cold-water',
        material: supplyMaterial,
        nominalSize: coldSized.size,
        path: coldRoute.path,
        slopeInPerFt: 0,
        dfuLoad: 0,
        wsfuLoad: fix.wsfuCold,
        gasBtuh: 0,
        sourceNodeId: supplySourceId,
        targetNodeId: fix.id,
        hasCleanout: false,
        hasSedimentTrap: false,
        hasShutoffWithin6Ft: true,
        isHorizontalSanTee: false,
        isMainVentStack: false,
      })
    }

    // Hot Water Supply (velocity-checked)
    if (fix.supplySize && fix.wsfuHot > 0) {
      const hotSized = sizeSupplyPipe({
        wsfu: fix.wsfuHot,
        material: supplyMaterial,
        isHot: true,
        minSize: fix.supplySize,
      })
      const hotRoute = routePressurizedPipeRun({
        from: [supplySourcePos[0] - 0.08, supplySourcePos[1], supplySourcePos[2]],
        to: [fix.position[0] - 0.06, fix.position[1], fix.position[2]],
        routingPlaneY: supplyPlaneY + 0.04,
        euclideanInCavity: supplyTopology === 'manifold',
        obstacles,
      })
      if (hotRoute.lengthFt > maxHotDist) {
        maxHotDist = hotRoute.lengthFt
        furthestHotFixture = fix
      }
      pipeRuns.push({
        id: nextPipeId(),
        name: `${hotSized.size} Hot Supply (${fix.name})`,
        system: 'hot-water',
        material: supplyMaterial,
        nominalSize: hotSized.size,
        path: hotRoute.path,
        slopeInPerFt: 0,
        dfuLoad: 0,
        wsfuLoad: fix.wsfuHot,
        gasBtuh: 0,
        sourceNodeId: supplySourceId,
        targetNodeId: fix.id,
        hasCleanout: false,
        hasSedimentTrap: false,
        hasShutoffWithin6Ft: true,
        isHorizontalSanTee: false,
        isMainVentStack: false,
      })
    }
  }

  // 7. Optional Hot Water Recirculation Return Loop (for long hot runs > 40 ft or when requested)
  if (includeHotRecirc && furthestHotFixture) {
    const recircId = nextEqId()
    equipment.push({
      id: recircId,
      name: 'Hot Water Recirculation Pump',
      equipmentKind: 'recirc-pump',
      position: [round2(whPos[0] - 0.35), 1.25, round2(whPos[2])],
      rotation: 0,
      roomName: mechRoom?.name ?? 'Utility',
      electricalDemand: getEquipmentElectricalDemand('recirc-pump'),
    })
    const recircRoute = routePressurizedPipeRun({
      from: furthestHotFixture.position,
      to: [round2(whPos[0] - 0.35), 1.25, round2(whPos[2])],
      routingPlaneY: supplyPlaneY + 0.08,
      euclideanInCavity: true,
      obstacles,
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

  // 8. Optional IFGC Fuel Gas Distribution (Gas Meter -> Gas Water Heater)
  if (includeFuelGas) {
    const gasMeterPos: Vec3 = [round2(bounds.minX - 0.15), 0.9, round2(whPos[2] + 0.8)]
    const gasMeterId = nextEqId()
    const totalGasBtuh = Math.max(40000, whSizing.gasBtuh || 40000)
    equipment.push({
      id: gasMeterId,
      name: `Natural Gas Meter (${Math.round(totalGasBtuh / 1000)} kBTU/hr)`,
      equipmentKind: 'gas-meter',
      position: gasMeterPos,
      rotation: 0,
      roomName: 'Exterior',
      gasBtuh: totalGasBtuh,
      electricalDemand: null,
    })
    const gasRoute = routePressurizedPipeRun({
      from: gasMeterPos,
      to: [whPos[0], 0.65, whPos[2]],
      routingPlaneY: supplyPlaneY - 0.06,
      euclideanInCavity: false,
      obstacles,
    })
    const gasSizing = sizeFuelGasPipe({
      totalBtuh: totalGasBtuh,
      longestRunFt: Math.max(15, gasRoute.lengthFt),
      material: 'black-iron',
    })
    pipeRuns.push({
      id: nextPipeId(),
      name: `${gasSizing.recommendedSize} Fuel Gas Line (${Math.round(totalGasBtuh / 1000)} kBTU/hr, IFGC 402.4)`,
      system: 'fuel-gas',
      material: 'black-iron',
      nominalSize: gasSizing.recommendedSize,
      path: gasRoute.path,
      slopeInPerFt: 0,
      dfuLoad: 0,
      wsfuLoad: 0,
      gasBtuh: totalGasBtuh,
      sourceNodeId: gasMeterId,
      targetNodeId: whId,
      hasCleanout: false,
      hasSedimentTrap: true,
      hasShutoffWithin6Ft: true,
      isHorizontalSanTee: false,
      isMainVentStack: false,
    })
  }

  // 9. Optional IRC M1502.4 Rigid 4" Dryer Vent for Clothes Washer / Laundry
  if (includeDryerVent) {
    const washer = fixtures.find((f) => f.fixtureKind === 'clothes-washer')
    if (washer) {
      // Exit straight to closest exterior bound
      const dLeft = Math.abs(washer.position[0] - bounds.minX)
      const dRight = Math.abs(bounds.maxX - washer.position[0])
      const dFront = Math.abs(bounds.maxZ - washer.position[2])
      const dBack = Math.abs(washer.position[2] - bounds.minZ)
      const m = Math.min(dLeft, dRight, dFront, dBack)
      const exitPt: Vec3 =
        m === dLeft
          ? [round2(bounds.minX - 0.08), 0.35, washer.position[2]]
          : m === dRight
            ? [round2(bounds.maxX + 0.08), 0.35, washer.position[2]]
            : m === dFront
              ? [washer.position[0], 0.35, round2(bounds.maxZ + 0.08)]
              : [washer.position[0], 0.35, round2(bounds.minZ - 0.08)]
      const dryerRoute = routePressurizedPipeRun({
        from: [washer.position[0], 0.35, washer.position[2]],
        to: exitPt,
        routingPlaneY: 0.35,
        euclideanInCavity: false,
        obstacles,
      })
      pipeRuns.push({
        id: nextPipeId(),
        name: '4" Rigid Aluminum Dryer Vent (IRC M1502.4)',
        system: 'dryer-vent',
        material: 'rigid-aluminum',
        nominalSize: '4"',
        path: dryerRoute.path,
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
