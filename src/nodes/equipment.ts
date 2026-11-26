/**
 * `plumbing:equipment` — Water Heaters (Electric/Gas Tank, Tankless, HPWH),
 * Expansion Tanks, PRV/Shutoff, Water Softener, Sump/Sewage Pumps, Recirc Pump, Gas Meter, Backwater Valve.
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
import { buildEquipmentCad } from '../cad/equipment'
import { getEquipmentElectricalDemand } from '../ipc/framing-interop'
import type { EquipmentKind } from '../ipc/tables'

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])

export const ElectricalDemandSchema = z.object({
  required: z.boolean().default(true),
  voltage: z.union([z.literal(120), z.literal(208), z.literal(240), z.literal(480)]).default(120),
  poles: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  breakerAmps: z.number().min(15).max(200).default(20),
  loadVa: z.number().min(0).max(50000).default(1200),
  continuous: z.boolean().default(false),
  dedicatedCircuit: z.boolean().default(true),
  gfciRequired: z.boolean().default(false),
  afciRequired: z.boolean().default(false),
  loadCategory: z
    .enum(['fixed', 'appliance', 'motor', 'hvac-heating', 'hvac-cooling', 'heat-pump'])
    .default('fixed'),
  label: z.string().default('Plumbing Equipment'),
})

export const EquipmentKindEnum = z.enum([
  'water-heater-tank-gas',
  'water-heater-tank-electric',
  'water-heater-tankless-gas',
  'water-heater-hpwh',
  'expansion-tank',
  'main-shutoff-prv',
  'water-softener',
  'sump-pump',
  'sewage-ejector',
  'recirc-pump',
  'gas-meter',
  'backwater-valve',
])

export const PlumbingEquipmentNode = BaseNode.extend({
  id: objectId('plumbeq'),
  type: nodeType('plumbing:equipment'),
  position: Vec3Schema.default([0, 0, 0]),
  rotation: z.number().default(0),
  equipmentKind: EquipmentKindEnum.default('water-heater-tank-electric'),
  roomName: z.string().default('Utility'),
  capacityGal: z.number().min(0).max(500).default(50),
  gasBtuh: z.number().min(0).max(500000).default(0),
  watts: z.number().min(0).max(50000).default(4500),
  roomVolumeCuFt: z.number().min(0).max(50000).optional(),
  hasDrainPan: z.boolean().default(true),
  hasTpDischarge: z.boolean().default(true),
  hasExpansionTank: z.boolean().default(true),
  electricalDemand: ElectricalDemandSchema.nullable().optional(),
})

export type PlumbingEquipmentNode = z.infer<typeof PlumbingEquipmentNode>

export function getPlumbingEquipmentPorts(node: PlumbingEquipmentNode): NodePort[] {
  const [x, y, zPos] = node.position
  const rot = node.rotation ?? 0
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const rotOffset = (lx: number, lz: number): [number, number] => [
    x + lx * cos + lz * sin,
    zPos - lx * sin + lz * cos,
  ]
  const [cx, cz] = rotOffset(0.1, 0)
  const [hx, hz] = rotOffset(-0.1, 0)
  if (node.equipmentKind === 'gas-meter') {
    return [
      { id: 'gas-out', position: [x, y + 0.35, zPos], direction: [0, 1, 0], diameter: 0.75, system: 'gas' },
    ]
  }
  return [
    { id: 'cold-in', position: [cx, y + 1.45, cz], direction: [0, 1, 0], diameter: 0.75, system: 'water' },
    { id: 'hot-out', position: [hx, y + 1.45, hz], direction: [0, 1, 0], diameter: 0.75, system: 'water' },
  ]
}

export function buildPlumbingEquipmentGeometry(
  node: PlumbingEquipmentNode,
  _ctx: GeometryContext,
): Group {
  const group = new Group()
  group.name = `plumbing-equipment-${node.id}`
  group.add(
    buildEquipmentCad({
      equipmentKind: node.equipmentKind as EquipmentKind,
      capacityGal: node.capacityGal,
      hasDrainPan: node.hasDrainPan,
    }),
  )
  return group
}

export function buildPlumbingEquipmentFloorplan(
  node: PlumbingEquipmentNode,
  ctx: GeometryContext,
): FloorplanGeometry {
  const view = ctx.viewState
  const selected = (view?.selected || view?.highlighted) ?? false
  const [cx, , cz] = node.position
  const r =
    node.equipmentKind.startsWith('water-heater-tank') || node.equipmentKind === 'water-heater-hpwh'
      ? 0.3
      : 0.22
  const baseStroke = node.equipmentKind === 'gas-meter' ? '#eab308' : '#2563eb'
  const stroke = selected && view?.palette ? view.palette.selectedStroke : baseStroke

  const children: FloorplanGeometry[] = [
    {
      kind: 'circle',
      cx,
      cy: cz,
      r,
      fill: baseStroke,
      fillOpacity: 0.14,
      stroke,
      strokeWidth: 0.025,
    },
    { kind: 'line', x1: cx - r * 0.65, y1: cz, x2: cx + r * 0.65, y2: cz, stroke, strokeWidth: 0.02 },
    { kind: 'line', x1: cx, y1: cz - r * 0.65, x2: cx, y2: cz + r * 0.65, stroke, strokeWidth: 0.02 },
  ]
  if (selected) {
    children.push({ kind: 'move-handle', point: [cx, cz] })
  }
  return { kind: 'group', children }
}

export const plumbingEquipmentRenderDefinition: NodeDefinition<typeof PlumbingEquipmentNode> = {
  kind: 'plumbing:equipment',
  schemaVersion: 1,
  schema: PlumbingEquipmentNode,
  category: 'utility',
  distributionRole: 'equipment',
  facingIndicator: true,
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Water Heater (50 gal)',
    position: [0, 0, 0],
    rotation: 0,
    equipmentKind: 'water-heater-tank-electric',
    roomName: 'Utility',
    capacityGal: 50,
    gasBtuh: 0,
    watts: 4500,
    hasDrainPan: true,
    hasTpDischarge: true,
    hasExpansionTank: true,
    electricalDemand: getEquipmentElectricalDemand('water-heater-tank-electric', 4500),
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 2] },
    duplicable: true,
    deletable: true,
    snappable: {},
  },
  geometry: buildPlumbingEquipmentGeometry,
  geometryKey: (n) => JSON.stringify([n.equipmentKind, n.capacityGal, n.hasDrainPan]),
  ports: getPlumbingEquipmentPorts,
  floorplan: buildPlumbingEquipmentFloorplan,
  presentation: {
    label: 'Plumbing Equipment',
    description: 'Water heaters (electric/gas tank, tankless, HPWH), expansion tanks, PRVs, softeners, pumps, and gas meters.',
    icon: { kind: 'iconify', name: 'lucide:flame' },
    paletteSection: 'structure',
  },
  mcp: {
    description: 'Plumbing mechanical equipment with IPC safety flags and standardized cross-trade electricalDemand metadata.',
  },
}
