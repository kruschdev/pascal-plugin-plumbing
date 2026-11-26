import { describe, expect, test } from 'bun:test'
import { auditScenePlumbing } from '../ipc/audit'
import { planPlumbingAutoPopulate } from '../ipc/autopopulate'
import type { SceneNodeLike } from '../ipc/framing-interop'
import { measureDrainPathSlope } from '../ipc/routing'

function buildTwoBedHouseScene(): Record<string, SceneNodeLike> {
  return {
    level_0: { id: 'level_0', type: 'level' },
    w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], thickness: 0.165, height: 2.6 },
    w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 8], end: [10, 8], thickness: 0.165, height: 2.6 },
    w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 8], thickness: 0.165, height: 2.6 },
    w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], thickness: 0.165, height: 2.6 },
    w_wet: { id: 'w_wet', type: 'wall', parentId: 'level_0', start: [4, 0], end: [4, 4], thickness: 0.165, height: 2.6 },
    z_bath: {
      id: 'z_bath',
      type: 'zone',
      name: 'Master Bathroom',
      parentId: 'level_0',
      polygon: [[0, 0], [4, 0], [4, 4], [0, 4]],
    },
    z_kit: {
      id: 'z_kit',
      type: 'zone',
      name: 'Kitchen',
      parentId: 'level_0',
      polygon: [[4, 0], [10, 0], [10, 4], [4, 4]],
    },
    z_laun: {
      id: 'z_laun',
      type: 'zone',
      name: 'Laundry & Utility',
      parentId: 'level_0',
      polygon: [[0, 4], [4, 4], [4, 8], [0, 8]],
    },
    furn_1: {
      id: 'furn_1',
      type: 'hvac:equipment',
      name: 'Gas Furnace',
      parentId: 'level_0',
      position: [1.5, 0, 6.2],
      gasBtuh: 80000,
    },
  }
}

describe('One-Click IPC/UPC Auto-Populate Plumbing', () => {
  test('auto-populates complete residential house with 0 IPC errors', () => {
    const base = buildTwoBedHouseScene()
    const plan = planPlumbingAutoPopulate(base, {
      levelId: 'level_0',
      supplyTopology: 'manifold',
      waterHeaterKind: 'water-heater-tank-electric',
      includeFuelGas: true,
      includeDryerVent: true,
      includeHotRecirc: true,
    })

    expect(plan.fixtures.length).toBeGreaterThanOrEqual(10)
    expect(plan.manifolds.length).toBe(1)
    expect(plan.equipment.some((e) => e.equipmentKind === 'water-heater-tank-electric')).toBe(true)
    expect(plan.equipment.some((e) => e.equipmentKind === 'expansion-tank')).toBe(true)
    expect(plan.equipment.some((e) => e.equipmentKind === 'gas-meter')).toBe(true)
    expect(plan.pipeRuns.some((r) => r.system === 'dwv-drain' && r.hasCleanout)).toBe(true)
    expect(plan.pipeRuns.some((r) => r.system === 'dwv-vent' && r.isMainVentStack)).toBe(true)
    expect(plan.pipeRuns.some((r) => r.system === 'fuel-gas')).toBe(true)
    expect(plan.pipeRuns.some((r) => r.system === 'dryer-vent')).toBe(true)
    expect(plan.pipeRuns.some((r) => r.system === 'hot-recirc')).toBe(true)

    const fullScene: Record<string, SceneNodeLike> = { ...base }
    for (const eq of plan.equipment) fullScene[eq.id] = { ...eq, type: 'plumbing:equipment', parentId: 'level_0' }
    for (const m of plan.manifolds) fullScene[m.id] = { ...m, type: 'plumbing:manifold', parentId: 'level_0' }
    for (const f of plan.fixtures) fullScene[f.id] = { ...f, type: 'plumbing:fixture', parentId: 'level_0' }
    for (const r of plan.pipeRuns) fullScene[r.id] = { ...r, type: 'plumbing:pipe-run', parentId: 'level_0' }

    const audit = auditScenePlumbing(fullScene, { codeEdition: 'IPC-2021' })
    expect(audit.errorCount).toBe(0)
  })

  test('Tucks water heater & PEX manifold into wet-core corner (never Living Room centroid) and respects floor HVAC equipment', () => {
    const twoBr: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.5 },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], height: 2.5, thickness: 0.16 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], height: 2.5, thickness: 0.16 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [10, 8], end: [0, 8], height: 2.5, thickness: 0.16 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 8], end: [0, 0], height: 2.5, thickness: 0.16 },
      r_liv: { id: 'r_liv', type: 'zone', name: 'Living Room', parentId: 'level_0', polygon: [[0, 4], [6, 4], [6, 8], [0, 8]] },
      r_kit: { id: 'r_kit', type: 'zone', name: 'Kitchen', parentId: 'level_0', polygon: [[6, 4], [10, 4], [10, 8], [6, 8]] },
      r_bath: { id: 'r_bath', type: 'zone', name: 'Bath', parentId: 'level_0', polygon: [[4, 0], [7, 0], [7, 4], [4, 4]] },
    }
    const plan = planPlumbingAutoPopulate(twoBr, { levelId: 'level_0', waterHeaterKind: 'water-heater-tank-electric' })
    const wh = plan.equipment.find((e) => e.equipmentKind === 'water-heater-tank-electric')!
    const man = plan.manifolds[0]!
    // Water heater tucks into Kitchen wet-core corner (x >= 6), never in Living Room center!
    expect(wh.roomName).toBe('Kitchen')
    expect(wh.position[0]).toBeGreaterThanOrEqual(6)
    expect(man.position[0]).toBeGreaterThanOrEqual(6)
    expect(man.position[0]).toBeLessThanOrEqual(9.9)
    expect(man.position[2]).toBeGreaterThanOrEqual(4.1)
    expect(man.position[2]).toBeLessThanOrEqual(7.9)
  })

  test('routes every DWV drain branch and Main Building Drain at exact uniform 1/4"/ft below grade past the foundation', () => {
    const base = buildTwoBedHouseScene()
    const plan = planPlumbingAutoPopulate(base, {
      levelId: 'level_0',
      foundationType: 'slab',
      dwvMaterial: 'abs-dwv',
    })
    const drains = plan.pipeRuns.filter((r) => r.system === 'dwv-drain')
    expect(drains.length).toBeGreaterThanOrEqual(10)

    for (const drain of drains) {
      const slope = measureDrainPathSlope(drain.path)
      expect(slope.hasUphillSegment).toBe(false)
      expect(slope.minSegmentSlopeInPerFt).toBe(0.25)
      expect(slope.overallSlopeInPerFt).toBe(0.25)
      // Every drain terminates strictly below finished floor (y = 0)
      expect(drain.path[drain.path.length - 1]![1]).toBeLessThan(-0.35)
    }

    const mainDrain = drains.find((r) => r.hasCleanout)!
    expect(mainDrain).toBeDefined()
    const endPt = mainDrain.path[mainDrain.path.length - 1]!
    // Exits >= 1.0 m outside east foundation wall (x = 10) below stack base invert
    expect(endPt[0]).toBeGreaterThanOrEqual(11.0)
    expect(endPt[1]).toBeLessThan(mainDrain.path[0]![1])
  })
})
