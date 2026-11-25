/**
 * Read-only viewer entry (`@kruschdev/pascal-plugin-plumbing/render`).
 * Same plugin ID, contract version, schemas, defaults, 3D geometry, and 2D floorplan symbols
 * as `plumbingPlugin`, with ZERO imports from `@pascal-app/editor` or `next`.
 */

import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { plumbingEquipmentRenderDefinition } from './nodes/equipment'
import { plumbingFixtureRenderDefinition } from './nodes/fixture'
import { plumbingManifoldRenderDefinition } from './nodes/manifold'
import { plumbingPipeRunRenderDefinition } from './nodes/pipe-run'

export const PLUMBING_PLUGIN_ID = 'krusch:plumbing' as const

export const plumbingRenderPlugin: Plugin = {
  id: PLUMBING_PLUGIN_ID,
  apiVersion: 1,
  nodes: [
    plumbingEquipmentRenderDefinition as unknown as AnyNodeDefinition,
    plumbingManifoldRenderDefinition as unknown as AnyNodeDefinition,
    plumbingFixtureRenderDefinition as unknown as AnyNodeDefinition,
    plumbingPipeRunRenderDefinition as unknown as AnyNodeDefinition,
  ],
}

export {
  PlumbingEquipmentNode,
  EquipmentKindEnum,
  ElectricalDemandSchema,
  plumbingEquipmentRenderDefinition,
  buildPlumbingEquipmentGeometry,
  buildPlumbingEquipmentFloorplan,
  getPlumbingEquipmentPorts,
} from './nodes/equipment'

export {
  PlumbingManifoldNode,
  ManifoldKindEnum,
  plumbingManifoldRenderDefinition,
  buildPlumbingManifoldGeometry,
  buildPlumbingManifoldFloorplan,
  getPlumbingManifoldPorts,
} from './nodes/manifold'

export {
  PlumbingFixtureNode,
  FixtureKindEnum,
  PipeNominalSizeEnum,
  plumbingFixtureRenderDefinition,
  buildPlumbingFixtureGeometry,
  buildPlumbingFixtureFloorplan,
  getPlumbingFixturePorts,
} from './nodes/fixture'

export {
  PlumbingPipeRunNode,
  PlumbingSystemEnum,
  PipeMaterialEnum,
  plumbingPipeRunRenderDefinition,
  buildPlumbingPipeRunGeometry,
  buildPlumbingPipeRunFloorplan,
  getPlumbingPipeRunPorts,
} from './nodes/pipe-run'
