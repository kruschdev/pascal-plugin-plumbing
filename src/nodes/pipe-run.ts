/**
 * `plumbing:pipe-run` — 3D Gravity-Sloped DWV, Vent Stack, Cold/Hot/Recirc Supply,
 * Fuel Gas (IFGC), Condensate, and Rigid Dryer Vent Pipe Runs.
 * Automatically renders 3D framing bore collars & steel nail plates at Bones stud/plate crossings!
 * Render-safe module: zero `@pascal-app/editor` imports.
 */

import {
  BaseNode,
  type FloorplanGeometry,
  type GeometryContext,
  type NodeDefinition,
  type NodePort,
  nodeType,
  objectId,
} from '@pascal-app/core'
import { Group } from 'three'
import { z } from 'zod'
import { buildPipeRunCad } from '../cad/fittings'
import { systemColorMeta } from '../cad/materials'
import {
  type SceneNodeLike,
  computePipeFramingPenetrations,
  extractBonesPlumbingContext,
  resolveNodeLevelId,
} from '../ipc/framing-interop'
import { extractWallSegments } from '../ipc/routing'
import { type PipeMaterial, type PipeNominalSize, type PlumbingSystem, getPipeOuterDiameterM } from '../ipc/tables'
import { PipeNominalSizeEnum } from './fixture'

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])

export const PlumbingSystemEnum = z.enum([
  'cold-water',
  'hot-water',
  'hot-recirc',
  'dwv-drain',
  'dwv-vent',
  'fuel-gas',
  'condensate',
  'dryer-vent',
])

export const PipeMaterialEnum = z.enum([
  'pex-a',
  'pex-b',
  'copper-l',
  'copper-m',
  'cpvc',
  'pvc-dwv',
  'abs-dwv',
  'cast-iron',
  'csst',
  'black-iron',
  'rigid-aluminum',
])

export const PlumbingPipeRunNode = BaseNode.extend({
  id: objectId('plumbpipe'),
  type: nodeType('plumbing:pipe-run'),
  path: z.array(Vec3Schema).min(2),
  system: PlumbingSystemEnum.default('cold-water'),
  material: PipeMaterialEnum.default('pex-a'),
  nominalSize: PipeNominalSizeEnum.default('1/2"'),
  slopeInPerFt: z.number().min(0).max(2).default(0),
  dfuLoad: z.number().min(0).max(1000).default(0),
  wsfuLoad: z.number().min(0).max(1000).default(0),
  gasBtuh: z.number().min(0).max(2000000).default(0),
  trapArmLengthFt: z.number().min(0).max(50).optional(),
  sourceNodeId: z.string().optional(),
  targetNodeId: z.string().optional(),
  wallId: z.string().optional(),
  hasCleanout: z.boolean().default(false),
  hasSedimentTrap: z.boolean().default(true),
  hasShutoffWithin6Ft: z.boolean().default(true),
  isHorizontalSanTee: z.boolean().default(false),
  isMainVentStack: z.boolean().default(false),
  showFramingPenetrations: z.boolean().default(true),
  /** Optional revision token bumped when adjacent walls/framing change to invalidate cached 3D bore collars. */
  framingRevision: z.number().int().min(0).optional(),
})

export type PlumbingPipeRunNode = z.infer<typeof PlumbingPipeRunNode>

function normalizeDir(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  sign: 1 | -1,
): [number, number, number] {
  const dx = (b[0] - a[0]) * sign
  const dy = (b[1] - a[1]) * sign
  const dz = (b[2] - a[2]) * sign
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-5) return [0, 1, 0]
  return [dx / len, dy / len, dz / len]
}

export function getPlumbingPipeRunPorts(node: PlumbingPipeRunNode): NodePort[] {
  const start = node.path[0]
  const end = node.path[node.path.length - 1]
  if (!start || !end) return []
  const second = node.path[1] ?? end
  const prev = node.path[node.path.length - 2] ?? start
  const sys = node.system.startsWith('dwv') ? 'dwv' : node.system === 'fuel-gas' ? 'gas' : 'water'
  return [
    { id: 'start', position: start, direction: normalizeDir(start, second, -1), diameter: 1, system: sys },
    { id: 'end', position: end, direction: normalizeDir(prev, end, 1), diameter: 1, system: sys },
  ]
}

export function buildPlumbingPipeRunGeometry(
  node: PlumbingPipeRunNode,
  ctx: GeometryContext,
): Group {
  let penetrations: ReturnType<typeof computePipeFramingPenetrations> = []
  if (node.showFramingPenetrations && ctx && typeof ctx === 'object' && 'nodes' in ctx && ctx.nodes) {
    const record = ctx.nodes as unknown as Readonly<Record<string, SceneNodeLike>>
    const levelId = resolveNodeLevelId(record, node as unknown as SceneNodeLike) ?? node.parentId ?? null
    const walls = extractWallSegments(record, levelId)
    const bones = extractBonesPlumbingContext(record, levelId)
    penetrations = computePipeFramingPenetrations({
      pipeRunId: node.id,
      path: node.path,
      pipeSize: node.nominalSize as PipeNominalSize,
      material: node.material as PipeMaterial,
      walls,
      bonesContext: bones,
    })
  }

  return buildPipeRunCad({
    id: node.id,
    path: node.path,
    system: node.system as PlumbingSystem,
    material: node.material as PipeMaterial,
    nominalSize: node.nominalSize as PipeNominalSize,
    hasCleanout: node.hasCleanout,
    penetrations,
  })
}

export function buildPlumbingPipeRunFloorplan(
  node: PlumbingPipeRunNode,
  ctx: GeometryContext,
): FloorplanGeometry {
  const view = ctx.viewState
  const selected = (view?.selected || view?.highlighted) ?? false
  const meta = systemColorMeta(node.system as PlumbingSystem)
  const stroke = selected && view?.palette ? view.palette.selectedStroke : meta.hex
  const children: FloorplanGeometry[] = []

  let drewHorizontal = false
  for (let i = 0; i < node.path.length - 1; i++) {
    const a = node.path[i]!
    const b = node.path[i + 1]!
    if (Math.hypot(b[0] - a[0], b[2] - a[2]) < 1e-3) continue
    drewHorizontal = true
    children.push({
      kind: 'line',
      x1: a[0],
      y1: a[2],
      x2: b[0],
      y2: b[2],
      stroke,
      strokeWidth: selected ? 0.042 : node.system === 'dwv-drain' ? 0.032 : 0.022,
      strokeDasharray: meta.dash2d ? '0.14 0.07' : undefined,
    })
  }

  const start = node.path[0]
  if (!drewHorizontal && start && node.path.length >= 2) {
    // Pure vertical pipe stack (e.g., 3"/4" Main Vent Stack): render a visible 2D riser circle + crosshair
    const odM = getPipeOuterDiameterM(node.nominalSize as PipeNominalSize, node.material as PipeMaterial)
    const r = Math.max(0.085, (odM / 2) * 1.6)
    const sw = selected ? 0.036 : 0.024
    children.push(
      {
        kind: 'circle',
        cx: start[0],
        cy: start[2],
        r,
        fill: meta.hex,
        fillOpacity: 0.22,
        stroke,
        strokeWidth: sw,
      },
      {
        kind: 'line',
        x1: start[0] - r * 0.85,
        y1: start[2],
        x2: start[0] + r * 0.85,
        y2: start[2],
        stroke,
        strokeWidth: 0.018,
      },
      {
        kind: 'line',
        x1: start[0],
        y1: start[2] - r * 0.85,
        x2: start[0],
        y2: start[2] + r * 0.85,
        stroke,
        strokeWidth: 0.018,
      },
    )
  }

  if (selected && start) {
    children.push({ kind: 'move-handle', point: [start[0], start[2]] })
  }
  return { kind: 'group', children }
}

export const plumbingPipeRunRenderDefinition: NodeDefinition<typeof PlumbingPipeRunNode> = {
  kind: 'plumbing:pipe-run',
  schemaVersion: 1,
  schema: PlumbingPipeRunNode,
  category: 'utility',
  distributionRole: 'run',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Pipe Run',
    path: [
      [0, 0.5, 0],
      [1, 0.5, 0],
    ],
    system: 'cold-water',
    material: 'pex-a',
    nominalSize: '1/2"',
    slopeInPerFt: 0,
    dfuLoad: 0,
    wsfuLoad: 0,
    gasBtuh: 0,
    hasCleanout: false,
    hasSedimentTrap: true,
    hasShutoffWithin6Ft: true,
    isHorizontalSanTee: false,
    isMainVentStack: false,
    showFramingPenetrations: true,
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    snappable: {},
  },
  geometry: buildPlumbingPipeRunGeometry,
  geometryKey: (n) =>
    JSON.stringify([
      n.path,
      n.system,
      n.material,
      n.nominalSize,
      n.hasCleanout,
      n.showFramingPenetrations,
      n.wallId ?? null,
      n.framingRevision ?? 0,
    ]),
  ports: getPlumbingPipeRunPorts,
  floorplan: buildPlumbingPipeRunFloorplan,
  presentation: {
    label: 'Pipe Run',
    description:
      'Gravity-sloped 3D DWV drain, vent stack, cold/hot/recirc supply, fuel gas, or rigid dryer vent run with framing bore collars.',
    icon: { kind: 'iconify', name: 'lucide:git-branch' },
    paletteSection: 'structure',
  },
  mcp: {
    description: '3D plumbing pipe polyline in level-local meters tracking system, material, nominalSize, gravity slope, DFU/WSFU/gas loads, and framing penetrations.',
  },
}
