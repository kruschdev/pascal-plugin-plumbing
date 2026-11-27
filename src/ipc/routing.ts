/**
 * Pure 3D Plumbing Routing Engine (`src/ipc/routing.ts`).
 *
 * Trade-Priority Hierarchy:
 *   1. Structural (`structural:beam`, `structural:column`, `beam`, `column`) - inviolable
 *   2. Plumbing (DWV gravity first, then Hot/Cold supply & Fuel Gas) - FIRST MEP right-of-way
 *   3. HVAC (yields to plumbing)
 *   4. Electrical (yields to plumbing & HVAC; Plumbing respects NEC 110.26(E) overhead panel keep-out)
 *
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import {
  type BuildingAnatomy,
  type CanonicalWall,
  type CavityBand,
  type CavityRouteResult,
  type LegalCavityGraph,
  type OccupancyObstacle,
  type RoutingPhysicsMode,
  TradeOccupancyGrid,
  compileBuildingAnatomy,
  compileLegalCavityGraph,
  compileLevelRoofShell,
  countPathElbows as kernelCountPathElbows,
  extractBaseRoomPolygons,
  extractCanonicalWalls,
  extractTradeOccupancyObstacles,
  pointInPolygon2D as kernelPointInPolygon2D,
  polygonAreaAndCentroid as kernelPolygonAreaAndCentroid,
  polylineHorizontalLengthM as kernelPolylineHorizontalLengthM,
  polylineLengthM as kernelPolylineLengthM,
  resolveLevelHeightM as kernelResolveLevelHeightM,
  routeInLegalCavities,
  segmentIntersectsAabb3,
} from '@kruschdev/pascal-mep-kernel'
import { type SceneNodeLike, type Vec3, belongsToLevel } from './framing-interop'
import { IPC_RULE_THRESHOLDS } from './rules'
import { getMinRequiredDrainSlopeInPerFt } from './sizing'
import {
  type FoundationType,
  METERS_TO_FEET,
  type OccupancyType,
  type PipeMaterial,
  type PipeNominalSize,
  getPipeOuterDiameterM,
  round2,
} from './tables'

export type Aabb3 = {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

export type PlumbingObstacle = {
  id: string
  /** Underlying scene node ID (shared across subdivided `:segN` boxes on diagonal beams). */
  nodeId?: string
  category: 'structural' | 'electrical-dedicated-space'
  /** Structural member role so vertical columns are never treated as under-floor beams to duck beneath. */
  structuralKind?: 'beam' | 'column'
  /** Optional structural beam role (e.g. 'header', 'floor-girder', 'ridge-beam'). */
  beamRole?: string
  label: string
  box: Aabb3
}

export type WallOpeningSpan = {
  id: string
  wallId: string
  kind: 'door' | 'window'
  name: string
  /** Center distance along host wall from `wall.start` toward `wall.end` (meters). */
  uCenterM: number
  /** Rough opening width (meters). */
  widthM: number
  /** Start distance along host wall (meters). */
  startU: number
  /** End distance along host wall (meters). */
  endU: number
  /** Sill height above wall base (meters, 0 for doors). */
  sillYM: number
  /** Head height above wall base (meters). */
  headYM: number
  /** World-space horizontal center of opening along wall centerline. */
  centerX: number
  centerZ: number
}

export type WallSegment2D = {
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
}

export type RoomPolygon2D = {
  id: string
  name: string
  category:
    | 'bathroom'
    | 'master-bath'
    | 'half-bath'
    | 'kitchen'
    | 'laundry'
    | 'utility'
    | 'garage'
    | 'bedroom'
    | 'living'
    | 'exterior'
    | 'commercial-restroom'
    | 'commercial-kitchen'
    | 'other'
  polygon: ReadonlyArray<readonly [number, number]>
  centroid: readonly [number, number]
  areaSqm: number
  areaSqft: number
}

export function polylineLengthM(path: ReadonlyArray<Vec3>): number {
  return kernelPolylineLengthM(path)
}

export function polylineHorizontalLengthM(path: ReadonlyArray<Vec3>): number {
  return kernelPolylineHorizontalLengthM(path)
}

export function countPathElbows(path: ReadonlyArray<Vec3>): { elbows90: number; elbows45: number } {
  return kernelCountPathElbows(path)
}

/**
 * Inspect a DWV drain path to verify monotonic gravity fall (no uphill segments)
 * and compute effective horizontal slope (in/ft).
 */
export function measureDrainPathSlope(path: ReadonlyArray<Vec3>): {
  hasUphillSegment: boolean
  minSegmentSlopeInPerFt: number
  overallSlopeInPerFt: number
  horizontalSegments: number
} {
  let hasUphill = false
  let minSlope = Infinity
  let horizDistM = 0
  let horizDropM = 0
  let horizontalSegments = 0

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const dz = b[2] - a[2]
    const horiz = Math.hypot(dx, dz)
    // Skip near-vertical risers / fixture drops (slope > 45°)
    if (horiz < 0.05 || Math.abs(dy) > horiz * 0.85) {
      // A vertical drop is always downward (dy <= 0); upward vertical on a drain is an error
      if (dy > 0.02) hasUphill = true
      continue
    }
    horizontalSegments += 1
    if (dy > 0.002) {
      hasUphill = true
      minSlope = Math.min(minSlope, -(dy / horiz) * 12)
    } else {
      const slopeInPerFt = (-dy / horiz) * 12
      minSlope = Math.min(minSlope, slopeInPerFt)
      horizDistM += horiz
      horizDropM += -dy
    }
  }

  const overallSlopeInPerFt = horizDistM > 0.05 ? round2((horizDropM / horizDistM) * 12) : 0.25
  return {
    hasUphillSegment: hasUphill,
    minSegmentSlopeInPerFt: horizontalSegments > 0 ? round2(minSlope) : 0.25,
    overallSlopeInPerFt,
    horizontalSegments,
  }
}

const wallSegmentsCache = new WeakMap<
  Readonly<Record<string, SceneNodeLike>>,
  Map<string, WallSegment2D[]>
>()

export function extractWallSegments(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null = null,
): WallSegment2D[] {
  const key = levelId ?? '__all__'
  let byLevel = wallSegmentsCache.get(nodes)
  if (!byLevel) {
    byLevel = new Map()
    wallSegmentsCache.set(nodes, byLevel)
  }
  const cached = byLevel.get(key)
  if (cached) return cached

  const walls: WallSegment2D[] = []
  for (const n of Object.values(nodes)) {
    if (n.type !== 'wall' || !belongsToLevel(nodes, n, levelId)) continue
    if (!Array.isArray(n.start) || !Array.isArray(n.end)) continue
    const sx = Number(n.start[0])
    const sz = Number(n.start[1])
    const ex = Number(n.end[0])
    const ez = Number(n.end[1])
    const len = Math.hypot(ex - sx, ez - sz)
    if (len < 0.1) continue
    const ux = (ex - sx) / len
    const uz = (ez - sz) / len
    walls.push({
      id: n.id,
      start: [sx, sz],
      end: [ex, ez],
      lengthM: len,
      thicknessM: typeof n.thickness === 'number' && n.thickness > 0 ? n.thickness : 0.14,
      heightM: typeof n.height === 'number' && n.height > 0 ? n.height : 2.6,
      ux,
      uz,
      nx: -uz,
      nz: ux,
    })
  }
  byLevel.set(key, walls)
  return walls
}

/**
 * Map pre-extracted `CanonicalWall` openings (filtering walls with `lengthM >= 0.3`)
 * directly into `WallOpeningSpan[]` without re-scanning scene nodes.
 */
export function mapCanonicalWallsToOpenings(
  walls: ReadonlyArray<CanonicalWall>,
): WallOpeningSpan[] {
  const out: WallOpeningSpan[] = []
  for (const wall of walls) {
    if (wall.lengthM < 0.3) continue
    for (const op of wall.openings) {
      out.push({
        id: op.id,
        wallId: op.wallId,
        kind: op.kind,
        name: op.name ?? op.kind,
        uCenterM: op.uCenterM,
        widthM: op.widthM,
        startU: op.startU,
        endU: op.endU,
        sillYM: op.framedSillYM,
        headYM: op.headYM,
        centerX: op.centerX,
        centerZ: op.centerZ,
      })
    }
  }
  return out
}

/**
 * Extract all Pascal `door` and `window` opening spans along walls on a level
 * (handling both native `door`/`window` nodes and wall-attached opening `item` nodes).
 */
export function extractWallOpenings(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null = null,
): WallOpeningSpan[] {
  const walls = extractCanonicalWalls(nodes, levelId, { minLengthM: 0.3 })
  if (walls.length === 0) return []
  return mapCanonicalWallsToOpenings(walls)
}

export function classifyRoomName(
  name: string,
  occupancy: OccupancyType = 'residential',
): RoomPolygon2D['category'] {
  const s = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019`]/g, "'")
  const hasIndoorTerm =
    /bath|shower|restroom|powder|ensuite|en-suite|\bwc\d*\b|toilet|salle\s+de\s+bains?|salle\s+d'eau|salle\s+de\s+douche|\bbad\b|badezimmer|\bbano\b|\bbagno\b|kitchen|cuisine|cocina|cucina|\bkuche\b|\bkueche\b|laundry|buanderie|lavanderia|utility|bedroom|\bchambre\b|living|dining|office/.test(
      s,
    )
  if (
    !hasIndoorTerm &&
    /\bpool\b|swimming|piscine|porch|patio|deck|balcony|yard|lanai|courtyard|garden|driveway|exterior|\bbalcon\b|\bterrasse\b|\bterrace\b|\bterraza\b|\bspawn\b/.test(
      s,
    )
  ) {
    return 'exterior'
  }
  if (/commercial.*restroom|mens|womens|public.*(bath|restroom)/.test(s)) return 'commercial-restroom'
  if (/restroom/.test(s)) return occupancy === 'commercial' ? 'commercial-restroom' : 'bathroom'
  if (/commercial.*kitchen|prep.*kitchen|scullery/.test(s)) return 'commercial-kitchen'
  if (/master.*bath|primary.*bath|ensuite|en-suite/.test(s)) return 'master-bath'
  if (/half.*bath|powder/.test(s)) return 'half-bath'
  if (
    /bath|shower|salle\s+de\s+bains?|salle\s+d'eau|salle\s+de\s+douche|\bbad\b|badezimmer|\bbano\b|cuarto\s+de\s+bano|\bbagno\b/.test(
      s,
    )
  ) {
    return 'bathroom'
  }
  if (/\bwc\d*\b|\btoilettes?\b|\baseo\b/.test(s)) return 'half-bath'
  if (/toilet/.test(s)) return 'bathroom'
  if (/kitchen|pantry|cuisine|cocina|cucina|\bkuche\b|\bkueche\b/.test(s)) return 'kitchen'
  if (/laundry|mudroom|washer|buanderie|waschkuche|waschkueche|lavanderia|hauswirtschaftsraum/.test(s)) {
    return 'laundry'
  }
  if (/utility|mech|boiler|furnace|storage/.test(s)) return 'utility'
  if (/garage|carport/.test(s)) return 'garage'
  if (/bed|nursery|guest|\bchambre\b|schlafzimmer|dormitorio/.test(s)) return 'bedroom'
  if (/living|great|family|dining|office|den|hall|\bsalon\b|\bsejour\b|wohnzimmer|\bbureau\b/.test(s)) return 'living'
  return 'other'
}

export function polygonAreaAndCentroid(
  polygon: ReadonlyArray<readonly [number, number]>,
): { areaSqm: number; centroid: readonly [number, number] } {
  if (polygon.length < 3) return { areaSqm: 0, centroid: [0, 0] }
  const { areaSqM, centroid } = kernelPolygonAreaAndCentroid(polygon)
  return { areaSqm: areaSqM, centroid }
}

export function pointInPolygon2D(
  x: number,
  z: number,
  polygon: ReadonlyArray<readonly [number, number]>,
): boolean {
  return kernelPointInPolygon2D(x, z, polygon)
}

export function extractRoomPolygons(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null = null,
  occupancy: OccupancyType = 'residential',
): RoomPolygon2D[] {
  return extractBaseRoomPolygons(nodes, levelId).map((base) => {
    const classifyText = `${base.rawCategory} ${base.name}`.trim()
    return {
      id: base.id,
      name: base.name,
      category: classifyRoomName(classifyText, occupancy),
      polygon: base.polygon,
      centroid: base.centroid,
      areaSqm: round2(base.areaSqM),
      areaSqft: round2(base.areaSqFt),
    }
  })
}

export function resolveLevelHeightM(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null = null,
): number {
  return kernelResolveLevelHeightM(nodes, levelId)
}

export type BuildingBounds2D = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/**
 * Estimate pitched gable roof soffit/ridge elevation at `(x, z)` over the walled building footprint.
 */
export function estimateGableRoofYAt(
  x: number,
  z: number,
  bounds: BuildingBounds2D,
  wallH: number,
  pitchRiseOver12 = 6,
): number {
  const spanX = bounds.maxX - bounds.minX
  const spanZ = bounds.maxZ - bounds.minZ
  if (spanX <= 0.1 || spanZ <= 0.1) return wallH
  const ridgeAlongX = spanX >= spanZ
  const halfSpan = (ridgeAlongX ? spanZ : spanX) / 2
  const center = ridgeAlongX ? (bounds.minZ + bounds.maxZ) / 2 : (bounds.minX + bounds.maxX) / 2
  const distFromRidge = Math.abs((ridgeAlongX ? z : x) - center)
  const riseM = Math.max(0, halfSpan - distFromRidge) * (pitchRiseOver12 / 12)
  return wallH + riseM
}

/**
 * Build a roof-surface evaluator `roofYAt(x, z)` for plumbing clearance checks on `levelId`.
 * Delegates to `@kruschdev/pascal-mep-kernel`'s `compileLevelRoofShell`, supporting all 7 Pascal
 * roof types (`flat`, `shed`, `gable`, `hip`, `dutch`, `mansard`, `conical`), story-ordinal
 * vertical ordering, spatial wall-less roof-level adoption, `pitch === 0` flat behavior, and
 * lower-story flat `wallH` fallback.
 */
export function buildPlumbingRoofYAt(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null,
  bounds: BuildingBounds2D,
  wallH: number,
  pitchRiseOver12 = 6,
): (x: number, z: number) => number {
  const shell = compileLevelRoofShell(nodes, levelId, wallH, {
    wallBounds: bounds,
    fallbackPitchRiseOver12: pitchRiseOver12,
    clampOverhangToEave: true,
  })
  return shell.roofEnvelopeY
}

/**
 * Map pre-extracted kernel `OccupancyObstacle[]` into `PlumbingObstacle[]`,
 * subdividing diagonal structural beams once into tight AABB segments.
 */
export function mapOccupancyObstaclesToPlumbing(
  kernelObstacles: ReadonlyArray<OccupancyObstacle>,
): PlumbingObstacle[] {
  const obstacles: PlumbingObstacle[] = []

  for (const occ of kernelObstacles) {
    if (occ.kind === 'structural-beam' && occ.prism) {
      const p = occ.prism
      const sx = p.centerX + p.lxMin * p.cos
      const sz = p.centerZ + p.lxMin * p.sin
      const ex = p.centerX + p.lxMax * p.cos
      const ez = p.centerZ + p.lxMax * p.sin
      if (Math.abs(ex - sx) > 0.2 && Math.abs(ez - sz) > 0.2) {
        const halfW = (p.lzMax - p.lzMin) / 2
        const len = p.lxMax - p.lxMin
        const steps = Math.max(2, Math.min(24, Math.ceil(len / 0.6)))
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps
          const t1 = (i + 1) / steps
          const x0 = sx + (ex - sx) * t0
          const z0 = sz + (ez - sz) * t0
          const x1 = sx + (ex - sx) * t1
          const z1 = sz + (ez - sz) * t1
          obstacles.push({
            id: `${occ.id}:seg${i}`,
            nodeId: occ.nodeId,
            category: 'structural',
            structuralKind: 'beam',
            ...(occ.beamRole ? { beamRole: occ.beamRole } : {}),
            label: occ.label,
            box: {
              minX: Math.min(x0, x1) - halfW,
              maxX: Math.max(x0, x1) + halfW,
              minY: p.yMin,
              maxY: p.yMax,
              minZ: Math.min(z0, z1) - halfW,
              maxZ: Math.max(z0, z1) + halfW,
            },
          })
        }
        continue
      }
    }

    const category: PlumbingObstacle['category'] =
      occ.kind === 'electrical-dedicated-space' ? 'electrical-dedicated-space' : 'structural'
    obstacles.push({
      id: occ.id,
      nodeId: occ.nodeId,
      category,
      ...(occ.structuralKind ? { structuralKind: occ.structuralKind } : {}),
      ...(occ.beamRole ? { beamRole: occ.beamRole } : {}),
      label: occ.label,
      box: { ...occ.aabb },
    })
  }

  return obstacles
}

/**
 * Extract Priority #1 Structural obstacles AND NEC 110.26(E) Dedicated Electrical Space columns
 * (footprint of any `electrical:panel` or `electrical:transformer` extending from floor to structural ceiling).
 */
export function extractPlumbingObstacles(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null = null,
): PlumbingObstacle[] {
  const kernelObstacles = extractTradeOccupancyObstacles(nodes, levelId, {
    forTrade: 'plumbing',
  })
  return mapOccupancyObstaclesToPlumbing(kernelObstacles)
}

export function segmentIntersectsAabb(a: Vec3, b: Vec3, box: Aabb3, margin = 0.02): boolean {
  return segmentIntersectsAabb3(a, b, box, margin)
}

export function detectPlumbingClashes(
  path: ReadonlyArray<Vec3>,
  obstacles: ReadonlyArray<PlumbingObstacle>,
  pipeRadiusM = 0.025,
): PlumbingObstacle[] {
  const hits: PlumbingObstacle[] = []
  const seen = new Set<string>()
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    for (const obs of obstacles) {
      const dedupeKey = obs.nodeId ?? obs.id.replace(/:seg\d+$/, '')
      if (seen.has(dedupeKey)) continue
      if (segmentIntersectsAabb(a, b, obs.box, pipeRadiusM + 0.02)) {
        seen.add(dedupeKey)
        hits.push(obs)
      }
    }
  }
  return hits
}

export function nearestWallToPoint(
  x: number,
  z: number,
  walls: ReadonlyArray<WallSegment2D>,
): { wall: WallSegment2D; t: number; point: readonly [number, number]; distanceM: number } | null {
  let best: { wall: WallSegment2D; t: number; point: readonly [number, number]; distanceM: number } | null =
    null
  for (const wall of walls) {
    const dx = x - wall.start[0]
    const dz = z - wall.start[1]
    const rawT = (dx * wall.ux + dz * wall.uz) / wall.lengthM
    const t = Math.max(0.08, Math.min(0.92, rawT))
    const px = wall.start[0] + wall.ux * wall.lengthM * t
    const pz = wall.start[1] + wall.uz * wall.lengthM * t
    const dist = Math.hypot(x - px, z - pz)
    if (!best || dist < best.distanceM) {
      best = { wall, t, point: [px, pz], distanceM: dist }
    }
  }
  return best
}

/**
 * Deduplicate consecutive nearly identical waypoints while preserving 0.1 mm (0.0001 m) elevation precision
 * so 1/4"/ft (2.08%) gravity slopes are never quantized below code minimums even on short horizontal legs.
 */
function cleanPath(pts: Vec3[]): Vec3[] {
  const r4 = (v: number) => Math.round(v * 10000) / 10000
  const out: Vec3[] = []
  for (const p of pts) {
    const prev = out[out.length - 1]
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) > 0.008) {
      out.push([r4(p[0]), r4(p[1]), r4(p[2])])
    }
  }
  return out
}

function isUnderFloorBeamObstacle(o: PlumbingObstacle): boolean {
  return (
    o.category === 'structural' &&
    (o.structuralKind === 'beam' ||
      (!o.structuralKind && !/column/i.test(o.label) && o.box.maxY <= 0.25)) &&
    o.box.minY < 0
  )
}

function isElevatedBeamObstacle(o: PlumbingObstacle): boolean {
  return (
    o.category === 'structural' &&
    (o.structuralKind === 'beam' || o.beamRole === 'header' || /header|beam|ridge/i.test(o.label)) &&
    o.box.maxY > 0.5
  )
}

/**
 * Given a vertical riser/drop at `(x, z)` that collides with one or more obstacles,
 * generate up to `maxCandidates` (default 8) closest lateral `(x', z')` jog positions just outside the colliding AABBs.
 */
function buildLateralEscapeCandidates(
  x: number,
  z: number,
  hits: ReadonlyArray<PlumbingObstacle>,
  clearPad: number,
  maxCandidates = 8,
): Array<readonly [number, number]> {
  const candidates: Array<readonly [number, number, number]> = []
  const seen = new Set<string>()
  const add = (cx: number, cz: number) => {
    const k = `${Math.round(cx * 100)},${Math.round(cz * 100)}`
    if (seen.has(k)) return
    seen.add(k)
    candidates.push([cx, cz, Math.hypot(cx - x, cz - z)])
  }
  for (const obs of hits) {
    // Try shortest escapes along X and Z past the obstacle's jambs / faces
    const leftX = obs.box.minX - clearPad
    const rightX = obs.box.maxX + clearPad
    const backZ = obs.box.minZ - clearPad
    const frontZ = obs.box.maxZ + clearPad
    add(leftX, z)
    add(rightX, z)
    add(x, backZ)
    add(x, frontZ)
    // Also try diagonal corners in case two beams meet at a corner/post
    add(leftX, backZ)
    add(leftX, frontZ)
    add(rightX, backZ)
    add(rightX, frontZ)
  }
  candidates.sort((a, b) => a[2] - b[2])
  return candidates.slice(0, maxCandidates).map(([cx, cz]) => [cx, cz] as const)
}

function resolveAllowedEnvelope(
  buildingBounds: BuildingBounds2D | undefined,
  from: Vec3,
  toXZ: readonly [number, number],
  margin = 0.08,
): BuildingBounds2D | null {
  if (!buildingBounds) return null
  const innerMinX = buildingBounds.minX + margin
  const innerMaxX = buildingBounds.maxX - margin
  const innerMinZ = buildingBounds.minZ + margin
  const innerMaxZ = buildingBounds.maxZ - margin
  return {
    minX: Math.min(innerMinX <= innerMaxX ? innerMinX : buildingBounds.minX, from[0], toXZ[0]),
    maxX: Math.max(innerMinX <= innerMaxX ? innerMaxX : buildingBounds.maxX, from[0], toXZ[0]),
    minZ: Math.min(innerMinZ <= innerMaxZ ? innerMinZ : buildingBounds.minZ, from[2], toXZ[1]),
    maxZ: Math.max(innerMinZ <= innerMaxZ ? innerMaxZ : buildingBounds.maxZ, from[2], toXZ[1]),
  }
}

function exceedsEnvelopeXZ(path: ReadonlyArray<Vec3>, env: BuildingBounds2D | null): boolean {
  if (!env) return false
  for (const p of path) {
    if (p[0] < env.minX - 1e-4 || p[0] > env.maxX + 1e-4 || p[2] < env.minZ - 1e-4 || p[2] > env.maxZ + 1e-4) {
      return true
    }
  }
  return false
}

function minRoofAlongPath(
  path: ReadonlyArray<Vec3>,
  maxRoofYAt?: (x: number, z: number) => number,
): number {
  if (!maxRoofYAt) return Infinity
  let minY = Infinity
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const px = a[0] + (b[0] - a[0]) * f
      const pz = a[2] + (b[2] - a[2]) * f
      const ry = maxRoofYAt(px, pz)
      if (ry < minY) minY = ry
    }
  }
  return minY
}

function exceedsRoofPlane(
  path: ReadonlyArray<Vec3>,
  pipeRadiusM: number,
  maxRoofYAt?: (x: number, z: number) => number,
): boolean {
  if (!maxRoofYAt) return false
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const px = a[0] + (b[0] - a[0]) * f
      const py = a[1] + (b[1] - a[1]) * f
      const pz = a[2] + (b[2] - a[2]) * f
      if (py + pipeRadiusM > maxRoofYAt(px, pz) - 0.08 + 1e-4) return true
    }
  }
  return false
}

/**
 * Generate obstacle-aware horizontal detour waypoint lists around colliding columns/panels/beams.
 */
function buildObstacleDetourWaypoints(
  startXZ: readonly [number, number],
  endXZ: readonly [number, number],
  hits: ReadonlyArray<PlumbingObstacle>,
  edgePad: number,
): Array<Array<readonly [number, number]>> {
  const out: Array<Array<readonly [number, number]>> = []
  const [sx, sz] = startXZ
  const [ex, ez] = endXZ
  for (const obs of hits) {
    const lx = obs.box.minX - edgePad
    const rx = obs.box.maxX + edgePad
    const bz = obs.box.minZ - edgePad
    const fz = obs.box.maxZ + edgePad
    out.push(
      [[lx, sz], [lx, ez], [ex, ez]],
      [[rx, sz], [rx, ez], [ex, ez]],
      [[sx, bz], [ex, bz], [ex, ez]],
      [[sx, fz], [ex, fz], [ex, ez]],
      [[lx, bz], [ex, bz], [ex, ez]],
      [[rx, fz], [ex, fz], [ex, ez]],
      [[lx, fz], [ex, fz], [ex, ez]],
      [[rx, bz], [ex, bz], [ex, ez]],
    )
  }
  return out
}

export type PlumbingCavityContext = {
  /** Pascal scene nodes (used to compile WeakMap-memoized BuildingAnatomy if `anatomy` is omitted). */
  nodes?: Readonly<Record<string, SceneNodeLike>>
  levelId?: string | null
  /** Pre-compiled BuildingAnatomy (optional). */
  anatomy?: BuildingAnatomy
  /** Pre-compiled LegalCavityGraph (optional — compiled on demand if omitted). */
  graph?: LegalCavityGraph
  /** Pre-populated TradeOccupancyGrid (optional — created on demand if omitted). */
  occupancy?: TradeOccupancyGrid
}

export type RoutePlumbingViaLegalCavityParams = PlumbingCavityContext & {
  from: Vec3
  to: Vec3
  mode: RoutingPhysicsMode
  nominalSize?: PipeNominalSize
  material?: PipeMaterial
  pipeRadiusM?: number
  clearanceM?: number
  allowedBands?: readonly CavityBand[]
  /** Gravity drain minimum slope (in/ft) for `'gravity-slope'` mode. */
  minSlopeInPerFt?: number
  /** Fixture flood-level rim (m) for `'non-descending-vent'` mode (IPC 905.5). */
  floodRimHeightM?: number
  /** Minimum elevation (m) for horizontal legs (overrides `floodRimHeightM + 0.1524 m` when higher). */
  minHorizontalElevationM?: number
  /** Clearance below roof surface (m). Default `0.10`. */
  roofClearanceM?: number
  /** Prefer wall cavities over open plenum corridors when true. */
  preferWallFollowing?: boolean
  /** Foundation hint used for default cavity bands and sub-floor elevation. */
  foundationType?: FoundationType
  /** Sub-floor trench elevation (m) when compiling a cavity graph on demand. */
  subFloorElevationM?: number
  /** Optional extra obstacles (reserved into occupancy grid when `occupancy` is not pre-supplied). */
  obstacles?: ReadonlyArray<PlumbingObstacle>
  /** Reserve the resulting run in `occupancy` (`INV-MEP-07`). */
  reserveOnCommit?: boolean
  runId?: string
}

export type PlumbingCavityRouteResult = CavityRouteResult & {
  readonly path: Vec3[]
  readonly lengthFt: number
}

function hasCavityScene(ctx?: PlumbingCavityContext): boolean {
  if (!ctx) return false
  if (ctx.graph && ctx.graph.vertices.length > 0) return true
  if (ctx.anatomy) return true
  if (ctx.nodes && Object.keys(ctx.nodes).length > 0) return true
  return false
}

function exceedsConcaveFootprint(
  path: ReadonlyArray<Vec3>,
  ctx: PlumbingCavityContext | undefined,
  enforce: boolean,
): boolean {
  if (!enforce || !ctx || path.length < 2) return false
  const anatomy = ctx.anatomy ?? (ctx.nodes ? compileBuildingAnatomy(ctx.nodes) : undefined)
  if (!anatomy) return false
  const levelId = ctx.levelId ?? null
  if (anatomy.getWalls(levelId).length === 0) return false
  const footprint = anatomy.getFootprint(levelId)
  // Only enforce concave void exclusion when the level actually has enclosed faces or room polygons
  if (!footprint.boundedFacesComplete && footprint.roomPolygons.length === 0) return false
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    // Sub-slab / underground trenches (y <= 0.05 m) do not float in mid-air over outdoor notches
    if (a[1] <= 0.05 && b[1] <= 0.05) continue
    if (
      !footprint.isSegmentInside(a, b, {
        precedence: 'room-first',
        wallToleranceM: 0.45,
        skipExteriorEndpointMarginM: 0.45,
      })
    ) {
      return true
    }
  }
  return false
}

function isVentPathCodeCompliant(path: ReadonlyArray<Vec3>, minHorizontalY: number): boolean {
  if (path.length < 2) return false
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    // IPC 905.2: dry vent must never descend (zero inverted-U condensate traps)
    if (b[1] < a[1] - 0.002) return false
    // IPC 905.5: horizontal dry vent leg must remain >= 6" above flood-level rim
    const horiz = Math.hypot(b[0] - a[0], b[2] - a[2])
    if (horiz > 0.25 && Math.min(a[1], b[1]) < minHorizontalY - 0.02) return false
  }
  return true
}

const defaultCavityGraphCache = new WeakMap<BuildingAnatomy, Map<string, LegalCavityGraph>>()

function getOrCompileDefaultCavityGraph(
  anatomy: BuildingAnatomy,
  levelId: string | null,
  opts: {
    roofClearanceM: number
    pipeRadiusM: number
    subFloorElevationM: number
  },
): LegalCavityGraph {
  let byKey = defaultCavityGraphCache.get(anatomy)
  if (!byKey) {
    byKey = new Map()
    defaultCavityGraphCache.set(anatomy, byKey)
  }
  const key = `${levelId === null ? '__all__' : JSON.stringify(levelId)}|${opts.subFloorElevationM}|${opts.roofClearanceM}|${opts.pipeRadiusM}`
  let graph = byKey.get(key)
  if (!graph) {
    graph = compileLegalCavityGraph(anatomy, levelId, {
      roofClearanceM: opts.roofClearanceM,
      halfY: opts.pipeRadiusM,
      halfXZ: opts.pipeRadiusM,
      subFloorElevationM: opts.subFloorElevationM,
    })
    byKey.set(key, graph)
  }
  return graph
}

/**
 * Layer 2 — Legal-Space-First Plumbing Cavity Router (`@kruschdev/pascal-mep-kernel/router`).
 *
 * Routes plumbing pipes strictly inside pre-compiled legal building cavities (solid wall stud bays
 * minus 3D door/window prisms, enclosed overhead plenums clamped below 7-type roof surfaces, and
 * under-slab/crawlspace trenches) with strict physics enforcement:
 *   - `'gravity-slope'`: DWV drains with strict monotonic `minSlopeInPerFt` fall (IPC 704.1)
 *   - `'non-descending-vent'`: Dry re-vents obeying IPC 905.5 (`floodRim + 0.1524 m`) & IPC 905.2 (zero inverted-U)
 *   - `'orthogonal' | 'euclidean-cavity'`: Pressurized supply, fuel gas, and dryer vent runs avoiding
 *     structural beams/columns, NEC 110.26(E) dedicated spaces, outdoor voids, and roof surfaces.
 */
export function routePlumbingViaLegalCavity(
  params: RoutePlumbingViaLegalCavityParams,
): PlumbingCavityRouteResult {
  const {
    from,
    to,
    mode,
    nominalSize,
    material = mode === 'gravity-slope' || mode === 'non-descending-vent' ? 'pvc-dwv' : 'pex-a',
    clearanceM = 0.02,
    roofClearanceM = 0.1,
    preferWallFollowing = false,
    foundationType = 'crawlspace',
    obstacles,
    reserveOnCommit,
    runId,
  } = params

  const levelId = params.levelId ?? null
  const anatomy = params.anatomy ?? compileBuildingAnatomy(params.nodes ?? {})
  const pipeRadiusM =
    params.pipeRadiusM ?? (nominalSize ? getPipeOuterDiameterM(nominalSize, material) / 2 : 0.025)

  const defaultSubFloorY =
    params.subFloorElevationM ??
    (mode === 'gravity-slope'
      ? Math.min(foundationType === 'slab' ? -0.35 : -0.24, Math.max(-0.45, Math.min(from[1], to[1])))
      : foundationType === 'slab'
        ? -0.35
        : -0.24)

  const graph =
    params.graph ??
    getOrCompileDefaultCavityGraph(anatomy, levelId, {
      roofClearanceM,
      pipeRadiusM,
      subFloorElevationM: defaultSubFloorY,
    })

  let occupancy = params.occupancy
  if (!occupancy) {
    occupancy = anatomy.createOccupancyGrid(levelId, { forTrade: 'plumbing' })
    if (obstacles && obstacles.length > 0) {
      const existingIds = new Set<string>()
      for (const o of occupancy.obstacles) {
        existingIds.add(o.id)
        existingIds.add(o.nodeId)
      }
      for (const obs of obstacles) {
        const key = obs.nodeId ?? obs.id
        if (existingIds.has(obs.id) || existingIds.has(key)) continue
        occupancy.reserveBox({
          id: obs.id,
          nodeId: key,
          trade: obs.category === 'electrical-dedicated-space' ? 'electrical' : 'structural',
          kind:
            obs.category === 'electrical-dedicated-space'
              ? 'electrical-dedicated-space'
              : obs.structuralKind === 'column'
                ? 'structural-column'
                : 'structural-beam',
          aabb: obs.box,
          clearanceM: 0.02,
          label: obs.label,
        })
      }
    }
  }

  let effectiveTo: Vec3 = to
  let minSlopeInPerFt: number | undefined
  let minHorizontalElevationM: number | undefined = params.minHorizontalElevationM
  let allowedBands: readonly CavityBand[]

  if (mode === 'gravity-slope') {
    minSlopeInPerFt =
      params.minSlopeInPerFt ??
      (nominalSize ? getMinRequiredDrainSlopeInPerFt(nominalSize) : IPC_RULE_THRESHOLDS.drainSlopeSmallInPerFt)
    allowedBands = params.allowedBands ?? ['under-slab', 'crawlspace', 'under-sill', 'mid-wall']
    const allowsSubFloor = allowedBands.includes('under-slab') || allowedBands.includes('crawlspace')
    if (allowsSubFloor && graph.subFloorY !== null && effectiveTo[1] > graph.subFloorY) {
      effectiveTo = [effectiveTo[0], graph.subFloorY, effectiveTo[2]]
    }
  } else if (mode === 'non-descending-vent') {
    const statutoryFloor =
      params.floodRimHeightM !== undefined
        ? params.floodRimHeightM + IPC_RULE_THRESHOLDS.ventMinAboveFloodRimM
        : undefined
    const conservativeFloor =
      statutoryFloor !== undefined
        ? statutoryFloor + IPC_RULE_THRESHOLDS.ventPlacementMarginM
        : undefined
    if (statutoryFloor !== undefined) {
      if (effectiveTo[1] < statutoryFloor) {
        effectiveTo = [effectiveTo[0], statutoryFloor, effectiveTo[2]]
      }
      const targetFloor = Math.max(statutoryFloor, Math.min(effectiveTo[1], conservativeFloor!))
      minHorizontalElevationM =
        minHorizontalElevationM !== undefined ? Math.max(minHorizontalElevationM, targetFloor) : targetFloor
    }
    allowedBands = params.allowedBands ?? ['mid-wall', 'top-plate', 'overhead-plenum', 'attic']
  } else {
    allowedBands =
      params.allowedBands ??
      (foundationType === 'slab'
        ? ['overhead-plenum', 'attic', 'top-plate', 'mid-wall', 'under-sill']
        : ['under-slab', 'crawlspace', 'under-sill', 'mid-wall', 'top-plate', 'overhead-plenum', 'attic'])
  }

  const result = routeInLegalCavities({
    anatomy,
    graph,
    occupancy,
    request: {
      trade: 'plumbing',
      from,
      to: effectiveTo,
      halfXZ: pipeRadiusM,
      halfY: pipeRadiusM,
      clearanceM,
      allowedBands,
      mode,
      ...(minSlopeInPerFt !== undefined ? { minSlopeInPerFt } : {}),
      ...(minHorizontalElevationM !== undefined ? { minHorizontalElevationM } : {}),
      roofClearanceM,
      preferWallFollowing,
      ...(reserveOnCommit !== undefined ? { reserveOnCommit } : {}),
      ...(runId !== undefined ? { runId } : {}),
    },
  })

  const cleanedPath = cleanPath([...result.path])
  return {
    ...result,
    path: cleanedPath,
    lengthFt: round2(polylineLengthM(cleanedPath) * METERS_TO_FEET),
  }
}

/**
 * Route a gravity-sloped DWV branch from a fixture rough-in to a stack/collector point.
 * Guarantees continuous downward fall at >= required IPC slope (1/4"/ft for <= 2.5", 1/8"/ft for >= 3")
 * and automatically detours horizontally around structural columns, beams, and NEC 110.26(E) electrical spaces.
 */
export function routeDwvDrainRun(params: {
  from: Vec3
  to: Vec3
  nominalSize: PipeNominalSize
  material?: PipeMaterial
  pipeRadiusM?: number
  foundationType?: FoundationType
  slopeInPerFt?: 0.125 | 0.25
  obstacles?: ReadonlyArray<PlumbingObstacle>
  buildingBounds?: BuildingBounds2D
  cavityContext?: PlumbingCavityContext
}): {
  path: Vec3[]
  slopeInPerFt: number
  lengthFt: number
  detoured: boolean
  clashes: PlumbingObstacle[]
} {
  const {
    from,
    to,
    nominalSize,
    material = 'pvc-dwv',
    foundationType = 'crawlspace',
    obstacles = [],
    buildingBounds,
    cavityContext,
  } = params
  const minSlope = getMinRequiredDrainSlopeInPerFt(nominalSize)
  const slopeInPerFt = Math.max(params.slopeInPerFt ?? 0.25, minSlope)
  const slopeRatio = slopeInPerFt / 12 // vertical drop per horizontal unit

  const underFloorY = foundationType === 'slab' ? -0.35 : -0.24
  const startY = Math.min(from[1], underFloorY)
  const pipeRadiusM = (params.pipeRadiusM ?? getPipeOuterDiameterM(nominalSize, material) / 2) + 0.015
  const env = resolveAllowedEnvelope(buildingBounds, from, [to[0], to[2]])
  const checkFootprint = Boolean(buildingBounds) && hasCavityScene(cavityContext)

  const buildSlopedCandidate = (
    horizWaypoints: ReadonlyArray<readonly [number, number]>,
    overrideStartY = startY,
    startJog?: readonly [number, number],
  ): Vec3[] => {
    const pts: Vec3[] = [from]
    let curX = from[0]
    let curZ = from[2]
    let curY = overrideStartY
    if (startJog) {
      const jogLen = Math.hypot(startJog[0] - from[0], startJog[1] - from[2])
      const jogY = from[1] - jogLen * slopeRatio
      if (jogLen >= 0.02 && jogY >= overrideStartY + 0.01) {
        pts.push([startJog[0], jogY, startJog[1]])
        curX = startJog[0]
        curZ = startJog[1]
        if (jogY > overrideStartY + 0.02) {
          pts.push([curX, overrideStartY, curZ])
        }
      } else if (from[1] > overrideStartY + 0.02) {
        pts.push([from[0], overrideStartY, from[2]])
      }
    } else if (from[1] > overrideStartY + 0.02) {
      pts.push([from[0], overrideStartY, from[2]])
    }
    for (let i = 0; i < horizWaypoints.length; i++) {
      const [wx, wz] = horizWaypoints[i]!
      const leg = Math.hypot(wx - curX, wz - curZ)
      const isLast = i === horizWaypoints.length - 1
      if (!isLast && leg < 0.15) continue
      curY -= leg * slopeRatio
      const y = isLast ? Math.min(to[1], curY) : curY
      pts.push([wx, y, wz])
      curX = wx
      curZ = wz
      curY = y
    }
    return cleanPath(pts)
  }

  const primary = buildSlopedCandidate([
    [to[0], from[2]],
    [to[0], to[2]],
  ])
  let bestPath = primary
  let bestClashes = detectPlumbingClashes(primary, obstacles, pipeRadiusM)
  let bestBoundsViolation =
    exceedsEnvelopeXZ(primary, env) || exceedsConcaveFootprint(primary, cavityContext, checkFootprint)
  let detoured = false
  let underBeamY: number | null = null

  if (bestClashes.length > 0 || bestBoundsViolation) {
    const tryCandidate = (cand: Vec3[]): boolean => {
      const boundsViol =
        exceedsEnvelopeXZ(cand, env) || exceedsConcaveFootprint(cand, cavityContext, checkFootprint)
      if (boundsViol && !bestBoundsViolation) return false
      const c = detectPlumbingClashes(cand, obstacles, pipeRadiusM)
      const better =
        (bestBoundsViolation && !boundsViol) ||
        (boundsViol === bestBoundsViolation && c.length < bestClashes.length)
      if (better) {
        bestPath = cand
        bestClashes = c
        bestBoundsViolation = boundsViol
        detoured = true
      }
      return bestClashes.length === 0 && !bestBoundsViolation
    }

    // Layer 2 — Legal-Space-First Cavity Candidate (gravity-slope) when scene anatomy/graph is present
    if (hasCavityScene(cavityContext)) {
      const cav = routePlumbingViaLegalCavity({
        ...cavityContext,
        from,
        to: [to[0], Math.min(to[1], underFloorY), to[2]],
        mode: 'gravity-slope',
        nominalSize,
        material,
        pipeRadiusM,
        foundationType,
        minSlopeInPerFt: slopeInPerFt,
        subFloorElevationM: underFloorY,
        obstacles,
      })
      if (cav.path.length >= 2) {
        const cavSlope = measureDrainPathSlope(cav.path)
        if (
          !cavSlope.hasUphillSegment &&
          (cavSlope.horizontalSegments === 0 || cavSlope.minSegmentSlopeInPerFt >= minSlope - 0.02)
        ) {
          tryCandidate(cav.path)
        }
      }
    }

    // Compute safe elevation below colliding (and deepest level) under-floor girders
    const allUnderBeams = obstacles.filter(isUnderFloorBeamObstacle)
    const structuralHits = bestClashes.filter(isUnderFloorBeamObstacle)
    const beamPool = structuralHits.length > 0 ? structuralHits : allUnderBeams
    if (beamPool.length > 0) {
      const lowestMinY = Math.min(...beamPool.map((o) => o.box.minY))
      underBeamY = Math.min(startY - 0.18, lowestMinY - pipeRadiusM - 0.06)
    }
    const allLowestMinY =
      allUnderBeams.length > 0 ? Math.min(...allUnderBeams.map((o) => o.box.minY)) : null
    const allUnderBeamY =
      allLowestMinY !== null ? Math.min(startY - 0.18, allLowestMinY - pipeRadiusM - 0.06) : null

    if ((bestClashes.length > 0 || bestBoundsViolation) && underBeamY !== null) {
      for (const sy of allUnderBeamY !== null && allUnderBeamY < underBeamY - 0.01 ? [underBeamY, allUnderBeamY] : [underBeamY]) {
        for (const wp of [
          [[to[0], from[2]], [to[0], to[2]]] as const,
          [[from[0], to[2]], [to[0], to[2]]] as const,
        ]) {
          if (tryCandidate(buildSlopedCandidate(wp, sy))) break
        }
        if (bestClashes.length === 0 && !bestBoundsViolation) break
      }
    }

    if (bestClashes.length > 0 || bestBoundsViolation) {
      const midX = (from[0] + to[0]) / 2
      const midZ = (from[2] + to[2]) / 2
      const edgePad = pipeRadiusM + 0.08
      const startYs = Array.from(
        new Set(
          [underBeamY, allUnderBeamY, startY].filter((v): v is number => v !== null),
        ),
      )

      // Check if the vertical drop from `from` directly collides with an under-floor girder or column
      // Probe to the deepest candidate startY so deeper beams below underBeamY are never missed.
      const dropProbeY = startYs.length > 0 ? Math.min(...startYs) : startY
      const dropHits =
        from[1] > dropProbeY + 0.02
          ? detectPlumbingClashes([from, [from[0], dropProbeY, from[2]]], obstacles, pipeRadiusM)
          : []
      const startJogs: Array<readonly [number, number] | undefined> = [
        undefined,
        ...(dropHits.length > 0 ? buildLateralEscapeCandidates(from[0], from[2], dropHits, edgePad) : []),
      ]

      const baseCandidates: Array<Array<readonly [number, number]>> = [
        [[to[0], from[2]], [to[0], to[2]]],
        [[from[0], to[2]], [to[0], to[2]]],
        [[to[0], from[2] + 0.55], [to[0], to[2]]],
        [[to[0], from[2] - 0.55], [to[0], to[2]]],
        [[from[0] + 0.55, to[2]], [to[0], to[2]]],
        [[from[0] - 0.55, to[2]], [to[0], to[2]]],
        [[midX + 0.75, from[2] + 0.75], [to[0] + 0.75, to[2]], [to[0], to[2]]],
        [[midX - 0.75, from[2] - 0.75], [to[0] - 0.75, to[2]], [to[0], to[2]]],
        [[to[0] + 0.95, from[2]], [to[0] + 0.95, to[2]], [to[0], to[2]]],
        [[to[0] - 0.95, from[2]], [to[0] - 0.95, to[2]], [to[0], to[2]]],
        [[from[0], to[2] + 0.95], [to[0], to[2] + 0.95], [to[0], to[2]]],
        [[from[0], to[2] - 0.95], [to[0], to[2] - 0.95], [to[0], to[2]]],
        ...buildObstacleDetourWaypoints([from[0], from[2]], [to[0], to[2]], bestClashes, edgePad),
      ]

      for (const jog of startJogs) {
        const jx = jog ? jog[0] : from[0]
        const jz = jog ? jog[1] : from[2]
        const wpList: Array<Array<readonly [number, number]>> = jog
          ? [
              [[to[0], jz], [to[0], to[2]]],
              [[jx, to[2]], [to[0], to[2]]],
              ...buildObstacleDetourWaypoints([jx, jz], [to[0], to[2]], bestClashes, edgePad),
              ...baseCandidates,
            ]
          : baseCandidates
        for (const sy of startYs) {
          for (const wp of wpList) {
            if (tryCandidate(buildSlopedCandidate(wp, sy, jog))) break
          }
          if (bestClashes.length === 0 && !bestBoundsViolation) break
        }
        if (bestClashes.length === 0 && !bestBoundsViolation) break
      }
    }
  }

  return {
    path: bestPath,
    slopeInPerFt,
    lengthFt: round2(polylineLengthM(bestPath) * METERS_TO_FEET),
    detoured,
    clashes: bestClashes,
  }
}

/**
 * Route a dry re-vent from a fixture wet wall up to >= 6" above flood-level rim (IPC 905.5)
 * and horizontally over to the main vent stack, detouring around structural headers, beams,
 * columns, and NEC 110.26(E) obstacles while keeping strictly non-descending elevation (IPC 905.2).
 */
export function routeVentRun(params: {
  from: Vec3
  stackPoint: readonly [number, number]
  floodRimHeightM: number
  ceilingHeightM?: number
  nominalSize?: PipeNominalSize
  material?: PipeMaterial
  pipeRadiusM?: number
  obstacles?: ReadonlyArray<PlumbingObstacle>
  buildingBounds?: BuildingBounds2D
  maxRoofYAt?: (x: number, z: number) => number
  cavityContext?: PlumbingCavityContext
}): {
  path: Vec3[]
  tieInHeightM: number
  lengthFt: number
  detoured: boolean
  clashes: PlumbingObstacle[]
} {
  const {
    from,
    stackPoint,
    floodRimHeightM,
    ceilingHeightM = 2.6,
    nominalSize,
    material = 'pvc-dwv',
    obstacles = [],
    buildingBounds,
    maxRoofYAt,
    cavityContext,
  } = params
  const pipeRadiusM =
    params.pipeRadiusM ?? (nominalSize ? getPipeOuterDiameterM(nominalSize, material) / 2 : 0.03)
  const env = resolveAllowedEnvelope(buildingBounds, from, stackPoint)
  const checkFootprint = Boolean(buildingBounds) && hasCavityScene(cavityContext)
  // IPC 905.5 (from IPC_DECLARATIVE_RULES): horizontal vent tie-in MUST be >= 6" (0.1524 m) above flood-level rim
  const ipcMinVentY = floodRimHeightM + IPC_RULE_THRESHOLDS.ventMinAboveFloodRimM + 0.01
  const minHorizontalVentY = floodRimHeightM + IPC_RULE_THRESHOLDS.ventPlacementMinAboveFloodRimM
  const minTieInY = floodRimHeightM + IPC_RULE_THRESHOLDS.ventMinAboveFloodRimM + 0.1
  const maxSafeCeilingY = ceilingHeightM - 0.08 - pipeRadiusM
  const rawTieInHeightM = Math.max(minTieInY, ceilingHeightM - 0.15)
  const minEndpointRoofCap = maxRoofYAt
    ? Math.min(maxRoofYAt(from[0], from[2]), maxRoofYAt(stackPoint[0], stackPoint[1])) - pipeRadiusM - 0.09
    : Infinity
  const tieInHeightM = Number.isFinite(minEndpointRoofCap)
    ? Math.max(ipcMinVentY, Math.min(rawTieInHeightM, minEndpointRoofCap))
    : rawTieInHeightM

  const buildVentCandidate = (
    waypoints: ReadonlyArray<readonly [number, number]>,
    tieY = tieInHeightM,
    riserJog?: { x: number; z: number; jogY: number },
  ): Vec3[] => {
    // Clamp jog elevation to tieY so dry vents never form an inverted-U condensate trap (IPC 905.2)
    const jy = riserJog ? Math.min(riserJog.jogY, tieY) : tieY
    const pts: Vec3[] = riserJog
      ? [
          from,
          [from[0], jy, from[2]],
          [riserJog.x, jy, riserJog.z],
          ...(tieY > jy + 0.008 ? [[riserJog.x, tieY, riserJog.z] as Vec3] : []),
        ]
      : [from, [from[0], tieY, from[2]]]
    for (const [wx, wz] of waypoints) {
      pts.push([wx, tieY, wz])
    }
    return cleanPath(pts)
  }

  const primary = buildVentCandidate([
    [stackPoint[0], from[2]],
    [stackPoint[0], stackPoint[1]],
  ])
  let bestPath = primary
  let bestClashes = detectPlumbingClashes(primary, obstacles, pipeRadiusM)
  let bestBoundsViolation =
    exceedsEnvelopeXZ(primary, env) || exceedsConcaveFootprint(primary, cavityContext, checkFootprint)
  let bestRoofViolation = exceedsRoofPlane(primary, pipeRadiusM, maxRoofYAt)
  let bestTieInY = tieInHeightM
  let detoured = false

  if (bestClashes.length > 0 || bestBoundsViolation || bestRoofViolation) {
    const tryVent = (cand: Vec3[], tieY: number): boolean => {
      const boundsViol =
        exceedsEnvelopeXZ(cand, env) || exceedsConcaveFootprint(cand, cavityContext, checkFootprint)
      const roofViol = exceedsRoofPlane(cand, pipeRadiusM, maxRoofYAt)
      if (boundsViol && !bestBoundsViolation) return false
      if (roofViol && !bestRoofViolation && boundsViol === bestBoundsViolation) return false
      const c = detectPlumbingClashes(cand, obstacles, pipeRadiusM)
      const better =
        (bestBoundsViolation && !boundsViol) ||
        (boundsViol === bestBoundsViolation && bestRoofViolation && !roofViol) ||
        (boundsViol === bestBoundsViolation && roofViol === bestRoofViolation && c.length < bestClashes.length)
      if (better) {
        bestPath = cand
        bestClashes = c
        bestBoundsViolation = boundsViol
        bestRoofViolation = roofViol
        bestTieInY = tieY
        detoured = true
      }
      return bestClashes.length === 0 && !bestBoundsViolation && !bestRoofViolation
    }

    const edgePad = pipeRadiusM + 0.07
    const maxAtticTieY = ceilingHeightM + 0.36
    const elevatedHits = bestClashes.filter(isElevatedBeamObstacle)
    const allElevatedBeams = obstacles.filter(isElevatedBeamObstacle)

    const primaryMinRoofCap = maxRoofYAt
      ? minRoofAlongPath(primary, maxRoofYAt) - pipeRadiusM - 0.09
      : Infinity
    const altPrimary = buildVentCandidate([
      [from[0], stackPoint[1]],
      [stackPoint[0], stackPoint[1]],
    ])
    const altMinRoofCap = maxRoofYAt
      ? minRoofAlongPath(altPrimary, maxRoofYAt) - pipeRadiusM - 0.09
      : Infinity

    // Candidate attic/upper-wall tie-in elevations:
    // 1. Default tieInHeightM
    // 2. Hop cleanly ABOVE wall headers into ceiling/attic space (while remaining strictly under roof envelope)
    // 3. Duck cleanly BELOW a high ceiling/ridge beam or low/flat explicit roof segment while staying >= 6" above flood rim (IPC 905.5)
    const tieYs: number[] = [tieInHeightM]
    const pushTieY = (y: number, minFloorY = ipcMinVentY) => {
      if (!Number.isFinite(y) || y < minFloorY || y > maxAtticTieY) return
      if (!tieYs.some((v) => Math.abs(v - y) < 0.02)) tieYs.push(y)
    }
    if (elevatedHits.length > 0) {
      const aboveHit = Math.max(...elevatedHits.map((o) => o.box.maxY)) + pipeRadiusM + 0.05
      const belowHit = Math.min(...elevatedHits.map((o) => o.box.minY)) - pipeRadiusM - 0.05
      pushTieY(aboveHit)
      pushTieY(belowHit)
    }
    if (Number.isFinite(minEndpointRoofCap)) pushTieY(minEndpointRoofCap)
    if (Number.isFinite(primaryMinRoofCap)) pushTieY(primaryMinRoofCap)
    if (Number.isFinite(altMinRoofCap)) pushTieY(altMinRoofCap)
    const headerBeams = allElevatedBeams.filter(
      (o) => o.beamRole === 'header' || /header/i.test(o.label) || o.box.maxY <= ceilingHeightM + 0.08,
    )
    if (headerBeams.length > 0) {
      pushTieY(Math.max(...headerBeams.map((o) => o.box.maxY)) + pipeRadiusM + 0.05)
    }
    pushTieY(ceilingHeightM - 0.15)
    pushTieY(Math.min(ceilingHeightM - 0.15, maxSafeCeilingY))
    pushTieY(ceilingHeightM - 0.25)
    pushTieY(ceilingHeightM - 0.45)
    pushTieY(ceilingHeightM + 0.14)
    pushTieY(ceilingHeightM + 0.28)
    pushTieY(minHorizontalVentY)
    pushTieY(ipcMinVentY)

    // Check if the vertical riser at `from` hits a window/door header or beam directly above the fixture.
    // If so, offset horizontally past the header jamb at `jogY >= floodRim + 6"` (IPC 905.5) before rising!
    const riserHits = detectPlumbingClashes(
      [from, [from[0], Math.max(...tieYs), from[2]]],
      obstacles,
      pipeRadiusM,
    )
    const riserJogs: Array<{ x: number; z: number; jogY: number } | undefined> = [undefined]
    if (riserHits.length > 0) {
      const lowestHitY = Math.min(...riserHits.map((o) => o.box.minY))
      const safeJogY = Math.max(
        minHorizontalVentY,
        Math.min(lowestHitY - pipeRadiusM - 0.06, tieInHeightM - 0.2),
      )
      const escapes = buildLateralEscapeCandidates(from[0], from[2], riserHits, edgePad + 0.03)
      for (const [rx, rz] of escapes) {
        riserJogs.push({ x: rx, z: rz, jogY: safeJogY })
      }
      for (const d of [0.45, -0.45, 0.9, -0.9]) {
        riserJogs.push({ x: from[0] + d, z: from[2], jogY: safeJogY })
        riserJogs.push({ x: from[0], z: from[2] + d, jogY: safeJogY })
      }
    }

    for (const jog of riserJogs) {
      const sx = jog ? jog.x : from[0]
      const sz = jog ? jog.z : from[2]
      const candidates: Array<Array<readonly [number, number]>> = [
        [[stackPoint[0], sz], [stackPoint[0], stackPoint[1]]],
        [[sx, stackPoint[1]], [stackPoint[0], stackPoint[1]]],
        [[stackPoint[0], sz + 0.55], [stackPoint[0], stackPoint[1]]],
        [[stackPoint[0], sz - 0.55], [stackPoint[0], stackPoint[1]]],
        [[sx + 0.55, stackPoint[1]], [stackPoint[0], stackPoint[1]]],
        [[sx - 0.55, stackPoint[1]], [stackPoint[0], stackPoint[1]]],
        [[stackPoint[0] + 0.95, sz], [stackPoint[0] + 0.95, stackPoint[1]], [stackPoint[0], stackPoint[1]]],
        [[stackPoint[0] - 0.95, sz], [stackPoint[0] - 0.95, stackPoint[1]], [stackPoint[0], stackPoint[1]]],
        ...buildObstacleDetourWaypoints([sx, sz], stackPoint, bestClashes, edgePad),
      ]
      for (const tieY of tieYs) {
        for (const wp of candidates) {
          if (tryVent(buildVentCandidate(wp, tieY, jog), tieY)) break
        }
        if (bestClashes.length === 0 && !bestBoundsViolation && !bestRoofViolation) break
      }
      if (bestClashes.length === 0 && !bestBoundsViolation && !bestRoofViolation) break
    }

    // Layer 2 — Legal-Space-First Cavity Rescue (non-descending-vent, IPC 905.5 & 905.2)
    if ((bestClashes.length > 0 || bestBoundsViolation || bestRoofViolation) && hasCavityScene(cavityContext)) {
      const cavityTargetY =
        cavityContext?.graph &&
        (!maxRoofYAt ||
          cavityContext.graph.ceilingPlenumY + pipeRadiusM <=
            maxRoofYAt(stackPoint[0], stackPoint[1]) - 0.08 + 1e-4)
          ? Math.max(tieInHeightM, cavityContext.graph.ceilingPlenumY)
          : tieInHeightM
      const cav = routePlumbingViaLegalCavity({
        ...cavityContext,
        from,
        to: [stackPoint[0], cavityTargetY, stackPoint[1]],
        mode: 'non-descending-vent',
        nominalSize,
        material,
        pipeRadiusM,
        floodRimHeightM,
        minHorizontalElevationM: minHorizontalVentY,
        obstacles,
      })
      if (
        cav.path.length >= 2 &&
        isVentPathCodeCompliant(cav.path, floodRimHeightM + IPC_RULE_THRESHOLDS.ventMinAboveFloodRimM)
      ) {
        const cavTieY = cav.path[cav.path.length - 1]![1]
        tryVent(cav.path, cavTieY)
      }
    }
  }

  return {
    path: bestPath,
    tieInHeightM: round2(bestTieInY),
    lengthFt: round2(polylineLengthM(bestPath) * METERS_TO_FEET),
    detoured,
    clashes: bestClashes,
  }
}

/**
 * Route a pressurized supply (Cold / Hot / Recirc) or Fuel Gas run:
 * - Drops vertically inside wall cavities to under-floor crawlspace/basement or attic plane
 * - Automatically detours below floor girders, over door/window headers, and clear of NEC 110.26(E)
 *   electrical-panel keep-out zones & structural columns (including vertical riser/drop jogs).
 */
export function routePressurizedPipeRun(params: {
  from: Vec3
  to: Vec3
  routingPlaneY: number
  nominalSize?: PipeNominalSize
  material?: PipeMaterial
  pipeRadiusM?: number
  euclideanInCavity?: boolean
  obstacles?: ReadonlyArray<PlumbingObstacle>
  buildingBounds?: BuildingBounds2D
  maxRoofYAt?: (x: number, z: number) => number
  cavityContext?: PlumbingCavityContext
  /** Optional explicit cavity band whitelist for Layer 2 cavity rescue. */
  allowedBands?: readonly CavityBand[]
}): {
  path: Vec3[]
  lengthFt: number
  detoured: boolean
  clashes: PlumbingObstacle[]
} {
  const {
    from,
    to,
    routingPlaneY,
    nominalSize,
    material = 'pex-a',
    euclideanInCavity = true,
    obstacles = [],
    buildingBounds,
    maxRoofYAt,
    cavityContext,
  } = params
  const pipeRadiusM =
    params.pipeRadiusM ?? (nominalSize ? getPipeOuterDiameterM(nominalSize, material) / 2 : 0.02)
  const env = resolveAllowedEnvelope(buildingBounds, from, [to[0], to[2]])
  const checkFootprint = Boolean(buildingBounds) && hasCavityScene(cavityContext)

  const buildCandidate = (
    elbowFirst: 'x' | 'z' | 'diag',
    offsetM = 0,
    planeY = routingPlaneY,
    fromJog?: readonly [number, number],
    toJog?: readonly [number, number],
    customMid?: ReadonlyArray<readonly [number, number]>,
  ): Vec3[] => {
    const fx = fromJog ? fromJog[0] : from[0]
    const fz = fromJog ? fromJog[1] : from[2]
    const tx = toJog ? toJog[0] : to[0]
    const tz = toJog ? toJog[1] : to[2]

    const pts: Vec3[] = [from]
    if (fromJog) pts.push([fx, from[1], fz])
    pts.push([fx, planeY, fz])

    if (customMid) {
      for (const [mx, mz] of customMid) {
        pts.push([mx, planeY, mz])
      }
    } else if (elbowFirst === 'diag') {
      if (Math.abs(offsetM) >= 1e-4) {
        pts.push([(fx + tx) / 2 + offsetM, planeY, (fz + tz) / 2 - offsetM])
      }
    } else if (elbowFirst === 'x') {
      pts.push([tx + offsetM, planeY, fz + offsetM])
    } else {
      pts.push([fx + offsetM, planeY, tz + offsetM])
    }

    pts.push([tx, planeY, tz])
    if (toJog) pts.push([tx, to[1], tz])
    pts.push(to)
    return cleanPath(pts)
  }

  const primary = buildCandidate(euclideanInCavity ? 'diag' : 'x', 0)
  let bestPath = primary
  let bestClashes = detectPlumbingClashes(primary, obstacles, pipeRadiusM)
  let bestBoundsViolation =
    exceedsEnvelopeXZ(primary, env) || exceedsConcaveFootprint(primary, cavityContext, checkFootprint)
  let bestRoofViolation = exceedsRoofPlane(primary, pipeRadiusM, maxRoofYAt)
  let detoured = false

  if (bestClashes.length > 0 || bestBoundsViolation || bestRoofViolation) {
    const maxEval = 300
    let evalCount = 0
    const tryPressurized = (cand: Vec3[], bypassBudget = false): boolean => {
      if (!bypassBudget && evalCount >= maxEval) return true
      if (!bypassBudget) evalCount += 1
      const boundsViol =
        exceedsEnvelopeXZ(cand, env) || exceedsConcaveFootprint(cand, cavityContext, checkFootprint)
      const roofViol = exceedsRoofPlane(cand, pipeRadiusM, maxRoofYAt)
      if (boundsViol && !bestBoundsViolation) return !bypassBudget && evalCount >= maxEval
      if (roofViol && !bestRoofViolation && boundsViol === bestBoundsViolation) return !bypassBudget && evalCount >= maxEval
      const c = detectPlumbingClashes(cand, obstacles, pipeRadiusM)
      const better =
        (bestBoundsViolation && !boundsViol) ||
        (boundsViol === bestBoundsViolation && bestRoofViolation && !roofViol) ||
        (boundsViol === bestBoundsViolation && roofViol === bestRoofViolation && c.length < bestClashes.length)
      if (better) {
        bestPath = cand
        bestClashes = c
        bestBoundsViolation = boundsViol
        bestRoofViolation = roofViol
        detoured = true
      }
      return (
        (bestClashes.length === 0 && !bestBoundsViolation && !bestRoofViolation) ||
        (!bypassBudget && evalCount >= maxEval)
      )
    }

    const edgePad = pipeRadiusM + 0.07
    const allUnderBeams = obstacles.filter(isUnderFloorBeamObstacle)
    const structuralHits = bestClashes.filter(isUnderFloorBeamObstacle)
    const elevatedHits = bestClashes.filter(isElevatedBeamObstacle)
    const allElevatedAreHeaders =
      elevatedHits.length > 0 &&
      elevatedHits.every((o) => o.beamRole === 'header' || /header/i.test(o.label))

    const planeYs: number[] = []
    const pushPlaneY = (y: number) => {
      if (!planeYs.some((v) => Math.abs(v - y) < 0.015)) planeYs.push(y)
    }

    if (structuralHits.length > 0) {
      pushPlaneY(
        Math.min(routingPlaneY - 0.16, Math.min(...structuralHits.map((o) => o.box.minY)) - pipeRadiusM - 0.06),
      )
    }
    if (allUnderBeams.length > 0 && routingPlaneY <= 0.25) {
      pushPlaneY(
        Math.min(routingPlaneY - 0.16, Math.min(...allUnderBeams.map((o) => o.box.minY)) - pipeRadiusM - 0.06),
      )
    }
    if (elevatedHits.length > 0) {
      const aboveHit = Math.max(...elevatedHits.map((o) => o.box.maxY)) + pipeRadiusM + 0.06
      const belowHit = Math.min(...elevatedHits.map((o) => o.box.minY)) - pipeRadiusM - 0.06
      const aboveViolatesRoof =
        maxRoofYAt !== undefined &&
        aboveHit + pipeRadiusM >
          Math.min(maxRoofYAt(from[0], from[2]), maxRoofYAt(to[0], to[2])) - 0.08 + 1e-4
      // Always try routing OVER door/window headers first; suppress belowHit on overhead runs (> 1.8m)
      // when routing over fits beneath the roof envelope so supply pipes never drop across open doorways/windows.
      pushPlaneY(aboveHit)
      if (!(allElevatedAreHeaders && routingPlaneY > 1.8 && !aboveViolatesRoof)) {
        pushPlaneY(belowHit)
      }
    }
    pushPlaneY(routingPlaneY)
    if (!(allElevatedAreHeaders && routingPlaneY > 1.8)) {
      pushPlaneY(routingPlaneY - 0.28)
    }
    if (maxRoofYAt) {
      const endpointRoofCap =
        Math.min(maxRoofYAt(from[0], from[2]), maxRoofYAt(to[0], to[2])) - pipeRadiusM - 0.09
      const primaryRoofCap = minRoofAlongPath(primary, maxRoofYAt) - pipeRadiusM - 0.09
      const roofSafeY = Math.min(endpointRoofCap, primaryRoofCap)
      if (bestRoofViolation || roofSafeY < routingPlaneY) {
        if (Number.isFinite(endpointRoofCap) && endpointRoofCap < routingPlaneY) {
          pushPlaneY(endpointRoofCap)
        }
        if (Number.isFinite(primaryRoofCap) && primaryRoofCap < routingPlaneY) {
          pushPlaneY(primaryRoofCap)
        }
        if (Number.isFinite(roofSafeY) && roofSafeY < routingPlaneY) {
          pushPlaneY(roofSafeY - 0.12)
        }
      }
    }

    // Probe the FULL vertical riser/drop envelope [minPlaneY, maxPlaneY] so headers/girders
    // sitting anywhere between endpoint elevation and any candidate routing plane are caught.
    const minPlaneY = Math.min(...planeYs)
    const maxPlaneY = Math.max(...planeYs)
    const fromDropHits = detectPlumbingClashes(
      [
        [from[0], Math.min(from[1], minPlaneY), from[2]],
        [from[0], Math.max(from[1], maxPlaneY), from[2]],
      ],
      obstacles,
      pipeRadiusM,
    )
    const toRiseHits = detectPlumbingClashes(
      [
        [to[0], Math.min(to[1], minPlaneY), to[2]],
        [to[0], Math.max(to[1], maxPlaneY), to[2]],
      ],
      obstacles,
      pipeRadiusM,
    )

    const prefilterJogs = (
      anchor: Vec3,
      rawEscapes: ReadonlyArray<readonly [number, number]>,
      limit = 4,
    ): Array<readonly [number, number] | undefined> => {
      if (rawEscapes.length === 0) return [undefined]
      const yLo = Math.min(anchor[1], minPlaneY)
      const yHi = Math.max(anchor[1], maxPlaneY)
      const scored = rawEscapes
        .filter(([jx, jz]) => !env || (jx >= env.minX - 1e-4 && jx <= env.maxX + 1e-4 && jz >= env.minZ - 1e-4 && jz <= env.maxZ + 1e-4))
        .map((jog) => {
          const leg: Vec3[] = [
            anchor,
            [jog[0], anchor[1], jog[1]],
            [jog[0], yLo, jog[1]],
            [jog[0], yHi, jog[1]],
          ]
          const clashCount = detectPlumbingClashes(leg, obstacles, pipeRadiusM).length
          const dist = Math.hypot(jog[0] - anchor[0], jog[1] - anchor[2])
          return { jog, clashCount, dist }
        })
      scored.sort((a, b) => a.clashCount - b.clashCount || a.dist - b.dist)
      return [undefined, ...scored.slice(0, limit).map((s) => s.jog)]
    }

    const fromJogs = prefilterJogs(
      from,
      fromDropHits.length > 0 ? buildLateralEscapeCandidates(from[0], from[2], fromDropHits, edgePad) : [],
    )
    const toJogs = prefilterJogs(
      to,
      toRiseHits.length > 0 ? buildLateralEscapeCandidates(to[0], to[2], toRiseHits, edgePad) : [],
    )

    const modes: ReadonlyArray<readonly ['x' | 'z' | 'diag', number]> = [
      [euclideanInCavity ? 'diag' : 'x', 0],
      ['x', 0],
      ['z', 0],
      ['x', 0.55],
      ['x', -0.55],
      ['z', 0.55],
      ['z', -0.55],
      ['diag', 0.75],
      ['diag', -0.75],
      ['x', 1.15],
      ['x', -1.15],
      ['z', 1.15],
      ['z', -1.15],
    ]

    const isDone = () =>
      (bestClashes.length === 0 && !bestBoundsViolation && !bestRoofViolation) || evalCount >= maxEval

    for (const fJog of fromJogs) {
      for (const tJog of toJogs) {
        const fx = fJog ? fJog[0] : from[0]
        const fz = fJog ? fJog[1] : from[2]
        const tx = tJog ? tJog[0] : to[0]
        const tz = tJog ? tJog[1] : to[2]
        const dynMids = buildObstacleDetourWaypoints([fx, fz], [tx, tz], bestClashes, edgePad)

        for (const py of planeYs) {
          for (const [m, off] of modes) {
            if (tryPressurized(buildCandidate(m, off, py, fJog, tJog))) break
          }
          if (isDone()) break
          for (const mid of dynMids) {
            if (tryPressurized(buildCandidate('x', 0, py, fJog, tJog, mid))) break
          }
          if (isDone()) break
        }
        if (isDone()) break
      }
      if (isDone()) break
    }

    // Layer 2 — Legal-Space-First Cavity Rescue:
    // - Sub-floor planes (<= 0.1 m): strictly under-slab / crawlspace
    // - Low-elevation appliance runs (0.1 m < y <= 0.6 m, e.g. 4" dryer vent at 0.35 m): allow under-sill / mid-wall / overhead-plenum
    // - Overhead pressurized water/gas mains (> 0.6 m): strictly overhead-plenum / attic (never intrude on mid-wall/top-plate electrical chases)
    if ((bestClashes.length > 0 || bestBoundsViolation || bestRoofViolation) && hasCavityScene(cavityContext)) {
      const allowedBands: readonly CavityBand[] =
        params.allowedBands ??
        (routingPlaneY <= 0.1
          ? ['under-slab', 'crawlspace']
          : routingPlaneY <= 0.6
            ? ['under-sill', 'mid-wall', 'overhead-plenum']
            : ['overhead-plenum', 'attic'])
      const cav = routePlumbingViaLegalCavity({
        ...cavityContext,
        from,
        to,
        mode: euclideanInCavity ? 'euclidean-cavity' : 'orthogonal',
        nominalSize,
        material,
        pipeRadiusM,
        allowedBands,
        obstacles,
      })
      if (cav.path.length >= 2) {
        tryPressurized(cav.path, true)
      }
    }
  }

  return {
    path: bestPath,
    lengthFt: round2(polylineLengthM(bestPath) * METERS_TO_FEET),
    detoured,
    clashes: bestClashes,
  }
}
