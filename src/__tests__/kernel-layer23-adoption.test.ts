import { describe, expect, test } from 'bun:test'
import {
  compileBuildingAnatomy,
  compileLegalCavityGraph,
  evaluatePlacementCandidate,
  validateRuleTable,
} from '@kruschdev/pascal-mep-kernel'
import { auditScenePlumbing } from '../ipc/audit'
import { planPlumbingAutoPopulate } from '../ipc/autopopulate'
import type { SceneNodeLike } from '../ipc/framing-interop'
import {
  countPathElbows,
  detectPlumbingClashes,
  extractPlumbingObstacles,
  measureDrainPathSlope,
  routeDwvDrainRun,
  routePlumbingViaLegalCavity,
  routePressurizedPipeRun,
  routeVentRun,
} from '../ipc/routing'
import {
  IPC_DECLARATIVE_RULES,
  IPC_RULE_THRESHOLDS,
  type IpcRuleId,
  evaluateIpcRuleCandidate,
  getIpcRuleById,
} from '../ipc/rules'
import { checkDryerVentRun } from '../ipc/sizing'

function buildObstacleHouseScene(): Record<string, SceneNodeLike> {
  return {
    level_0: { id: 'level_0', type: 'level', height: 2.7 },
    w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], thickness: 0.165, height: 2.7 },
    w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 8], end: [10, 8], thickness: 0.165, height: 2.7 },
    w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 8], thickness: 0.165, height: 2.7 },
    w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], thickness: 0.165, height: 2.7 },
    w_wet: { id: 'w_wet', type: 'wall', parentId: 'level_0', start: [4, 0], end: [4, 6], thickness: 0.165, height: 2.7 },
    z_bath: {
      id: 'z_bath',
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
    z_kit: {
      id: 'z_kit',
      type: 'zone',
      name: 'Kitchen',
      parentId: 'level_0',
      polygon: [
        [4, 0],
        [10, 0],
        [10, 4],
        [4, 4],
      ],
    },
    z_laun: {
      id: 'z_laun',
      type: 'zone',
      name: 'Laundry',
      parentId: 'level_0',
      polygon: [
        [0, 4],
        [4, 4],
        [4, 8],
        [0, 8],
      ],
    },
    z_liv: {
      id: 'z_liv',
      type: 'zone',
      name: 'Living Room',
      parentId: 'level_0',
      polygon: [
        [4, 4],
        [10, 4],
        [10, 8],
        [4, 8],
      ],
    },
    col_mid: {
      id: 'col_mid',
      type: 'structural:column',
      name: 'Center Support Column',
      parentId: 'level_0',
      position: [5.0, 0, 2.0],
      width: 0.3,
      depth: 0.3,
      height: 2.7,
    },
    panel_mid: {
      id: 'panel_mid',
      type: 'electrical:panel',
      name: 'MDP-1',
      parentId: 'level_0',
      position: [6.0, 1.52, 5.0],
      width: 0.42,
      height: 0.92,
      depth: 0.16,
    },
  }
}

describe('Kernel Layer 2 (Legal-Space Cavity Router) & Layer 3 (Single-Source Declarative IPC Rules)', () => {
  test('validateRuleTable(IPC_DECLARATIVE_RULES) passes with all required canonical IPC/IRC/IFGC rules', () => {
    const validation = validateRuleTable(IPC_DECLARATIVE_RULES)
    expect(validation.valid).toBe(true)
    expect(validation.errors).toEqual([])

    const requiredIds: readonly IpcRuleId[] = [
      'ipc-704-1-drain-slope-small',
      'ipc-704-1-drain-slope-large',
      'ipc-905-5-dry-vent-height',
      'ipc-903-1-main-vent-stack',
      'ipc-708-1-cleanout-interval',
      'irc-r602-6-wet-wall-fit',
      'irc-m1502-4-dryer-vent',
      'irc-m1502-4-1-dryer-vent-material',
      'ifgc-402-4-fuel-gas-max-len',
    ]
    for (const id of requiredIds) {
      const rule = getIpcRuleById(id)
      expect(rule.id).toBe(id)
      expect(rule.trade).toBe('plumbing')
      expect(rule.codeRef.length).toBeGreaterThan(0)
    }

    expect(IPC_RULE_THRESHOLDS.drainSlopeSmallInPerFt).toBe(0.25)
    expect(IPC_RULE_THRESHOLDS.drainSlopeLargeInPerFt).toBe(0.125)
    expect(IPC_RULE_THRESHOLDS.ventMinAboveFloodRimM).toBe(0.1524)
    expect(IPC_RULE_THRESHOLDS.ventPlacementMarginM).toBe(0.04)
    expect(IPC_RULE_THRESHOLDS.mainVentStackMinNominalIn).toBe(3)
    expect(IPC_RULE_THRESHOLDS.cleanoutMaxIntervalFt).toBe(100)
    expect(IPC_RULE_THRESHOLDS.wetWallMinPipeNominalIn).toBe(3)
    expect(IPC_RULE_THRESHOLDS.wetWallMinThicknessM).toBe(0.14)
    expect(IPC_RULE_THRESHOLDS.wetWallMax2x4ThicknessM).toBe(0.125)
    expect(IPC_RULE_THRESHOLDS.dryerVentMaxEffectiveLengthFt).toBe(35)
    expect(IPC_RULE_THRESHOLDS.dryerVentRequiredMaterials).toEqual(['rigid-aluminum'])
    expect(IPC_RULE_THRESHOLDS.fuelGasMaxEffectiveLengthFt).toBe(200)
    expect(IPC_RULE_THRESHOLDS.fuelGasMinSizingLengthAuditFt).toBe(10)
    expect(IPC_RULE_THRESHOLDS.fuelGasMinSizingLengthPlacementFt).toBe(15)
    expect(IPC_RULE_THRESHOLDS.fuelGasMinSizingLengthPlacementFt).toBeGreaterThanOrEqual(
      IPC_RULE_THRESHOLDS.fuelGasMinSizingLengthAuditFt,
    )
  })

  test('INV-MEP-08 placement-vs-audit parity: every legal placement candidate is guaranteed legal in audit mode', () => {
    // 1. IPC 905.5 dry vent height: audit = floodRim + 0.1524 m, placement = floodRim + 0.1924 m
    const floodRim = 0.85
    const ventTooLow = { kind: 'dwv-vent', pos: [1, floodRim + 0.10, 1] as const, floodRimM: floodRim }
    const ventBorderline = { kind: 'dwv-vent', pos: [1, floodRim + 0.17, 1] as const, floodRimM: floodRim }
    const ventConservative = { kind: 'dwv-vent', pos: [1, floodRim + 0.21, 1] as const, floodRimM: floodRim }

    expect(evaluateIpcRuleCandidate(ventTooLow, 'placement', ['ipc-905-5-dry-vent-height']).legal).toBe(false)
    expect(evaluateIpcRuleCandidate(ventTooLow, 'audit', ['ipc-905-5-dry-vent-height']).legal).toBe(false)
    expect(evaluateIpcRuleCandidate(ventBorderline, 'placement', ['ipc-905-5-dry-vent-height']).legal).toBe(false)
    expect(evaluateIpcRuleCandidate(ventBorderline, 'audit', ['ipc-905-5-dry-vent-height']).legal).toBe(true)
    expect(evaluateIpcRuleCandidate(ventConservative, 'placement', ['ipc-905-5-dry-vent-height']).legal).toBe(true)
    expect(evaluateIpcRuleCandidate(ventConservative, 'audit', ['ipc-905-5-dry-vent-height']).legal).toBe(true)

    // 2. IRC R602.6 wet wall fit: 2x4 (0.114 m) rejected in both; 0.142 m rejected in placement / ok in audit; 2x6 (0.165 m) ok in both
    const wcIn2x4 = { kind: 'plumbing:pipe-run', system: 'dwv-drain', pos: [0, 0.5, 0] as const, nominalSizeIn: 3, wallThicknessM: 0.114 }
    const wcInTight = { kind: 'plumbing:pipe-run', system: 'dwv-drain', pos: [0, 0.5, 0] as const, nominalSizeIn: 3, wallThicknessM: 0.142 }
    const wcIn2x6 = { kind: 'plumbing:pipe-run', system: 'dwv-drain', pos: [0, 0.5, 0] as const, nominalSizeIn: 3, wallThicknessM: 0.165 }

    expect(evaluateIpcRuleCandidate(wcIn2x4, 'placement', ['irc-r602-6-wet-wall-fit']).legal).toBe(false)
    expect(evaluateIpcRuleCandidate(wcIn2x4, 'audit', ['irc-r602-6-wet-wall-fit']).legal).toBe(false)
    expect(evaluateIpcRuleCandidate(wcInTight, 'placement', ['irc-r602-6-wet-wall-fit']).legal).toBe(false)
    expect(evaluateIpcRuleCandidate(wcInTight, 'audit', ['irc-r602-6-wet-wall-fit']).legal).toBe(true)
    expect(evaluateIpcRuleCandidate(wcIn2x6, 'placement', ['irc-r602-6-wet-wall-fit']).legal).toBe(true)
    expect(evaluateIpcRuleCandidate(wcIn2x6, 'audit', ['irc-r602-6-wet-wall-fit']).legal).toBe(true)

    // 3. IPC 704.1 drain slopes, IPC 903.1 main stack, IPC 708.1 cleanout, IRC M1502.4 dryer vent, IFGC 402.4 gas length
    const sampleCandidates = [
      { kind: 'plumbing:pipe-run', system: 'dwv-drain-small', pos: [0, 0, 0] as const, slopeInPerFt: 0.25 },
      { kind: 'plumbing:pipe-run', system: 'dwv-drain-large', pos: [0, 0, 0] as const, slopeInPerFt: 0.125 },
      { kind: 'plumbing:pipe-run', system: 'dwv-main-vent-stack', pos: [0, 0, 0] as const, nominalSizeIn: 3 },
      { kind: 'plumbing:pipe-run', system: 'dwv-drain', pos: [0, 0, 0] as const, runLengthFt: 80, hasCleanout: false },
      { kind: 'plumbing:pipe-run', system: 'dryer-vent', pos: [0, 0.35, 0] as const, effectiveLengthFt: 30, material: 'rigid-aluminum' },
      { kind: 'plumbing:pipe-run', system: 'fuel-gas', pos: [0, 0, 0] as const, effectiveLengthFt: 150 },
    ]
    for (const cand of sampleCandidates) {
      const pRes = evaluatePlacementCandidate(IPC_DECLARATIVE_RULES, cand, 'placement')
      const aRes = evaluatePlacementCandidate(IPC_DECLARATIVE_RULES, cand, 'audit')
      expect(pRes.legal).toBe(true)
      expect(aRes.legal).toBe(true)
    }

    // Violations detected identically across placement & audit
    expect(
      evaluateIpcRuleCandidate(
        { kind: 'plumbing:pipe-run', system: 'dryer-vent', pos: [0, 0.35, 0], effectiveLengthFt: 42, material: 'pvc-dwv' },
        'audit',
      ).violations.map((v) => v.ruleId),
    ).toEqual(['irc-m1502-4-dryer-vent', 'irc-m1502-4-1-dryer-vent-material'])

    expect(
      evaluateIpcRuleCandidate(
        { kind: 'plumbing:pipe-run', system: 'fuel-gas', pos: [0, 0, 0], effectiveLengthFt: 225 },
        'audit',
      ).legal,
    ).toBe(false)
  })

  test('routePlumbingViaLegalCavity supports gravity-slope (IPC 704.1) and non-descending-vent (IPC 905.5 / 905.2)', () => {
    const nodes = buildObstacleHouseScene()
    const anatomy = compileBuildingAnatomy(nodes)
    const graph = compileLegalCavityGraph(anatomy, 'level_0', { subFloorElevationM: -0.35 })
    const occupancy = anatomy.createOccupancyGrid('level_0', { forTrade: 'plumbing' })

    // 1. Gravity-slope DWV drain crossing past structural column at (5.0, 2.0)
    const drainRes = routePlumbingViaLegalCavity({
      nodes,
      levelId: 'level_0',
      anatomy,
      graph,
      occupancy,
      from: [2.0, 0.45, 2.0],
      to: [8.0, -0.55, 2.0],
      mode: 'gravity-slope',
      nominalSize: '2"',
      material: 'pvc-dwv',
      foundationType: 'slab',
    })
    expect(drainRes.path.length).toBeGreaterThanOrEqual(2)
    expect(drainRes.clashObstacleIds.length).toBe(0)
    expect(drainRes.outdoorVoidViolation).toBe(false)
    const drainSlope = measureDrainPathSlope(drainRes.path)
    expect(drainSlope.hasUphillSegment).toBe(false)
    expect(drainSlope.minSegmentSlopeInPerFt).toBeGreaterThanOrEqual(0.24)

    // 2. Non-descending dry re-vent obeying IPC 905.5 (floodRim + 0.1524 m) & IPC 905.2 (zero inverted-U)
    const floodRim = 0.91
    const ventRes = routePlumbingViaLegalCavity({
      nodes,
      levelId: 'level_0',
      anatomy,
      graph,
      occupancy,
      from: [2.0, 0.5, 5.0],
      to: [8.5, 2.55, 5.0],
      mode: 'non-descending-vent',
      floodRimHeightM: floodRim,
      nominalSize: '1-1/2"',
      material: 'pvc-dwv',
    })
    expect(ventRes.path.length).toBeGreaterThanOrEqual(2)
    expect(ventRes.clashObstacleIds.length).toBe(0)
    expect(ventRes.roofViolation).toBe(false)
    expect(ventRes.outdoorVoidViolation).toBe(false)
    for (let i = 1; i < ventRes.path.length; i++) {
      const a = ventRes.path[i - 1]!
      const b = ventRes.path[i]!
      // IPC 905.2: strictly non-descending (no inverted-U condensate traps)
      expect(b[1]).toBeGreaterThanOrEqual(a[1] - 0.002)
      const horiz = Math.hypot(b[0] - a[0], b[2] - a[2])
      if (horiz > 0.25) {
        // IPC 905.5: horizontal dry vent >= floodRim + 6" (0.1524 m)
        expect(Math.min(a[1], b[1])).toBeGreaterThanOrEqual(floodRim + 0.1524 - 1e-3)
      }
    }

    // 3. Orthogonal & euclidean-cavity pressurized pipe routing clear of NEC 110.26(E) panel at (6.0, 5.0)
    const orthoRes = routePlumbingViaLegalCavity({
      nodes,
      levelId: 'level_0',
      anatomy,
      graph,
      occupancy,
      from: [3.0, 2.3, 5.0],
      to: [9.0, 2.3, 5.0],
      mode: 'orthogonal',
      nominalSize: '3/4"',
      material: 'pex-a',
      foundationType: 'slab',
    })
    expect(orthoRes.clashObstacleIds.length).toBe(0)
    expect(orthoRes.roofViolation).toBe(false)
    expect(orthoRes.outdoorVoidViolation).toBe(false)

    // 4. Router wrappers integrate cavityContext cleanly on obstructed runs
    const obstacles = extractPlumbingObstacles(nodes, 'level_0')
    const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 8 }
    const cavityContext = { nodes, levelId: 'level_0', anatomy, graph, occupancy }

    const wrappedDrain = routeDwvDrainRun({
      from: [2.0, 0.45, 2.0],
      to: [8.0, -0.55, 2.0],
      nominalSize: '2"',
      foundationType: 'slab',
      obstacles,
      buildingBounds: bounds,
      cavityContext,
    })
    expect(wrappedDrain.clashes.length).toBe(0)
    expect(measureDrainPathSlope(wrappedDrain.path).hasUphillSegment).toBe(false)

    const wrappedVent = routeVentRun({
      from: [2.0, 0.5, 5.0],
      stackPoint: [8.5, 5.0],
      floodRimHeightM: 0.91,
      ceilingHeightM: 2.7,
      nominalSize: '1-1/2"',
      obstacles,
      buildingBounds: bounds,
      cavityContext,
    })
    expect(wrappedVent.clashes.length).toBe(0)

    const wrappedSupply = routePressurizedPipeRun({
      from: [3.0, 2.3, 5.0],
      to: [9.0, 2.3, 5.0],
      routingPlaneY: 2.4,
      nominalSize: '3/4"',
      material: 'pex-a',
      euclideanInCavity: false,
      obstacles,
      buildingBounds: bounds,
      cavityContext,
    })
    expect(wrappedSupply.clashes.length).toBe(0)
  })

  test('IRC R602.6 prevention by construction: 2x4 walls (<= 0.125 m) never falsely host 3" WC branches or 3" main stack', () => {
    const thinWallScene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.6 },
      // ALL walls are 2x4 stud walls (0.114 m <= 0.125 m)
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], thickness: 0.114, height: 2.6 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 8], end: [10, 8], thickness: 0.114, height: 2.6 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 8], thickness: 0.114, height: 2.6 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], thickness: 0.114, height: 2.6 },
      w_wet: { id: 'w_wet', type: 'wall', parentId: 'level_0', start: [4, 0], end: [4, 4], thickness: 0.114, height: 2.6 },
      z_bath: {
        id: 'z_bath',
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
      z_kit: {
        id: 'z_kit',
        type: 'zone',
        name: 'Kitchen',
        parentId: 'level_0',
        polygon: [
          [4, 0],
          [10, 0],
          [10, 4],
          [4, 4],
        ],
      },
      z_laun: {
        id: 'z_laun',
        type: 'zone',
        name: 'Laundry',
        parentId: 'level_0',
        polygon: [
          [0, 4],
          [4, 4],
          [4, 8],
          [0, 8],
        ],
      },
    }

    const plan = planPlumbingAutoPopulate(thinWallScene, {
      levelId: 'level_0',
      foundationType: 'slab',
      includeDryerVent: true,
    })

    const wcFixture = plan.fixtures.find((f) => f.fixtureKind === 'water-closet')
    expect(wcFixture).toBeDefined()
    const wcDrain = plan.pipeRuns.find((r) => r.system === 'dwv-drain' && r.sourceNodeId === wcFixture!.id)
    expect(wcDrain).toBeDefined()
    expect(wcDrain!.nominalSize).toBe('3"')
    // Prevented by construction: 3" WC drain must NOT be falsely tagged inside a 2x4 wall
    expect(wcDrain!.wallId).toBeUndefined()

    const mainStack = plan.pipeRuns.find((r) => r.isMainVentStack)
    expect(mainStack).toBeDefined()
    expect(mainStack!.wallId).toBeUndefined()

    const fullScene: Record<string, SceneNodeLike> = { ...thinWallScene }
    for (const eq of plan.equipment) fullScene[eq.id] = { ...eq, type: 'plumbing:equipment', parentId: 'level_0' }
    for (const m of plan.manifolds) fullScene[m.id] = { ...m, type: 'plumbing:manifold', parentId: 'level_0' }
    for (const f of plan.fixtures) fullScene[f.id] = { ...f, type: 'plumbing:fixture', parentId: 'level_0' }
    for (const r of plan.pipeRuns) fullScene[r.id] = { ...r, type: 'plumbing:pipe-run', parentId: 'level_0' }

    const audit = auditScenePlumbing(fullScene)
    const wetWallErrors = audit.findings.filter((f) => /R602\.6|Wet Wall/i.test(f.codeRef))
    expect(wetWallErrors).toEqual([])
    expect(audit.errorCount).toBe(0)
  })

  test('Main DWV soil/vent stack avoids existing electrical:panel NEC 110.26(E) dedicated space & dryer vent obeys IRC M1502.4', () => {
    // Place an electrical panel right at the wet-wall midpoint (4.0, 2.0) where the main DWV stack wants to land
    const sceneWithPanelAtWetCore: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.6 },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], thickness: 0.165, height: 2.6 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 8], end: [10, 8], thickness: 0.165, height: 2.6 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 8], thickness: 0.165, height: 2.6 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], thickness: 0.165, height: 2.6 },
      w_wet: { id: 'w_wet', type: 'wall', parentId: 'level_0', start: [4, 0], end: [4, 4], thickness: 0.165, height: 2.6 },
      z_bath: {
        id: 'z_bath',
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
      z_kit: {
        id: 'z_kit',
        type: 'zone',
        name: 'Kitchen',
        parentId: 'level_0',
        polygon: [
          [4, 0],
          [10, 0],
          [10, 4],
          [4, 4],
        ],
      },
      z_laun: {
        id: 'z_laun',
        type: 'zone',
        name: 'Laundry',
        parentId: 'level_0',
        polygon: [
          [0, 4],
          [4, 4],
          [4, 8],
          [0, 8],
        ],
      },
      panel_wet: {
        id: 'panel_wet',
        type: 'electrical:panel',
        name: 'Main Panel on Wet Wall',
        parentId: 'level_0',
        position: [4.0, 1.52, 2.0],
        width: 0.5,
        height: 0.92,
        depth: 0.2,
      },
    }

    const plan = planPlumbingAutoPopulate(sceneWithPanelAtWetCore, {
      levelId: 'level_0',
      includeDryerVent: true,
    })

    const mainStack = plan.pipeRuns.find((r) => r.isMainVentStack)!
    expect(mainStack).toBeDefined()
    const obstacles = extractPlumbingObstacles(sceneWithPanelAtWetCore, 'level_0')
    const panelObstacles = obstacles.filter((o) => o.category === 'electrical-dedicated-space')
    expect(panelObstacles.length).toBe(1)
    expect(detectPlumbingClashes(mainStack.path, panelObstacles, 0.044)).toEqual([])

    const dryerVent = plan.pipeRuns.find((r) => r.system === 'dryer-vent')
    expect(dryerVent).toBeDefined()
    expect(dryerVent!.material).toBe('rigid-aluminum')
    const { elbows90, elbows45 } = countPathElbows(dryerVent!.path)
    const lengthFt =
      dryerVent!.path.reduce((sum, pt, idx, arr) => {
        if (idx === 0) return 0
        const prev = arr[idx - 1]!
        return sum + Math.hypot(pt[0] - prev[0], pt[1] - prev[1], pt[2] - prev[2])
      }, 0) / 0.3048
    const dryerCheck = checkDryerVentRun({ lengthFt, elbows90, elbows45 })
    expect(dryerCheck.ok).toBe(true)
    expect(dryerCheck.effectiveLengthFt).toBeLessThanOrEqual(35)

    const fullScene: Record<string, SceneNodeLike> = { ...sceneWithPanelAtWetCore }
    for (const eq of plan.equipment) fullScene[eq.id] = { ...eq, type: 'plumbing:equipment', parentId: 'level_0' }
    for (const m of plan.manifolds) fullScene[m.id] = { ...m, type: 'plumbing:manifold', parentId: 'level_0' }
    for (const f of plan.fixtures) fullScene[f.id] = { ...f, type: 'plumbing:fixture', parentId: 'level_0' }
    for (const r of plan.pipeRuns) fullScene[r.id] = { ...r, type: 'plumbing:pipe-run', parentId: 'level_0' }

    const audit = auditScenePlumbing(fullScene)
    const necErrors = audit.findings.filter((f) => f.codeRef === 'NEC 110.26(E)')
    expect(necErrors).toEqual([])
    expect(audit.errorCount).toBe(0)
  })
})
