/**
 * `plumbing:fixture` — 18 Residential & Light-Commercial Plumbing Fixture Rough-Ins.
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
import { buildFixtureCad } from '../cad/fixtures'
import { getFixtureElectricalDemand } from '../ipc/framing-interop'
import { FIXTURE_SPECS, type FixtureKind } from '../ipc/tables'
import { ElectricalDemandSchema } from './equipment'

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])

export const FixtureKindEnum = z.enum([
  'water-closet',
  'lavatory',
  'kitchen-sink',
  'bathtub',
  'shower',
  'tub-shower-combo',
  'dishwasher',
  'clothes-washer',
  'laundry-sink',
  'bar-sink',
  'floor-drain',
  'hose-bibb',
  'bidet',
  'garbage-disposal',
  'urinal',
  'mop-sink',
  'drinking-fountain',
  'grease-interceptor',
])

export const PipeNominalSizeEnum = z.enum([
  '3/8"',
  '1/2"',
  '3/4"',
  '1"',
  '1-1/4"',
  '1-1/2"',
  '2"',
  '2-1/2"',
  '3"',
  '4"',
  '6"',
])

export const PlumbingFixtureNode = BaseNode.extend({
  id: objectId('plumbfix'),
  type: nodeType('plumbing:fixture'),
  position: Vec3Schema.default([0, 0.5, 0]),
  rotation: z.number().default(0),
  fixtureKind: FixtureKindEnum.default('lavatory'),
  roomName: z.string().default('Bathroom'),
  wallId: z.string().optional(),
  dfu: z.number().min(0).max(20).default(1),
  wsfuCold: z.number().min(0).max(20).default(0.5),
  wsfuHot: z.number().min(0).max(20).default(0.5),
  wsfuTotal: z.number().min(0).max(25).default(0.7),
  trapSize: PipeNominalSizeEnum.nullable().default('1-1/4"'),
  drainSize: PipeNominalSizeEnum.nullable().default('1-1/2"'),
  ventSize: PipeNominalSizeEnum.nullable().default('1-1/2"'),
  supplySize: PipeNominalSizeEnum.nullable().default('1/2"'),
  hasVacuumBreaker: z.boolean().default(true),
  hasPTrap: z.boolean().default(true),
  electricalDemand: ElectricalDemandSchema.nullable().optional(),
})

export type PlumbingFixtureNode = z.infer<typeof PlumbingFixtureNode>

function rotateLocal2D(
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

export function getPlumbingFixturePorts(node: PlumbingFixtureNode): NodePort[] {
  const [x, y, zPos] = node.position
  const rot = node.rotation ?? 0
  const backDir: [number, number, number] = [-Math.sin(rot), 0, -Math.cos(rot)]
  const ports: NodePort[] = []
  if (node.drainSize) {
    ports.push({ id: 'drain', position: [x, Math.max(0, y - 0.15), zPos], direction: [0, -1, 0], diameter: 2, system: 'dwv' })
  }
  if (node.supplySize) {
    const [cx, cz] = rotateLocal2D(x, zPos, 0.08, 0, rot)
    ports.push({ id: 'cold', position: [cx, y, cz], direction: backDir, diameter: 0.5, system: 'water' })
    if (node.wsfuHot > 0) {
      const [hx, hz] = rotateLocal2D(x, zPos, -0.08, 0, rot)
      ports.push({ id: 'hot', position: [hx, y, hz], direction: backDir, diameter: 0.5, system: 'water' })
    }
  }
  return ports
}

export function buildPlumbingFixtureGeometry(
  node: PlumbingFixtureNode,
  _ctx: GeometryContext,
): Group {
  const group = new Group()
  group.name = `plumbing-fixture-${node.id}`
  const cad = buildFixtureCad({ fixtureKind: node.fixtureKind as FixtureKind })
  const spec = FIXTURE_SPECS[node.fixtureKind as FixtureKind]
  // Offset CAD by nominal rough-in height (not -node.position[1]) so Y-axis dragging moves the 3D fixture naturally
  if (
    spec &&
    node.fixtureKind !== 'clothes-washer' &&
    node.fixtureKind !== 'hose-bibb' &&
    node.fixtureKind !== 'garbage-disposal'
  ) {
    cad.position.y = -spec.roughInHeightM
  }
  group.add(cad)
  return group
}

export function buildPlumbingFixtureFloorplan(
  node: PlumbingFixtureNode,
  ctx: GeometryContext,
): FloorplanGeometry {
  const view = ctx.viewState
  const selected = (view?.selected || view?.highlighted) ?? false
  const [cx, , cz] = node.position
  const rot = node.rotation ?? 0
  const spec = FIXTURE_SPECS[node.fixtureKind as FixtureKind]
  const hw = (spec?.dimensionsM[0] ?? 0.5) / 2
  const hd = (spec?.dimensionsM[2] ?? 0.5) / 2
  const baseStroke = node.fixtureKind === 'hose-bibb' ? '#2563eb' : '#0ea5e9'
  const stroke = selected && view?.palette ? view.palette.selectedStroke : baseStroke

  const p0 = rotateLocal2D(cx, cz, -hw, -hd, rot)
  const p1 = rotateLocal2D(cx, cz, hw, -hd, rot)
  const p2 = rotateLocal2D(cx, cz, hw, hd, rot)
  const p3 = rotateLocal2D(cx, cz, -hw, hd, rot)
  const d0 = rotateLocal2D(cx, cz, -hw * 0.5, -hd * 0.5, rot)
  const d1 = rotateLocal2D(cx, cz, hw * 0.5, hd * 0.5, rot)

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: [p0, p1, p2, p3],
      fill: baseStroke,
      fillOpacity: 0.12,
      stroke,
      strokeWidth: 0.02,
    },
    { kind: 'line', x1: d0[0], y1: d0[1], x2: d1[0], y2: d1[1], stroke, strokeWidth: 0.015 },
  ]
  if (selected) {
    children.push({ kind: 'move-handle', point: [cx, cz] })
  }
  return { kind: 'group', children }
}

export const plumbingFixtureRenderDefinition: NodeDefinition<typeof PlumbingFixtureNode> = {
  kind: 'plumbing:fixture',
  schemaVersion: 1,
  schema: PlumbingFixtureNode,
  category: 'utility',
  distributionRole: 'terminal',
  facingIndicator: true,
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Lavatory Rough-In',
    position: [0, 0.53, 0],
    rotation: 0,
    fixtureKind: 'lavatory',
    roomName: 'Bathroom',
    dfu: 1,
    wsfuCold: 0.5,
    wsfuHot: 0.5,
    wsfuTotal: 0.7,
    trapSize: '1-1/4"',
    drainSize: '1-1/2"',
    ventSize: '1-1/2"',
    supplySize: '1/2"',
    hasVacuumBreaker: true,
    hasPTrap: true,
    electricalDemand: getFixtureElectricalDemand('lavatory'),
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 2] },
    duplicable: true,
    deletable: true,
    snappable: {},
  },
  geometry: buildPlumbingFixtureGeometry,
  geometryKey: (n) => JSON.stringify([n.fixtureKind]),
  ports: getPlumbingFixturePorts,
  floorplan: buildPlumbingFixtureFloorplan,
  presentation: {
    label: 'Plumbing Fixture',
    description: 'Residential & commercial plumbing fixture rough-in with IPC DFU/WSFU units and drain/vent/supply ports.',
    icon: { kind: 'iconify', name: 'lucide:bath' },
    paletteSection: 'structure',
  },
  mcp: {
    description: 'Plumbing fixture node tracking DFU, cold/hot WSFU, rough-in sizes, P-trap, and electricalDemand metadata.',
  },
}
