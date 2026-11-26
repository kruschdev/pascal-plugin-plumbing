import { describe, expect, test } from 'bun:test'
import { auditScenePlumbing } from '../ipc/audit'
import { planPlumbingAutoPopulate } from '../ipc/autopopulate'
import type { SceneNodeLike } from '../ipc/framing-interop'
import {
  classifyRoomName,
  detectPlumbingClashes,
  estimateGableRoofYAt,
  extractPlumbingObstacles,
  extractWallOpenings,
  pointInPolygon2D,
  resolveLevelHeightM,
  routeDwvDrainRun,
  routePressurizedPipeRun,
  routeVentRun,
} from '../ipc/routing'

function materializePlan(
  base: Record<string, SceneNodeLike>,
  plan: ReturnType<typeof planPlumbingAutoPopulate>,
  levelId = 'level_0',
): Record<string, SceneNodeLike> {
  const full: Record<string, SceneNodeLike> = { ...base }
  for (const eq of plan.equipment) full[eq.id] = { ...eq, type: 'plumbing:equipment', parentId: levelId }
  for (const m of plan.manifolds) full[m.id] = { ...m, type: 'plumbing:manifold', parentId: levelId }
  for (const f of plan.fixtures) full[f.id] = { ...f, type: 'plumbing:fixture', parentId: levelId }
  for (const r of plan.pipeRuns) full[r.id] = { ...r, type: 'plumbing:pipe-run', parentId: levelId }
  return full
}

describe('Plumbing Audit & Visual Geometry Regression Suite (PLU-BUG-01..05, PLU-OPT-01, PLU-CON-01, VIS-02, VIS-06)', () => {
  test('PLU-BUG-01: overhead pressurized supply routes OVER door/window headers (never through doorway void) and probes full vertical riser envelope', () => {
    const obstacles = extractPlumbingObstacles(
      {
        level_0: { id: 'level_0', type: 'level', height: 2.7 },
        // Door/window header spanning y = 2.08..2.38 m along x = 3.0 m
        hdr_door: {
          id: 'hdr_door',
          type: 'structural:beam',
          role: 'header',
          name: 'Header over Entry Door',
          parentId: 'level_0',
          start: [3.0, 0.0],
          end: [3.0, 3.0],
          elevationY: 2.23,
          widthIn: 3.5,
          depthIn: 11.81,
        },
        // Window header directly above destination fixture `to` at (6.0, 0.45, 1.5)
        hdr_above_to: {
          id: 'hdr_above_to',
          type: 'structural:beam',
          role: 'header',
          name: 'Header over Sink Window',
          parentId: 'level_0',
          start: [5.4, 1.5],
          end: [6.6, 1.5],
          elevationY: 2.23,
          widthIn: 3.5,
          depthIn: 11.81,
        },
      },
      'level_0',
    )

    // 1. Overhead slab supply crossing door header must go ABOVE (y > 2.38 m), never drop below 2.08 m through doorway!
    const overDoor = routePressurizedPipeRun({
      from: [1.0, 1.35, 1.5],
      to: [5.0, 0.45, 1.5],
      routingPlaneY: 2.35,
      nominalSize: '3/4"',
      material: 'pex-a',
      euclideanInCavity: false,
      obstacles: [obstacles[0]!],
    })
    expect(overDoor.clashes).toHaveLength(0)
    // Every horizontal segment crossing x = 3.0 must be above the header (>= 2.38 m)
    const horizMidYs = overDoor.path
      .slice(1)
      .map((b, i) => ({ a: overDoor.path[i]!, b }))
      .filter(({ a, b }) => Math.hypot(b[0] - a[0], b[2] - a[2]) > 0.3)
      .map(({ a, b }) => (a[1] + b[1]) / 2)
    expect(horizMidYs.length).toBeGreaterThan(0)
    for (const y of horizMidYs) {
      expect(y).toBeGreaterThan(2.38)
    }

    // 2. Destination fixture `to` directly under header: full vertical envelope probe catches header clash and jogs clear
    const riserUnderHeader = routePressurizedPipeRun({
      from: [1.0, 1.35, 1.5],
      to: [6.0, 0.45, 1.5],
      routingPlaneY: 2.35,
      nominalSize: '1/2"',
      material: 'pex-a',
      euclideanInCavity: false,
      obstacles,
    })
    expect(riserUnderHeader.clashes).toHaveLength(0)

    // 3. DWV drain probes down to deepest startY (allUnderBeamY) catching deeper beam under fixture drop
    const dwvObstacles = extractPlumbingObstacles(
      {
        level_0: { id: 'level_0', type: 'level', height: 2.6 },
        shallow_beam: {
          id: 'shallow_beam',
          type: 'structural:beam',
          role: 'floor-girder',
          name: 'Shallow Girder',
          parentId: 'level_0',
          start: [2.5, 0],
          end: [2.5, 4],
          elevationY: -0.22,
          widthIn: 3.5,
          depthIn: 8,
        },
        deep_beam_under_from: {
          id: 'deep_beam_under_from',
          type: 'structural:beam',
          role: 'floor-girder',
          name: 'Deep Girder Under Fixture',
          parentId: 'level_0',
          start: [1.0, 0],
          end: [1.0, 4],
          elevationY: -0.58,
          widthIn: 3.5,
          depthIn: 10,
        },
      },
      'level_0',
    )
    const deepDrain = routeDwvDrainRun({
      from: [1.0, 0.48, 2.0],
      to: [4.0, -0.8, 2.0],
      nominalSize: '2"',
      material: 'pvc-dwv',
      foundationType: 'crawlspace',
      slopeInPerFt: 0.25,
      obstacles: dwvObstacles,
    })
    expect(deepDrain.clashes).toHaveLength(0)
  })

  test('PLU-BUG-02: routeVentRun never produces a downward drop (inverted-U condensate trap violating IPC 905.2)', () => {
    const obstacles = extractPlumbingObstacles(
      {
        level_0: { id: 'level_0', type: 'level', height: 2.6 },
        // Wall header directly above lavatory: minY = 2.15 m -> safeJogY ~ 2.06 m
        hdr_lav: {
          id: 'hdr_lav',
          type: 'structural:beam',
          role: 'header',
          name: 'Header over Lavatory Window',
          parentId: 'level_0',
          start: [1.2, 0.5],
          end: [2.8, 0.5],
          elevationY: 2.3,
          widthIn: 3.5,
          depthIn: 11.81,
        },
        // Deep soffit beam blocking horizontal run from y = 1.90..2.95 m -> forces tieY ~ 1.82 m < safeJogY
        deep_soffit: {
          id: 'deep_soffit',
          type: 'structural:beam',
          role: 'header',
          name: 'Deep Ceiling Soffit Beam',
          parentId: 'level_0',
          start: [3.5, -1.0],
          end: [3.5, 6.0],
          elevationY: 2.425,
          widthIn: 5.5,
          depthIn: 41.34,
        },
      },
      'level_0',
    )

    const routed = routeVentRun({
      from: [2.0, 0.45, 0.5],
      stackPoint: [5.0, 0.5],
      floodRimHeightM: 0.86,
      ceilingHeightM: 2.6,
      nominalSize: '1-1/2"',
      obstacles,
    })

    expect(routed.clashes).toHaveLength(0)
    // Verify monotonic non-descending elevation across every segment (IPC 905.2: no inverted-U trap)
    for (let i = 1; i < routed.path.length; i++) {
      const prev = routed.path[i - 1]!
      const cur = routed.path[i]!
      expect(cur[1]).toBeGreaterThanOrEqual(prev[1] - 1e-4)
    }
    // Verify IPC 905.5: every horizontal vent leg remains >= 6" (0.1524m) above 0.86m flood rim
    for (let i = 1; i < routed.path.length; i++) {
      const a = routed.path[i - 1]!
      const b = routed.path[i]!
      if (Math.hypot(b[0] - a[0], b[2] - a[2]) > 0.1) {
        expect(Math.min(a[1], b[1])).toBeGreaterThanOrEqual(0.86 + 0.1524 - 0.005)
      }
    }
  })

  test('PLU-BUG-03 & PLU-CON-01: fixture dodging & floor-girder nudging stay strictly inside host room polygon and building bounds', () => {
    const bathPoly: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [2.4, 0],
      [2.4, 2.4],
      [0, 2.4],
    ]
    const base: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.6 },
      // Continuous 10m north exterior wall spanning Bathroom (0..2.4) + Bedroom (2.4..10)
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], thickness: 0.165, height: 2.6 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 6], end: [10, 6], thickness: 0.165, height: 2.6 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 6], thickness: 0.165, height: 2.6 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 6], thickness: 0.165, height: 2.6 },
      w_part: { id: 'w_part', type: 'wall', parentId: 'level_0', start: [2.4, 0], end: [2.4, 2.4], thickness: 0.12, height: 2.6 },
      w_bath_s: { id: 'w_bath_s', type: 'wall', parentId: 'level_0', start: [0, 2.4], end: [2.4, 2.4], thickness: 0.12, height: 2.6 },
      // Floor girder directly under the north bathroom wall and east edge forcing Pass 1 / Pass 2 / nudge
      girder_n: {
        id: 'girder_n',
        type: 'structural:beam',
        role: 'floor-girder',
        name: 'North Perimeter Girder',
        parentId: 'level_0',
        start: [0, 0.25],
        end: [2.4, 0.25],
        elevationY: -0.15,
        widthIn: 5.5,
        depthIn: 11.875,
      },
      // Floor girder along east exterior wall under a placed fixture to test bounds-clamped nudgeOffFloorGirder
      girder_e: {
        id: 'girder_e',
        type: 'structural:beam',
        role: 'floor-girder',
        name: 'East Perimeter Girder',
        parentId: 'level_0',
        start: [9.85, 0],
        end: [9.85, 6],
        elevationY: -0.15,
        widthIn: 3.5,
        depthIn: 11.875,
      },
      sink_east: {
        id: 'sink_east',
        type: 'item',
        name: 'Kitchen Sink',
        parentId: 'level_0',
        position: [9.85, 0, 3.0],
      },
      z_bath: {
        id: 'z_bath',
        type: 'zone',
        name: 'Bathroom',
        parentId: 'level_0',
        polygon: bathPoly,
      },
      z_bed: {
        id: 'z_bed',
        type: 'zone',
        name: 'Bedroom',
        parentId: 'level_0',
        polygon: [
          [2.4, 0],
          [10, 0],
          [10, 6],
          [2.4, 6],
        ],
      },
    }

    const plan = planPlumbingAutoPopulate(base, { levelId: 'level_0' })
    const bathFixtures = plan.fixtures.filter((f) => f.roomName === 'Bathroom')
    expect(bathFixtures.length).toBeGreaterThanOrEqual(3)
    for (const f of bathFixtures) {
      expect(pointInPolygon2D(f.position[0], f.position[2], bathPoly)).toBe(true)
    }

    // Placed kitchen sink near east wall x=9.85 must NOT be nudged past x=10.0 exterior wall!
    const eastSink = plan.fixtures.find((f) => f.fixtureKind === 'kitchen-sink')!
    expect(eastSink).toBeDefined()
    expect(eastSink.position[0]).toBeLessThanOrEqual(9.88)
    expect(eastSink.position[0]).toBeGreaterThanOrEqual(0.12)

    // All indoor equipment & manifold must remain strictly inside walled bounds [0.15..9.85, 0.15..5.85]
    for (const eq of plan.equipment) {
      if (eq.equipmentKind === 'gas-meter') continue
      expect(eq.position[0]).toBeGreaterThanOrEqual(0.15)
      expect(eq.position[0]).toBeLessThanOrEqual(9.85)
      expect(eq.position[2]).toBeGreaterThanOrEqual(0.15)
      expect(eq.position[2]).toBeLessThanOrEqual(5.85)
    }
    for (const m of plan.manifolds) {
      expect(m.position[0]).toBeGreaterThanOrEqual(0.15)
      expect(m.position[0]).toBeLessThanOrEqual(9.85)
      expect(m.position[2]).toBeGreaterThanOrEqual(0.15)
      expect(m.position[2]).toBeLessThanOrEqual(5.85)
    }
  })

  test('PLU-BUG-04: combined full-bath/WC names remain bathroom while standalone WC/Toilettes/Aseo map to half-bath', () => {
    expect(classifyRoomName('Bath / WC')).toBe('bathroom')
    expect(classifyRoomName('Shower / WC')).toBe('bathroom')
    expect(classifyRoomName('Salle de Bain / WC')).toBe('bathroom')
    expect(classifyRoomName('Salle de Bains / WC')).toBe('bathroom')
    expect(classifyRoomName('Bad / WC')).toBe('bathroom')
    expect(classifyRoomName('Badezimmer / WC')).toBe('bathroom')
    expect(classifyRoomName('Baño / Aseo')).toBe('bathroom')
    expect(classifyRoomName('Master Bath / WC')).toBe('master-bath')
    expect(classifyRoomName('Ensuite WC')).toBe('master-bath')

    expect(classifyRoomName('WC')).toBe('half-bath')
    expect(classifyRoomName('WC 1')).toBe('half-bath')
    expect(classifyRoomName('Toilettes')).toBe('half-bath')
    expect(classifyRoomName('Aseo')).toBe('half-bath')
    expect(classifyRoomName('Half Bath')).toBe('half-bath')
    expect(classifyRoomName('Powder Room')).toBe('half-bath')
  })

  test('PLU-BUG-05: extractWallOpenings projects world-space openings near z=0 instead of misclassifying them as wall-local', () => {
    const scene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.6 },
      // East-West wall spanning x = -5..+5 at z = 0 (length = 10 m)
      w_ew: {
        id: 'w_ew',
        type: 'wall',
        parentId: 'level_0',
        start: [-5, 0],
        end: [5, 0],
        thickness: 0.16,
        height: 2.6,
        children: ['door_local'],
      },
      // North-South wall spanning z = -4..+4 at x = 2 (length = 8 m)
      w_ns: {
        id: 'w_ns',
        type: 'wall',
        parentId: 'level_0',
        start: [2, -4],
        end: [2, 4],
        thickness: 0.16,
        height: 2.6,
      },
      // Non-child world-space door at world (2, 0, 0) on w_ew -> true uCenterM = 7.0 m (NOT 2.0 m!)
      door_world_ew: {
        id: 'door_world_ew',
        type: 'door',
        name: 'World EW Door',
        parentId: 'level_0',
        wallId: 'w_ew',
        position: [2, 0, 0],
        width: 0.9,
        height: 2.1,
      },
      // Non-child world-space door at world (2, 0, 0) on w_ns -> true uCenterM = 4.0 m (NOT 2.0 m!)
      door_world_ns: {
        id: 'door_world_ns',
        type: 'door',
        name: 'World NS Door',
        parentId: 'level_0',
        wallId: 'w_ns',
        position: [2, 0, 0],
        width: 0.9,
        height: 2.1,
      },
      // True wall-child opening in wall-local coords [2, 1.05, 0] -> uCenterM = 2.0 m
      door_local: {
        id: 'door_local',
        type: 'door',
        name: 'Local Child Door',
        parentId: 'w_ew',
        wallId: 'w_ew',
        position: [2, 1.05, 0],
        width: 0.9,
        height: 2.1,
      },
    }

    const openings = extractWallOpenings(scene, 'level_0')
    const ewWorld = openings.find((o) => o.id === 'door_world_ew')!
    const nsWorld = openings.find((o) => o.id === 'door_world_ns')!
    const ewLocal = openings.find((o) => o.id === 'door_local')!

    expect(ewWorld.uCenterM).toBeCloseTo(7.0, 2)
    expect(ewWorld.centerX).toBeCloseTo(2.0, 2)
    expect(nsWorld.uCenterM).toBeCloseTo(4.0, 2)
    expect(nsWorld.centerZ).toBeCloseTo(0.0, 2)
    expect(ewLocal.uCenterM).toBeCloseTo(2.0, 2)
    expect(ewLocal.centerX).toBeCloseTo(-3.0, 2)
  })

  test('PLU-OPT-01: routePressurizedPipeRun terminates in bounded time on unresolvable endpoint clash with 200 obstacles', () => {
    const nodes: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.6 },
      // Encase `from` and `to` inside columns/panels so 0-clash route is impossible
      panel_from: { id: 'panel_from', type: 'electrical:panel', parentId: 'level_0', position: [0, 1.4, 0], width: 1.5, depth: 1.5, height: 1.0 },
      panel_to: { id: 'panel_to', type: 'electrical:panel', parentId: 'level_0', position: [8, 1.4, 8], width: 1.5, depth: 1.5, height: 1.0 },
      col_from_2: { id: 'col_from_2', type: 'structural:column', parentId: 'level_0', position: [0.3, 0, 0.3], widthIn: 24, depthIn: 24, heightM: 2.6 },
      col_to_2: { id: 'col_to_2', type: 'structural:column', parentId: 'level_0', position: [7.7, 0, 7.7], widthIn: 24, depthIn: 24, heightM: 2.6 },
    }
    for (let i = 0; i < 196; i++) {
      nodes[`col_${i}`] = {
        id: `col_${i}`,
        type: 'structural:column',
        parentId: 'level_0',
        position: [(i % 14) * 0.8 + 1.0, 0, Math.floor(i / 14) * 0.8 + 1.0],
        widthIn: 5.5,
        depthIn: 5.5,
        heightM: 2.6,
      }
    }
    const obstacles = extractPlumbingObstacles(nodes, 'level_0')
    expect(obstacles.length).toBeGreaterThanOrEqual(200)

    const t0 = performance.now()
    const res = routePressurizedPipeRun({
      from: [0, 1.2, 0],
      to: [8, 0.45, 8],
      routingPlaneY: 2.35,
      nominalSize: '3/4"',
      material: 'pex-a',
      obstacles,
    })
    const elapsedMs = performance.now() - t0
    expect(res.path.length).toBeGreaterThanOrEqual(2)
    expect(elapsedMs).toBeLessThan(250)
  })

  test('VIS-02 & VIS-06: level height uses level.height / tallest wall, indoor equipment & runs stay inside walled footprint & below pitched roof, and pools/patios are excluded', () => {
    // 1. resolveLevelHeightM: explicit tallest wall (> 1.5m) wins (aligned with Structural audit);
    //    when walls omit explicit heights, level.height is used, falling back to 2.7m.
    const gymWithExplicitWalls: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 5.0 },
      w_ext1: { id: 'w_ext1', type: 'wall', parentId: 'level_0', start: [0, 0], end: [12, 0], height: 4.8 },
      w_part1: { id: 'w_part1', type: 'wall', parentId: 'level_0', start: [2, 0], end: [2, 3], height: 2.5 },
      w_part2: { id: 'w_part2', type: 'wall', parentId: 'level_0', start: [0, 3], end: [2, 3], height: 2.5 },
    }
    expect(resolveLevelHeightM(gymWithExplicitWalls, 'level_0')).toBe(4.8)

    const gymLevelHeightFallback: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 5.0 },
      w_ext1: { id: 'w_ext1', type: 'wall', parentId: 'level_0', start: [0, 0], end: [12, 0] },
    }
    expect(resolveLevelHeightM(gymLevelHeightFallback, 'level_0')).toBe(5.0)

    const gymNoLevelH: Record<string, SceneNodeLike> = {
      ...gymWithExplicitWalls,
      level_0: { id: 'level_0', type: 'level' },
    }
    expect(resolveLevelHeightM(gymNoLevelH, 'level_0')).toBe(4.8)

    // 2. Pool / Swimming / Piscine / Terrace / Patio / Deck / Yard / Lanai classify as exterior
    expect(classifyRoomName('Pool')).toBe('exterior')
    expect(classifyRoomName('Swimming Pool')).toBe('exterior')
    expect(classifyRoomName('Piscine')).toBe('exterior')
    expect(classifyRoomName('Terrace')).toBe('exterior')
    expect(classifyRoomName('Lanai')).toBe('exterior')
    expect(classifyRoomName('Back Patio')).toBe('exterior')
    expect(classifyRoomName('Rear Deck')).toBe('exterior')
    expect(classifyRoomName('Front Yard')).toBe('exterior')

    // 3. Full scene with outdoor Terrace, Swimming Pool, outdoor fountain, bathroom decor, and wall-child Showerhead
    const house: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.6 },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [-6, -5], end: [6, -5], thickness: 0.165, height: 2.6 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [-6, 5], end: [6, 5], thickness: 0.165, height: 2.6 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [-6, -5], end: [-6, 5], thickness: 0.165, height: 2.6 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [6, -5], end: [6, 5], thickness: 0.165, height: 2.6 },
      w_bath: { id: 'w_bath', type: 'wall', parentId: 'level_0', start: [-2, -5], end: [-2, 0], thickness: 0.165, height: 2.6 },
      // Outdoor zones extending far outside walls
      z_terrace: {
        id: 'z_terrace',
        type: 'zone',
        name: 'Terrace',
        parentId: 'level_0',
        polygon: [[-13, -5], [-6, -5], [-6, 5], [-13, 5]],
      },
      z_pool: {
        id: 'z_pool',
        type: 'zone',
        name: 'Swimming Pool',
        parentId: 'level_0',
        polygon: [[7, -4], [14, -4], [14, 4], [7, 4]],
      },
      z_bath: {
        id: 'z_bath',
        type: 'zone',
        name: 'Bathroom',
        parentId: 'level_0',
        polygon: [[-6, -5], [-2, -5], [-2, 0], [-6, 0]],
      },
      // Wall-parented Showerhead in wall-local coords [0.4, 1.8, -0.05] -> must transform inside [-6..6, -5..5]
      item_sh: {
        id: 'item_sh',
        type: 'item',
        name: 'Showerhead',
        parentId: 'w_bath',
        position: [0.4, 1.8, -0.05],
      },
      // Bathroom decor items & outdoor fountain that MUST be ignored
      item_rug: { id: 'item_rug', type: 'item', name: 'Shower Rug', parentId: 'level_0', position: [-4, 0, -2] },
      item_tp: { id: 'item_tp', type: 'item', name: 'Toilet Paper', parentId: 'w_bath', position: [1.5, 0.7, -0.05] },
      item_fountain: {
        id: 'item_fountain',
        type: 'item',
        name: 'Round Parisian fountain, limestone basin, ornate bronze sculpture',
        parentId: 'level_0',
        position: [10, 0, 9.5],
      },
      // Header near eave to verify overhead slab supply & re-vents stay below pitched roof
      hdr_eave: {
        id: 'hdr_eave',
        type: 'structural:beam',
        role: 'header',
        name: 'Header over Bath Window',
        parentId: 'level_0',
        start: [-5.2, -5],
        end: [-3.2, -5],
        elevationY: 2.32,
        widthIn: 3.5,
        depthIn: 7.25,
      },
    }

    const plan = planPlumbingAutoPopulate(house, {
      levelId: 'level_0',
      foundationType: 'slab',
      includeHotRecirc: true,
    })

    // Pool / Terrace must have 0 fixtures; decor & outdoor fountain ignored
    expect(plan.fixtures.some((f) => /pool|terrace/i.test(f.roomName))).toBe(false)
    expect(plan.fixtures.some((f) => f.position[0] > 6.2 || f.position[2] > 5.2)).toBe(false)

    // Wall-child Showerhead must transform into world coordinates near w_bath (x ~ -2, z ~ -4.6)
    const showerFix = plan.fixtures.find((f) => f.fixtureKind === 'shower')!
    expect(showerFix).toBeDefined()
    expect(showerFix.position[0]).toBeGreaterThanOrEqual(-5.85)
    expect(showerFix.position[0]).toBeLessThanOrEqual(5.85)
    expect(showerFix.position[2]).toBeGreaterThanOrEqual(-4.85)
    expect(showerFix.position[2]).toBeLessThanOrEqual(4.85)

    // All indoor equipment & manifolds stay strictly inside walled bounds [-5.85..5.85, -4.85..4.85]
    for (const eq of plan.equipment) {
      if (eq.equipmentKind === 'gas-meter') continue
      expect(eq.position[0]).toBeGreaterThanOrEqual(-5.85)
      expect(eq.position[0]).toBeLessThanOrEqual(5.85)
      expect(eq.position[2]).toBeGreaterThanOrEqual(-4.85)
      expect(eq.position[2]).toBeLessThanOrEqual(4.85)
    }

    // Check roof protrusion: ONLY Main DWV Soil & Vent Stack may penetrate above roofYAt(x, z) - 0.08
    const bounds = { minX: -6, maxX: 6, minZ: -5, maxZ: 5 }
    for (const run of plan.pipeRuns) {
      if (run.isMainVentStack) continue
      const isExtRun = /building-drain|sewer|gas|hose bibb|dryer-vent/i.test(`${run.system} ${run.name}`)
      for (const pt of run.path) {
        if (!isExtRun) {
          expect(pt[0]).toBeGreaterThanOrEqual(-6.35)
          expect(pt[0]).toBeLessThanOrEqual(6.35)
          expect(pt[2]).toBeGreaterThanOrEqual(-5.35)
          expect(pt[2]).toBeLessThanOrEqual(5.35)
        }
        if (pt[0] >= -6 && pt[0] <= 6 && pt[2] >= -5 && pt[2] <= 5) {
          const roofY = estimateGableRoofYAt(pt[0], pt[2], bounds, 2.6, 6)
          expect(pt[1]).toBeLessThanOrEqual(roofY - 0.08 + 0.01)
        }
      }
    }

    const fullScene = materializePlan(house, plan, 'level_0')
    const audit = auditScenePlumbing(fullScene, { codeEdition: 'IPC-2021' })
    expect(audit.errorCount).toBe(0)
  })
})
