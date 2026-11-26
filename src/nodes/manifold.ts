/**
 * `plumbing:manifold` — PEX Home-Run Manifold, Copper Trunk Header, or CSST Fuel-Gas Manifold.
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
import { buildManifoldCad } from '../cad/manifold-interior'
import type { ManifoldKind } from '../ipc/tables'

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])

export const ManifoldKindEnum = z.enum(['pex-homerun', 'copper-header', 'gas-csst'])

export const PlumbingManifoldNode = BaseNode.extend({
  id: objectId('plumbman'),
  type: nodeType('plumbing:manifold'),
  position: Vec3Schema.default([0, 1.35, 0]),
  rotation: z.number().default(0),
  manifoldKind: ManifoldKindEnum.default('pex-homerun'),
  portCount: z.number().int().min(4).max(36).default(12),
  supplyMaterial: z
    .enum(['pex-a', 'pex-b', 'copper-l', 'copper-m', 'cpvc', 'csst', 'black-iron'])
    .default('pex-a'),
  coverRemoved: z.boolean().default(false),
})

export type PlumbingManifoldNode = z.infer<typeof PlumbingManifoldNode>

function rotateManifoldLocal2D(
  cx: number,
  cz: number,
  lx: number,
  lz: number,
  rot: number,
): [number, number] {
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  return [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos]
}

export function getPlumbingManifoldPorts(node: PlumbingManifoldNode): NodePort[] {
  const [x, y, zPos] = node.position
  const rot = node.rotation ?? 0
  if (node.manifoldKind === 'gas-csst') {
    return [
      { id: 'gas-in', position: [x, y - 0.25, zPos], direction: [0, -1, 0], diameter: 0.75, system: 'gas' },
    ]
  }
  const [hx, hz] = rotateManifoldLocal2D(x, zPos, -0.085, 0, rot)
  const [cx, cz] = rotateManifoldLocal2D(x, zPos, 0.085, 0, rot)
  return [
    { id: 'hot-in', position: [hx, y - 0.32, hz], direction: [0, -1, 0], diameter: 0.75, system: 'water' },
    { id: 'cold-in', position: [cx, y - 0.32, cz], direction: [0, -1, 0], diameter: 0.75, system: 'water' },
  ]
}

export function buildPlumbingManifoldGeometry(
  node: PlumbingManifoldNode,
  _ctx: GeometryContext,
): Group {
  const group = new Group()
  group.name = `plumbing-manifold-${node.id}`
  group.add(
    buildManifoldCad({
      manifoldKind: node.manifoldKind as ManifoldKind,
      portCount: node.portCount,
      coverRemoved: node.coverRemoved,
    }),
  )
  return group
}

export function buildPlumbingManifoldFloorplan(
  node: PlumbingManifoldNode,
  ctx: GeometryContext,
): FloorplanGeometry {
  const view = ctx.viewState
  const selected = (view?.selected || view?.highlighted) ?? false
  const [cx, , cz] = node.position
  const rot = node.rotation ?? 0
  const hw = 0.22
  const hd = 0.08
  const baseStroke = node.manifoldKind === 'gas-csst' ? '#eab308' : '#0284c7'
  const stroke = selected && view?.palette ? view.palette.selectedStroke : baseStroke

  const p0 = rotateManifoldLocal2D(cx, cz, -hw, -hd, rot)
  const p1 = rotateManifoldLocal2D(cx, cz, hw, -hd, rot)
  const p2 = rotateManifoldLocal2D(cx, cz, hw, hd, rot)
  const p3 = rotateManifoldLocal2D(cx, cz, -hw, hd, rot)

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: [p0, p1, p2, p3],
      fill: baseStroke,
      fillOpacity: 0.16,
      stroke,
      strokeWidth: 0.025,
    },
  ]
  if (node.manifoldKind === 'gas-csst') {
    const g0 = rotateManifoldLocal2D(cx, cz, -hw * 0.7, 0, rot)
    const g1 = rotateManifoldLocal2D(cx, cz, hw * 0.7, 0, rot)
    children.push({ kind: 'line', x1: g0[0], y1: g0[1], x2: g1[0], y2: g1[1], stroke: '#eab308', strokeWidth: 0.025 })
  } else {
    const h0 = rotateManifoldLocal2D(cx, cz, -hw * 0.45, -hd, rot)
    const h1 = rotateManifoldLocal2D(cx, cz, -hw * 0.45, hd, rot)
    const c0 = rotateManifoldLocal2D(cx, cz, hw * 0.45, -hd, rot)
    const c1 = rotateManifoldLocal2D(cx, cz, hw * 0.45, hd, rot)
    children.push(
      { kind: 'line', x1: h0[0], y1: h0[1], x2: h1[0], y2: h1[1], stroke: '#dc2626', strokeWidth: 0.025 },
      { kind: 'line', x1: c0[0], y1: c0[1], x2: c1[0], y2: c1[1], stroke: '#2563eb', strokeWidth: 0.025 },
    )
  }
  if (selected) {
    children.push({ kind: 'move-handle', point: [cx, cz] })
  }
  return { kind: 'group', children }
}

export const plumbingManifoldRenderDefinition: NodeDefinition<typeof PlumbingManifoldNode> = {
  kind: 'plumbing:manifold',
  schemaVersion: 1,
  schema: PlumbingManifoldNode,
  category: 'utility',
  distributionRole: 'equipment',
  facingIndicator: true,
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'PEX Home-Run Manifold (12-Port)',
    position: [0, 1.35, 0],
    rotation: 0,
    manifoldKind: 'pex-homerun',
    portCount: 12,
    supplyMaterial: 'pex-a',
    coverRemoved: false,
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 2] },
    duplicable: true,
    deletable: true,
    snappable: {},
  },
  geometry: buildPlumbingManifoldGeometry,
  geometryKey: (n) => JSON.stringify([n.manifoldKind, n.portCount, n.coverRemoved]),
  ports: getPlumbingManifoldPorts,
  floorplan: buildPlumbingManifoldFloorplan,
  presentation: {
    label: 'Plumbing Manifold',
    description: 'PEX home-run manifold with quarter-turn ball valves, copper trunk header, or CSST gas distribution block.',
    icon: { kind: 'iconify', name: 'lucide:sliders-horizontal' },
    paletteSection: 'structure',
  },
  mcp: {
    description: 'Plumbing distribution manifold (PEX home-run, copper header, or CSST gas block).',
  },
}
