/**
 * Pure Agent Operations (`@kruschdev/pascal-plugin-plumbing/agent-operations`).
 * Runs identically in Pascal's MCP server, detached scene runtime, or live editor tab
 * in a single undo step (`DECISIONS.md` E-016 & E-018).
 */

import type { AnyNode } from '@pascal-app/core'
import type { AgentContext, AgentOperations, SceneNodes } from '@pascal-app/core/agent-operations'
import { refuse } from '@pascal-app/core/agent-tools'
import { auditScenePlumbing } from './ipc/audit'
import { type BonesIngestionMode, planPlumbingAutoPopulate } from './ipc/autopopulate'
import {
  type FramingPenetration,
  type SceneNodeLike,
  type Vec3,
  computePipeFramingPenetrations,
  extractBonesPlumbingContext,
  getEquipmentElectricalDemand,
  getFixtureElectricalDemand,
} from './ipc/framing-interop'
import { buildPlumbingBom, formatPlumbingBomCsv } from './ipc/pricing'
import {
  extractPlumbingObstacles,
  extractWallSegments,
  resolveLevelHeightM,
  routeDwvDrainRun,
  routePressurizedPipeRun,
  routeVentRun,
} from './ipc/routing'
import { buildPlumbingSchedule, formatPlumbingScheduleCsv } from './ipc/schedule'
import {
  type CodeEdition,
  type EquipmentKind,
  FIXTURE_SPECS,
  type FixtureKind,
  type FoundationType,
  type ManifoldKind,
  type OccupancyType,
  type PipeMaterial,
  type PipeNominalSize,
  type PlumbingSystem,
  type SupplyTopology,
  getFixtureDfu,
} from './ipc/tables'

function asRecord(nodes: SceneNodes): Readonly<Record<string, SceneNodeLike>> {
  return nodes as unknown as Readonly<Record<string, SceneNodeLike>>
}

function resolveLevelId(nodes: SceneNodes, requested: string | undefined, ctx: AgentContext): string | null {
  if (requested && nodes[requested]) return requested
  if (ctx.activeLevelId && nodes[ctx.activeLevelId]) return ctx.activeLevelId
  for (const n of Object.values(nodes)) {
    if ((n as { type?: string }).type === 'level') return (n as { id: string }).id
  }
  return null
}

function deterministicId(prefix: string, nodes: SceneNodes): string {
  let idx = 1
  while (nodes[`${prefix}_${idx}`]) idx += 1
  return `${prefix}_${idx}`
}

function collectAllScenePenetrations(nodes: Readonly<Record<string, SceneNodeLike>>): FramingPenetration[] {
  const walls = extractWallSegments(nodes, null)
  const bones = extractBonesPlumbingContext(nodes, null)
  const out: FramingPenetration[] = []
  for (const n of Object.values(nodes)) {
    if (n.type !== 'plumbing:pipe-run' || !Array.isArray(n.path)) continue
    out.push(
      ...computePipeFramingPenetrations({
        pipeRunId: n.id,
        path: n.path as ReadonlyArray<Vec3>,
        pipeSize: (n.nominalSize as PipeNominalSize) || '1/2"',
        material: (n.material as PipeMaterial) || 'pex-a',
        walls,
        bonesContext: bones,
      }),
    )
  }
  return out
}

export const plumbingAgentOperations = {
  plumbing_place_equipment: (
    nodes: SceneNodes,
    input: {
      levelId?: string
      name?: string
      equipmentKind?: EquipmentKind
      position: [number, number, number]
      rotation?: number
      roomName?: string
      capacityGal?: number
      gasBtuh?: number
      watts?: number
    },
    ctx: AgentContext,
  ) => {
    const levelId = resolveLevelId(nodes, input.levelId, ctx)
    if (!levelId) refuse('level_not_found', 'No level found in scene to host plumbing equipment.')
    const kind = input.equipmentKind ?? 'water-heater-tank-electric'
    const id = deterministicId('plumbeq', nodes)
    const electricalDemand = getEquipmentElectricalDemand(kind, input.watts)
    const node = {
      object: 'node',
      id,
      type: 'plumbing:equipment',
      name: input.name ?? kind,
      parentId: levelId,
      visible: true,
      metadata: {},
      position: input.position,
      rotation: input.rotation ?? 0,
      equipmentKind: kind,
      roomName: input.roomName ?? 'Utility',
      capacityGal: input.capacityGal ?? 50,
      gasBtuh: input.gasBtuh ?? 0,
      watts: input.watts ?? (electricalDemand?.loadVa ?? 0),
      hasDrainPan: true,
      hasTpDischarge: true,
      hasExpansionTank: true,
      electricalDemand,
    } as unknown as AnyNode

    return {
      result: {
        nodeId: id,
        name: node.name,
        equipmentKind: kind,
        levelId,
        electricalDemand,
      },
      changes: { create: [{ node, parentId: levelId }] },
    }
  },

  plumbing_place_manifold: (
    nodes: SceneNodes,
    input: {
      levelId?: string
      name?: string
      manifoldKind?: ManifoldKind
      position: [number, number, number]
      rotation?: number
      portCount?: number
      coverRemoved?: boolean
    },
    ctx: AgentContext,
  ) => {
    const levelId = resolveLevelId(nodes, input.levelId, ctx)
    if (!levelId) refuse('level_not_found', 'No level found in scene to host plumbing manifold.')
    const id = deterministicId('plumbman', nodes)
    const kind = input.manifoldKind ?? 'pex-homerun'
    const portCount = input.portCount ?? 12
    const node = {
      object: 'node',
      id,
      type: 'plumbing:manifold',
      name: input.name ?? `PEX Manifold (${portCount}-Port)`,
      parentId: levelId,
      visible: true,
      metadata: {},
      position: input.position,
      rotation: input.rotation ?? 0,
      manifoldKind: kind,
      portCount,
      supplyMaterial: kind === 'gas-csst' ? 'csst' : kind === 'copper-header' ? 'copper-l' : 'pex-a',
      coverRemoved: input.coverRemoved ?? false,
    } as unknown as AnyNode

    return {
      result: { nodeId: id, name: node.name, manifoldKind: kind, portCount, levelId },
      changes: { create: [{ node, parentId: levelId }] },
    }
  },

  plumbing_place_fixture: (
    nodes: SceneNodes,
    input: {
      levelId?: string
      name?: string
      fixtureKind?: FixtureKind
      position: [number, number, number]
      rotation?: number
      roomName?: string
      codeEdition?: CodeEdition
    },
    ctx: AgentContext,
  ) => {
    const levelId = resolveLevelId(nodes, input.levelId, ctx)
    if (!levelId) refuse('level_not_found', 'No level found in scene to host plumbing fixture.')
    const kind = input.fixtureKind ?? 'lavatory'
    const spec = FIXTURE_SPECS[kind]
    const id = deterministicId('plumbfix', nodes)
    const electricalDemand = getFixtureElectricalDemand(kind)
    const dfu = getFixtureDfu(kind, input.codeEdition ?? 'IPC-2021')
    const node = {
      object: 'node',
      id,
      type: 'plumbing:fixture',
      name: input.name ?? spec.label,
      parentId: levelId,
      visible: true,
      metadata: {},
      position: input.position,
      rotation: input.rotation ?? 0,
      fixtureKind: kind,
      roomName: input.roomName ?? 'Bathroom',
      dfu,
      wsfuCold: spec.wsfuCold,
      wsfuHot: spec.wsfuHot,
      wsfuTotal: spec.wsfuTotal,
      trapSize: spec.minTrapIn,
      drainSize: spec.minDrainIn,
      ventSize: spec.minVentIn,
      supplySize: spec.supplySizeIn,
      hasVacuumBreaker: true,
      hasPTrap: spec.needsPTrap,
      electricalDemand,
    } as unknown as AnyNode

    return {
      result: { nodeId: id, name: node.name, fixtureKind: kind, dfu, wsfu: spec.wsfuTotal, electricalDemand },
      changes: { create: [{ node, parentId: levelId }] },
    }
  },

  plumbing_route_pipe: (
    nodes: SceneNodes,
    input: {
      levelId?: string
      name?: string
      from: [number, number, number]
      to: [number, number, number]
      system?: PlumbingSystem
      material?: PipeMaterial
      nominalSize?: PipeNominalSize
      foundationType?: FoundationType
      dfuLoad?: number
      wsfuLoad?: number
      gasBtuh?: number
      hasCleanout?: boolean
    },
    ctx: AgentContext,
  ) => {
    const levelId = resolveLevelId(nodes, input.levelId, ctx)
    if (!levelId) refuse('level_not_found', 'No level found in scene to route pipe.')
    const record = asRecord(nodes)
    const system = input.system ?? 'cold-water'
    const material =
      input.material ?? (system.startsWith('dwv') ? 'pvc-dwv' : system === 'fuel-gas' ? 'black-iron' : 'pex-a')
    const nominalSize = input.nominalSize ?? (system === 'dwv-drain' ? '3"' : '1/2"')
    const obstacles = extractPlumbingObstacles(record, levelId)
    const levelH = resolveLevelHeightM(record, levelId)

    let path: Vec3[]
    let slopeInPerFt = 0
    let lengthFt = 0

    if (system === 'dwv-drain') {
      const r = routeDwvDrainRun({
        from: input.from,
        to: input.to,
        nominalSize,
        foundationType: input.foundationType ?? 'crawlspace',
        obstacles,
      })
      path = r.path
      slopeInPerFt = r.slopeInPerFt
      lengthFt = r.lengthFt
    } else if (system === 'dwv-vent') {
      const r = routeVentRun({
        from: input.from,
        stackPoint: [input.to[0], input.to[2]],
        floodRimHeightM: 0.9,
        ceilingHeightM: levelH,
        obstacles,
      })
      path = r.path
      lengthFt = r.lengthFt
    } else {
      const planeY = (input.foundationType ?? 'crawlspace') === 'slab' ? levelH - 0.25 : -0.16
      const r = routePressurizedPipeRun({
        from: input.from,
        to: input.to,
        routingPlaneY: planeY,
        euclideanInCavity: material === 'pex-a' || material === 'pex-b',
        obstacles,
      })
      path = r.path
      lengthFt = r.lengthFt
    }

    const id = deterministicId('plumbpipe', nodes)
    const walls = extractWallSegments(record, levelId)
    const bones = extractBonesPlumbingContext(record, levelId)
    const penetrations = computePipeFramingPenetrations({
      pipeRunId: id,
      path,
      pipeSize: nominalSize,
      material,
      walls,
      bonesContext: bones,
    })

    const node = {
      object: 'node',
      id,
      type: 'plumbing:pipe-run',
      name: input.name ?? `${nominalSize} ${system} (${material})`,
      parentId: levelId,
      visible: true,
      metadata: {},
      path,
      system,
      material,
      nominalSize,
      slopeInPerFt,
      dfuLoad: input.dfuLoad ?? 0,
      wsfuLoad: input.wsfuLoad ?? 0,
      gasBtuh: input.gasBtuh ?? 0,
      hasCleanout: input.hasCleanout ?? false,
      hasSedimentTrap: system === 'fuel-gas',
      hasShutoffWithin6Ft: true,
      isHorizontalSanTee: false,
      isMainVentStack: false,
      showFramingPenetrations: true,
    } as unknown as AnyNode

    return {
      result: { nodeId: id, lengthFt, slopeInPerFt, penetrations },
      changes: { create: [{ node, parentId: levelId }] },
    }
  },

  plumbing_autopopulate: (
    nodes: SceneNodes,
    input: {
      levelId?: string
      occupancy?: OccupancyType
      codeEdition?: CodeEdition
      supplyTopology?: SupplyTopology
      supplyMaterial?: 'pex-a' | 'pex-b' | 'copper-l' | 'cpvc'
      dwvMaterial?: 'pvc-dwv' | 'abs-dwv' | 'cast-iron'
      foundationType?: FoundationType
      waterHeaterKind?:
        | 'water-heater-tank-electric'
        | 'water-heater-tank-gas'
        | 'water-heater-tankless-gas'
        | 'water-heater-hpwh'
      includeFuelGas?: boolean
      includeDryerVent?: boolean
      includeHotRecirc?: boolean
      bonesMode?: BonesIngestionMode
      clearExisting?: boolean
    },
    ctx: AgentContext,
  ) => {
    const levelId = resolveLevelId(nodes, input.levelId, ctx)
    if (!levelId) refuse('level_not_found', 'No level found in scene to auto-populate plumbing.')

    const deleteIds: string[] = []
    const baseNodes: Record<string, SceneNodeLike> = { ...asRecord(nodes) }
    if (input.clearExisting !== false) {
      for (const [id, n] of Object.entries(baseNodes)) {
        if (n.type.startsWith('plumbing:') && (!n.parentId || n.parentId === levelId)) {
          deleteIds.push(id)
          delete baseNodes[id]
        }
      }
    }

    const plan = planPlumbingAutoPopulate(baseNodes, {
      levelId,
      occupancy: input.occupancy,
      codeEdition: input.codeEdition,
      supplyTopology: input.supplyTopology,
      supplyMaterial: input.supplyMaterial,
      dwvMaterial: input.dwvMaterial,
      foundationType: input.foundationType,
      waterHeaterKind: input.waterHeaterKind,
      includeFuelGas: input.includeFuelGas,
      includeDryerVent: input.includeDryerVent,
      includeHotRecirc: input.includeHotRecirc,
      bonesMode: input.bonesMode,
    })

    const created: Array<{ node: AnyNode; parentId: string }> = []
    const simulated: Record<string, SceneNodeLike> = { ...baseNodes }

    for (const eq of plan.equipment) {
      const node = {
        object: 'node',
        ...eq,
        type: 'plumbing:equipment',
        parentId: levelId,
        visible: true,
        metadata: {},
      }
      created.push({ node: node as unknown as AnyNode, parentId: levelId })
      simulated[eq.id] = node as unknown as SceneNodeLike
    }
    for (const m of plan.manifolds) {
      const node = {
        object: 'node',
        ...m,
        type: 'plumbing:manifold',
        parentId: levelId,
        visible: true,
        metadata: {},
      }
      created.push({ node: node as unknown as AnyNode, parentId: levelId })
      simulated[m.id] = node as unknown as SceneNodeLike
    }
    for (const f of plan.fixtures) {
      const node = {
        object: 'node',
        ...f,
        type: 'plumbing:fixture',
        parentId: levelId,
        visible: true,
        metadata: {},
      }
      created.push({ node: node as unknown as AnyNode, parentId: levelId })
      simulated[f.id] = node as unknown as SceneNodeLike
    }
    for (const r of plan.pipeRuns) {
      const node = {
        object: 'node',
        ...r,
        type: 'plumbing:pipe-run',
        parentId: levelId,
        visible: true,
        metadata: {},
        showFramingPenetrations: true,
      }
      created.push({ node: node as unknown as AnyNode, parentId: levelId })
      simulated[r.id] = node as unknown as SceneNodeLike
    }

    const audit = auditScenePlumbing(simulated, { codeEdition: plan.codeEdition })
    return {
      result: {
        levelId,
        summary: plan.summary,
        equipmentCount: plan.equipment.length,
        manifoldCount: plan.manifolds.length,
        fixtureCount: plan.fixtures.length,
        pipeRunCount: plan.pipeRuns.length,
        bonesAnchorsUsed: plan.bonesAnchorsUsed,
        audit,
      },
      changes: {
        ...(deleteIds.length > 0 ? { delete: deleteIds } : {}),
        create: created,
      },
    }
  },

  plumbing_calculate_loads: (
    nodes: SceneNodes,
    input: { codeEdition?: CodeEdition; occupancy?: OccupancyType },
  ) => {
    const schedule = buildPlumbingSchedule(asRecord(nodes), {
      codeEdition: input.codeEdition ?? 'IPC-2021',
      occupancy: input.occupancy ?? 'residential',
    })
    return {
      result: {
        loads: schedule.loads,
        electricalCoordination: schedule.electricalCoordination,
      },
    }
  },

  plumbing_generate_schedule: (
    nodes: SceneNodes,
    input: {
      codeEdition?: CodeEdition
      laborRateUsd?: number
      materialMarkupPct?: number
      salesTaxPct?: number
    },
  ) => {
    const record = asRecord(nodes)
    const schedule = buildPlumbingSchedule(record, { codeEdition: input.codeEdition ?? 'IPC-2021' })
    const bom = buildPlumbingBom(record, {
      codeEdition: input.codeEdition ?? 'IPC-2021',
      laborRateUsd: input.laborRateUsd ?? 115,
      materialMarkupPct: input.materialMarkupPct ?? 0,
      salesTaxPct: input.salesTaxPct ?? 0,
    })
    const penetrations = collectAllScenePenetrations(record)
    return {
      result: {
        schedule,
        bom,
        penetrations,
        scheduleCsv: formatPlumbingScheduleCsv(schedule),
        bomCsv: formatPlumbingBomCsv(bom),
      },
    }
  },

  plumbing_audit_ipc: (nodes: SceneNodes, input: { codeEdition?: CodeEdition }) => {
    const audit = auditScenePlumbing(asRecord(nodes), { codeEdition: input.codeEdition ?? 'IPC-2021' })
    return {
      result: audit,
    }
  },
} satisfies AgentOperations
