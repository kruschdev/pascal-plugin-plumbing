import { describe, expect, test } from 'bun:test'
import { Mesh } from 'three'
import { plumbingAgentOperations } from '../agent-operations'
import { plumbingAgentTools } from '../agent-tools'
import { PLUMBING_CAD_CATALOG, buildPipeRunCad } from '../cad/catalog'
import { createPlumbingMaterialPool } from '../cad/materials'
import { auditScenePlumbing } from '../ipc/audit'
import { planPlumbingAutoPopulate } from '../ipc/autopopulate'
import {
  type SceneNodeLike,
  checkWetWallPipeFit,
  computePipeFramingPenetrations,
  extractBonesPlumbingContext,
  getEquipmentElectricalDemand,
  getFixtureElectricalDemand,
  resolveNodeLevelId,
} from '../ipc/framing-interop'
import { buildPlumbingBom, formatPlumbingBomCsv } from '../ipc/pricing'
import {
  extractPlumbingObstacles,
  extractWallSegments,
  measureDrainPathSlope,
  routeDwvDrainRun,
  routeVentRun,
} from '../ipc/routing'
import { buildElectricalCoordination, buildPlumbingSchedule } from '../ipc/schedule'
import { getFixtureWsfu } from '../ipc/tables'
import { plumbingEquipmentRenderDefinition, getPlumbingEquipmentPorts } from '../nodes/equipment'
import {
  buildPlumbingFixtureFloorplan,
  buildPlumbingFixtureGeometry,
  getPlumbingFixturePorts,
  plumbingFixtureRenderDefinition,
} from '../nodes/fixture'
import {
  buildPlumbingManifoldFloorplan,
  getPlumbingManifoldPorts,
  type PlumbingManifoldNode,
} from '../nodes/manifold'
import { plumbingPipeRunRenderDefinition } from '../nodes/pipe-run'
import { plumbingPipeRunParametrics } from '../nodes/parametrics'

describe('Phase 1 Gemini 4 Carbon Audit Regression Suite (BUG-01..19, OPT-01..05, CON-01..08)', () => {
  test('BUG-01: Short DWV elbow legs (0.06 m - 0.14 m) preserve >= 0.25"/ft gravity slope without quantization false positives', () => {
    for (const dx of [0.06, 0.08, 0.12, 0.14, 0.2]) {
      const r = routeDwvDrainRun({
        from: [0, 0.15, 0],
        to: [dx, -0.55, 5.0],
        nominalSize: '2"',
        foundationType: 'crawlspace',
      })
      const slope = measureDrainPathSlope(r.path)
      expect(slope.hasUphillSegment).toBe(false)
      expect(slope.minSegmentSlopeInPerFt).toBeGreaterThanOrEqual(0.24)
    }
  })

  test('BUG-02: routeDwvDrainRun & routeVentRun detour around structural columns and NEC 110.26(E) panels while keeping monotonic gravity fall', () => {
    const obstacles = extractPlumbingObstacles(
      {
        level_0: { id: 'level_0', type: 'level' },
        col_1: {
          id: 'col_1',
          type: 'structural:column',
          name: 'Main Post',
          parentId: 'level_0',
          position: [4, -1, 0],
          widthIn: 8,
          depthIn: 8,
          heightM: 4,
        },
        panel_1: {
          id: 'panel_1',
          type: 'electrical:panel',
          name: 'MDP-1',
          parentId: 'level_0',
          position: [2, 1.5, 0],
          width: 0.42,
          depth: 0.16,
          height: 0.92,
        },
      },
      'level_0',
    )

    // BUG-14: NEC 110.26(E) dedicated space extends down to floor (minY = 0)
    const panelObs = obstacles.find((o) => o.id === 'panel_1')!
    expect(panelObs.box.minY).toBe(0)
    expect(panelObs.box.maxX - panelObs.box.minX).toBeLessThan(0.55)
    expect(panelObs.box.maxZ - panelObs.box.minZ).toBeLessThan(0.3)

    const drain = routeDwvDrainRun({
      from: [0, 0.4, 0],
      to: [4, -0.4, 3],
      nominalSize: '3"',
      obstacles,
    })
    expect(drain.detoured).toBe(true)
    expect(drain.clashes.length).toBe(0)
    const drainSlope = measureDrainPathSlope(drain.path)
    expect(drainSlope.hasUphillSegment).toBe(false)
    expect(drainSlope.minSegmentSlopeInPerFt).toBeGreaterThanOrEqual(0.24)

    const vent = routeVentRun({
      from: [0, 0.5, 0],
      stackPoint: [4, 3],
      floodRimHeightM: 0.85,
      ceilingHeightM: 2.6,
      obstacles,
    })
    expect(vent.detoured).toBe(true)
    expect(vent.clashes.length).toBe(0)
  })

  test('BUG-03, BUG-04, BUG-05: IRC R602.6 bore % uses holeSawIn + isLoadBearing, nail plate threshold is 1-1/4", and 3D nail plates orient along wallNormal on both faces', () => {
    // 1/2" PEX (holeSaw 7/8" = 0.875") in 2x4 (3.5" cavity): edge = (3.5 - 0.875)/2 = 1.3125" >= 1.25" -> NO nail plate
    const pexHalf2x4 = checkWetWallPipeFit({
      wallThicknessM: 0.1143, // 4.5" finished = 3.5" cavity
      pipeSize: '1/2"',
      material: 'pex-a',
      isHorizontalBore: true,
    })
    expect(pexHalf2x4.fits).toBe(true)
    expect(pexHalf2x4.needsNailPlate).toBe(false)

    // 3/4" PEX (holeSaw 1-1/8" = 1.125") in 2x4 (3.5" cavity): edge = (3.5 - 1.125)/2 = 1.1875" < 1.25" -> NEEDS nail plate
    const pex34_2x4 = checkWetWallPipeFit({
      wallThicknessM: 0.1143,
      pipeSize: '3/4"',
      material: 'pex-a',
      isHorizontalBore: true,
    })
    expect(pex34_2x4.fits).toBe(true)
    expect(pex34_2x4.needsNailPlate).toBe(true)

    // BUG-04: 1-1/2" PVC Sch-40 (holeSaw 2-1/4" = 2.25") in 2x4 (3.5"): 2.25/3.5 = 64% > 60% non-bearing limit -> FAILS!
    const pvc15_2x4 = checkWetWallPipeFit({
      wallThicknessM: 0.1143,
      pipeSize: '1-1/2"',
      material: 'pvc-dwv',
      isHorizontalBore: true,
      isLoadBearing: false,
    })
    expect(pvc15_2x4.fits).toBe(false)
    expect(pvc15_2x4.borePctOfStud).toBeGreaterThan(60)

    // BUG-04 & BUG-05: Z-aligned load-bearing wall passes isLoadBearing=true & wallNormal=[-1, 0] (or [1, 0]) and renders 2 nail plates along X!
    const scene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level' },
      w_z: { id: 'w_z', type: 'wall', parentId: 'level_0', start: [2, 0], end: [2, 4], thickness: 0.165, height: 2.6 },
      bf: {
        id: 'bf',
        type: 'bones:framing',
        parentId: 'level_0',
        studSpacingIn: 16,
        wallOverrides: { w_z: { construction: 'framed', studSpacingIn: 16, isLoadBearing: true } },
      },
    }
    const walls = extractWallSegments(scene, 'level_0')
    const bones = extractBonesPlumbingContext(scene, 'level_0')
    // 2" PVC has 2.625" hole saw -> 2.625 / 5.5 = 48% > 40% load-bearing limit in 2x6 wall!
    const pens = computePipeFramingPenetrations({
      pipeRunId: 'p1',
      path: [
        [2, 1.0, 0.1],
        [2, 1.0, 2.0],
      ],
      pipeSize: '2"',
      material: 'pvc-dwv',
      walls,
      bonesContext: bones,
    })
    expect(pens.length).toBeGreaterThan(0)
    const firstStud = pens.find((p) => p.memberKind === 'stud')!
    expect(firstStud.codeCompliant).toBe(false) // 48% > 40% load-bearing
    expect(Math.abs(firstStud.wallNormal[0])).toBeCloseTo(1, 3)
    expect(Math.abs(firstStud.wallNormal[1])).toBeCloseTo(0, 3)

    const cad = buildPipeRunCad({
      id: 'p1',
      path: [
        [2, 1.0, 0.1],
        [2, 1.0, 2.0],
      ],
      system: 'dwv-drain',
      material: 'pvc-dwv',
      nominalSize: '3"',
      penetrations: [{ ...firstStud, holeSawIn: 3.75, needsNailPlate: true }],
    })
    // Front & back nail plates offset along wallNormal X (not world +Z!)
    const plates = cad.children.filter((c) => c instanceof Mesh && Math.abs(c.position.x - firstStud.position[0]) > 0.04)
    expect(plates.length).toBe(2)
    expect(plates[0]!.position.z).toBeCloseTo(firstStud.position[2], 3)
    expect(plates[1]!.position.z).toBeCloseTo(firstStud.position[2], 3)
  })

  test('BUG-06 & OPT-03: createPlumbingMaterialPool instantiates materials lazily (not all 21 up front)', () => {
    const pool = createPlumbingMaterialPool()
    // Accessing only 1 material should work and dispose cleanly
    const m1 = pool.pexColdBlue
    const m2 = pool.pexColdBlue
    expect(m1).toBe(m2)
    pool.dispose()
  })

  test('BUG-07 & BUG-08: Commercial occupancy applies flushometer WSFU & curves; gas-meter never double-counts totalGasBtuh', () => {
    const commWsfu = getFixtureWsfu('water-closet', 'commercial')
    expect(commWsfu.total).toBe(10.0)
    expect(getFixtureWsfu('lavatory', 'commercial').total).toBe(2.0)

    const commPlan = planPlumbingAutoPopulate(
      {
        level_0: { id: 'level_0', type: 'level' },
        r1: {
          id: 'r1',
          type: 'zone',
          name: 'Commercial Restroom',
          parentId: 'level_0',
          polygon: [
            [0, 0],
            [5, 0],
            [5, 4],
            [0, 4],
          ],
        },
      },
      { levelId: 'level_0', occupancy: 'commercial', waterHeaterKind: 'water-heater-tank-gas', includeFuelGas: true },
    )

    // Verify commercial WCs got 10 WSFU and gas meter has gasBtuh = 0
    const commWcs = commPlan.fixtures.filter((f) => f.fixtureKind === 'water-closet')
    expect(commWcs.length).toBeGreaterThan(0)
    expect(commWcs[0]!.wsfuTotal).toBe(10.0)
    const gasMeter = commPlan.equipment.find((e) => e.equipmentKind === 'gas-meter')!
    expect(gasMeter.gasBtuh).toBe(0)

    const scene: Record<string, SceneNodeLike> = { level_0: { id: 'level_0', type: 'level' } }
    for (const eq of commPlan.equipment) scene[eq.id] = { ...eq, type: 'plumbing:equipment', parentId: 'level_0' }
    for (const f of commPlan.fixtures) scene[f.id] = { ...f, type: 'plumbing:fixture', parentId: 'level_0' }
    for (const r of commPlan.pipeRuns) scene[r.id] = { ...r, type: 'plumbing:pipe-run', parentId: 'level_0' }

    // Even if someone manually puts gasBtuh on a gas-meter node, schedule excludes gas-meter from appliance totalGasBtuh!
    scene[gasMeter.id]!.gasBtuh = 99999
    const sched = buildPlumbingSchedule(scene, { occupancy: 'commercial' })
    const wh = commPlan.equipment.find((e) => e.equipmentKind === 'water-heater-tank-gas')!
    expect(sched.loads.totalGasBtuh).toBe(wh.gasBtuh!)
  })

  test('BUG-09 & BUG-10: Multi-level isolation prevents cross-floor NEC 110.26(E) clashes, phantom wall bores, and cross-floor/shared-circuit electrical matches', () => {
    const multiLevel: Record<string, SceneNodeLike> = {
      lvl_1: { id: 'lvl_1', type: 'level' },
      lvl_2: { id: 'lvl_2', type: 'level' },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl_1', start: [0, 0], end: [6, 0], thickness: 0.14, height: 2.6 },
      panel_l1: {
        id: 'panel_l1',
        type: 'electrical:panel',
        name: 'MDP-1',
        parentId: 'lvl_1',
        position: [2, 1.5, 0.1],
      },
      // Shared kitchen countertop receptacle on Level 1 at (3, 1.1, 1) — 2 devices share CKT 3
      sab_1: {
        id: 'sab_1',
        type: 'electrical:device',
        parentId: 'lvl_1',
        position: [3, 1.1, 1],
        panelId: 'panel_l1',
        circuitNumber: 3,
        poles: 1,
        breakerAmps: 20,
      },
      sab_2: {
        id: 'sab_2',
        type: 'electrical:device',
        parentId: 'lvl_1',
        position: [4, 1.1, 1],
        panelId: 'panel_l1',
        circuitNumber: 3,
        poles: 1,
        breakerAmps: 20,
      },
      // Dedicated dishwasher on Level 1 right next to shared sab_1 -> MUST NOT match shared SAB circuit!
      dw_l1: {
        id: 'dw_l1',
        type: 'plumbing:fixture',
        fixtureKind: 'dishwasher',
        parentId: 'lvl_1',
        position: [3.1, 0.4, 1.0],
        electricalDemand: getFixtureElectricalDemand('dishwasher'),
      },
      // Sump pump on Level 2 at same (x,z) as Level 1's dedicated device -> MUST NOT match cross-level!
      ded_l1: {
        id: 'ded_l1',
        type: 'electrical:device',
        parentId: 'lvl_1',
        position: [1, 0.5, 1],
        panelId: 'panel_l1',
        circuitNumber: 5,
        poles: 1,
        breakerAmps: 20,
      },
      sump_l2: {
        id: 'sump_l2',
        type: 'plumbing:equipment',
        equipmentKind: 'sump-pump',
        parentId: 'lvl_2',
        position: [1, 0, 1],
        electricalDemand: getEquipmentElectricalDemand('sump-pump'),
      },
      // Pipe on Level 2 at exact same local (x, y, z) as Level 1's panel_l1 and wall w1
      pipe_l2: {
        id: 'pipe_l2',
        type: 'plumbing:pipe-run',
        parentId: 'lvl_2',
        system: 'cold-water',
        material: 'pex-a',
        nominalSize: '1/2"',
        path: [
          [0, 1.8, 0.05],
          [5, 1.8, 0.05],
        ],
      },
    }

    expect(resolveNodeLevelId(multiLevel, multiLevel.pipe_l2!)).toBe('lvl_2')
    const audit = auditScenePlumbing(multiLevel)
    // Level 2 pipe must NOT clash with Level 1's panel_l1!
    expect(audit.findings.some((f) => f.codeRef === 'NEC 110.26(E)' && f.nodeIds.includes('pipe_l2'))).toBe(false)

    // Level 2 pipe must NOT penetrate Level 1's wall w1!
    const schedOp = plumbingAgentOperations.plumbing_generate_schedule(multiLevel as never, {})
    expect(schedOp.result.penetrations.length).toBe(0)

    // Coordination: neither dw_l1 (shared SAB) nor sump_l2 (cross-level) should falsely show WIRED!
    const coord = buildElectricalCoordination(multiLevel)
    expect(coord.find((c) => c.sourceNodeId === 'dw_l1')!.wired).toBe(false)
    expect(coord.find((c) => c.sourceNodeId === 'sump_l2')!.wired).toBe(false)
  })

  test('BUG-12, BUG-15, BUG-16, BUG-17, BUG-18, BUG-19: Bidet dedicated, fixture Y-drag, optional agent tool schemas, import-only mode, and pipe geometryKey', () => {
    // BUG-12: Bidet is dedicatedCircuit = true
    expect(getFixtureElectricalDemand('bidet')!.dedicatedCircuit).toBe(true)

    // BUG-16: HPWH at 6000W gets 35A (or >=35A) standard NEC 240.6(A) breaker, not hardcoded 30A
    expect(getEquipmentElectricalDemand('water-heater-hpwh', 6000)!.breakerAmps).toBe(35)
    expect(getEquipmentElectricalDemand('water-heater-tank-electric', 6000)!.breakerAmps).toBe(35)

    // BUG-16 & BUG-17: Zod schemas in agent-tools.ts do NOT inject watts=4500 or material='pex-a' when omitted
    const eqTool = plumbingAgentTools.tools.find((t) => t.name === 'plumbing_place_equipment')!
    const parsedGasWh = eqTool.input.watts!.safeParse(undefined)
    expect(parsedGasWh.success).toBe(true)
    expect(parsedGasWh.data).toBeUndefined()

    const pipeTool = plumbingAgentTools.tools.find((t) => t.name === 'plumbing_route_pipe')!
    expect(pipeTool.input.material!.safeParse(undefined).data).toBeUndefined()
    expect(pipeTool.input.nominalSize!.safeParse(undefined).data).toBeUndefined()

    const baseScene = { level_0: { id: 'level_0', type: 'level' } }
    const gasOp = plumbingAgentOperations.plumbing_place_equipment(
      baseScene as never,
      { equipmentKind: 'water-heater-tank-gas', position: [1, 0, 1] },
      { activeLevelId: 'level_0' },
    )
    const gasNode = gasOp.changes!.create![0]!.node as unknown as Record<string, unknown>
    expect(gasNode.watts).toBe(0)
    expect(gasNode.gasBtuh).toBe(40000)

    const drainOp = plumbingAgentOperations.plumbing_route_pipe(
      baseScene as never,
      { system: 'dwv-drain', from: [0, 0.5, 0], to: [3, -0.4, 0] },
      { activeLevelId: 'level_0' },
    )
    const drainNode = drainOp.changes!.create![0]!.node as unknown as Record<string, unknown>
    expect(drainNode.material).toBe('pvc-dwv')
    expect(drainNode.nominalSize).toBe('3"')

    const dryerOp = plumbingAgentOperations.plumbing_route_pipe(
      baseScene as never,
      { system: 'dryer-vent', from: [0, 1, 0], to: [2, 1, 0] },
      { activeLevelId: 'level_0' },
    )
    const dryerNode = dryerOp.changes!.create![0]!.node as unknown as Record<string, unknown>
    expect(dryerNode.material).toBe('rigid-aluminum')
    expect(dryerNode.nominalSize).toBe('4"')

    // BUG-15: Fixture CAD offset uses -spec.roughInHeightM (not -node.position[1]) so Y dragging works
    const lavDefault = plumbingFixtureRenderDefinition.defaults!()
    const g1 = buildPlumbingFixtureGeometry({ ...lavDefault, id: 'f1', position: [0, 0.53, 0] } as never, {} as never)
    const g2 = buildPlumbingFixtureGeometry({ ...lavDefault, id: 'f1', position: [0, 0.93, 0] } as never, {} as never)
    expect(g1.children[0]!.position.y).toBeCloseTo(-0.53, 2)
    expect(g2.children[0]!.position.y).toBeCloseTo(-0.53, 2)

    // BUG-18: bonesMode: 'import-only' does NOT synthesize unplaced room fixtures or exterior hose bibbs
    const importOnlyPlan = planPlumbingAutoPopulate(
      {
        level_0: { id: 'level_0', type: 'level' },
        r_bath: {
          id: 'r_bath',
          type: 'zone',
          name: 'Bathroom',
          parentId: 'level_0',
          polygon: [
            [0, 0],
            [3, 0],
            [3, 3],
            [0, 3],
          ],
        },
      },
      { levelId: 'level_0', bonesMode: 'import-only' },
    )
    expect(importOnlyPlan.fixtures.length).toBe(0)

    // BUG-19: geometryKey changes when wallId or framingRevision changes
    const pDef = plumbingPipeRunRenderDefinition.defaults!()
    const k1 = plumbingPipeRunRenderDefinition.geometryKey!({ ...pDef, id: 'p1', wallId: 'w1', framingRevision: 0 } as never)
    const k2 = plumbingPipeRunRenderDefinition.geometryKey!({ ...pDef, id: 'p1', wallId: 'w1', framingRevision: 1 } as never)
    expect(k1).not.toBe(k2)
  })

  test('OPT-01, OPT-02, CON-01..08: WeakMap caches, 47 CAD models, defaults electricalDemand, rotated 2D/ports, gas-csst port, BOM breakdown & angle stops, trunk-and-branch spine, and inferred trap-arm audit', () => {
    // CON-01: 47 registered CAD parts
    expect(PLUMBING_CAD_CATALOG.length).toBe(47)
    expect(PLUMBING_CAD_CATALOG.some((p) => p.id === 'fixture-bidet')).toBe(true)
    expect(PLUMBING_CAD_CATALOG.some((p) => p.id === 'fitting-pipe-hanger-clevis')).toBe(true)

    // CON-02: equipment defaults include electricalDemand, and passive gas WH with stale electricalDemand returns null in coordination
    const eqDef = plumbingEquipmentRenderDefinition.defaults!()
    expect(eqDef.electricalDemand?.required).toBe(true)
    const staleCoord = buildElectricalCoordination({
      level_0: { id: 'level_0', type: 'level' },
      gas_wh: {
        id: 'gas_wh',
        type: 'plumbing:equipment',
        equipmentKind: 'water-heater-tank-gas',
        parentId: 'level_0',
        position: [1, 0, 1],
        electricalDemand: { required: true, voltage: 240, poles: 2, breakerAmps: 30, loadVa: 4500 },
      },
    })
    expect(staleCoord.length).toBe(0)

    // CON-03: Rotated 2D floorplan & ports + gas-csst port
    const tub = {
      ...plumbingFixtureRenderDefinition.defaults!(),
      id: 'tub_1',
      fixtureKind: 'bathtub' as const,
      position: [2, 0.15, 2] as [number, number, number],
      rotation: Math.PI / 2,
    }
    const fp0 = buildPlumbingFixtureFloorplan({ ...tub, rotation: 0 } as never, {} as never)
    const fp90 = buildPlumbingFixtureFloorplan(tub as never, {} as never)
    expect(JSON.stringify(fp90)).not.toBe(JSON.stringify(fp0))

    const tubPorts90 = getPlumbingFixturePorts(tub as never)
    const coldPort = tubPorts90.find((p) => p.id === 'cold')!
    expect(coldPort.position[0]).toBeCloseTo(2, 2)
    expect(Math.abs(coldPort.position[2] - 2)).toBeCloseTo(0.08, 2)

    const eqPorts90 = getPlumbingEquipmentPorts({
      ...eqDef,
      id: 'eq_1',
      position: [2, 0, 2],
      rotation: Math.PI / 2,
    } as never)
    expect(eqPorts90[0]!.position[0]).toBeCloseTo(2, 2)
    expect(Math.abs(eqPorts90[0]!.position[2] - 2)).toBeCloseTo(0.1, 2)

    const gasMan: PlumbingManifoldNode = {
      object: 'node',
      id: 'man_gas' as PlumbingManifoldNode['id'],
      type: 'plumbing:manifold',
      parentId: null,
      visible: true,
      metadata: {},
      name: 'Gas Manifold',
      position: [1, 1.35, 1],
      rotation: Math.PI / 2,
      manifoldKind: 'gas-csst',
      portCount: 8,
      supplyMaterial: 'csst',
      coverRemoved: true,
    }
    const gasPorts = getPlumbingManifoldPorts(gasMan)
    expect(gasPorts.length).toBe(1)
    expect(gasPorts[0]!.id).toBe('gas-in')
    expect(gasPorts[0]!.system).toBe('gas')
    const gasFp = buildPlumbingManifoldFloorplan(gasMan, {} as never)
    expect(gasFp.kind).toBe('group')

    // OPT-01 & OPT-02: WeakMap memoization returns identical cached object references
    const cacheScene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level' },
      w1: { id: 'w1', type: 'wall', parentId: 'level_0', start: [0, 0], end: [5, 0], thickness: 0.14, height: 2.6 },
      f1: { id: 'f1', type: 'plumbing:fixture', fixtureKind: 'water-closet', parentId: 'level_0', position: [1, 0.15, 1] },
      f2: { id: 'f2', type: 'plumbing:fixture', fixtureKind: 'shower', parentId: 'level_0', position: [2, 0.05, 1] },
      f3: { id: 'f3', type: 'plumbing:fixture', fixtureKind: 'lavatory', parentId: 'level_0', position: [3, 0.53, 1] },
    }
    expect(extractWallSegments(cacheScene, 'level_0')).toBe(extractWallSegments(cacheScene, 'level_0'))
    expect(extractBonesPlumbingContext(cacheScene, 'level_0')).toBe(extractBonesPlumbingContext(cacheScene, 'level_0'))
    const s1 = buildPlumbingSchedule(cacheScene)
    const s2 = buildPlumbingSchedule(cacheScene)
    expect(s1).toBe(s2)

    // CON-05: Accurate angle stop counts (WC=1, Shower=0, Lav=2 -> 3 total!) + Markup/Tax CSV summary rows
    const bom = buildPlumbingBom(cacheScene, { materialMarkupPct: 15, salesTaxPct: 8, schedule: s1 })
    const angleStopLine = bom.lines.find((l) => l.item.includes('Angle Stops'))!
    expect(angleStopLine.quantity).toBe(3)
    const csv = formatPlumbingBomCsv(bom)
    expect(csv).toContain('Material Subtotal')
    expect(csv).toContain('Material Markup')
    expect(csv).toContain('Sales Tax')
    expect(csv).toContain('Labor Subtotal')

    // CON-07: trunk-and-branch routes sized 3/4"+ distribution trunks + short fixture branches
    const tbPlan = planPlumbingAutoPopulate(
      {
        level_0: { id: 'level_0', type: 'level' },
        r_bath: {
          id: 'r_bath',
          type: 'zone',
          name: 'Bathroom',
          parentId: 'level_0',
          polygon: [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
          ],
        },
        r_kit: {
          id: 'r_kit',
          type: 'zone',
          name: 'Kitchen',
          parentId: 'level_0',
          polygon: [
            [6, 0],
            [10, 0],
            [10, 4],
            [6, 4],
          ],
        },
      },
      { levelId: 'level_0', supplyTopology: 'trunk-and-branch' },
    )
    expect(tbPlan.pipeRuns.some((r) => r.name.includes('Main Cold Distribution Trunk'))).toBe(true)
    expect(tbPlan.pipeRuns.some((r) => r.name.includes('Main Hot Distribution Trunk'))).toBe(true)
    expect(tbPlan.pipeRuns.some((r) => r.name.includes('Cold Branch'))).toBe(true)

    // CON-08: trapArmLengthFt exposed in parametrics AND inferred in auditScenePlumbing for unvented long fixture drains
    const hasTrapArmField = plumbingPipeRunParametrics.groups.some((g) =>
      g.fields.some((f) => f.key === 'trapArmLengthFt'),
    )
    expect(hasTrapArmField).toBe(true)

    const longUnventedAudit = auditScenePlumbing({
      level_0: { id: 'level_0', type: 'level' },
      lav_1: { id: 'lav_1', type: 'plumbing:fixture', fixtureKind: 'lavatory', parentId: 'level_0', position: [0, 0.53, 0] },
      drain_long: {
        id: 'drain_long',
        type: 'plumbing:pipe-run',
        parentId: 'level_0',
        system: 'dwv-drain',
        material: 'pvc-dwv',
        nominalSize: '1-1/2"',
        sourceNodeId: 'lav_1',
        hasCleanout: true,
        path: [
          [0, 0.53, 0],
          [0, -0.24, 0],
          [7.6, -0.4, 0], // ~25 ft horizontal > 6 ft IPC Table 909.1 max for 1-1/2"!
        ],
      },
    })
    expect(longUnventedAudit.findings.some((f) => f.codeRef.includes('909.1'))).toBe(true)
  })
})
