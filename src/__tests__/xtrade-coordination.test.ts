import { describe, expect, test } from 'bun:test'
import { plumbingAgentOperations } from '../agent-operations'
import { auditScenePlumbing } from '../ipc/audit'
import { routeDwvDrainRun, routePressurizedPipeRun, type PlumbingObstacle } from '../ipc/routing'
import type { SceneNodeLike } from '../ipc/framing-interop'

function applyChanges(nodes: Record<string, SceneNodeLike>, outcome: any): Record<string, SceneNodeLike> {
  const next = { ...nodes }
  for (const id of outcome?.changes?.delete ?? []) delete next[id]
  for (const item of outcome?.changes?.create ?? []) {
    const n = item.node ?? item
    if (n?.id) next[n.id] = n
  }
  return next
}

describe('Cross-Trade 4-MEP Coordination Regression Suite (XTRADE-02, XTRADE-03, XTRADE-12, XTRADE-16)', () => {
  test('multi-level autopopulate allocates collision-free IDs and preserves Level 1 DWV stack', () => {
    let nodes: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', name: 'Level 1', height: 2.7, elevation: 0 },
      level_1: { id: 'level_1', type: 'level', name: 'Level 2', height: 2.7, elevation: 2.7 },
      w0_1: { id: 'w0_1', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], height: 2.7, thickness: 0.16 },
      w0_2: { id: 'w0_2', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], height: 2.7, thickness: 0.16 },
      w0_3: { id: 'w0_3', type: 'wall', parentId: 'level_0', start: [10, 8], end: [0, 8], height: 2.7, thickness: 0.16 },
      w0_4: { id: 'w0_4', type: 'wall', parentId: 'level_0', start: [0, 8], end: [0, 0], height: 2.7, thickness: 0.16 },
      r0_b: { id: 'r0_b', type: 'zone', parentId: 'level_0', name: 'Bath 1', polygon: [[5, 0], [10, 0], [10, 8], [5, 8]] },
      w1_1: { id: 'w1_1', type: 'wall', parentId: 'level_1', start: [0, 0], end: [10, 0], height: 2.7, thickness: 0.16 },
      w1_2: { id: 'w1_2', type: 'wall', parentId: 'level_1', start: [10, 0], end: [10, 8], height: 2.7, thickness: 0.16 },
      w1_3: { id: 'w1_3', type: 'wall', parentId: 'level_1', start: [10, 8], end: [0, 8], height: 2.7, thickness: 0.16 },
      w1_4: { id: 'w1_4', type: 'wall', parentId: 'level_1', start: [0, 8], end: [0, 0], height: 2.7, thickness: 0.16 },
      r1_b: { id: 'r1_b', type: 'zone', parentId: 'level_1', name: 'Upstairs Bath', polygon: [[5, 0], [10, 0], [10, 8], [5, 8]] },
      girder_l1: {
        id: 'girder_l1',
        type: 'structural:beam',
        parentId: 'level_1',
        name: 'Floor Girder #1',
        start: [0, 4],
        end: [10, 4],
        elevationY: -0.121,
        widthIn: 3.5,
        depthIn: 9.5,
      },
    }

    nodes = applyChanges(nodes, plumbingAgentOperations.plumbing_autopopulate(nodes as any, { levelId: 'level_0' }, { activeLevelId: 'level_0' }))
    const l1Count = Object.values(nodes).filter((n) => String(n.type).startsWith('plumbing:') && n.parentId === 'level_0').length
    expect(l1Count).toBeGreaterThan(5)

    nodes = applyChanges(nodes, plumbingAgentOperations.plumbing_autopopulate(nodes as any, { levelId: 'level_1' }, { activeLevelId: 'level_1' }))
    const l1After = Object.values(nodes).filter((n) => String(n.type).startsWith('plumbing:') && n.parentId === 'level_0').length
    const l2After = Object.values(nodes).filter((n) => String(n.type).startsWith('plumbing:') && n.parentId === 'level_1').length
    expect(l1After).toBe(l1Count)
    expect(l2After).toBeGreaterThan(5)

    const audit = auditScenePlumbing(nodes)
    const structuralErrors = audit.findings.filter((f) => f.severity === 'error' && /Structural/.test(f.codeRef))
    expect(structuralErrors).toHaveLength(0)
  })

  test('under-floor DWV and pressurized supply runs cleanly drop below full-span structural girders', () => {
    const girder: PlumbingObstacle = {
      id: 'girder_1',
      category: 'structural',
      label: 'Structural beam LVL',
      box: { minX: 0, maxX: 12, minY: -0.242, maxY: 0, minZ: 3.9, maxZ: 4.1 },
    }
    const dwv = routeDwvDrainRun({
      from: [4, 0.5, 2],
      to: [4, -0.55, 6],
      nominalSize: '3"',
      slopeInPerFt: 0.25,
      obstacles: [girder],
    })
    expect(dwv.clashes).toHaveLength(0)

    const supply = routePressurizedPipeRun({
      from: [4, 1.35, 2],
      to: [4, 0.55, 6],
      routingPlaneY: -0.16,
      obstacles: [girder],
    })
    expect(supply.clashes).toHaveLength(0)
  })
})
