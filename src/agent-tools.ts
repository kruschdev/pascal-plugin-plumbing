/**
 * Pure Zod-only Agent Tool Contracts (`@kruschdev/pascal-plugin-plumbing/agent-tools`).
 * Conforms to Pascal DECISIONS.md E-016: zero Three.js, React, viewer, or editor imports.
 */

import type { PluginAgentTools } from '@pascal-app/core/agent-tools'
import { z } from 'zod'

const Vec3 = z.tuple([z.number(), z.number(), z.number()])

const EquipmentKind = z.enum([
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

const FixtureKind = z.enum([
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

const PlumbingSystem = z.enum([
  'cold-water',
  'hot-water',
  'hot-recirc',
  'dwv-drain',
  'dwv-vent',
  'fuel-gas',
  'condensate',
  'dryer-vent',
])

const PipeMaterial = z.enum([
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

const PipeNominalSize = z.enum([
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

export const plumbingAgentTools: PluginAgentTools = {
  pluginId: 'krusch:plumbing',
  apiVersion: 1,
  version: '0.1.0',
  instructions:
    'Plumbing holds Priority #2 MEP right-of-way (1. Structural -> 2. Plumbing -> 3. HVAC -> 4. Electrical) due to gravity DWV slope requirements. Plumbing yields ONLY to Structural members and NEC 110.26(E) Dedicated Electrical Space above electrical panels. Every powered plumbing unit (electric/HPWH water heater, sump pump, sewage ejector, dishwasher, disposal, washer) publishes an `electricalDemand` spec so Electrical automatically adds its breaker and 3D power run.',
  skills: [
    {
      name: 'ipc-gravity-first-plumbing',
      summary: 'Residential & Light-Commercial IPC/UPC/IFGC plumbing workflow with Bones framing penetration & Electrical power coordination',
      body: [
        '1. Run `plumbing_autopopulate` to scan rooms, placed Pascal fixtures, and `@pascal-app/plugin-bones` (`bones:service` water-heater / water-entry / sewer-exit) anchors to generate a complete DWV, vent, hot/cold supply, and optional fuel-gas / dryer-vent network.',
        '2. Add individual mechanical equipment (`plumbing_place_equipment`), PEX/copper/gas manifolds (`plumbing_place_manifold`), or fixtures (`plumbing_place_fixture`).',
        '3. Route custom gravity-sloped drains, vents, supply, or gas lines via `plumbing_route_pipe` (automatically respecting structural obstacles and NEC 110.26(E) panel keep-outs).',
        '4. Run `plumbing_calculate_loads`, `plumbing_generate_schedule`, and `plumbing_audit_ipc` to confirm zero IPC/UPC/IFGC/IRC errors, review stud bore drill schedules, and verify cross-trade Electrical power wiring.',
      ].join('\n'),
    },
  ],
  tools: [
    {
      name: 'plumbing_place_equipment',
      title: 'Place plumbing mechanical equipment',
      description:
        'Place a water heater (electric/gas tank, tankless, HPWH), expansion tank, PRV/shutoff, water softener, sump/sewage pump, recirc pump, gas meter, or backwater valve with automatic electricalDemand metadata.',
      runsIn: 'operation',
      input: {
        levelId: z.string().optional(),
        name: z.string().optional(),
        equipmentKind: EquipmentKind.default('water-heater-tank-electric'),
        position: Vec3,
        rotation: z.number().default(0),
        roomName: z.string().default('Utility'),
        capacityGal: z.number().min(0).max(500).optional(),
        gasBtuh: z.number().min(0).max(500000).optional(),
        watts: z.number().min(0).max(50000).optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'plumbing_place_manifold',
      title: 'Place PEX, copper, or fuel-gas manifold',
      description:
        'Place a PEX home-run manifold with quarter-turn ball valves, copper trunk header, or CSST gas manifold on a level.',
      runsIn: 'operation',
      input: {
        levelId: z.string().optional(),
        name: z.string().default('PEX Home-Run Manifold (12-Port)'),
        manifoldKind: z.enum(['pex-homerun', 'copper-header', 'gas-csst']).default('pex-homerun'),
        position: Vec3,
        rotation: z.number().default(0),
        portCount: z.number().int().min(4).max(36).default(12),
        coverRemoved: z.boolean().default(false),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'plumbing_place_fixture',
      title: 'Place plumbing fixture rough-in',
      description:
        'Place any of 18 residential or light-commercial plumbing fixtures with IPC Table 709.1 DFU, WSFU, rough-in height, and electricalDemand coordination metadata.',
      runsIn: 'operation',
      input: {
        levelId: z.string().optional(),
        name: z.string().optional(),
        fixtureKind: FixtureKind.default('lavatory'),
        position: Vec3,
        rotation: z.number().default(0),
        roomName: z.string().default('Bathroom'),
        codeEdition: z.enum(['IPC-2021', 'UPC-2021']).default('IPC-2021'),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'plumbing_route_pipe',
      title: 'Route 3D gravity DWV, vent, supply, or gas pipe run',
      description:
        'Route a 3D pipe run between two points with automatic gravity DWV pitch (1/4" or 1/8"/ft), vent flood-rim clearance (IPC 905.5), structural/NEC 110.26(E) obstacle avoidance, and Bones framing penetration drill reporting.',
      runsIn: 'operation',
      input: {
        levelId: z.string().optional(),
        name: z.string().optional(),
        from: Vec3,
        to: Vec3,
        system: PlumbingSystem.default('cold-water'),
        material: PipeMaterial.optional(),
        nominalSize: PipeNominalSize.optional(),
        foundationType: z.enum(['slab', 'crawlspace', 'basement']).default('crawlspace'),
        dfuLoad: z.number().min(0).max(1000).default(0),
        wsfuLoad: z.number().min(0).max(1000).default(0),
        gasBtuh: z.number().min(0).max(2000000).default(0),
        hasCleanout: z.boolean().default(false),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'plumbing_autopopulate',
      title: 'One-click IPC/UPC auto-populate plumbing',
      description:
        'Scan rooms, placed Pascal fixtures, and plugin-bones anchors to auto-populate water heater, PEX manifold, wet-wall fixtures, frost-proof hose bibbs, sloped DWV drains, 3" roof vent stack, hot/cold supply, and optional gas/dryer-vent runs.',
      runsIn: 'operation',
      input: {
        levelId: z.string().optional(),
        occupancy: z.enum(['residential', 'commercial']).default('residential'),
        codeEdition: z.enum(['IPC-2021', 'UPC-2021']).default('IPC-2021'),
        supplyTopology: z.enum(['manifold', 'trunk-and-branch']).default('manifold'),
        supplyMaterial: z.enum(['pex-a', 'pex-b', 'copper-l', 'cpvc']).default('pex-a'),
        dwvMaterial: z.enum(['pvc-dwv', 'abs-dwv', 'cast-iron']).default('pvc-dwv'),
        foundationType: z.enum(['slab', 'crawlspace', 'basement']).default('crawlspace'),
        waterHeaterKind: z
          .enum([
            'water-heater-tank-electric',
            'water-heater-tank-gas',
            'water-heater-tankless-gas',
            'water-heater-hpwh',
          ])
          .default('water-heater-tank-electric'),
        includeFuelGas: z.boolean().default(false),
        includeDryerVent: z.boolean().default(true),
        includeHotRecirc: z.boolean().default(false),
        bonesMode: z.enum(['auto', 'import-only', 'ignore']).default('auto'),
        clearExisting: z.boolean().default(true),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'plumbing_calculate_loads',
      title: 'Calculate IPC/UPC DFU, WSFU/GPM, water heater & gas loads',
      description:
        'Compute building drain sizing (IPC Table 710.1), Hunter-curve peak GPM & velocity, water heater & expansion tank recommendation, IFGC fuel-gas sizing, and cross-trade electrical power demands.',
      runsIn: 'operation',
      input: {
        codeEdition: z.enum(['IPC-2021', 'UPC-2021']).default('IPC-2021'),
        occupancy: z.enum(['residential', 'commercial']).default('residential'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'plumbing_generate_schedule',
      title: 'Generate fixture schedule, framing drill list & priced BOM',
      description:
        'Generate the fixture schedule, pipe linear-footage summary, Bones framing stud/plate drill schedule, cross-trade electrical coordination table, and priced BOM takeoff.',
      runsIn: 'operation',
      input: {
        codeEdition: z.enum(['IPC-2021', 'UPC-2021']).default('IPC-2021'),
        laborRateUsd: z.number().min(20).max(400).default(115),
        materialMarkupPct: z.number().min(0).max(100).default(0),
        salesTaxPct: z.number().min(0).max(25).default(0),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'plumbing_audit_ipc',
      title: 'Audit scene for IPC, UPC, IFGC, IRC & NEC 110.26(E) compliance',
      description:
        'Audit all plumbing equipment, fixtures, and pipe runs for DWV slope, 2x6 wet walls, trap-arm limits, vent flood-rim clearance, supply velocity, gas drip legs, dryer vents, structural clashes, NEC 110.26(E) panel keep-outs, and unwired electrical demands.',
      runsIn: 'operation',
      input: {
        codeEdition: z.enum(['IPC-2021', 'UPC-2021']).default('IPC-2021'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ],
}
