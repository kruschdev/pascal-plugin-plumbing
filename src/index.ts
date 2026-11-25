/**
 * Main browser entry (`@kruschdev/pascal-plugin-plumbing`).
 *
 * Exports the full Pascal Plugin API v1 surface:
 * - `plumbingPlugin`: Core `Plugin` manifest (`apiVersion: 1`, 4 `plumbing:*` node kinds + InspectorExtension)
 * - `plumbingHostPanel`: Left-rail `EditorHostPanel`
 * - `plumbingScheduleView`: Full-pane `EditorHostView` (Fixtures, Loads & Power, IPC Audit, Drill List, BOM, 3D Manifold Cutaway)
 * - `plumbingChatExtension`: `PluginChatExtension` (`/` actions + lazy tool result cards)
 */

import type { AnyNodeDefinition, InspectorExtension, Plugin } from '@pascal-app/core'
import type { EditorHostPanel, EditorHostView, PluginChatExtension } from '@pascal-app/editor'
import { plumbingEquipmentRenderDefinition } from './nodes/equipment'
import { plumbingFixtureRenderDefinition } from './nodes/fixture'
import { plumbingManifoldRenderDefinition } from './nodes/manifold'
import {
  plumbingEquipmentParametrics,
  plumbingFixtureParametrics,
  plumbingManifoldParametrics,
  plumbingPipeRunParametrics,
} from './nodes/parametrics'
import { plumbingPipeRunRenderDefinition } from './nodes/pipe-run'
import { PLUMBING_PLUGIN_ID, plumbingRenderPlugin } from './render'
import { PLUMBING_SCHEDULE_VIEW_ID } from './ui/plumbing-panel'

export const plumbingInspectorExtensions: InspectorExtension[] = [
  {
    id: `${PLUMBING_PLUGIN_ID}:ipc-diagnostics`,
    pluginId: PLUMBING_PLUGIN_ID,
    kinds: [
      'plumbing:equipment',
      'plumbing:manifold',
      'plumbing:fixture',
      'plumbing:pipe-run',
    ],
    icon: { kind: 'iconify', name: 'lucide:droplets' },
    title: 'IPC / IFGC Engineering',
    component: () => import('./ui/inspector-card'),
  },
]

export const plumbingEquipmentDefinition = {
  ...plumbingEquipmentRenderDefinition,
  snapProfile: 'item' as const,
  parametrics: plumbingEquipmentParametrics,
}

export const plumbingManifoldDefinition = {
  ...plumbingManifoldRenderDefinition,
  snapProfile: 'item' as const,
  parametrics: plumbingManifoldParametrics,
}

export const plumbingFixtureDefinition = {
  ...plumbingFixtureRenderDefinition,
  snapProfile: 'item' as const,
  parametrics: plumbingFixtureParametrics,
}

export const plumbingPipeRunDefinition = {
  ...plumbingPipeRunRenderDefinition,
  snapProfile: 'structural' as const,
  parametrics: plumbingPipeRunParametrics,
}

export const plumbingPlugin: Plugin = {
  ...plumbingRenderPlugin,
  nodes: [
    plumbingEquipmentDefinition as unknown as AnyNodeDefinition,
    plumbingManifoldDefinition as unknown as AnyNodeDefinition,
    plumbingFixtureDefinition as unknown as AnyNodeDefinition,
    plumbingPipeRunDefinition as unknown as AnyNodeDefinition,
  ],
  inspectorExtensions: plumbingInspectorExtensions,
}

export const plumbingHostPanel: EditorHostPanel = {
  id: `${PLUMBING_PLUGIN_ID}:panel`,
  pluginId: PLUMBING_PLUGIN_ID,
  label: 'Plumbing',
  summary: 'Residential & Light-Commercial IPC/UPC/IFGC DWV, supply, PEX manifolds, fuel gas, and framing bore coordination.',
  description:
    'Author editable residential and light-commercial plumbing systems with IPC/UPC DFU drain sizing, Hunter-curve WSFU peak demand and Hazen-Williams hydraulics, gravity-sloped 3D DWV routing, PEX home-run manifolds, IFGC fuel gas, IRC dryer vents, Bones framing penetration drill schedules, and automatic Electrical panel power coordination.',
  category: 'MEP & Engineering',
  creator: {
    name: 'Kevin Ruschman (@kruschdev)',
    url: 'https://github.com/kruschdev',
  },
  pluginUrl: 'https://github.com/kruschdev/pascal-plugin-plumbing',
  icon: { kind: 'iconify', name: 'lucide:droplets' },
  component: () => import('./ui/plumbing-panel'),
  defaultInstalled: false,
}

export const plumbingScheduleView: EditorHostView = {
  id: PLUMBING_SCHEDULE_VIEW_ID,
  pluginId: PLUMBING_PLUGIN_ID,
  label: 'Plumbing Schedule',
  description:
    'Fixture schedule, DFU/WSFU/Gas loads, cross-trade electrical coordination, IPC/IFGC audit, framing drill list, priced BOM, and 3D PEX manifold cutaway.',
  icon: { kind: 'iconify', name: 'lucide:table' },
  component: () => import('./ui/schedule-view'),
  workspaces: ['edit'],
  defaultPinned: false,
}

export const plumbingChatExtension: PluginChatExtension = {
  pluginId: PLUMBING_PLUGIN_ID,
  cards: {
    plumbing_audit_ipc: () => import('./ui/chat-card'),
    plumbing_generate_schedule: () => import('./ui/chat-card'),
    plumbing_route_pipe: () => import('./ui/chat-card'),
  },
  actions: [
    {
      id: 'ipc-audit',
      label: 'IPC & Framing Audit',
      hint: 'Check DWV slope, 2x6 wet walls, trap arms, gas drip legs & NEC 110.26(E)',
      prompt: 'Run plumbing_audit_ipc on this scene and summarize any code, framing bore, or electrical coordination issues.',
    },
    {
      id: 'plumbing-schedule',
      label: 'Fixture Schedule & BOM',
      hint: 'Generate DFU/WSFU schedule, framing drill list, electrical handoff, and priced BOM',
      prompt: 'Run plumbing_generate_schedule and open the plumbing schedule view.',
    },
    {
      id: 'plumbing-loads',
      label: 'DFU / WSFU / Gas Calc',
      hint: 'Calculate building drain size, Hunter-curve peak GPM, water heater & IFGC gas sizing',
      prompt: 'Run plumbing_calculate_loads for this building and summarize drain, supply, and water heater sizing.',
    },
  ],
}

export {
  PLUMBING_PLUGIN_ID,
  plumbingRenderPlugin,
  PlumbingEquipmentNode,
  EquipmentKindEnum,
  ElectricalDemandSchema,
  PlumbingManifoldNode,
  ManifoldKindEnum,
  PlumbingFixtureNode,
  FixtureKindEnum,
  PipeNominalSizeEnum,
  PlumbingPipeRunNode,
  PlumbingSystemEnum,
  PipeMaterialEnum,
} from './render'
export { PLUMBING_SCHEDULE_VIEW_ID } from './ui/plumbing-panel'
export * from './ipc'
