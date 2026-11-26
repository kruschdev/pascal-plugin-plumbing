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

  switch (node.equipmentKind) {
    case 'gas-meter': {
      const [gxIn, gzIn] = rotOffset(-0.11, 0)
      const [gxOut, gzOut] = rotOffset(0.11, 0)
      return [
        { id: 'gas-in', position: [gxIn, y + 0.35, gzIn], direction: [0, 1, 0], diameter: 0.75, system: 'gas' },
        { id: 'gas-out', position: [gxOut, y + 0.35, gzOut], direction: [0, 1, 0], diameter: 0.75, system: 'gas' },
      ]
    }
    case 'water-heater-tankless-gas': {
      const [cx, cz] = rotOffset(0.1, 0)
      const [hx, hz] = rotOffset(-0.1, 0)
      return [
        { id: 'cold-in', position: [cx, y + 0.90, cz], direction: [0, -1, 0], diameter: 0.75, system: 'water' },
        { id: 'hot-out', position: [hx, y + 0.90, hz], direction: [0, -1, 0], diameter: 0.75, system: 'water' },
        { id: 'gas-in', position: [x, y + 0.90, zPos], direction: [0, -1, 0], diameter: 0.75, system: 'gas' },
      ]
    }
    case 'expansion-tank':
      return [
        { id: 'water-in', position: [x, y + 0.25, zPos], direction: [0, 1, 0], diameter: 0.75, system: 'water' },
      ]
    case 'main-shutoff-prv':
      return [
        { id: 'main-in', position: [x, y - 0.28, zPos], direction: [0, -1, 0], diameter: 1, system: 'water' },
        { id: 'main-out', position: [x, y + 0.28, zPos], direction: [0, 1, 0], diameter: 1, system: 'water' },
      ]
    case 'water-softener': {
      const [inX, inZ] = rotOffset(-0.26, 0)
      const [outX, outZ] = rotOffset(-0.18, 0)
      return [
        { id: 'cold-in', position: [inX, y + 1.32, inZ], direction: [0, 1, 0], diameter: 1, system: 'water' },
        { id: 'cold-out', position: [outX, y + 1.32, outZ], direction: [0, 1, 0], diameter: 1, system: 'water' },
      ]
    }
    case 'sump-pump': {
      const [dx, dz] = rotOffset(0.08, 0)
      return [
        { id: 'discharge', position: [dx, y + 1.25, dz], direction: [0, 1, 0], diameter: 1.5, system: 'dwv' },
      ]
    }
    case 'sewage-ejector': {
      const [dx, dz] = rotOffset(0.08, 0)
      const [vx, vz] = rotOffset(-0.09, 0)
      return [
        { id: 'discharge', position: [dx, y + 1.25, dz], direction: [0, 1, 0], diameter: 2, system: 'dwv' },
        { id: 'vent', position: [vx, y + 1.25, vz], direction: [0, 1, 0], diameter: 2, system: 'dwv' },
      ]
    }
    case 'recirc-pump': {
      const [inX, inZ] = rotOffset(-0.10, 0)
      const [outX, outZ] = rotOffset(0.10, 0)
      return [
        { id: 'recirc-in', position: [inX, y, inZ], direction: [-cos, 0, sin], diameter: 0.75, system: 'water' },
        { id: 'recirc-out', position: [outX, y, outZ], direction: [cos, 0, -sin], diameter: 0.75, system: 'water' },
      ]
    }
    case 'backwater-valve': {
      const [inX, inZ] = rotOffset(-0.17, 0)
      const [outX, outZ] = rotOffset(0.17, 0)
      return [
        { id: 'dwv-in', position: [inX, y, inZ], direction: [-cos, 0, sin], diameter: 3, system: 'dwv' },
        { id: 'dwv-out', position: [outX, y, outZ], direction: [cos, 0, -sin], diameter: 3, system: 'dwv' },
      ]
    }
    default: {
      const [cx, cz] = rotOffset(0.1, 0)
      const [hx, hz] = rotOffset(-0.1, 0)
      const ports: NodePort[] = [
        { id: 'cold-in', position: [cx, y + 1.45, cz], direction: [0, 1, 0], diameter: 0.75, system: 'water' },
        { id: 'hot-out', position: [hx, y + 1.45, hz], direction: [0, 1, 0], diameter: 0.75, system: 'water' },
      ]
      if (node.equipmentKind === 'water-heater-tank-gas') {
        const [gx, gz] = rotOffset(0, 0.30)
        ports.push({ id: 'gas-in', position: [gx, y + 0.34, gz], direction: [sin, 0, cos], diameter: 0.5, system: 'gas' })
      }
      return ports
    }
  }
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

const RECT_EQUIPMENT_FOOTPRINTS: Readonly<Partial<Record<EquipmentKind, readonly [number, number]>>> = {
  'gas-meter': [0.34, 0.24],
  'water-heater-tankless-gas': [0.40, 0.28],
  'water-softener': [0.76, 0.40],
  'main-shutoff-prv': [0.22, 0.14],
  'recirc-pump': [0.22, 0.14],
  'backwater-valve': [0.34, 0.16],
}

export function buildPlumbingEquipmentFloorplan(
  node: PlumbingEquipmentNode,
  ctx: GeometryContext,
): FloorplanGeometry {
  const view = ctx.viewState
  const selected = (view?.selected || view?.highlighted) ?? false
  const [cx, , cz] = node.position
  const rot = node.rotation ?? 0
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const toWorld = (lx: number, lz: number): [number, number] => [
    cx + lx * cos + lz * sin,
    cz - lx * sin + lz * cos,
  ]

  const baseStroke =
    node.equipmentKind === 'gas-meter'
      ? '#eab308'
      : node.equipmentKind === 'sump-pump' ||
          node.equipmentKind === 'sewage-ejector' ||
          node.equipmentKind === 'backwater-valve'
        ? '#64748b'
        : '#2563eb'
  const stroke = selected && view?.palette ? view.palette.selectedStroke : baseStroke

  const rectDims = RECT_EQUIPMENT_FOOTPRINTS[node.equipmentKind as EquipmentKind]
  const children: FloorplanGeometry[] = []

  if (rectDims) {
    const hw = rectDims[0] / 2
    const hd = rectDims[1] / 2
    const [fx1, fy1] = toWorld(-hw * 0.7, hd * 0.6)
    const [fx2, fy2] = toWorld(hw * 0.7, hd * 0.6)
    children.push(
      {
        kind: 'polygon',
        points: [toWorld(-hw, -hd), toWorld(hw, -hd), toWorld(hw, hd), toWorld(-hw, hd)],
        fill: baseStroke,
        fillOpacity: 0.14,
        stroke,
        strokeWidth: 0.025,
      },
      { kind: 'line', x1: fx1, y1: fy1, x2: fx2, y2: fy2, stroke, strokeWidth: 0.02 },
    )
  } else {
    const r =
      node.equipmentKind.startsWith('water-heater-tank') || node.equipmentKind === 'water-heater-hpwh'
        ? 0.3
        : node.equipmentKind === 'expansion-tank'
          ? 0.14
          : 0.25
    const [lx1, ly1] = toWorld(-r * 0.65, 0)
    const [lx2, ly2] = toWorld(r * 0.65, 0)
    const [lz1, lz1y] = toWorld(0, -r * 0.65)
    const [lz2, lz2y] = toWorld(0, r * 0.95)
    children.push(
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
      { kind: 'line', x1: lx1, y1: ly1, x2: lx2, y2: ly2, stroke, strokeWidth: 0.02 },
      { kind: 'line', x1: lz1, y1: lz1y, x2: lz2, y2: lz2y, stroke, strokeWidth: 0.02 },
    )
  }
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
