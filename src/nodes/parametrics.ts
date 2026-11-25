/**
 * Auto-derived Pascal Inspector Parametrics for all 4 `plumbing:*` node kinds.
 */

import type { ParametricDescriptor } from '@pascal-app/core'
import { EquipmentKindEnum, type PlumbingEquipmentNode } from './equipment'
import { FixtureKindEnum, PipeNominalSizeEnum, type PlumbingFixtureNode } from './fixture'
import { ManifoldKindEnum, type PlumbingManifoldNode } from './manifold'
import { PipeMaterialEnum, type PlumbingPipeRunNode, PlumbingSystemEnum } from './pipe-run'

export const plumbingEquipmentParametrics: ParametricDescriptor<PlumbingEquipmentNode> = {
  groups: [
    {
      label: 'Equipment & Capacity',
      fields: [
        { key: 'equipmentKind', kind: 'enum', options: [...EquipmentKindEnum.options] },
        { key: 'capacityGal', kind: 'number', unit: 'gal', min: 0, max: 500, step: 5 },
        { key: 'gasBtuh', kind: 'number', unit: 'BTU/h', min: 0, max: 500000, step: 5000 },
        { key: 'watts', kind: 'number', unit: 'W', min: 0, max: 50000, step: 500 },
      ],
    },
    {
      label: 'IPC Safety & Compliance',
      fields: [
        { key: 'hasDrainPan', kind: 'boolean', label: 'Safety Drain Pan (IPC 504.7)' },
        { key: 'hasTpDischarge', kind: 'boolean', label: 'T&P Relief Pipe (IPC 504.6)' },
        { key: 'hasExpansionTank', kind: 'boolean', label: 'Expansion Tank (IPC 607.3)' },
      ],
    },
  ],
}

export const plumbingManifoldParametrics: ParametricDescriptor<PlumbingManifoldNode> = {
  groups: [
    {
      label: 'Manifold Configuration',
      fields: [
        { key: 'manifoldKind', kind: 'enum', options: [...ManifoldKindEnum.options], display: 'segmented' },
        { key: 'portCount', kind: 'number', min: 4, max: 36, step: 2 },
        { key: 'coverRemoved', kind: 'boolean', label: 'Expose Open Manifold Valves' },
      ],
    },
  ],
}

export const plumbingFixtureParametrics: ParametricDescriptor<PlumbingFixtureNode> = {
  groups: [
    {
      label: 'Fixture & IPC Units',
      fields: [
        { key: 'fixtureKind', kind: 'enum', options: [...FixtureKindEnum.options] },
        { key: 'dfu', kind: 'number', unit: 'DFU', min: 0, max: 20, step: 0.5 },
        { key: 'wsfuCold', kind: 'number', unit: 'WSFU', min: 0, max: 20, step: 0.5 },
        { key: 'wsfuHot', kind: 'number', unit: 'WSFU', min: 0, max: 20, step: 0.5 },
      ],
    },
    {
      label: 'Rough-In Sizing & Protection',
      fields: [
        { key: 'hasPTrap', kind: 'boolean', label: 'P-Trap Installed (IPC 1002.1)' },
        { key: 'hasVacuumBreaker', kind: 'boolean', label: 'Anti-Siphon Vacuum Breaker' },
      ],
    },
  ],
}

export const plumbingPipeRunParametrics: ParametricDescriptor<PlumbingPipeRunNode> = {
  groups: [
    {
      label: 'System & Material',
      fields: [
        { key: 'system', kind: 'enum', options: [...PlumbingSystemEnum.options] },
        { key: 'material', kind: 'enum', options: [...PipeMaterialEnum.options] },
        { key: 'nominalSize', kind: 'enum', options: [...PipeNominalSizeEnum.options] },
      ],
    },
    {
      label: 'Slope, Loads & Framing Bore Visualization',
      fields: [
        { key: 'slopeInPerFt', kind: 'number', unit: 'in/ft', min: 0, max: 2, step: 0.125 },
        { key: 'dfuLoad', kind: 'number', unit: 'DFU', min: 0, max: 1000, step: 1 },
        { key: 'wsfuLoad', kind: 'number', unit: 'WSFU', min: 0, max: 1000, step: 0.5 },
        { key: 'gasBtuh', kind: 'number', unit: 'BTU/h', min: 0, max: 2000000, step: 5000 },
        { key: 'hasCleanout', kind: 'boolean', label: 'Cleanout Installed (IPC 708.1)' },
        { key: 'hasSedimentTrap', kind: 'boolean', label: 'Gas Drip Leg (IFGC 408.4)' },
        { key: 'showFramingPenetrations', kind: 'boolean', label: 'Show 3D Stud Bore Rings & Nail Plates' },
      ],
    },
  ],
}
