import { describe, expect, test } from 'bun:test'
import { auditScenePlumbing } from '../ipc/audit'
import { planPlumbingAutoPopulate } from '../ipc/autopopulate'
import type { SceneNodeLike } from '../ipc/framing-interop'
import {
  classifyRoomName,
  detectPlumbingClashes,
  extractPlumbingObstacles,
  extractWallOpenings,
  measureDrainPathSlope,
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

describe('Real-World Plumbing Fixes (REAL-PLB-01 & REAL-PLB-02)', () => {
  test('REAL-PLB-01a: Main DWV Stack & Re-Vents dodge door/window headers (structural:beam role=header) and openings', () => {
    const base: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.6 },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [8, 0], thickness: 0.165, height: 2.6 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 6], end: [8, 6], thickness: 0.165, height: 2.6 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 6], thickness: 0.165, height: 2.6 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [8, 0], end: [8, 6], thickness: 0.165, height: 2.6 },
      // Central wet wall separating Bath and Kitchen with a door right at the wet-core centroid (z = 1.5..2.7)
      w_wet: {
        id: 'w_wet',
        type: 'wall',
        parentId: 'level_0',
        start: [4, 0],
        end: [4, 6],
        thickness: 0.165,
        height: 2.6,
        children: ['door_wet_1'],
      },
      door_wet_1: {
        id: 'door_wet_1',
        type: 'door',
        name: 'Door 4',
        parentId: 'w_wet',
        wallId: 'w_wet',
        position: [2.1, 1.05, 0],
        width: 1.2,
        height: 2.1,
      },
      hdr_door_wet: {
        id: 'hdr_door_wet',
        type: 'structural:beam',
        role: 'header',
        name: 'Header ((2) 2x8 Built-Up Header) over Door 4',
        parentId: 'level_0',
        start: [4, 1.4],
        end: [4, 2.8],
        elevationY: 2.192,
        widthIn: 3.0,
        depthIn: 7.25,
        designation: '(2) 2x8 Built-Up Header',
      },
      // Window on north kitchen wall with a placed kitchen sink directly beneath its header
      win_kit: {
        id: 'win_kit',
        type: 'window',
        name: 'Window 5',
        parentId: 'w_n',
        wallId: 'w_n',
        position: [6.0, 1.5, 0],
        width: 1.4,
        height: 1.2,
      },
      hdr_win_kit: {
        id: 'hdr_win_kit',
        type: 'structural:beam',
        role: 'header',
        name: 'Header ((2) 2x8 Built-Up Header) over Window 5',
        parentId: 'level_0',
        start: [5.2, 0],
        end: [6.8, 0],
        elevationY: 2.25,
        widthIn: 3.0,
        depthIn: 7.25,
        designation: '(2) 2x8 Built-Up Header',
      },
      sink_item: {
        id: 'sink_item',
        type: 'item',
        name: 'Kitchen Sink',
        parentId: 'level_0',
        position: [6.0, 0, 0.12],
      },
      z_bath: {
        id: 'z_bath',
        type: 'zone',
        name: 'Bathroom',
        parentId: 'level_0',
        polygon: [[0, 0], [4, 0], [4, 4], [0, 4]],
      },
      z_kit: {
        id: 'z_kit',
        type: 'zone',
        name: 'Kitchen',
        parentId: 'level_0',
        polygon: [[4, 0], [8, 0], [8, 4], [4, 4]],
      },
    }

    const openings = extractWallOpenings(base, 'level_0')
    expect(openings.length).toBe(2)
    expect(openings.some((o) => o.wallId === 'w_wet' && o.kind === 'door')).toBe(true)
    expect(openings.some((o) => o.wallId === 'w_n' && o.kind === 'window')).toBe(true)

    const plan = planPlumbingAutoPopulate(base, { levelId: 'level_0' })
    const fullScene = materializePlan(base, plan, 'level_0')
    const obstacles = extractPlumbingObstacles(fullScene, 'level_0')

    const mainStack = plan.pipeRuns.find((r) => r.isMainVentStack)!
    expect(mainStack).toBeDefined()
    expect(detectPlumbingClashes(mainStack.path, obstacles, 0.055)).toHaveLength(0)

    const sinkVent = plan.pipeRuns.find((r) => r.system === 'dwv-vent' && r.name.includes('Kitchen Sink'))!
    expect(sinkVent).toBeDefined()
    expect(detectPlumbingClashes(sinkVent.path, obstacles, 0.03)).toHaveLength(0)

    const audit = auditScenePlumbing(fullScene, { codeEdition: 'IPC-2021' })
    expect(audit.errorCount).toBe(0)
  })

  test('REAL-PLB-01a (direct router): routeVentRun offsets past overhead window header & hops over cross-wall header while obeying IPC 905.5', () => {
    const obstacles = extractPlumbingObstacles(
      {
        level_0: { id: 'level_0', type: 'level', height: 2.6 },
        hdr_above_sink: {
          id: 'hdr_above_sink',
          type: 'structural:beam',
          role: 'header',
          name: 'Header over Kitchen Window',
          parentId: 'level_0',
          start: [1.2, 0],
          end: [2.8, 0],
          elevationY: 2.25,
          widthIn: 3.5,
          depthIn: 7.25,
        },
        hdr_mid_wall: {
          id: 'hdr_mid_wall',
          type: 'structural:beam',
          role: 'header',
          name: 'Header over Hallway Door',
          parentId: 'level_0',
          start: [3.0, -0.5],
          end: [3.0, 4.5],
          elevationY: 2.38,
          widthIn: 3.5,
          depthIn: 7.25,
        },
      },
      'level_0',
    )

    const routed = routeVentRun({
      from: [2.0, 0.46, 0.02],
      stackPoint: [5.0, 2.0],
      floodRimHeightM: 0.91,
      ceilingHeightM: 2.6,
      nominalSize: '1-1/2"',
      obstacles,
    })

    expect(routed.detoured).toBe(true)
    expect(routed.clashes).toHaveLength(0)
    // Verify IPC 905.5: every horizontal segment stays >= 6" (0.1524m) above 0.91m flood rim
    for (let i = 1; i < routed.path.length; i++) {
      const a = routed.path[i - 1]!
      const b = routed.path[i]!
      const horiz = Math.hypot(b[0] - a[0], b[2] - a[2])
      if (horiz > 0.25) {
        expect(Math.min(a[1], b[1])).toBeGreaterThanOrEqual(0.91 + 0.1524 - 0.005)
      }
    }
  })

  test('REAL-PLB-01b: Exterior Hose Bibbs, pressurized supply & DWV drains clear central floor girders', () => {
    // Mirrors Small Castle / Plan Mamie Adjoa where a central Floor Girder runs right along x = bounds.cx (x = 5)
    const base: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.6 },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], thickness: 0.165, height: 2.6 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 8], end: [10, 8], thickness: 0.165, height: 2.6 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 8], thickness: 0.165, height: 2.6 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], thickness: 0.165, height: 2.6 },
      girder_center: {
        id: 'girder_center',
        type: 'structural:beam',
        role: 'floor-girder',
        name: 'Floor Girder #1-1 ((2) 1-3/4"x14" 2.0E LVL)',
        parentId: 'level_0',
        start: [5, -0.2],
        end: [5, 8.2],
        elevationY: -0.178,
        widthIn: 3.5,
        depthIn: 14,
        designation: '(2) 1-3/4"x14" 2.0E LVL',
      },
      girder_end_post: {
        id: 'girder_end_post',
        type: 'structural:column',
        name: 'Girder End Support Post',
        parentId: 'level_0',
        position: [10, -0.45, 4],
        widthIn: 5.5,
        depthIn: 5.5,
        heightM: 0.45,
      },
      z_bath: {
        id: 'z_bath',
        type: 'zone',
        name: 'Bathroom',
        parentId: 'level_0',
        polygon: [[0, 0], [5, 0], [5, 4], [0, 4]],
      },
      z_kit: {
        id: 'z_kit',
        type: 'zone',
        name: 'Kitchen',
        parentId: 'level_0',
        polygon: [[5, 0], [10, 0], [10, 4], [5, 4]],
      },
    }

    const plan = planPlumbingAutoPopulate(base, { levelId: 'level_0', foundationType: 'crawlspace' })
    const fullScene = materializePlan(base, plan, 'level_0')
    const obstacles = extractPlumbingObstacles(fullScene, 'level_0')

    const hoseBibbs = plan.fixtures.filter((f) => f.fixtureKind === 'hose-bibb')
    expect(hoseBibbs.length).toBe(2)
    for (const bibb of hoseBibbs) {
      // Must be nudged clear of x = 5.0 central floor girder
      expect(Math.abs(bibb.position[0] - 5.0)).toBeGreaterThanOrEqual(0.28)
    }

    // Verify direct router escape even when an endpoint sits directly over a floor girder
    const directSupply = routePressurizedPipeRun({
      from: [1.0, 1.35, 1.0],
      to: [5.0, 0.46, 8.08],
      routingPlaneY: -0.16,
      nominalSize: '3/4"',
      material: 'pex-a',
      euclideanInCavity: false,
      obstacles,
    })
    expect(directSupply.clashes).toHaveLength(0)

    const directDrain = routeDwvDrainRun({
      from: [5.0, 0.48, 2.0],
      to: [2.0, -0.35, 2.0],
      nominalSize: '2"',
      material: 'pvc-dwv',
      foundationType: 'crawlspace',
      slopeInPerFt: 0.25,
      obstacles,
    })
    expect(directDrain.clashes).toHaveLength(0)
    const slope = measureDrainPathSlope(directDrain.path)
    expect(slope.hasUphillSegment).toBe(false)
    expect(slope.minSegmentSlopeInPerFt).toBeGreaterThanOrEqual(0.24)

    const audit = auditScenePlumbing(fullScene, { codeEdition: 'IPC-2021' })
    expect(audit.errorCount).toBe(0)
  })

  test('REAL-PLB-02: French, German & Spanish room names classify cleanly without breaking English matching', () => {
    // French
    expect(classifyRoomName('Salle de Bains')).toBe('bathroom')
    expect(classifyRoomName("Salle d'eau")).toBe('bathroom')
    expect(classifyRoomName('Salle d’eau')).toBe('bathroom')
    expect(classifyRoomName('WC')).toBe('half-bath')
    expect(classifyRoomName('Cuisine')).toBe('kitchen')
    expect(classifyRoomName('Séjour / Cuisine')).toBe('kitchen')
    expect(classifyRoomName('Buanderie')).toBe('laundry')
    expect(classifyRoomName('Chambre 1')).toBe('bedroom')

    // German
    expect(classifyRoomName('Bad')).toBe('bathroom')
    expect(classifyRoomName('Badezimmer')).toBe('bathroom')
    expect(classifyRoomName('Küche')).toBe('kitchen')
    expect(classifyRoomName('Waschküche')).toBe('laundry')
    // Must not falsely classify unrelated English words containing "bad"
    expect(classifyRoomName('Badminton Court')).toBe('other')

    // Spanish
    expect(classifyRoomName('Baño')).toBe('bathroom')
    expect(classifyRoomName('Cocina')).toBe('kitchen')
    expect(classifyRoomName('Lavandería')).toBe('laundry')

    // Existing English invariants preserved
    expect(classifyRoomName('Master Bathroom')).toBe('master-bath')
    expect(classifyRoomName('Half Bath')).toBe('half-bath')
    expect(classifyRoomName('Kitchen')).toBe('kitchen')
    expect(classifyRoomName('Laundry Room')).toBe('laundry')
    expect(classifyRoomName('Living Room')).toBe('living')

    // End-to-end autopopulate on a French apartment scene
    const frenchApt: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.5 },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], thickness: 0.165, height: 2.5 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 7], end: [10, 7], thickness: 0.165, height: 2.5 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 7], thickness: 0.165, height: 2.5 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 7], thickness: 0.165, height: 2.5 },
      w_mid: { id: 'w_mid', type: 'wall', parentId: 'level_0', start: [5, 0], end: [5, 7], thickness: 0.165, height: 2.5 },
      z_sdb: { id: 'z_sdb', type: 'zone', name: 'Salle de Bains', parentId: 'level_0', polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] },
      z_wc: { id: 'z_wc', type: 'zone', name: 'WC', parentId: 'level_0', polygon: [[3, 0], [5, 0], [5, 3], [3, 3]] },
      z_cui: { id: 'z_cui', type: 'zone', name: 'Séjour / Cuisine', parentId: 'level_0', polygon: [[5, 0], [10, 0], [10, 4], [5, 4]] },
      z_bua: { id: 'z_bua', type: 'zone', name: 'Buanderie', parentId: 'level_0', polygon: [[0, 3], [5, 3], [5, 7], [0, 7]] },
      z_ch: { id: 'z_ch', type: 'zone', name: 'Chambre 1', parentId: 'level_0', polygon: [[5, 4], [10, 4], [10, 7], [5, 7]] },
    }
    const plan = planPlumbingAutoPopulate(frenchApt, { levelId: 'level_0' })
    expect(plan.fixtures.some((f) => f.roomName === 'Salle de Bains' && f.fixtureKind === 'water-closet')).toBe(true)
    expect(plan.fixtures.some((f) => f.roomName === 'WC' && f.fixtureKind === 'water-closet')).toBe(true)
    expect(plan.fixtures.some((f) => f.roomName === 'Séjour / Cuisine' && f.fixtureKind === 'kitchen-sink')).toBe(true)
    expect(plan.fixtures.some((f) => f.roomName === 'Buanderie' && f.fixtureKind === 'clothes-washer')).toBe(true)
    expect(plan.fixtures.some((f) => f.roomName === 'Chambre 1')).toBe(false)

    const fullScene = materializePlan(frenchApt, plan, 'level_0')
    const audit = auditScenePlumbing(fullScene, { codeEdition: 'IPC-2021' })
    expect(audit.errorCount).toBe(0)
  })
})
