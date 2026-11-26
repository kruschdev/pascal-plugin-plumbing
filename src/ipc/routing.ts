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

import { type SceneNodeLike, type Vec3, belongsToLevel } from './framing-interop'
import { getMinRequiredDrainSlopeInPerFt } from './sizing'
import {
  type FoundationType,
  INCHES_TO_METERS,
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
  label: string
  box: Aabb3
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
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return total
}

export function polylineHorizontalLengthM(path: ReadonlyArray<Vec3>): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    total += Math.hypot(b[0] - a[0], b[2] - a[2])
  }
  return total
}

export function countPathElbows(path: ReadonlyArray<Vec3>): { elbows90: number; elbows45: number } {
  let elbows90 = 0
  let elbows45 = 0
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const c = path[i + 1]!
    const v1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const
    const v2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]] as const
    const l1 = Math.hypot(v1[0], v1[1], v1[2])
    const l2 = Math.hypot(v2[0], v2[1], v2[2])
    if (l1 < 1e-4 || l2 < 1e-4) continue
    const dot = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (l1 * l2)))
    const deg = (Math.acos(dot) * 180) / Math.PI
    if (deg >= 68) elbows90 += 1
    else if (deg >= 25) elbows45 += 1
  }
  return { elbows90, elbows45 }
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

export function classifyRoomName(
  name: string,
  occupancy: OccupancyType = 'residential',
): RoomPolygon2D['category'] {
  const s = name.toLowerCase()
  if (/commercial.*restroom|mens|womens|public.*(bath|restroom)/.test(s)) return 'commercial-restroom'
  if (/restroom/.test(s)) return occupancy === 'commercial' ? 'commercial-restroom' : 'bathroom'
  if (/commercial.*kitchen|prep.*kitchen|scullery/.test(s)) return 'commercial-kitchen'
  if (/master.*bath|primary.*bath|ensuite|en-suite/.test(s)) return 'master-bath'
  if (/half.*bath|powder/.test(s)) return 'half-bath'
  if (/bath|wc|toilet|shower/.test(s)) return 'bathroom'
  if (/kitchen|pantry/.test(s)) return 'kitchen'
  if (/laundry|mudroom|washer/.test(s)) return 'laundry'
  if (/utility|mech|boiler|furnace|storage/.test(s)) return 'utility'
  if (/garage|carport/.test(s)) return 'garage'
  if (/bed|nursery|guest/.test(s)) return 'bedroom'
  if (/living|great|family|dining|office|den|hall/.test(s)) return 'living'
  if (/porch|patio|deck|balcony|yard|exterior/.test(s)) return 'exterior'
  return 'other'
}

export function polygonAreaAndCentroid(
  polygon: ReadonlyArray<readonly [number, number]>,
): { areaSqm: number; centroid: readonly [number, number] } {
  if (polygon.length < 3) return { areaSqm: 0, centroid: [0, 0] }
  let signed = 0
  let cx = 0
  let cz = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x0, z0] = polygon[i]!
    const [x1, z1] = polygon[(i + 1) % polygon.length]!
    const cross = x0 * z1 - x1 * z0
    signed += cross
    cx += (x0 + x1) * cross
    cz += (z0 + z1) * cross
  }
  const area = Math.abs(signed) * 0.5
  if (area < 1e-4) {
    const avgX = polygon.reduce((s, p) => s + p[0], 0) / polygon.length
    const avgZ = polygon.reduce((s, p) => s + p[1], 0) / polygon.length
    return { areaSqm: 0, centroid: [avgX, avgZ] }
  }
  return {
    areaSqm: area,
    centroid: [cx / (3 * signed), cz / (3 * signed)],
  }
}

export function pointInPolygon2D(
  x: number,
  z: number,
  polygon: ReadonlyArray<readonly [number, number]>,
): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]![0]
    const zi = polygon[i]![1]
    const xj = polygon[j]![0]
    const zj = polygon[j]![1]
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function extractRoomPolygons(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null = null,
  occupancy: OccupancyType = 'residential',
): RoomPolygon2D[] {
  const rooms: RoomPolygon2D[] = []
  for (const n of Object.values(nodes)) {
    if ((n.type !== 'zone' && n.type !== 'room') || !belongsToLevel(nodes, n, levelId)) continue
    const rawPoly = Array.isArray(n.polygon) ? n.polygon : null
    if (!rawPoly || rawPoly.length < 3) continue
    const poly = rawPoly.map((p) => [Number(p[0]), Number(p[1])] as const)
    const { areaSqm, centroid } = polygonAreaAndCentroid(poly)
    const label = typeof n.name === 'string' && n.name.trim() ? n.name.trim() : n.id
    const rawCategory = typeof n.category === 'string' ? n.category.trim() : ''
    const classifyText = `${rawCategory} ${label}`.trim()
    rooms.push({
      id: n.id,
      name: label,
      category: classifyRoomName(classifyText, occupancy),
      polygon: poly,
      centroid,
      areaSqm: round2(areaSqm),
      areaSqft: round2(areaSqm * 10.7639),
    })
  }
  return rooms
}

export function resolveLevelHeightM(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null = null,
): number {
  const walls = extractWallSegments(nodes, levelId)
  if (walls.length === 0) return 2.6
  return Math.max(2.2, walls.reduce((s, w) => s + w.heightM, 0) / walls.length)
}

/**
 * Extract Priority #1 Structural obstacles AND NEC 110.26(E) Dedicated Electrical Space columns
 * (footprint of any `electrical:panel` or `electrical:transformer` extending from floor to structural ceiling).
 */
export function extractPlumbingObstacles(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null = null,
): PlumbingObstacle[] {
  const obstacles: PlumbingObstacle[] = []
  const levelH = resolveLevelHeightM(nodes, levelId)

  const extractYaw = (rawRot: unknown): number =>
    typeof rawRot === 'number'
      ? rawRot
      : Array.isArray(rawRot) && rawRot.length >= 2
        ? Number(rawRot[1] ?? 0)
        : 0

  for (const n of Object.values(nodes)) {
    if (!belongsToLevel(nodes, n, levelId)) continue
    const pos = Array.isArray(n.position) && n.position.length >= 3
      ? ([Number(n.position[0]), Number(n.position[1]), Number(n.position[2])] as Vec3)
      : null

    if (n.type === 'structural:column' && pos) {
      const w = (typeof n.widthIn === 'number' ? n.widthIn : 5.5) * INCHES_TO_METERS
      const d = (typeof n.depthIn === 'number' ? n.depthIn : 5.5) * INCHES_TO_METERS
      const h = typeof n.heightM === 'number' ? n.heightM : levelH
      const rot = extractYaw(n.rotation)
      const cosR = Math.abs(Math.cos(rot))
      const sinR = Math.abs(Math.sin(rot))
      const halfX = (w * cosR + d * sinR) / 2
      const halfZ = (w * sinR + d * cosR) / 2
      obstacles.push({
        id: n.id,
        nodeId: n.id,
        category: 'structural',
        structuralKind: 'column',
        label: `Structural column ${String(n.designation ?? n.columnType ?? '')} (${n.name ?? n.id})`.trim(),
        box: {
          minX: pos[0] - halfX,
          maxX: pos[0] + halfX,
          minY: pos[1],
          maxY: pos[1] + h,
          minZ: pos[2] - halfZ,
          maxZ: pos[2] + halfZ,
        },
      })
    } else if (n.type === 'structural:beam' && Array.isArray(n.start) && Array.isArray(n.end)) {
      const sx = Number(n.start[0])
      const sz = Number(n.start[1])
      const ex = Number(n.end[0])
      const ez = Number(n.end[1])
      const w = (typeof n.widthIn === 'number' ? n.widthIn : 3.5) * INCHES_TO_METERS
      const h = (typeof n.depthIn === 'number' ? n.depthIn : 11.875) * INCHES_TO_METERS
      const y = typeof n.elevationY === 'number' ? Number(n.elevationY) : levelH - h / 2
      const label = `Structural beam ${String(n.designation ?? n.beamType ?? '')} (${n.name ?? n.id})`.trim()
      const isDiagonal = Math.abs(ex - sx) > 0.2 && Math.abs(ez - sz) > 0.2
      if (isDiagonal) {
        const len = Math.hypot(ex - sx, ez - sz)
        const steps = Math.max(2, Math.min(24, Math.ceil(len / 0.6)))
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps
          const t1 = (i + 1) / steps
          const x0 = sx + (ex - sx) * t0
          const z0 = sz + (ez - sz) * t0
          const x1 = sx + (ex - sx) * t1
          const z1 = sz + (ez - sz) * t1
          obstacles.push({
            id: `${n.id}:seg${i}`,
            nodeId: n.id,
            category: 'structural',
            structuralKind: 'beam',
            label,
            box: {
              minX: Math.min(x0, x1) - w / 2,
              maxX: Math.max(x0, x1) + w / 2,
              minY: y - h / 2,
              maxY: y + h / 2,
              minZ: Math.min(z0, z1) - w / 2,
              maxZ: Math.max(z0, z1) + w / 2,
            },
          })
        }
      } else {
        obstacles.push({
          id: n.id,
          nodeId: n.id,
          category: 'structural',
          structuralKind: 'beam',
          label,
          box: {
            minX: Math.min(sx, ex) - w / 2,
            maxX: Math.max(sx, ex) + w / 2,
            minY: y - h / 2,
            maxY: y + h / 2,
            minZ: Math.min(sz, ez) - w / 2,
            maxZ: Math.max(sz, ez) + w / 2,
          },
        })
      }
    } else if (n.type === 'column' && pos) {
      const w = typeof n.width === 'number' ? n.width : 0.25
      const d = typeof n.depth === 'number' ? n.depth : 0.25
      const h = typeof n.height === 'number' ? n.height : levelH
      const rot = extractYaw(n.rotation)
      const cosR = Math.abs(Math.cos(rot))
      const sinR = Math.abs(Math.sin(rot))
      const halfX = (w * cosR + d * sinR) / 2
      const halfZ = (w * sinR + d * cosR) / 2
      obstacles.push({
        id: n.id,
        nodeId: n.id,
        category: 'structural',
        structuralKind: 'column',
        label: `Structural column (${n.name ?? n.id})`,
        box: {
          minX: pos[0] - halfX,
          maxX: pos[0] + halfX,
          minY: pos[1],
          maxY: pos[1] + h,
          minZ: pos[2] - halfZ,
          maxZ: pos[2] + halfZ,
        },
      })
    } else if (n.type === 'beam' && Array.isArray(n.start) && Array.isArray(n.end)) {
      const sx = Number(n.start[0])
      const sz = Number(n.start[1])
      const ex = Number(n.end[0])
      const ez = Number(n.end[1])
      const w = typeof n.width === 'number' ? n.width : 0.2
      const h = typeof n.height === 'number' ? n.height : 0.3
      const y = typeof n.elevation === 'number' ? Number(n.elevation) : levelH - h / 2
      const label = `Structural beam (${n.name ?? n.id})`
      const isDiagonal = Math.abs(ex - sx) > 0.2 && Math.abs(ez - sz) > 0.2
      if (isDiagonal) {
        const len = Math.hypot(ex - sx, ez - sz)
        const steps = Math.max(2, Math.min(24, Math.ceil(len / 0.6)))
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps
          const t1 = (i + 1) / steps
          const x0 = sx + (ex - sx) * t0
          const z0 = sz + (ez - sz) * t0
          const x1 = sx + (ex - sx) * t1
          const z1 = sz + (ez - sz) * t1
          obstacles.push({
            id: `${n.id}:seg${i}`,
            nodeId: n.id,
            category: 'structural',
            structuralKind: 'beam',
            label,
            box: {
              minX: Math.min(x0, x1) - w / 2,
              maxX: Math.max(x0, x1) + w / 2,
              minY: y - h / 2,
              maxY: y + h / 2,
              minZ: Math.min(z0, z1) - w / 2,
              maxZ: Math.max(z0, z1) + w / 2,
            },
          })
        }
      } else {
        obstacles.push({
          id: n.id,
          nodeId: n.id,
          category: 'structural',
          structuralKind: 'beam',
          label,
          box: {
            minX: Math.min(sx, ex) - w / 2,
            maxX: Math.max(sx, ex) + w / 2,
            minY: y - h / 2,
            maxY: y + h / 2,
            minZ: Math.min(sz, ez) - w / 2,
            maxZ: Math.max(sz, ez) + w / 2,
          },
        })
      }
    } else if ((n.type === 'electrical:panel' || n.type === 'electrical:transformer') && pos) {
      // NEC 110.26(E)(1)(a): Dedicated space equal to width & depth of panel/transformer extending from floor (y = 0) to 6 ft above (or ceiling)
      const isTransformer = n.type === 'electrical:transformer'
      const w = typeof n.width === 'number' ? n.width : isTransformer ? 0.76 : 0.42
      const d = typeof n.depth === 'number' ? n.depth : isTransformer ? 0.64 : 0.16
      const rot = extractYaw(n.rotation)
      const cosR = Math.abs(Math.cos(rot))
      const sinR = Math.abs(Math.sin(rot))
      const halfX = (w * cosR + d * sinR) / 2 + 0.03
      const halfZ = (w * sinR + d * cosR) / 2 + 0.03
      const topY = isTransformer
        ? pos[1] + (typeof n.height === 'number' ? n.height : 0.95)
        : pos[1] + (typeof n.height === 'number' ? n.height / 2 : 0.46)
      obstacles.push({
        id: n.id,
        nodeId: n.id,
        category: 'electrical-dedicated-space',
        label: `NEC 110.26(E) Dedicated Space (${n.name ?? n.id})`,
        box: {
          minX: pos[0] - halfX,
          maxX: pos[0] + halfX,
          minY: 0,
          maxY: Math.max(levelH + 0.6, topY + 1.83), // Floor to 6 ft above panel/transformer
          minZ: pos[2] - halfZ,
          maxZ: pos[2] + halfZ,
        },
      })
    }
  }
  return obstacles
}

export function segmentIntersectsAabb(a: Vec3, b: Vec3, box: Aabb3, margin = 0.02): boolean {
  const minX = box.minX - margin
  const maxX = box.maxX + margin
  const minY = box.minY - margin
  const maxY = box.maxY + margin
  const minZ = box.minZ - margin
  const maxZ = box.maxZ + margin

  let tMin = 0
  let tMax = 1
  const dirs = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const
  const starts = [a[0], a[1], a[2]] as const
  const mins = [minX, minY, minZ] as const
  const maxs = [maxX, maxY, maxZ] as const

  for (let axis = 0; axis < 3; axis++) {
    const d = dirs[axis]!
    const s = starts[axis]!
    if (Math.abs(d) < 1e-8) {
      if (s < mins[axis]! || s > maxs[axis]!) return false
    } else {
      let t1 = (mins[axis]! - s) / d
      let t2 = (maxs[axis]! - s) / d
      if (t1 > t2) [t1, t2] = [t2, t1]
      tMin = Math.max(tMin, t1)
      tMax = Math.min(tMax, t2)
      if (tMin > tMax) return false
    }
  }
  return true
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
}): {
  path: Vec3[]
  slopeInPerFt: number
  lengthFt: number
  detoured: boolean
  clashes: PlumbingObstacle[]
} {
  const { from, to, nominalSize, material = 'pvc-dwv', foundationType = 'crawlspace', obstacles = [] } = params
  const minSlope = getMinRequiredDrainSlopeInPerFt(nominalSize)
  const slopeInPerFt = Math.max(params.slopeInPerFt ?? 0.25, minSlope)
  const slopeRatio = slopeInPerFt / 12 // vertical drop per horizontal unit

  const underFloorY = foundationType === 'slab' ? -0.35 : -0.24
  const startY = Math.min(from[1], underFloorY)
  const pipeRadiusM = (params.pipeRadiusM ?? getPipeOuterDiameterM(nominalSize, material) / 2) + 0.015

  const buildSlopedCandidate = (
    horizWaypoints: ReadonlyArray<readonly [number, number]>,
    overrideStartY = startY,
  ): Vec3[] => {
    const pts: Vec3[] = [from]
    if (from[1] > overrideStartY + 0.02) {
      pts.push([from[0], overrideStartY, from[2]])
    }
    let curX = from[0]
    let curZ = from[2]
    let curY = overrideStartY
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
  let detoured = false
  let underBeamY: number | null = null

  if (bestClashes.length > 0) {
    // If hitting a full-span under-floor structural girder (never a vertical column), drop cleanly below its bottom face first!
    const structuralHits = bestClashes.filter(isUnderFloorBeamObstacle)
    if (structuralHits.length > 0) {
      const lowestMinY = Math.min(...structuralHits.map((o) => o.box.minY))
      underBeamY = Math.min(startY - 0.18, lowestMinY - pipeRadiusM - 0.06)
      for (const wp of [
        [[to[0], from[2]], [to[0], to[2]]] as const,
        [[from[0], to[2]], [to[0], to[2]]] as const,
      ]) {
        const cand = buildSlopedCandidate(wp, underBeamY)
        const c = detectPlumbingClashes(cand, obstacles, pipeRadiusM)
        if (c.length < bestClashes.length) {
          bestPath = cand
          bestClashes = c
          detoured = true
          if (c.length === 0) break
        }
      }
    }
  }

  if (bestClashes.length > 0) {
    const midX = (from[0] + to[0]) / 2
    const midZ = (from[2] + to[2]) / 2
    const candidates: Array<Array<readonly [number, number]>> = [
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
    ]
    // Preserve underBeamY when attempting horizontal detours so a run can BOTH duck under a girder AND jog around a column/panel!
    const startYs = underBeamY !== null ? [underBeamY, startY] : [startY]
    for (const sy of startYs) {
      for (const wp of candidates) {
        const cand = buildSlopedCandidate(wp, sy)
        const c = detectPlumbingClashes(cand, obstacles, pipeRadiusM)
        if (c.length < bestClashes.length) {
          bestPath = cand
          bestClashes = c
          detoured = true
          if (c.length === 0) break
        }
      }
      if (bestClashes.length === 0) break
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
 * and horizontally over to the main vent stack, detouring around structural & NEC 110.26(E) obstacles.
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
  } = params
  const pipeRadiusM =
    params.pipeRadiusM ?? (nominalSize ? getPipeOuterDiameterM(nominalSize, material) / 2 : 0.03)
  // IPC 905.5: horizontal vent tie-in MUST be >= 6" (0.1524 m) above flood-level rim; route in upper wall/attic
  const minTieInY = floodRimHeightM + 6 * INCHES_TO_METERS + 0.1
  const tieInHeightM = Math.max(minTieInY, ceilingHeightM - 0.15)

  const buildVentCandidate = (waypoints: ReadonlyArray<readonly [number, number]>): Vec3[] => {
    const pts: Vec3[] = [from, [from[0], tieInHeightM, from[2]]]
    for (const [wx, wz] of waypoints) {
      pts.push([wx, tieInHeightM, wz])
    }
    return cleanPath(pts)
  }

  const primary = buildVentCandidate([
    [stackPoint[0], from[2]],
    [stackPoint[0], stackPoint[1]],
  ])
  let bestPath = primary
  let bestClashes = detectPlumbingClashes(primary, obstacles, pipeRadiusM)
  let detoured = false

  if (bestClashes.length > 0) {
    const candidates: Array<Array<readonly [number, number]>> = [
      [[from[0], stackPoint[1]], [stackPoint[0], stackPoint[1]]],
      [[stackPoint[0], from[2] + 0.55], [stackPoint[0], stackPoint[1]]],
      [[stackPoint[0], from[2] - 0.55], [stackPoint[0], stackPoint[1]]],
      [[from[0] + 0.55, stackPoint[1]], [stackPoint[0], stackPoint[1]]],
      [[from[0] - 0.55, stackPoint[1]], [stackPoint[0], stackPoint[1]]],
      [[stackPoint[0] + 0.95, from[2]], [stackPoint[0] + 0.95, stackPoint[1]], [stackPoint[0], stackPoint[1]]],
      [[stackPoint[0] - 0.95, from[2]], [stackPoint[0] - 0.95, stackPoint[1]], [stackPoint[0], stackPoint[1]]],
    ]
    for (const wp of candidates) {
      const cand = buildVentCandidate(wp)
      const c = detectPlumbingClashes(cand, obstacles, pipeRadiusM)
      if (c.length < bestClashes.length) {
        bestPath = cand
        bestClashes = c
        detoured = true
        if (c.length === 0) break
      }
    }
  }

  return {
    path: bestPath,
    tieInHeightM: round2(tieInHeightM),
    lengthFt: round2(polylineLengthM(bestPath) * METERS_TO_FEET),
    detoured,
    clashes: bestClashes,
  }
}

/**
 * Route a pressurized supply (Cold / Hot / Recirc) or Fuel Gas run:
 * - Drops vertically inside wall cavities to under-floor crawlspace/basement or attic plane
 * - Automatically offsets horizontally around NEC 110.26(E) electrical-panel keep-out zones & structural columns.
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
  } = params
  const pipeRadiusM =
    params.pipeRadiusM ?? (nominalSize ? getPipeOuterDiameterM(nominalSize, material) / 2 : 0.02)

  const buildCandidate = (elbowFirst: 'x' | 'z' | 'diag', offsetM = 0, planeY = routingPlaneY): Vec3[] => {
    const startPlane: Vec3 = [from[0], planeY, from[2]]
    const endPlane: Vec3 = [to[0], planeY, to[2]]
    if (elbowFirst === 'diag') {
      if (Math.abs(offsetM) < 1e-4) {
        return cleanPath([from, startPlane, endPlane, to])
      }
      const midX = (from[0] + to[0]) / 2 + offsetM
      const midZ = (from[2] + to[2]) / 2 - offsetM
      return cleanPath([from, startPlane, [midX, planeY, midZ], endPlane, to])
    }
    if (elbowFirst === 'x') {
      return cleanPath([from, startPlane, [to[0] + offsetM, planeY, from[2] + offsetM], endPlane, to])
    }
    return cleanPath([from, startPlane, [from[0] + offsetM, planeY, to[2] + offsetM], endPlane, to])
  }

  const primary = buildCandidate(euclideanInCavity ? 'diag' : 'x', 0)
  let bestPath = primary
  let bestClashes = detectPlumbingClashes(primary, obstacles, pipeRadiusM)
  let detoured = false

  if (bestClashes.length > 0) {
    // Try dropping cleanly beneath any under-floor structural girder (never a vertical column) first before horizontal detours
    const structuralHits = bestClashes.filter(isUnderFloorBeamObstacle)
    const underBeamY =
      structuralHits.length > 0
        ? Math.min(routingPlaneY - 0.16, Math.min(...structuralHits.map((o) => o.box.minY)) - pipeRadiusM - 0.06)
        : routingPlaneY - 0.28
    const candidates: Vec3[][] = [
      ...(structuralHits.length > 0
        ? [
            buildCandidate(euclideanInCavity ? 'diag' : 'x', 0, underBeamY),
            buildCandidate('x', 0, underBeamY),
            buildCandidate('z', 0, underBeamY),
            buildCandidate('x', 0.55, underBeamY),
            buildCandidate('x', -0.55, underBeamY),
            buildCandidate('z', 0.55, underBeamY),
            buildCandidate('z', -0.55, underBeamY),
          ]
        : []),
      buildCandidate('x', 0),
      buildCandidate('z', 0),
      buildCandidate('x', 0.55),
      buildCandidate('x', -0.55),
      buildCandidate('z', 0.55),
      buildCandidate('z', -0.55),
      buildCandidate('diag', 0.75),
      buildCandidate('diag', -0.75),
      buildCandidate('x', 0, underBeamY),
    ]
    for (const cand of candidates) {
      const c = detectPlumbingClashes(cand, obstacles, pipeRadiusM)
      if (c.length < bestClashes.length) {
        bestPath = cand
        bestClashes = c
        detoured = true
        if (c.length === 0) break
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
