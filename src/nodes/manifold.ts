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

export function getPlumbingManifoldPorts(node: PlumbingManifoldNode): NodePort[] {
  const [x, y, zPos] = node.position
  return [
    { id: 'hot-in', position: [x - 0.085, y - 0.32, zPos], direction: [0, -1, 0], diameter: 0.75, system: 'water' },
    { id: 'cold-in', position: [x + 0.085, y - 0.32, zPos], direction: [0, -1, 0], diameter: 0.75, system: 'water' },
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
  const hw = 0.22
  const hd = 0.08
  const baseStroke = node.manifoldKind === 'gas-csst' ? '#eab308' : '#0284c7'
  const stroke = selected && view?.palette ? view.palette.selectedStroke : baseStroke

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: [
        [cx - hw, cz - hd],
        [cx + hw, cz - hd],
        [cx + hw, cz + hd],
        [cx - hw, cz + hd],
      ],
      fill: baseStroke,
      fillOpacity: 0.16,
      stroke,
      strokeWidth: 0.025,
    },
    { kind: 'line', x1: cx - hw * 0.45, y1: cz - hd, x2: cx - hw * 0.45, y2: cz + hd, stroke: '#dc2626', strokeWidth: 0.025 },
    { kind: 'line', x1: cx + hw * 0.45, y1: cz - hd, x2: cx + hw * 0.45, y2: cz + hd, stroke: '#2563eb', strokeWidth: 0.025 },
  ]
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
