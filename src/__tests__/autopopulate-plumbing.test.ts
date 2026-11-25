import { describe, expect, test } from 'bun:test'
import { auditScenePlumbing } from '../ipc/audit'
import { planPlumbingAutoPopulate } from '../ipc/autopopulate'
import type { SceneNodeLike } from '../ipc/framing-interop'

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
})
