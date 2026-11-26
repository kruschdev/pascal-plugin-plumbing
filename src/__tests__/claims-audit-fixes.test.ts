import { describe, expect, test } from 'bun:test'
import { Box3, Mesh } from 'three'
import { plumbingAgentOperations } from '../agent-operations'
import { plumbingAgentTools } from '../agent-tools'
import { PLUMBING_CAD_CATALOG } from '../cad/catalog'
import { buildEquipmentCad } from '../cad/equipment'
import { buildWiredManifoldCutawayCad } from '../cad/manifold-interior'
import { plumbingChatExtension } from '../index'
import { auditScenePlumbing } from '../ipc/audit'
import { planPlumbingAutoPopulate } from '../ipc/autopopulate'
import {
  type SceneNodeLike,
  computePipeFramingPenetrations,
  extractBonesPlumbingContext,
} from '../ipc/framing-interop'
import { buildPlumbingBom } from '../ipc/pricing'
import {
  classifyRoomName,
  extractPlumbingObstacles,
  extractRoomPolygons,
  extractWallSegments,
  measureDrainPathSlope,
  routeDwvDrainRun,
  routePressurizedPipeRun,
} from '../ipc/routing'
import { buildElectricalCoordination, buildPlumbingSchedule, resolveNodeElectricalDemand } from '../ipc/schedule'
import {
  calculateSupplyHydraulics,
  sizeFuelGasPipe,
  sizeSupplyPipe,
  sizeVentStack,
  sizeWaterHeater,
} from '../ipc/sizing'
import { INCHES_TO_METERS, type PipeNominalSize } from '../ipc/tables'
import {
  buildPlumbingEquipmentFloorplan,
  getPlumbingEquipmentPorts,
  plumbingEquipmentRenderDefinition,
} from '../nodes/equipment'
import { PlumbingFixtureNode, plumbingFixtureRenderDefinition } from '../nodes/fixture'
import { plumbingEquipmentParametrics, plumbingPipeRunParametrics } from '../nodes/parametrics'
import { buildPlumbingPipeRunFloorplan, plumbingPipeRunRenderDefinition } from '../nodes/pipe-run'

function countDisconnectedComponents(group: ReturnType<typeof buildEquipmentCad>, eps = 0.002): number {
  group.updateMatrixWorld(true)
  const boxes: Box3[] = []
  group.traverse((obj) => {
    if (obj instanceof Mesh) boxes.push(new Box3().setFromObject(obj))
  })
  const n = boxes.length
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = boxes[i]!
      const b = boxes[j]!
      const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x)
      const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y)
      const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z)
      if (Math.hypot(dx, dy, dz) <= eps) {
        adj[i]!.push(j)
        adj[j]!.push(i)
      }
    }
  }
  const visited = new Set<number>()
  let comps = 0
  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue
    comps += 1
    const stack = [i]
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (visited.has(cur)) continue
      visited.add(cur)
      for (const nxt of adj[cur]!) {
        if (!visited.has(nxt)) stack.push(nxt)
      }
    }
  }
  return comps
}

describe('Claims-vs-Reality Audit Fix Regression Suite (PLB-01..PLB-07)', () => {
  test('PLB-01: auditScenePlumbing enforces IPC Table 710.1 drain sizing, 3" WC/main-vent minimum, and IFGC sizing.ok === false', () => {
    const nodes: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level' },
      wc_1: {
        id: 'wc_1',
        type: 'plumbing:fixture',
        fixtureKind: 'water-closet',
        parentId: 'level_0',
        position: [1, 0.15, 1],
      },
      // 2" drain serving a water closet -> violates IPC Table 710.1(2) 3" WC minimum
      wc_drain_small: {
        id: 'wc_drain_small',
        type: 'plumbing:pipe-run',
        name: 'Undersized WC Drain',
        parentId: 'level_0',
        system: 'dwv-drain',
        material: 'pvc-dwv',
        nominalSize: '2"',
        sourceNodeId: 'wc_1',
        dfuLoad: 3,
        hasCleanout: true,
        path: [
          [1, 0.15, 1],
          [1, -0.24, 1],
          [3, -0.32, 1],
        ],
      },
      // 1-1/2" branch carrying 12 DFU -> violates IPC Table 710.1(2) (max 3 DFU)
      branch_overloaded: {
        id: 'branch_overloaded',
        type: 'plumbing:pipe-run',
        name: 'Overloaded Branch',
        parentId: 'level_0',
        system: 'dwv-drain',
        material: 'pvc-dwv',
        nominalSize: '1-1/2"',
        dfuLoad: 12,
        path: [
          [0, -0.24, 2],
          [2, -0.30, 2],
        ],
      },
      // 2" main vent stack -> violates IPC 903.1 3" minimum
      small_main_vent: {
        id: 'small_main_vent',
        type: 'plumbing:pipe-run',
        name: 'Undersized Main Stack',
        parentId: 'level_0',
        system: 'dwv-vent',
        material: 'pvc-dwv',
        nominalSize: '2"',
        isMainVentStack: true,
        path: [
          [3, -0.34, 1],
          [3, 3.05, 1],
        ],
      },
      // 3" building drain carrying 60 DFU -> violates IPC Table 710.1(1) (max 42 DFU @ 1/4"/ft)
      main_drain_overloaded: {
        id: 'main_drain_overloaded',
        type: 'plumbing:pipe-run',
        name: '3" Main Building Drain',
        parentId: 'level_0',
        system: 'dwv-drain',
        material: 'pvc-dwv',
        nominalSize: '3"',
        sourceNodeId: 'small_main_vent',
        dfuLoad: 60,
        slopeInPerFt: 0.25,
        hasCleanout: true,
        path: [
          [3, -0.34, 1],
          [6, -0.45, 1],
        ],
      },
      // Fuel gas run > 200 ft (70 m = 229.6 ft) -> sizing.ok === false
      gas_too_long: {
        id: 'gas_too_long',
        type: 'plumbing:pipe-run',
        name: '230 ft Gas Line',
        parentId: 'level_0',
        system: 'fuel-gas',
        material: 'black-iron',
        nominalSize: '2"',
        gasBtuh: 80000,
        hasSedimentTrap: true,
        hasShutoffWithin6Ft: true,
        path: [
          [0, 0.5, 4],
          [70, 0.5, 4],
        ],
      },
      // CSST gas run exceeding max 1-1/4" CSST capacity (1,500 kBTU/h) -> sizing.ok === false
      gas_over_cap: {
        id: 'gas_over_cap',
        type: 'plumbing:pipe-run',
        name: 'Over-Capacity CSST',
        parentId: 'level_0',
        system: 'fuel-gas',
        material: 'csst',
        nominalSize: '1-1/4"',
        gasBtuh: 1500000,
        hasSedimentTrap: true,
        hasShutoffWithin6Ft: true,
        path: [
          [0, 0.5, 5],
          [10, 0.5, 5],
        ],
      },
    }

    const audit = auditScenePlumbing(nodes)
    expect(audit.findings.some((f) => f.nodeIds.includes('wc_drain_small') && f.codeRef.includes('710.1'))).toBe(true)
    expect(audit.findings.some((f) => f.nodeIds.includes('branch_overloaded') && f.codeRef.includes('710.1'))).toBe(true)
    expect(audit.findings.some((f) => f.nodeIds.includes('main_drain_overloaded') && f.codeRef.includes('710.1'))).toBe(true)
    expect(
      audit.findings.some(
        (f) => f.nodeIds.includes('small_main_vent') && f.codeRef === 'IPC 903.1' && f.severity === 'error',
      ),
    ).toBe(true)
    expect(
      audit.findings.some(
        (f) => f.nodeIds.includes('gas_too_long') && f.codeRef.includes('402.4') && f.severity === 'error',
      ),
    ).toBe(true)
    expect(
      audit.findings.some(
        (f) => f.nodeIds.includes('gas_over_cap') && f.codeRef.includes('402.4') && f.severity === 'error',
      ),
    ).toBe(true)
  })

  test('PLB-02: DWV branch drains never terminate below Main Building Drain invert & diagonal beam clashes dedupe without :segN', () => {
    // Long 22m house so far fixtures drop significantly at 1/4"/ft
    const longHouse: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level' },
      w1: { id: 'w1', type: 'wall', parentId: 'level_0', start: [0, 0], end: [22, 0], thickness: 0.165, height: 2.6 },
      w2: { id: 'w2', type: 'wall', parentId: 'level_0', start: [0, 8], end: [22, 8], thickness: 0.165, height: 2.6 },
      z_bath_west: {
        id: 'z_bath_west',
        type: 'zone',
        name: 'Master Bathroom',
        parentId: 'level_0',
        polygon: [[0, 0], [4, 0], [4, 4], [0, 4]],
      },
      z_kit_east: {
        id: 'z_kit_east',
        type: 'zone',
        name: 'Kitchen',
        parentId: 'level_0',
        polygon: [[18, 0], [22, 0], [22, 4], [18, 4]],
      },
    }
    const plan = planPlumbingAutoPopulate(longHouse, { levelId: 'level_0', foundationType: 'crawlspace' })
    const mainStack = plan.pipeRuns.find((r) => r.isMainVentStack)!
    const mainDrain = plan.pipeRuns.find((r) => r.system === 'dwv-drain' && r.sourceNodeId === mainStack.id)!
    const branches = plan.pipeRuns.filter((r) => r.system === 'dwv-drain' && r.targetNodeId === mainStack.id)
    expect(branches.length).toBeGreaterThanOrEqual(5)

    const mainDrainStartY = mainDrain.path[0]![1]
    const stackBottomY = mainStack.path[0]![1]
    expect(mainDrainStartY).toBeCloseTo(stackBottomY, 4)
    for (const br of branches) {
      const arrivalY = br.path[br.path.length - 1]![1]
      expect(arrivalY).toBeGreaterThanOrEqual(mainDrainStartY - 1e-4)
    }

    // Diagonal plain `beam` subdivision + :segN deduplication in auditScenePlumbing
    const diagScene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level' },
      beam_plain_diag: {
        id: 'beam_plain_diag',
        type: 'beam',
        name: 'Diagonal Header',
        parentId: 'level_0',
        start: [0, 0],
        end: [6, 6],
        elevation: 2.2,
        width: 0.2,
        height: 0.3,
      },
      pipe_hit: {
        id: 'pipe_hit',
        type: 'plumbing:pipe-run',
        parentId: 'level_0',
        system: 'cold-water',
        material: 'pex-a',
        nominalSize: '3/4"',
        path: [
          [0, 2.2, 0],
          [6, 2.2, 6],
        ],
      },
    }
    const obs = extractPlumbingObstacles(diagScene, 'level_0')
    const diagSegs = obs.filter((o) => o.nodeId === 'beam_plain_diag')
    expect(diagSegs.length).toBeGreaterThanOrEqual(4)
    // Far corner (0, 6) must not be inside any diagonal plain beam AABB
    expect(diagSegs.some((o) => 0 >= o.box.minX && 0 <= o.box.maxX && 6 >= o.box.minZ && 6 <= o.box.maxZ)).toBe(false)

    const diagAudit = auditScenePlumbing(diagScene)
    const clashFindings = diagAudit.findings.filter((f) => f.codeRef.includes('Structural'))
    expect(clashFindings.length).toBe(1)
    expect(clashFindings[0]!.nodeIds).toEqual(['pipe_hit', 'beam_plain_diag'])
    expect(clashFindings[0]!.nodeIds.some((id) => id.includes(':seg'))).toBe(false)
  })

  test('PLB-03: router uses true pipe OD radius matching auditor & combines under-beam drop with horizontal column detour', () => {
    // 4" rigid-aluminum dryer vent (OD = 4.5" = 0.1143 m -> r = 0.05715 m) routed near an obstacle
    const dryerObs = extractPlumbingObstacles(
      {
        level_0: { id: 'level_0', type: 'level' },
        col_near: {
          id: 'col_near',
          type: 'structural:column',
          parentId: 'level_0',
          position: [2, 0, 0.14],
          widthIn: 5.5,
          depthIn: 5.5,
          heightM: 2.6,
        },
      },
      'level_0',
    )
    const dryerRoute = routePressurizedPipeRun({
      from: [0, 0.35, 0],
      to: [4, 0.35, 0],
      routingPlaneY: 0.35,
      nominalSize: '4"',
      material: 'rigid-aluminum',
      euclideanInCavity: false,
      obstacles: dryerObs,
    })
    expect(dryerRoute.detoured).toBe(true)
    expect(dryerRoute.clashes.length).toBe(0)
    const dryerAudit = auditScenePlumbing({
      level_0: { id: 'level_0', type: 'level' },
      col_near: {
        id: 'col_near',
        type: 'structural:column',
        parentId: 'level_0',
        position: [2, 0, 0.14],
        widthIn: 5.5,
        depthIn: 5.5,
        heightM: 2.6,
      },
      dryer_1: {
        id: 'dryer_1',
        type: 'plumbing:pipe-run',
        parentId: 'level_0',
        system: 'dryer-vent',
        material: 'rigid-aluminum',
        nominalSize: '4"',
        path: dryerRoute.path,
      },
    })
    expect(dryerAudit.findings.filter((f) => f.codeRef.includes('Structural')).length).toBe(0)

    // Combined full-span under-floor girder AND vertical basement columns blocking BOTH primary L-bends
    const comboObs = extractPlumbingObstacles(
      {
        level_0: { id: 'level_0', type: 'level' },
        girder_1: {
          id: 'girder_1',
          type: 'structural:beam',
          parentId: 'level_0',
          start: [2, -5],
          end: [2, 5],
          elevationY: -0.2,
          widthIn: 5.25,
          depthIn: 11.875,
        },
        col_1: {
          id: 'col_1',
          type: 'structural:column',
          parentId: 'level_0',
          position: [4, -2, 0],
          widthIn: 8,
          depthIn: 8,
          heightM: 5,
        },
        col_2: {
          id: 'col_2',
          type: 'structural:column',
          parentId: 'level_0',
          position: [0, -2, 2],
          widthIn: 8,
          depthIn: 8,
          heightM: 5,
        },
      },
      'level_0',
    )
    expect(comboObs.find((o) => o.id === 'girder_1')?.structuralKind).toBe('beam')
    expect(comboObs.find((o) => o.id === 'col_1')?.structuralKind).toBe('column')
    const comboDrain = routeDwvDrainRun({
      from: [0, 0.4, 0],
      to: [4, -0.5, 2],
      nominalSize: '4"',
      material: 'pvc-dwv',
      obstacles: comboObs,
    })
    expect(comboDrain.detoured).toBe(true)
    expect(comboDrain.clashes.length).toBe(0)
    // Must duck beneath girder (~ -0.47 m) and jog horizontally around columns without plunging below column footing (-2.13 m)!
    expect(comboDrain.path[1]![1]).toBeGreaterThan(-1.0)
    expect(comboDrain.path[1]![1]).toBeLessThan(-0.4)
    const slope = measureDrainPathSlope(comboDrain.path)
    expect(slope.hasUphillSegment).toBe(false)
    expect(slope.minSegmentSlopeInPerFt).toBeGreaterThanOrEqual(0.24)
  })

  test('PLB-04: sizeVentStack developedLengthFt, SUPPLY_ID_INCHES up to 6", gas >200 ft ok:false, tankless-gas watts, CSST schedule, & monotonic BOM', () => {
    // sizeVentStack honors developedLengthFt and returns 3" row maxDevelopedFt (200 ft) for main stacks
    const longSmallVent = sizeVentStack({ totalDfu: 6, isMainStack: false, developedLengthFt: 80 })
    expect(longSmallVent.recommendedSize).toBe('2"')
    expect(longSmallVent.maxDevelopedFt).toBe(120)

    const mainStack = sizeVentStack({ totalDfu: 24, isMainStack: true })
    expect(mainStack.recommendedSize).toBe('3"')
    expect(mainStack.maxDevelopedFt).toBe(200)

    // Large supply IDs never fall back to 0.671"
    const pex3 = calculateSupplyHydraulics({ gpm: 80, size: '3"', material: 'pex-a' })
    const cu4 = calculateSupplyHydraulics({ gpm: 120, size: '4"', material: 'copper-l' })
    const cpvc6 = calculateSupplyHydraulics({ gpm: 250, size: '6"', material: 'cpvc' })
    expect(pex3.innerDiameterIn).toBeGreaterThan(2.2)
    expect(cu4.innerDiameterIn).toBeGreaterThan(3.8)
    expect(cpvc6.innerDiameterIn).toBeGreaterThan(5.9)

    // Fuel gas > 200 ft returns ok: false
    expect(sizeFuelGasPipe({ totalBtuh: 40000, longestRunFt: 220, material: 'black-iron' }).ok).toBe(false)
    expect(sizeFuelGasPipe({ totalBtuh: 40000, longestRunFt: 220, material: 'csst' }).ok).toBe(false)

    // Tankless gas WH electrical load matches getEquipmentElectricalDemand (300 W / 15A)
    const tankless = sizeWaterHeater({ bathrooms: 2, bedrooms: 3, fuelType: 'tankless-gas' })
    expect(tankless.electricalLoadWatts).toBe(300)
    expect(tankless.electricalBreakerAmps).toBe(15)

    // Schedule detects CSST material in scene
    const csstSched = buildPlumbingSchedule({
      level_0: { id: 'level_0', type: 'level' },
      wh_g: { id: 'wh_g', type: 'plumbing:equipment', equipmentKind: 'water-heater-tankless-gas', parentId: 'level_0', gasBtuh: 199000 },
      gas_run: {
        id: 'gas_run',
        type: 'plumbing:pipe-run',
        parentId: 'level_0',
        system: 'fuel-gas',
        material: 'csst',
        nominalSize: '1"',
        gasBtuh: 199000,
        path: [
          [0, 0.5, 0],
          [18, 0.5, 0], // ~59 ft -> black-iron needs 1" (257k), CSST at 60ft: 3/4"=129k, 1"=302k
        ],
      },
    })
    // At 150k BTU / 40 ft: black-iron 3/4" (170k) vs CSST 3/4" (161k); at 70k BTU / 40 ft: black-iron 1/2" (81k) vs CSST 3/4" (1/2"=63k < 70k)!
    const csstDiffSched = buildPlumbingSchedule({
      level_0: { id: 'level_0', type: 'level' },
      wh_g: { id: 'wh_g', type: 'plumbing:equipment', equipmentKind: 'water-heater-tank-gas', parentId: 'level_0', gasBtuh: 70000 },
      gas_run: {
        id: 'gas_run',
        type: 'plumbing:pipe-run',
        parentId: 'level_0',
        system: 'fuel-gas',
        material: 'csst',
        nominalSize: '3/4"',
        gasBtuh: 70000,
        path: [
          [0, 0.5, 0],
          [10, 0.5, 0], // ~32.8 ft -> 40ft row: black-iron 1/2" holds 81k, CSST 1/2" holds only 63k -> CSST recommends 3/4"!
        ],
      },
    })
    expect(csstSched.loads.recommendedGasMain).toBe('1"')
    expect(csstDiffSched.loads.recommendedGasMain).toBe('3/4"')

    // BOM pricing monotonically increases with pipe size
    const sizesToCheck: PipeNominalSize[] = ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"']
    const pexUnitPrices = sizesToCheck.map((sz) => {
      const b = buildPlumbingBom({
        level_0: { id: 'level_0', type: 'level' },
        p1: {
          id: 'p1',
          type: 'plumbing:pipe-run',
          parentId: 'level_0',
          system: 'cold-water',
          material: 'pex-a',
          nominalSize: sz,
          path: [[0, 0, 0], [5, 0, 0]],
        },
      })
      return b.lines.find((l) => l.category === 'Pipe & Tubing')!.unitMaterialUsd
    })
    for (let i = 1; i < pexUnitPrices.length; i++) {
      expect(pexUnitPrices[i]!).toBeGreaterThan(pexUnitPrices[i - 1]!)
    }

    const pvc4 = buildPlumbingBom({
      p: { id: 'p', type: 'plumbing:pipe-run', system: 'dwv-drain', material: 'pvc-dwv', nominalSize: '4"', path: [[0, 0, 0], [3, 0, 0]] },
    }).lines.find((l) => l.category === 'Pipe & Tubing')!.unitMaterialUsd
    const pvc6 = buildPlumbingBom({
      p: { id: 'p', type: 'plumbing:pipe-run', system: 'dwv-drain', material: 'pvc-dwv', nominalSize: '6"', path: [[0, 0, 0], [3, 0, 0]] },
    }).lines.find((l) => l.category === 'Pipe & Tubing')!.unitMaterialUsd
    expect(pvc6).toBeGreaterThan(pvc4)

    // Supply-only scene (single hose bibb) bills 0 DWV fittings and 0 cleanouts
    const supplyOnlyBom = buildPlumbingBom({
      level_0: { id: 'level_0', type: 'level' },
      bibb: { id: 'bibb', type: 'plumbing:fixture', fixtureKind: 'hose-bibb', parentId: 'level_0', position: [0, 0.46, 0] },
    })
    expect(supplyOnlyBom.lines.some((l) => l.item.includes('DWV Fittings'))).toBe(false)
    expect(supplyOnlyBom.lines.some((l) => l.item.includes('Cleanout'))).toBe(false)
    expect(supplyOnlyBom.lines.some((l) => l.item.includes('Supply Fittings'))).toBe(true)
  })

  test('PLB-05: optional includeFuelGas, no phantom gas into electric WH, zone.category & residential Restroom, wall-parented clearExisting, stale electricalDemand, 2x6 penetrations, & tub-shower-combo', () => {
    // includeFuelGas is optional in Zod schema
    const autoTool = plumbingAgentTools.tools.find((t) => t.name === 'plumbing_autopopulate')!
    expect(autoTool.input.includeFuelGas!.safeParse(undefined).data).toBeUndefined()

    // Gas WH auto-enables fuel gas when includeFuelGas omitted
    const gasWhPlan = planPlumbingAutoPopulate(
      { level_0: { id: 'level_0', type: 'level' } },
      { levelId: 'level_0', waterHeaterKind: 'water-heater-tank-gas' },
    )
    expect(gasWhPlan.pipeRuns.some((r) => r.system === 'fuel-gas')).toBe(true)

    // Electric WH with includeFuelGas: true and NO gas furnaces does NOT route gas into electric WH
    const elecNoGasPlan = planPlumbingAutoPopulate(
      { level_0: { id: 'level_0', type: 'level' } },
      { levelId: 'level_0', waterHeaterKind: 'water-heater-tank-electric', includeFuelGas: true },
    )
    expect(elecNoGasPlan.pipeRuns.some((r) => r.system === 'fuel-gas')).toBe(false)
    expect(elecNoGasPlan.equipment.some((e) => e.equipmentKind === 'gas-meter')).toBe(false)

    // Zone category + residential "Guest Restroom"
    expect(classifyRoomName('Guest Restroom', 'residential')).toBe('bathroom')
    expect(classifyRoomName('Restroom', 'commercial')).toBe('commercial-restroom')
    const rooms = extractRoomPolygons(
      {
        level_0: { id: 'level_0', type: 'level' },
        z1: {
          id: 'z1',
          type: 'zone',
          name: 'Room 101',
          category: 'kitchen',
          parentId: 'level_0',
          polygon: [[0, 0], [4, 0], [4, 4], [0, 4]],
        },
        z2: {
          id: 'z2',
          type: 'zone',
          name: 'Guest Restroom',
          parentId: 'level_0',
          polygon: [[4, 0], [8, 0], [8, 4], [4, 4]],
        },
      },
      'level_0',
      'residential',
    )
    expect(rooms.find((r) => r.id === 'z1')!.category).toBe('kitchen')
    expect(rooms.find((r) => r.id === 'z2')!.category).toBe('bathroom')

    // clearExisting clears wall-parented plumbing fixtures on the target level
    const wallParentScene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level' },
      w1: { id: 'w1', type: 'wall', parentId: 'level_0', start: [0, 0], end: [5, 0], thickness: 0.165, height: 2.6 },
      fix_on_wall: {
        id: 'fix_on_wall',
        type: 'plumbing:fixture',
        fixtureKind: 'lavatory',
        parentId: 'w1',
        position: [2, 0.53, 0],
      },
    }
    const popRes = plumbingAgentOperations.plumbing_autopopulate(
      wallParentScene as never,
      { levelId: 'level_0', clearExisting: true },
      { activeLevelId: 'level_0' },
    )
    expect(popRes.changes.delete).toContain('fix_on_wall')

    // Stale electricalDemand recomputed on switched fixture / equipment
    const switchedLav: SceneNodeLike = {
      id: 'lav_switched',
      type: 'plumbing:fixture',
      fixtureKind: 'lavatory',
      electricalDemand: { required: true, voltage: 120, poles: 1, breakerAmps: 20, loadVa: 1500 },
    }
    expect(resolveNodeElectricalDemand(switchedLav)).toBeNull()
    expect(buildElectricalCoordination({ level_0: { id: 'level_0', type: 'level' }, lav_switched: switchedLav }).length).toBe(0)

    const switchedTankless: SceneNodeLike = {
      id: 'wh_switched',
      type: 'plumbing:equipment',
      equipmentKind: 'water-heater-tankless-gas',
      electricalDemand: {
        required: true,
        voltage: 240,
        poles: 2,
        breakerAmps: 30,
        loadVa: 4500,
        continuous: true,
        dedicatedCircuit: true,
        loadCategory: 'fixed',
      },
    }
    const resolvedTankless = resolveNodeElectricalDemand(switchedTankless)!
    expect(resolvedTankless.voltage).toBe(120)
    expect(resolvedTankless.breakerAmps).toBe(15)
    expect(resolvedTankless.loadVa).toBe(300)

    // 2x6 structural:assembly penetration parity in computePipeFramingPenetrations
    const struct2x6Scene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level' },
      str_1: { id: 'str_1', type: 'structural:assembly', parentId: 'level_0', studSize: '2x6', studSpacingIn: 16 },
      // Wall drawn thin (0.114m), but Priority #1 structural:assembly declares 2x6 (5.5" stud cavity)
      w_wet: { id: 'w_wet', type: 'wall', parentId: 'level_0', start: [0, 0], end: [4, 0], thickness: 0.114, height: 2.6 },
    }
    const bones2x6 = extractBonesPlumbingContext(struct2x6Scene, 'level_0')
    const walls2x6 = extractWallSegments(struct2x6Scene, 'level_0')
    const pens2x6 = computePipeFramingPenetrations({
      pipeRunId: 'p_2in',
      path: [[0.1, 0.8, 0], [2.5, 0.8, 0]],
      pipeSize: '2"',
      material: 'pvc-dwv',
      walls: walls2x6,
      bonesContext: bones2x6,
    })
    expect(pens2x6.length).toBeGreaterThan(0)
    expect(pens2x6[0]!.studDepthM).toBeCloseTo(5.5 * INCHES_TO_METERS, 4)
    expect(pens2x6[0]!.codeCompliant).toBe(true) // 2.625" / 5.5" = 48% <= 60% non-bearing 2x6 limit!

    // tub-shower-combo inferred before bathtub
    const comboPlan = planPlumbingAutoPopulate(
      {
        level_0: { id: 'level_0', type: 'level' },
        item_combo: {
          id: 'item_combo',
          type: 'item',
          name: 'Alcove Tub Shower Combo',
          parentId: 'level_0',
          position: [2, 0, 2],
        },
      },
      { levelId: 'level_0', bonesMode: 'import-only' },
    )
    expect(comboPlan.fixtures[0]!.fixtureKind).toBe('tub-shower-combo')
  })

  test('PLB-06: all 47 CAD models have 0 unintended air gaps (1 connected component) & water heaters sit at y = 0 without drain pan', () => {
    expect(PLUMBING_CAD_CATALOG.length).toBe(47)
    for (const part of PLUMBING_CAD_CATALOG) {
      const comps = countDisconnectedComponents(part.build())
      expect(comps, `${part.id} should have 1 connected component`).toBe(1)
    }

    for (const kind of ['water-heater-tank-electric', 'water-heater-tank-gas', 'water-heater-hpwh'] as const) {
      const g = buildEquipmentCad({ equipmentKind: kind, hasDrainPan: false })
      g.updateMatrixWorld(true)
      const box = new Box3().setFromObject(g)
      expect(box.min.y).toBeCloseTo(0, 4)
    }
  })

  test('PLB-07: vertical stack 2D symbol, rotated equipment 2D & accurate ports, active manifold ports, parametrics, vacuum breaker & chat cards', () => {
    // 2D vertical stack symbol
    const stackNode = {
      ...plumbingPipeRunRenderDefinition.defaults!(),
      id: 'plumbpipe_stack',
      system: 'dwv-vent' as const,
      material: 'pvc-dwv' as const,
      nominalSize: '3"' as const,
      isMainVentStack: true,
      path: [[2, -0.34, 3], [2, 3.05, 3]] as Array<[number, number, number]>,
    }
    const stackFp = buildPlumbingPipeRunFloorplan(stackNode as never, {} as never)
    expect(stackFp.kind).toBe('group')
    if (stackFp.kind === 'group') {
      expect(stackFp.children.some((c) => c.kind === 'circle')).toBe(true)
      expect(stackFp.children.filter((c) => c.kind === 'line').length).toBe(2)
    }

    // Rotated rectangular equipment 2D floorplan + accurate non-WH port heights
    const gasMeter0 = {
      ...plumbingEquipmentRenderDefinition.defaults!(),
      id: 'plumbeq_gm',
      equipmentKind: 'gas-meter' as const,
      position: [1, 0.9, 1] as [number, number, number],
      rotation: 0,
    }
    const gmFp0 = buildPlumbingEquipmentFloorplan(gasMeter0 as never, {} as never)
    const gmFp90 = buildPlumbingEquipmentFloorplan({ ...gasMeter0, rotation: Math.PI / 2 } as never, {} as never)
    expect(JSON.stringify(gmFp0)).not.toBe(JSON.stringify(gmFp90))
    expect(JSON.stringify(gmFp0)).toContain('"polygon"')

    const sumpPorts = getPlumbingEquipmentPorts({
      ...gasMeter0,
      equipmentKind: 'sump-pump',
      position: [0, 0, 0],
    } as never)
    expect(sumpPorts.length).toBe(1)
    expect(sumpPorts[0]!.system).toBe('dwv')
    expect(sumpPorts[0]!.position[1]).toBeCloseTo(1.25, 2)

    const expPorts = getPlumbingEquipmentPorts({
      ...gasMeter0,
      equipmentKind: 'expansion-tank',
      position: [0, 1.65, 0],
    } as never)
    expect(expPorts.length).toBe(1)
    expect(expPorts[0]!.position[1]).toBeCloseTo(1.90, 2)

    const prvPorts = getPlumbingEquipmentPorts({
      ...gasMeter0,
      equipmentKind: 'main-shutoff-prv',
      position: [0, 0.75, 0],
    } as never)
    expect(prvPorts.length).toBe(2)
    expect(prvPorts[0]!.position[1]).toBeCloseTo(0.47, 2)
    expect(prvPorts[1]!.position[1]).toBeCloseTo(1.03, 2)

    // Active vs inactive manifold cutaway port rendering
    const fullManifold = buildWiredManifoldCutawayCad({
      manifoldKind: 'pex-homerun',
      portCount: 12,
      viewMode: 'open-manifold',
      ports: [],
    })
    const sparseManifold = buildWiredManifoldCutawayCad({
      manifoldKind: 'pex-homerun',
      portCount: 12,
      viewMode: 'open-manifold',
      ports: [
        { portIndex: 0, side: 'hot', label: 'Kitchen Hot', pipeSize: '1/2"', active: true },
        { portIndex: 0, side: 'cold', label: 'Kitchen Cold', pipeSize: '1/2"', active: true },
      ],
    })
    expect(sparseManifold.children.length).toBeLessThan(fullManifold.children.length)

    // Parametrics, roomVolumeCuFt, hasVacuumBreaker, and chat cards
    expect(
      plumbingEquipmentParametrics.groups.some((g) => g.fields.some((f) => f.key === 'roomVolumeCuFt')),
    ).toBe(true)
    expect(
      plumbingPipeRunParametrics.groups.some((g) => g.fields.some((f) => f.key === 'isMainVentStack')),
    ).toBe(true)
    expect(
      plumbingPipeRunParametrics.groups.some((g) => g.fields.some((f) => f.key === 'isHorizontalSanTee')),
    ).toBe(true)

    const base = { level_0: { id: 'level_0', type: 'level' } }
    const hpwhOp = plumbingAgentOperations.plumbing_place_equipment(
      base as never,
      { equipmentKind: 'water-heater-hpwh', position: [1, 0, 1], roomVolumeCuFt: 550 },
      { activeLevelId: 'level_0' },
    )
    expect((hpwhOp.changes.create![0]!.node as unknown as Record<string, unknown>).roomVolumeCuFt).toBe(550)

    const lavOp = plumbingAgentOperations.plumbing_place_fixture(
      base as never,
      { fixtureKind: 'lavatory', position: [1, 0.53, 1] },
      { activeLevelId: 'level_0' },
    )
    expect((lavOp.changes.create![0]!.node as unknown as Record<string, unknown>).hasVacuumBreaker).toBe(false)

    const bibbOp = plumbingAgentOperations.plumbing_place_fixture(
      base as never,
      { fixtureKind: 'hose-bibb', position: [1, 0.46, 0] },
      { activeLevelId: 'level_0' },
    )
    expect((bibbOp.changes.create![0]!.node as unknown as Record<string, unknown>).hasVacuumBreaker).toBe(true)

    expect(plumbingChatExtension.cards?.plumbing_calculate_loads).toBeDefined()
    expect(plumbingChatExtension.cards?.plumbing_autopopulate).toBeDefined()
  })

  test('Pass-2 Referee Fixes: basement column footing guard, scoped combo inference, same-voltage electricalDemand recompute, conservative slope bucket, gas detail length, manifold naming, 6" supply minSize, & fixture vacuum breaker default', () => {
    // 1. Basement column on pressurized route does NOT plunge pipe below footing (-2.13 m)
    const colOnlyObs = extractPlumbingObstacles(
      {
        level_0: { id: 'level_0', type: 'level' },
        col_basement: {
          id: 'col_basement',
          type: 'structural:column',
          parentId: 'level_0',
          position: [2, -2, 0],
          widthIn: 8,
          depthIn: 8,
          heightM: 5,
        },
      },
      'level_0',
    )
    const pressColRoute = routePressurizedPipeRun({
      from: [0, 0.5, 0],
      to: [4, 0.5, 0],
      routingPlaneY: -0.16,
      nominalSize: '3/4"',
      material: 'pex-a',
      obstacles: colOnlyObs,
    })
    expect(pressColRoute.clashes.length).toBe(0)
    expect(Math.min(...pressColRoute.path.map((p) => p[1]))).toBeGreaterThan(-1.0)

    // 2. Scoped combo inference: Washer Dryer Combo -> clothes-washer; Wall Oven Microwave Combo -> null
    const comboCheck = planPlumbingAutoPopulate(
      {
        level_0: { id: 'level_0', type: 'level' },
        item_wd: { id: 'item_wd', type: 'item', name: 'Washer Dryer Combo', parentId: 'level_0', position: [1, 0, 1] },
        item_oven: { id: 'item_oven', type: 'item', name: 'Wall Oven Microwave Combo', parentId: 'level_0', position: [2, 0, 1] },
      },
      { levelId: 'level_0', bonesMode: 'import-only' },
    )
    expect(comboCheck.fixtures.length).toBe(1)
    expect(comboCheck.fixtures[0]!.fixtureKind).toBe('clothes-washer')

    // 3. Same-voltage/pole kind switches & watts upgrade recompute loadVa, breakerAmps, & label
    const switchedSoftener = resolveNodeElectricalDemand({
      id: 'eq1',
      type: 'plumbing:equipment',
      equipmentKind: 'water-softener',
      electricalDemand: { required: true, voltage: 120, poles: 1, breakerAmps: 15, loadVa: 300, label: 'Tankless Gas WH Ignition / Blower' },
    })!
    expect(switchedSoftener.loadVa).toBe(150)
    expect(switchedSoftener.label).toContain('Water Softener')

    const switchedEjector = resolveNodeElectricalDemand({
      id: 'eq2',
      type: 'plumbing:equipment',
      equipmentKind: 'sewage-ejector',
      electricalDemand: { required: true, voltage: 120, poles: 1, breakerAmps: 20, loadVa: 1200, label: 'Sump Pump (Dedicated GFCI)' },
    })!
    expect(switchedEjector.loadVa).toBe(1440)
    expect(switchedEjector.label).toContain('Sewage Ejector')

    const switchedDisposal = resolveNodeElectricalDemand({
      id: 'fx1',
      type: 'plumbing:fixture',
      fixtureKind: 'garbage-disposal',
      electricalDemand: { required: true, voltage: 120, poles: 1, breakerAmps: 20, loadVa: 1500, label: 'Dishwasher (NEC 210.8(D) GFCI)' },
    })!
    expect(switchedDisposal.loadVa).toBe(1000)
    expect(switchedDisposal.label).toContain('Disposal')

    const upgradedWh = resolveNodeElectricalDemand({
      id: 'eq3',
      type: 'plumbing:equipment',
      equipmentKind: 'water-heater-tank-electric',
      watts: 6000,
      electricalDemand: { required: true, voltage: 240, poles: 2, breakerAmps: 30, loadVa: 4500, label: 'Electric Water Heater (4.5 kW)' },
    })!
    expect(upgradedWh.loadVa).toBe(6000)
    expect(upgradedWh.breakerAmps).toBe(35)

    // 4. Conservative building-drain slope bucketing (0.18 in/ft -> 0.125 bucket, max 36 DFU on 3") & accurate CSST run length in detail
    const auditPass2 = auditScenePlumbing({
      level_0: { id: 'level_0', type: 'level' },
      stack_1: {
        id: 'stack_1',
        type: 'plumbing:pipe-run',
        parentId: 'level_0',
        system: 'dwv-vent',
        material: 'pvc-dwv',
        nominalSize: '3"',
        isMainVentStack: true,
        hasCleanout: true,
        path: [[0, -0.34, 0], [0, 3.0, 0]],
      },
      // 0.18"/ft = 0.015 drop per m; over 4 m drop = 0.06 m -> 0.18"/ft (< 0.25", >= 0.125"); 40 DFU exceeds 36 DFU @ 1/8"/ft!
      main_018: {
        id: 'main_018',
        type: 'plumbing:pipe-run',
        name: '3" Main Building Drain',
        parentId: 'level_0',
        system: 'dwv-drain',
        material: 'pvc-dwv',
        nominalSize: '3"',
        sourceNodeId: 'stack_1',
        dfuLoad: 40,
        hasCleanout: true,
        path: [[0, -0.34, 0], [4, -0.40, 0]],
      },
      short_csst_over: {
        id: 'short_csst_over',
        type: 'plumbing:pipe-run',
        name: 'Short Over-Cap CSST',
        parentId: 'level_0',
        system: 'fuel-gas',
        material: 'csst',
        nominalSize: '1-1/4"',
        gasBtuh: 1500000,
        hasSedimentTrap: true,
        hasShutoffWithin6Ft: true,
        path: [[0, 0.5, 2], [10, 0.5, 2]],
      },
    })
    expect(auditPass2.findings.some((f) => f.nodeIds.includes('main_018') && f.codeRef.includes('710.1'))).toBe(true)
    const csstFinding = auditPass2.findings.find((f) => f.nodeIds.includes('short_csst_over'))!
    expect(csstFinding.detail).toContain('at 32.81 ft')
    expect(csstFinding.detail).not.toContain('<= 200 ft')

    // 5. Default manifold names per manifoldKind & optional name in agent-tools
    const manTool = plumbingAgentTools.tools.find((t) => t.name === 'plumbing_place_manifold')!
    expect(manTool.input.name!.safeParse(undefined).data).toBeUndefined()
    const base = { level_0: { id: 'level_0', type: 'level' } }
    const csstMan = plumbingAgentOperations.plumbing_place_manifold(
      base as never,
      { manifoldKind: 'gas-csst', portCount: 8, position: [1, 1.35, 1] },
      { activeLevelId: 'level_0' },
    )
    const copperMan = plumbingAgentOperations.plumbing_place_manifold(
      base as never,
      { manifoldKind: 'copper-header', portCount: 12, position: [1, 1.35, 1] },
      { activeLevelId: 'level_0' },
    )
    expect(csstMan.result.name).toBe('CSST Fuel-Gas Manifold (8-Port)')
    expect(copperMan.result.name).toBe('Type L Copper Header (12-Port)')

    // 6. sizeSupplyPipe supports minSize: '6"' without downgrading to '1/2"'
    expect(sizeSupplyPipe({ wsfu: 50, minSize: '6"', material: 'copper-l' }).size).toBe('6"')

    // 7. PlumbingFixtureNode & defaults set hasVacuumBreaker: false for lavatory
    expect(PlumbingFixtureNode.parse({ id: 'plumbfix_99', type: 'plumbing:fixture' }).hasVacuumBreaker).toBe(false)
    expect(plumbingFixtureRenderDefinition.defaults!().hasVacuumBreaker).toBe(false)
  })

  test('Cross-Trade & Visual Interop (XT-01, XT-04, XT-10, XT-13, VIS-04): per-wall studSize override, order-independent totalGasBtuh, rotated column AABB, transformer prism + 2-pass electrical claiming, & orthogonal PEX home runs', () => {
    // XT-01: Per-wall 2x4 override must NOT be inflated by global structural:assembly 2x6 default
    const global2x6WithInt2x4: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level' },
      str_1: {
        id: 'str_1',
        type: 'structural:assembly',
        parentId: 'level_0',
        studSize: '2x6',
        studSpacingIn: 16,
        wallOverrides: {
          w_int_2x4: { construction: 'framed', studSize: '2x4', isLoadBearing: false },
        },
      },
      w_int_2x4: {
        id: 'w_int_2x4',
        type: 'wall',
        parentId: 'level_0',
        start: [0, 0],
        end: [4, 0],
        thickness: 0.114,
        height: 2.6,
      },
      pipe_3in: {
        id: 'pipe_3in',
        type: 'plumbing:pipe-run',
        parentId: 'level_0',
        system: 'dwv-drain',
        material: 'pvc-dwv',
        nominalSize: '3"',
        wallId: 'w_int_2x4',
        hasCleanout: true,
        path: [[0.5, 0.8, 0], [2.5, 0.72, 0]],
      },
    }
    const xt01AuditFail = auditScenePlumbing(global2x6WithInt2x4)
    expect(xt01AuditFail.findings.some((f) => f.codeRef.includes('Wet Wall') && f.nodeIds.includes('pipe_3in'))).toBe(true)
    const xt01PensFail = computePipeFramingPenetrations({
      pipeRunId: 'pipe_3in',
      path: [[0.5, 0.8, 0], [2.5, 0.72, 0]],
      pipeSize: '3"',
      material: 'pvc-dwv',
      walls: extractWallSegments(global2x6WithInt2x4, 'level_0'),
      bonesContext: extractBonesPlumbingContext(global2x6WithInt2x4, 'level_0'),
    })
    expect(xt01PensFail.length).toBeGreaterThan(0)
    expect(xt01PensFail[0]!.studDepthM).toBeCloseTo(3.5 * INCHES_TO_METERS, 4)
    expect(xt01PensFail[0]!.codeCompliant).toBe(false)

    // XT-01 converse: global 2x4 with per-wall 2x6 wet-wall override permits 3" vertical DWV pipe
    const global2x4WithWet2x6: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level' },
      str_1: {
        id: 'str_1',
        type: 'structural:assembly',
        parentId: 'level_0',
        studSize: '2x4',
        studSpacingIn: 16,
        wallOverrides: {
          w_wet_2x6: { construction: 'framed', studSize: '2x6', isWetWall: true },
        },
      },
      w_wet_2x6: {
        id: 'w_wet_2x6',
        type: 'wall',
        parentId: 'level_0',
        start: [0, 0],
        end: [4, 0],
        thickness: 0.114,
        height: 2.6,
      },
      stack_3in: {
        id: 'stack_3in',
        type: 'plumbing:pipe-run',
        parentId: 'level_0',
        system: 'dwv-vent',
        material: 'pvc-dwv',
        nominalSize: '3"',
        wallId: 'w_wet_2x6',
        isMainVentStack: true,
        hasCleanout: true,
        path: [[2, -0.34, 0], [2, 3.0, 0]],
      },
    }
    const xt01AuditPass = auditScenePlumbing(global2x4WithWet2x6)
    expect(xt01AuditPass.findings.some((f) => f.codeRef.includes('Wet Wall'))).toBe(false)
    const xt01PensPass = computePipeFramingPenetrations({
      pipeRunId: 'stack_3in',
      path: [[2, -0.34, 0], [2, 3.0, 0]],
      pipeSize: '3"',
      material: 'pvc-dwv',
      walls: extractWallSegments(global2x4WithWet2x6, 'level_0'),
      bonesContext: extractBonesPlumbingContext(global2x4WithWet2x6, 'level_0'),
    })
    expect(xt01PensPass.length).toBeGreaterThan(0)
    expect(xt01PensPass[0]!.studDepthM).toBeCloseTo(5.5 * INCHES_TO_METERS, 4)
    expect(xt01PensPass[0]!.codeCompliant).toBe(true)

    // XT-04: Order-independent totalGasBtuh (pipe run before appliances vs after appliances)
    const gasPipeNode: SceneNodeLike = {
      id: 'pipe_gas_main',
      type: 'plumbing:pipe-run',
      parentId: 'level_0',
      system: 'fuel-gas',
      material: 'black-iron',
      nominalSize: '1"',
      gasBtuh: 120000,
      path: [[0, 0.5, 0], [8, 0.5, 0]],
    }
    const whNode: SceneNodeLike = {
      id: 'wh_gas',
      type: 'plumbing:equipment',
      equipmentKind: 'water-heater-tank-gas',
      parentId: 'level_0',
      gasBtuh: 40000,
    }
    const furnNode: SceneNodeLike = {
      id: 'furn_gas',
      type: 'hvac:equipment',
      parentId: 'level_0',
      gasBtuh: 80000,
    }
    const pipeFirst = buildPlumbingSchedule({
      level_0: { id: 'level_0', type: 'level' },
      pipe_gas_main: gasPipeNode,
      wh_gas: whNode,
      furn_gas: furnNode,
    })
    const pipeLast = buildPlumbingSchedule({
      level_0: { id: 'level_0', type: 'level' },
      wh_gas: whNode,
      furn_gas: furnNode,
      pipe_gas_main: gasPipeNode,
    })
    expect(pipeFirst.loads.totalGasBtuh).toBe(120000)
    expect(pipeLast.loads.totalGasBtuh).toBe(120000)

    // XT-10 & XT-13: Rotated rectangular columns & floor-anchored electrical:transformer prism
    const obsScene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level' },
      col_struct_rot: {
        id: 'col_struct_rot',
        type: 'structural:column',
        parentId: 'level_0',
        position: [3, 0, 3],
        widthIn: 12,
        depthIn: 4,
        heightM: 3.0,
        rotation: Math.PI / 2,
      },
      col_plain_rot: {
        id: 'col_plain_rot',
        type: 'column',
        parentId: 'level_0',
        position: [6, 0, 3],
        width: 0.6,
        depth: 0.2,
        height: 2.8,
        rotation: [0, Math.PI / 2, 0],
      },
      xfmr_1: {
        id: 'xfmr_1',
        type: 'electrical:transformer',
        name: '45 kVA Dry Transformer',
        parentId: 'level_0',
        position: [1, 0, 5],
        height: 1.5,
      },
    }
    const obsList = extractPlumbingObstacles(obsScene, 'level_0')
    const sCol = obsList.find((o) => o.id === 'col_struct_rot')!
    expect(sCol.box.maxX - sCol.box.minX).toBeCloseTo(4 * INCHES_TO_METERS, 4)
    expect(sCol.box.maxZ - sCol.box.minZ).toBeCloseTo(12 * INCHES_TO_METERS, 4)
    const pCol = obsList.find((o) => o.id === 'col_plain_rot')!
    expect(pCol.box.maxX - pCol.box.minX).toBeCloseTo(0.2, 4)
    expect(pCol.box.maxZ - pCol.box.minZ).toBeCloseTo(0.6, 4)
    const xfmrObs = obsList.find((o) => o.id === 'xfmr_1')!
    expect(xfmrObs.box.maxX - xfmrObs.box.minX).toBeCloseTo(0.76 + 0.06, 4)
    expect(xfmrObs.box.maxZ - xfmrObs.box.minZ).toBeCloseTo(0.64 + 0.06, 4)
    expect(xfmrObs.box.maxY).toBeCloseTo(1.5 + 1.83, 2)

    // XT-13: 2-pass electrical coordination with exclusive claimedDeviceIds
    const coordOneDevice = buildElectricalCoordination({
      level_0: { id: 'level_0', type: 'level' },
      dw_1: { id: 'dw_1', type: 'plumbing:fixture', fixtureKind: 'dishwasher', parentId: 'level_0', position: [2.0, 0.4, 1.0] },
      disp_1: { id: 'disp_1', type: 'plumbing:fixture', fixtureKind: 'garbage-disposal', parentId: 'level_0', position: [2.25, 0.4, 1.0] },
      dev_single: {
        id: 'dev_single',
        type: 'electrical:device',
        parentId: 'level_0',
        position: [2.05, 0.4, 1.0],
        panelId: 'mdp_1',
        circuitNumber: 12,
        poles: 1,
        breakerAmps: 20,
      },
    })
    expect(coordOneDevice.filter((r) => r.wired).length).toBe(1)
    expect(coordOneDevice.filter((r) => !r.wired).length).toBe(1)

    // Pass 1 explicit mepSourceNodeId wins over a closer unlinked fixture
    const coordExplicitWins = buildElectricalCoordination({
      level_0: { id: 'level_0', type: 'level' },
      dw_1: { id: 'dw_1', type: 'plumbing:fixture', fixtureKind: 'dishwasher', parentId: 'level_0', position: [2.0, 0.4, 1.0] },
      disp_1: { id: 'disp_1', type: 'plumbing:fixture', fixtureKind: 'garbage-disposal', parentId: 'level_0', position: [2.5, 0.4, 1.0] },
      dev_linked: {
        id: 'dev_linked',
        type: 'electrical:device',
        parentId: 'level_0',
        position: [2.0, 0.4, 1.0],
        panelId: 'mdp_1',
        circuitNumber: 14,
        poles: 1,
        breakerAmps: 20,
        metadata: { mepSourceNodeId: 'disp_1' },
      },
    })
    expect(coordExplicitWins.find((r) => r.sourceNodeId === 'disp_1')!.wired).toBe(true)
    expect(coordExplicitWins.find((r) => r.sourceNodeId === 'dw_1')!.wired).toBe(false)

    // VIS-04: Manifold PEX home runs & hot-recirc route cleanly orthogonally (zero diagonal spiderweb segments)
    const visScene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level' },
      w1: { id: 'w1', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], thickness: 0.165, height: 2.6 },
      w2: { id: 'w2', type: 'wall', parentId: 'level_0', start: [0, 8], end: [10, 8], thickness: 0.165, height: 2.6 },
      z_bath: { id: 'z_bath', type: 'zone', name: 'Bathroom', parentId: 'level_0', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      z_kit: { id: 'z_kit', type: 'zone', name: 'Kitchen', parentId: 'level_0', polygon: [[5, 0], [10, 0], [10, 4], [5, 4]] },
      z_util: { id: 'z_util', type: 'zone', name: 'Utility', parentId: 'level_0', polygon: [[0, 4], [4, 4], [4, 8], [0, 8]] },
    }
    for (const foundationType of ['crawlspace', 'slab'] as const) {
      const visPlan = planPlumbingAutoPopulate(visScene, {
        levelId: 'level_0',
        supplyTopology: 'manifold',
        foundationType,
        includeHotRecirc: true,
      })
      const supplyRuns = visPlan.pipeRuns.filter(
        (r) => r.system === 'cold-water' || r.system === 'hot-water' || r.system === 'hot-recirc',
      )
      expect(supplyRuns.length).toBeGreaterThan(5)
      for (const r of supplyRuns) {
        for (let i = 1; i < r.path.length; i++) {
          const a = r.path[i - 1]!
          const b = r.path[i]!
          const dx = Math.abs(b[0] - a[0])
          const dz = Math.abs(b[2] - a[2])
          // Every horizontal segment must be orthogonal (either X-aligned or Z-aligned, never diagonal)
          if (dx > 0.02 || dz > 0.02) {
            expect(Math.min(dx, dz)).toBeLessThan(0.01)
          }
        }
      }
      const fullVis: Record<string, SceneNodeLike> = { ...visScene }
      for (const eq of visPlan.equipment) fullVis[eq.id] = { ...eq, type: 'plumbing:equipment', parentId: 'level_0' }
      for (const m of visPlan.manifolds) fullVis[m.id] = { ...m, type: 'plumbing:manifold', parentId: 'level_0' }
      for (const f of visPlan.fixtures) fullVis[f.id] = { ...f, type: 'plumbing:fixture', parentId: 'level_0' }
      for (const r of visPlan.pipeRuns) fullVis[r.id] = { ...r, type: 'plumbing:pipe-run', parentId: 'level_0' }
      expect(auditScenePlumbing(fullVis).errorCount).toBe(0)
    }
  })
})
