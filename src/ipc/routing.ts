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

function classifyPascalOpeningKind(node: SceneNodeLike): 'door' | 'window' | null {
  if (node.type === 'door') return 'door'
  if (node.type === 'window') return 'window'
  if (node.type === 'item') {
    const asset = node.asset as Record<string, unknown> | undefined
    const cat = typeof asset?.category === 'string' ? asset.category.toLowerCase() : ''
    if (cat === 'door') return 'door'
    if (cat === 'window') return 'window'
    const hay = `${String(node.name ?? '')} ${String(asset?.id ?? '')}`.toLowerCase()
    if (/\bdoor\b|garage-door|sliding-door|patio-door/.test(hay)) return 'door'
    if (/\bwindow\b/.test(hay)) return 'window'
  }
  return null
}

/**
 * Extract all Pascal `door` and `window` opening spans along walls on a level
 * (handling both native `door`/`window` nodes and wall-attached opening `item` nodes).
 */
export function extractWallOpenings(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null = null,
): WallOpeningSpan[] {
  const walls = extractWallSegments(nodes, levelId)
  if (walls.length === 0) return []
  const wallById = new Map<string, WallSegment2D>(walls.map((w) => [w.id, w]))
  const childWallLookup = new Map<string, string>()
  for (const w of walls) {
    const rawWall = nodes[w.id]
    if (rawWall && Array.isArray(rawWall.children)) {
      for (const cid of rawWall.children) {
        if (typeof cid === 'string') childWallLookup.set(cid, w.id)
      }
    }
  }

  const out: WallOpeningSpan[] = []
  for (const n of Object.values(nodes)) {
    if (n.visible === false) continue
    const kind = classifyPascalOpeningKind(n)
    if (!kind) continue
    const hostWallId =
      (typeof n.wallId === 'string' && wallById.has(n.wallId) ? n.wallId : null) ??
      (typeof n.parentId === 'string' && wallById.has(n.parentId) ? n.parentId : null) ??
      childWallLookup.get(n.id) ??
      null
    if (!hostWallId) continue
    const wall = wallById.get(hostWallId)!
    if (wall.lengthM < 0.3) continue

    const asset = n.asset as Record<string, unknown> | undefined
    const dims = Array.isArray(asset?.dimensions) ? (asset.dimensions as number[]) : undefined
    const scale = Array.isArray(n.scale) ? (n.scale as number[]) : [1, 1, 1]
    const sxScale = typeof scale[0] === 'number' && scale[0] > 0 ? scale[0] : 1
    const syScale = typeof scale[1] === 'number' && scale[1] > 0 ? scale[1] : 1

    const rawW =
      typeof n.width === 'number' && n.width > 0
        ? n.width
        : dims && typeof dims[0] === 'number' && dims[0] > 0
          ? dims[0] * sxScale
          : kind === 'door'
            ? 0.9144
            : 1.2192
    const rawH =
      typeof n.height === 'number' && n.height > 0
        ? n.height
        : dims && typeof dims[1] === 'number' && dims[1] > 0
          ? dims[1] * syScale
          : kind === 'door'
            ? 2.0828
            : 1.2192

    const widthM = Math.max(0.45, Math.min(wall.lengthM - 0.15, rawW))
    const pos = Array.isArray(n.position) ? (n.position as number[]) : undefined
    const rot = Array.isArray(n.rotation) ? (n.rotation as number[]) : [0, 0, 0]
    const itemRotY = typeof rot[1] === 'number' && Number.isFinite(rot[1]) ? rot[1] : 0
    const assetOffset = Array.isArray(asset?.offset) ? (asset.offset as number[]) : undefined

    let uCenterM = wall.lengthM / 2
    if (pos && typeof pos[0] === 'number' && Number.isFinite(pos[0])) {
      const px = pos[0]
      const pz = typeof pos[2] === 'number' && Number.isFinite(pos[2]) ? pos[2] : 0
      if (Math.abs(pz) < 0.45 && px >= -0.25 && px <= wall.lengthM + 0.25) {
        uCenterM = px
        if (n.type === 'item' && assetOffset) {
          const ox = typeof assetOffset[0] === 'number' && Number.isFinite(assetOffset[0]) ? assetOffset[0] : 0
          const oz = typeof assetOffset[2] === 'number' && Number.isFinite(assetOffset[2]) ? assetOffset[2] : 0
          uCenterM += ox * Math.cos(itemRotY) + oz * Math.sin(itemRotY)
        }
      } else {
        uCenterM = (px - wall.start[0]) * wall.ux + (pz - wall.start[1]) * wall.uz
      }
    }
    uCenterM = Math.max(widthM / 2 + 0.08, Math.min(wall.lengthM - widthM / 2 - 0.08, uCenterM))

    const rawPosY = pos && typeof pos[1] === 'number' && Number.isFinite(pos[1]) ? pos[1] : 0
    const rawHeightClamped = Math.max(0.45, Math.min(wall.heightM - 0.18, rawH))
    const sillYM =
      kind === 'door'
        ? 0
        : n.type === 'window'
          ? Math.max(
              0.08,
              Math.min(
                wall.heightM - rawHeightClamped - 0.12,
                typeof n.sillHeight === 'number'
                  ? n.sillHeight
                  : rawPosY > 0.05
                    ? rawPosY - rawHeightClamped / 2
                    : 0.9144,
              ),
            )
          : Math.max(0.08, Math.min(wall.heightM - 0.5, rawPosY > 0.02 ? rawPosY : 0.9144))
    const heightM = Math.max(0.45, Math.min(wall.heightM - sillYM - 0.12, rawH))
    const headYM = Math.min(wall.heightM - 0.1, sillYM + heightM)

    out.push({
      id: n.id,
      wallId: wall.id,
      kind,
      name: typeof n.name === 'string' && n.name.trim() ? n.name.trim() : kind,
      uCenterM,
      widthM,
      startU: Math.max(0, uCenterM - widthM / 2),
      endU: Math.min(wall.lengthM, uCenterM + widthM / 2),
      sillYM,
      headYM,
      centerX: wall.start[0] + wall.ux * uCenterM,
      centerZ: wall.start[1] + wall.uz * uCenterM,
    })
  }

  return out
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
  if (/commercial.*restroom|mens|womens|public.*(bath|restroom)/.test(s)) return 'commercial-restroom'
  if (/restroom/.test(s)) return occupancy === 'commercial' ? 'commercial-restroom' : 'bathroom'
  if (/commercial.*kitchen|prep.*kitchen|scullery/.test(s)) return 'commercial-kitchen'
  if (/master.*bath|primary.*bath|ensuite|en-suite/.test(s)) return 'master-bath'
  if (/half.*bath|powder|\bwc\d*\b|\btoilettes?\b|\baseo\b/.test(s)) return 'half-bath'
  if (
    /bath|toilet|shower|salle\s+de\s+bains?|salle\s+d'eau|salle\s+de\s+douche|\bbad\b|badezimmer|\bbano\b|cuarto\s+de\s+bano|\bbagno\b/.test(
      s,
    )
  ) {
    return 'bathroom'
  }
  if (/kitchen|pantry|cuisine|cocina|cucina|\bkuche\b|\bkueche\b/.test(s)) return 'kitchen'
  if (/laundry|mudroom|washer|buanderie|waschkuche|waschkueche|lavanderia|hauswirtschaftsraum/.test(s)) {
    return 'laundry'
  }
  if (/utility|mech|boiler|furnace|storage/.test(s)) return 'utility'
  if (/garage|carport/.test(s)) return 'garage'
  if (/bed|nursery|guest|\bchambre\b|schlafzimmer|dormitorio/.test(s)) return 'bedroom'
  if (/living|great|family|dining|office|den|hall|\bsalon\b|\bsejour\b|wohnzimmer|\bbureau\b/.test(s)) return 'living'
  if (/porch|patio|deck|balcony|yard|exterior|\bbalcon\b|\bterrasse\b|\bterraza\b/.test(s)) return 'exterior'
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
      const beamRole = typeof n.role === 'string' ? n.role : undefined
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
            beamRole,
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
          beamRole,
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

function isElevatedBeamObstacle(o: PlumbingObstacle): boolean {
  return (
    o.category === 'structural' &&
    (o.structuralKind === 'beam' || o.beamRole === 'header' || /header|beam|ridge/i.test(o.label)) &&
    o.box.maxY > 0.5
  )
}

/**
 * Given a vertical riser/drop at `(x, z)` that collides with one or more obstacles,
 * generate candidate lateral `(x', z')` jog positions just outside the colliding AABBs.
 */
function buildLateralEscapeCandidates(
  x: number,
  z: number,
  hits: ReadonlyArray<PlumbingObstacle>,
  clearPad: number,
): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = []
  const seen = new Set<string>()
  const add = (cx: number, cz: number) => {
    const k = `${Math.round(cx * 100)},${Math.round(cz * 100)}`
    if (seen.has(k)) return
    seen.add(k)
    out.push([cx, cz])
  }
  for (const obs of hits) {
    // Try shortest escapes along X and Z past the obstacle's jambs / faces
    const leftX = obs.box.minX - clearPad
    const rightX = obs.box.maxX + clearPad
    const backZ = obs.box.minZ - clearPad
    const frontZ = obs.box.maxZ + clearPad
    const ordered: Array<readonly [number, number, number]> = [
      [leftX, z, Math.abs(leftX - x)],
      [rightX, z, Math.abs(rightX - x)],
      [x, backZ, Math.abs(backZ - z)],
      [x, frontZ, Math.abs(frontZ - z)],
    ]
    ordered.sort((a, b) => a[2] - b[2])
    for (const [cx, cz] of ordered) add(cx, cz)
    // Also try diagonal corners in case two beams meet at a corner/post
    add(leftX, backZ)
    add(leftX, frontZ)
    add(rightX, backZ)
    add(rightX, frontZ)
  }
  return out
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
  let detoured = false
  let underBeamY: number | null = null

  if (bestClashes.length > 0) {
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

    const tryCandidate = (cand: Vec3[]): boolean => {
      const c = detectPlumbingClashes(cand, obstacles, pipeRadiusM)
      if (c.length < bestClashes.length) {
        bestPath = cand
        bestClashes = c
        detoured = true
      }
      return bestClashes.length === 0
    }

    if (underBeamY !== null) {
      for (const sy of allUnderBeamY !== null && allUnderBeamY < underBeamY - 0.01 ? [underBeamY, allUnderBeamY] : [underBeamY]) {
        for (const wp of [
          [[to[0], from[2]], [to[0], to[2]]] as const,
          [[from[0], to[2]], [to[0], to[2]]] as const,
        ]) {
          if (tryCandidate(buildSlopedCandidate(wp, sy))) break
        }
        if (bestClashes.length === 0) break
      }
    }

    if (bestClashes.length > 0) {
      const midX = (from[0] + to[0]) / 2
      const midZ = (from[2] + to[2]) / 2
      const edgePad = pipeRadiusM + 0.08
      const startYs = Array.from(
        new Set(
          [underBeamY, allUnderBeamY, startY].filter((v): v is number => v !== null),
        ),
      )

      // Check if the vertical drop from `from` directly collides with an under-floor girder or column
      const dropProbeY = startYs[0] ?? startY
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
          if (bestClashes.length === 0) break
        }
        if (bestClashes.length === 0) break
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
 * columns, and NEC 110.26(E) obstacles.
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
  const minHorizontalVentY = floodRimHeightM + 6 * INCHES_TO_METERS + 0.04
  const minTieInY = floodRimHeightM + 6 * INCHES_TO_METERS + 0.1
  const tieInHeightM = Math.max(minTieInY, ceilingHeightM - 0.15)

  const buildVentCandidate = (
    waypoints: ReadonlyArray<readonly [number, number]>,
    tieY = tieInHeightM,
    riserJog?: { x: number; z: number; jogY: number },
  ): Vec3[] => {
    const pts: Vec3[] = riserJog
      ? [
          from,
          [from[0], riserJog.jogY, from[2]],
          [riserJog.x, riserJog.jogY, riserJog.z],
          [riserJog.x, tieY, riserJog.z],
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
  let bestTieInY = tieInHeightM
  let detoured = false

  if (bestClashes.length > 0) {
    const edgePad = pipeRadiusM + 0.07
    const maxAtticTieY = ceilingHeightM + 0.36
    const elevatedHits = bestClashes.filter(isElevatedBeamObstacle)
    const allElevatedBeams = obstacles.filter(isElevatedBeamObstacle)

    // Candidate attic/upper-wall tie-in elevations:
    // 1. Default tieInHeightM
    // 2. Hop cleanly ABOVE wall headers into ceiling/attic space (while remaining below stack roof exit)
    // 3. Duck cleanly BELOW a high ceiling/ridge beam when still >= 6" above fixture flood rim (IPC 905.5)
    const tieYs: number[] = [tieInHeightM]
    const pushTieY = (y: number) => {
      if (y < minHorizontalVentY || y > maxAtticTieY) return
      if (!tieYs.some((v) => Math.abs(v - y) < 0.02)) tieYs.push(y)
    }
    if (elevatedHits.length > 0) {
      const aboveHit = Math.max(...elevatedHits.map((o) => o.box.maxY)) + pipeRadiusM + 0.05
      const belowHit = Math.min(...elevatedHits.map((o) => o.box.minY)) - pipeRadiusM - 0.05
      pushTieY(aboveHit)
      pushTieY(belowHit)
    }
    const headerBeams = allElevatedBeams.filter(
      (o) => o.beamRole === 'header' || /header/i.test(o.label) || o.box.maxY <= ceilingHeightM + 0.08,
    )
    if (headerBeams.length > 0) {
      pushTieY(Math.max(...headerBeams.map((o) => o.box.maxY)) + pipeRadiusM + 0.05)
    }
    pushTieY(ceilingHeightM + 0.14)
    pushTieY(ceilingHeightM + 0.28)

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

    const tryVent = (cand: Vec3[], tieY: number): boolean => {
      const c = detectPlumbingClashes(cand, obstacles, pipeRadiusM)
      if (c.length < bestClashes.length) {
        bestPath = cand
        bestClashes = c
        bestTieInY = tieY
        detoured = true
      }
      return bestClashes.length === 0
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
        if (bestClashes.length === 0) break
      }
      if (bestClashes.length === 0) break
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
 * - Automatically detours below floor girders, around headers/beams, and clear of NEC 110.26(E)
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
  let detoured = false

  if (bestClashes.length > 0) {
    const edgePad = pipeRadiusM + 0.07
    const allUnderBeams = obstacles.filter(isUnderFloorBeamObstacle)
    const structuralHits = bestClashes.filter(isUnderFloorBeamObstacle)
    const elevatedHits = bestClashes.filter(isElevatedBeamObstacle)

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
      pushPlaneY(Math.min(...elevatedHits.map((o) => o.box.minY)) - pipeRadiusM - 0.06)
      pushPlaneY(Math.max(...elevatedHits.map((o) => o.box.maxY)) + pipeRadiusM + 0.06)
    }
    pushPlaneY(routingPlaneY)
    pushPlaneY(routingPlaneY - 0.28)

    const tryPressurized = (cand: Vec3[]): boolean => {
      const c = detectPlumbingClashes(cand, obstacles, pipeRadiusM)
      if (c.length < bestClashes.length) {
        bestPath = cand
        bestClashes = c
        detoured = true
      }
      return bestClashes.length === 0
    }

    // Detect if the vertical drop at `from` or vertical rise at `to` passes through a girder/header/column
    const probeY = planeYs[0] ?? routingPlaneY
    const fromDropHits = detectPlumbingClashes([from, [from[0], probeY, from[2]]], obstacles, pipeRadiusM)
    const toRiseHits = detectPlumbingClashes([[to[0], probeY, to[2]], to], obstacles, pipeRadiusM)

    const fromJogs: Array<readonly [number, number] | undefined> = [
      undefined,
      ...(fromDropHits.length > 0 ? buildLateralEscapeCandidates(from[0], from[2], fromDropHits, edgePad) : []),
    ]
    const toJogs: Array<readonly [number, number] | undefined> = [
      undefined,
      ...(toRiseHits.length > 0 ? buildLateralEscapeCandidates(to[0], to[2], toRiseHits, edgePad) : []),
    ]

    for (const fJog of fromJogs) {
      for (const tJog of toJogs) {
        const fx = fJog ? fJog[0] : from[0]
        const fz = fJog ? fJog[1] : from[2]
        const tx = tJog ? tJog[0] : to[0]
        const tz = tJog ? tJog[1] : to[2]
        const dynMids = buildObstacleDetourWaypoints([fx, fz], [tx, tz], bestClashes, edgePad)

        for (const py of planeYs) {
          const modes: Array<readonly ['x' | 'z' | 'diag', number]> = [
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
          for (const [m, off] of modes) {
            if (tryPressurized(buildCandidate(m, off, py, fJog, tJog))) break
          }
          if (bestClashes.length === 0) break
          for (const mid of dynMids) {
            if (tryPressurized(buildCandidate('x', 0, py, fJog, tJog, mid))) break
          }
          if (bestClashes.length === 0) break
        }
        if (bestClashes.length === 0) break
      }
      if (bestClashes.length === 0) break
    }
  }

  return {
    path: bestPath,
    lengthFt: round2(polylineLengthM(bestPath) * METERS_TO_FEET),
    detoured,
    clashes: bestClashes,
  }
}
