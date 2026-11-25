import { describe, expect, test } from 'bun:test'
import {
  extractPlumbingObstacles,
  measureDrainPathSlope,
  routeDwvDrainRun,
  routePressurizedPipeRun,
  routeVentRun,
} from '../ipc/routing'
import type { SceneNodeLike } from '../ipc/framing-interop'

describe('Gravity DWV, Vent & Obstacle-Aware Supply Routing', () => {
  test('routeDwvDrainRun produces monotonic downward gravity slope >= 1/4"/ft', () => {
    const r = routeDwvDrainRun({
      from: [0, 0.5, 0],
      to: [4, -0.45, 3],
      nominalSize: '2"',
      foundationType: 'crawlspace',
      slopeInPerFt: 0.25,
    })
    const slope = measureDrainPathSlope(r.path)
    expect(slope.hasUphillSegment).toBe(false)
    expect(slope.minSegmentSlopeInPerFt).toBeGreaterThanOrEqual(0.24)
    expect(r.lengthFt).toBeGreaterThan(20)
  })

  test('routeVentRun rises >= 6" above fixture flood-level rim (IPC 905.5)', () => {
    const r = routeVentRun({
      from: [1, 0.5, 1],
      stackPoint: [4, 2],
      floodRimHeightM: 0.91,
      ceilingHeightM: 2.6,
    })
    expect(r.tieInHeightM).toBeGreaterThanOrEqual(0.91 + 0.1524)
    expect(r.path.length).toBeGreaterThanOrEqual(3)
  })

  test('routePressurizedPipeRun automatically detours around NEC 110.26(E) electrical panel keep-out', () => {
    const nodes: Record<string, SceneNodeLike> = {
      level_1: { id: 'level_1', type: 'level' },
      elecpanel_1: {
        id: 'elecpanel_1',
        type: 'electrical:panel',
        name: 'MDP-1',
        parentId: 'level_1',
        position: [2, 1.52, 0],
        width: 0.42,
        height: 0.92,
        depth: 0.16,
      },
    }
    const obstacles = extractPlumbingObstacles(nodes, 'level_1')
    expect(obstacles.length).toBe(1)
    expect(obstacles[0]!.category).toBe('electrical-dedicated-space')

    const routed = routePressurizedPipeRun({
      from: [0, 2.3, 0],
      to: [4, 2.3, 0],
      routingPlaneY: 2.3,
      euclideanInCavity: true,
      obstacles,
    })
    expect(routed.detoured).toBe(true)
    expect(routed.clashes.length).toBe(0)
  })
})
