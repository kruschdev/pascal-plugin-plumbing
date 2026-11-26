import { describe, expect, test } from 'bun:test'
import { auditScenePlumbing } from '../ipc/audit'
import { isGroundOrLowestWalledLevel, planPlumbingAutoPopulate } from '../ipc/autopopulate'
import type { SceneNodeLike } from '../ipc/framing-interop'
import { extractWallSegments } from '../ipc/routing'

function materializePlan(
  base: Record<string, SceneNodeLike>,
  plan: ReturnType<typeof planPlumbingAutoPopulate>,
  levelId: string,
): Record<string, SceneNodeLike> {
  const full: Record<string, SceneNodeLike> = { ...base }
  for (const eq of plan.equipment) full[eq.id] = { ...eq, type: 'plumbing:equipment', parentId: levelId }
  for (const m of plan.manifolds) full[m.id] = { ...m, type: 'plumbing:manifold', parentId: levelId }
  for (const f of plan.fixtures) full[f.id] = { ...f, type: 'plumbing:fixture', parentId: levelId }
  for (const r of plan.pipeRuns) full[r.id] = { ...r, type: 'plumbing:pipe-run', parentId: levelId }
  return full
}

function buildMultiStoryScene(): Record<string, SceneNodeLike> {
  return {
    bldg_1: { id: 'bldg_1', type: 'building' },
    level_0: { id: 'level_0', type: 'level', name: 'Main floor', parentId: 'bldg_1', level: 0, height: 2.7 },
    level_1: { id: 'level_1', type: 'level', name: 'Floor 1', parentId: 'bldg_1', level: 1, height: 2.7 },
    level_2: { id: 'level_2', type: 'level', name: 'Floor 2', parentId: 'bldg_1', level: 2, height: 2.7 },

    // Main floor (0..12 x 0..10)
    w0_n: { id: 'w0_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [12, 0], thickness: 0.165, height: 2.7 },
    w0_s: { id: 'w0_s', type: 'wall', parentId: 'level_0', start: [0, 10], end: [12, 10], thickness: 0.165, height: 2.7 },
    w0_w: { id: 'w0_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 10], thickness: 0.165, height: 2.7 },
    w0_e: { id: 'w0_e', type: 'wall', parentId: 'level_0', start: [12, 0], end: [12, 10], thickness: 0.165, height: 2.7 },
    w0_mid: { id: 'w0_mid', type: 'wall', parentId: 'level_0', start: [6, 0], end: [6, 10], thickness: 0.165, height: 2.7 },
    z0_kit: {
      id: 'z0_kit',
      type: 'zone',
      name: 'Kitchen',
      parentId: 'level_0',
      polygon: [[0, 0], [6, 0], [6, 5], [0, 5]],
    },
    z0_bath: {
      id: 'z0_bath',
      type: 'zone',
      name: 'Half Bath',
      parentId: 'level_0',
      polygon: [[6, 0], [12, 0], [12, 5], [6, 5]],
    },

    // Floor 1 (0..12 x 0..10)
    w1_n: { id: 'w1_n', type: 'wall', parentId: 'level_1', start: [0, 0], end: [12, 0], thickness: 0.165, height: 2.7 },
    w1_s: { id: 'w1_s', type: 'wall', parentId: 'level_1', start: [0, 10], end: [12, 10], thickness: 0.165, height: 2.7 },
    w1_w: { id: 'w1_w', type: 'wall', parentId: 'level_1', start: [0, 0], end: [0, 10], thickness: 0.165, height: 2.7 },
    w1_e: { id: 'w1_e', type: 'wall', parentId: 'level_1', start: [12, 0], end: [12, 10], thickness: 0.165, height: 2.7 },
    w1_mid: { id: 'w1_mid', type: 'wall', parentId: 'level_1', start: [6, 0], end: [6, 10], thickness: 0.165, height: 2.7 },
    z1_bath: {
      id: 'z1_bath',
      type: 'zone',
      name: 'Master Bathroom',
      parentId: 'level_1',
      polygon: [[6, 0], [12, 0], [12, 5], [6, 5]],
    },

    // Floor 2 (2..10 x 2..8 — stepped-in upper tower/attic story)
    w2_n: { id: 'w2_n', type: 'wall', parentId: 'level_2', start: [2, 2], end: [10, 2], thickness: 0.165, height: 2.7 },
    w2_s: { id: 'w2_s', type: 'wall', parentId: 'level_2', start: [2, 8], end: [10, 8], thickness: 0.165, height: 2.7 },
    w2_w: { id: 'w2_w', type: 'wall', parentId: 'level_2', start: [2, 2], end: [2, 8], thickness: 0.165, height: 2.7 },
    w2_e: { id: 'w2_e', type: 'wall', parentId: 'level_2', start: [10, 2], end: [10, 8], thickness: 0.165, height: 2.7 },
    z2_bath: {
      id: 'z2_bath',
      type: 'zone',
      name: 'Bathroom',
      parentId: 'level_2',
      polygon: [[6, 2], [10, 2], [10, 6], [6, 6]],
    },
  }
}

describe('Round 3 Visual Fixes (VIS-V3-09 & Concave Footprint Containment)', () => {
  test('isGroundOrLowestWalledLevel classifies ground, upper, unwalled, missing, and sibling-building levels', () => {
    const multi = buildMultiStoryScene()
    expect(isGroundOrLowestWalledLevel(multi, null)).toBe(true)
    expect(isGroundOrLowestWalledLevel(multi, 'missing_lvl')).toBe(true)
    expect(isGroundOrLowestWalledLevel(multi, 'level_0')).toBe(true)
    expect(isGroundOrLowestWalledLevel(multi, 'level_1')).toBe(false)
    expect(isGroundOrLowestWalledLevel(multi, 'level_2')).toBe(false)

    // Unwalled pad level below a walled main floor does not make main floor an upper story
    const withUnwalledPad: Record<string, SceneNodeLike> = {
      bldg_1: { id: 'bldg_1', type: 'building' },
      pad_0: { id: 'pad_0', type: 'level', parentId: 'bldg_1', level: 0 },
      main_1: { id: 'main_1', type: 'level', parentId: 'bldg_1', level: 1 },
      upper_2: { id: 'upper_2', type: 'level', parentId: 'bldg_1', level: 2 },
      w_m1: { id: 'w_m1', type: 'wall', parentId: 'main_1', start: [0, 0], end: [6, 0], thickness: 0.165, height: 2.7 },
      w_u2: { id: 'w_u2', type: 'wall', parentId: 'upper_2', start: [0, 0], end: [6, 0], thickness: 0.165, height: 2.7 },
      // Separate sibling building must not interfere
      bldg_2: { id: 'bldg_2', type: 'building' },
      b2_main: { id: 'b2_main', type: 'level', parentId: 'bldg_2', level: 2 },
      w_b2: { id: 'w_b2', type: 'wall', parentId: 'b2_main', start: [20, 0], end: [26, 0], thickness: 0.165, height: 2.7 },
    }
    expect(isGroundOrLowestWalledLevel(withUnwalledPad, 'main_1')).toBe(true)
    expect(isGroundOrLowestWalledLevel(withUnwalledPad, 'upper_2')).toBe(false)
    expect(isGroundOrLowestWalledLevel(withUnwalledPad, 'b2_main')).toBe(true)
  })

  test('VIS-V3-09: multi-story building gates hose bibbs, main-shutoff-prv, water-heater & exterior sewer lateral to ground story only', () => {
    let scene = buildMultiStoryScene()

    // 1. Ground story gets frost-proof hose bibbs, main-shutoff-prv, water heater, expansion tank, and sewer lateral
    const plan0 = planPlumbingAutoPopulate(scene, { levelId: 'level_0', foundationType: 'crawlspace' })
    expect(plan0.fixtures.filter((f) => f.fixtureKind === 'hose-bibb')).toHaveLength(2)
    expect(plan0.equipment.filter((e) => e.equipmentKind === 'main-shutoff-prv')).toHaveLength(1)
    expect(plan0.equipment.filter((e) => e.equipmentKind.startsWith('water-heater-'))).toHaveLength(1)
    expect(plan0.equipment.filter((e) => e.equipmentKind === 'expansion-tank')).toHaveLength(1)
    const mainDrain0 = plan0.pipeRuns.find((r) => r.system === 'dwv-drain' && /Main Building Drain/i.test(r.name))
    expect(mainDrain0).toBeDefined()
    for (const pt of mainDrain0!.path) {
      expect(pt[1]).toBeLessThan(-0.15)
    }
    scene = materializePlan(scene, plan0, 'level_0')

    // 2. Floor 1 gets ZERO exterior hose bibbs, ZERO main-shutoff-prv, ZERO duplicate water heater, ZERO exterior sewer lateral
    const plan1 = planPlumbingAutoPopulate(scene, { levelId: 'level_1', foundationType: 'crawlspace' })
    expect(plan1.fixtures.filter((f) => f.fixtureKind === 'hose-bibb')).toHaveLength(0)
    expect(plan1.equipment.filter((e) => e.equipmentKind === 'main-shutoff-prv')).toHaveLength(0)
    expect(plan1.equipment.filter((e) => e.equipmentKind.startsWith('water-heater-'))).toHaveLength(0)
    expect(plan1.equipment.filter((e) => e.equipmentKind === 'expansion-tank')).toHaveLength(0)
    expect(plan1.pipeRuns.some((r) => /Main Building Drain|Sewer Exit/i.test(r.name))).toBe(false)
    // Every pipe run on Floor 1 must stay strictly inside [0..12, 0..10]
    for (const run of plan1.pipeRuns) {
      for (const pt of run.path) {
        expect(pt[0]).toBeGreaterThanOrEqual(-0.05)
        expect(pt[0]).toBeLessThanOrEqual(12.05)
        expect(pt[2]).toBeGreaterThanOrEqual(-0.05)
        expect(pt[2]).toBeLessThanOrEqual(10.05)
      }
    }
    scene = materializePlan(scene, plan1, 'level_1')

    // 3. Floor 2 (stepped-in 2..10 x 2..8 footprint) stays strictly inside its own walls too
    const plan2 = planPlumbingAutoPopulate(scene, {
      levelId: 'level_2',
      supplyTopology: 'trunk-and-branch',
      foundationType: 'slab',
    })
    expect(plan2.fixtures.filter((f) => f.fixtureKind === 'hose-bibb')).toHaveLength(0)
    expect(plan2.equipment.filter((e) => e.equipmentKind === 'main-shutoff-prv')).toHaveLength(0)
    expect(plan2.equipment.filter((e) => e.equipmentKind.startsWith('water-heater-'))).toHaveLength(0)
    expect(plan2.pipeRuns.some((r) => /Main Building Drain|Sewer Exit/i.test(r.name))).toBe(false)
    for (const run of plan2.pipeRuns) {
      for (const pt of run.path) {
        expect(pt[0]).toBeGreaterThanOrEqual(1.95)
        expect(pt[0]).toBeLessThanOrEqual(10.05)
        expect(pt[2]).toBeGreaterThanOrEqual(1.95)
        expect(pt[2]).toBeLessThanOrEqual(8.05)
      }
    }
    scene = materializePlan(scene, plan2, 'level_2')

    // 4. Full 3-story audit passes with ZERO errors and ZERO warnings
    const audit = auditScenePlumbing(scene, { codeEdition: 'IPC-2021' })
    expect(audit.errorCount).toBe(0)
    expect(audit.warningCount).toBe(0)
  })

  test('VIS-V3-09: standalone upper-story run (before ground story has plumbing) omits hose bibbs, main-shutoff-prv, exterior sewer & gas-meter, and passes audit', () => {
    const scene = buildMultiStoryScene()
    scene.upstairs_furnace = {
      id: 'upstairs_furnace',
      type: 'hvac:equipment',
      name: 'Attic Gas Furnace',
      parentId: 'level_1',
      position: [2.0, 0, 2.0],
      gasBtuh: 60000,
    }

    const plan1 = planPlumbingAutoPopulate(scene, {
      levelId: 'level_1',
      includeFuelGas: true,
    })
    expect(plan1.fixtures.filter((f) => f.fixtureKind === 'hose-bibb')).toHaveLength(0)
    expect(plan1.equipment.filter((e) => e.equipmentKind === 'main-shutoff-prv')).toHaveLength(0)
    expect(plan1.equipment.filter((e) => e.equipmentKind === 'gas-meter')).toHaveLength(0)
    expect(plan1.pipeRuns.some((r) => /Main Building Drain|Sewer Exit/i.test(r.name))).toBe(false)
    for (const run of plan1.pipeRuns) {
      for (const pt of run.path) {
        expect(pt[0]).toBeGreaterThanOrEqual(-0.05)
        expect(pt[0]).toBeLessThanOrEqual(12.05)
        expect(pt[2]).toBeGreaterThanOrEqual(-0.05)
        expect(pt[2]).toBeLessThanOrEqual(10.05)
      }
    }

    const materialized = materializePlan(scene, plan1, 'level_1')
    const audit = auditScenePlumbing(materialized, { codeEdition: 'IPC-2021' })
    expect(audit.errorCount).toBe(0)
  })

  test('Single-story standalone building keeps 2 frost-proof hose bibbs, main-shutoff-prv, water heater, and 0 audit errors (zero regression)', () => {
    const singleStory: Record<string, SceneNodeLike> = {
      bldg_1: { id: 'bldg_1', type: 'building' },
      level_0: { id: 'level_0', type: 'level', name: 'Ground Floor', parentId: 'bldg_1', level: 0, height: 2.7 },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], thickness: 0.165, height: 2.7 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 8], end: [10, 8], thickness: 0.165, height: 2.7 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 8], thickness: 0.165, height: 2.7 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], thickness: 0.165, height: 2.7 },
      w_div: { id: 'w_div', type: 'wall', parentId: 'level_0', start: [5, 0], end: [5, 8], thickness: 0.165, height: 2.7 },
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

    const plan = planPlumbingAutoPopulate(singleStory, { levelId: 'level_0' })
    expect(plan.fixtures.filter((f) => f.fixtureKind === 'hose-bibb')).toHaveLength(2)
    expect(plan.equipment.filter((e) => e.equipmentKind === 'main-shutoff-prv')).toHaveLength(1)
    expect(plan.equipment.filter((e) => e.equipmentKind.startsWith('water-heater-'))).toHaveLength(1)
    expect(plan.equipment.filter((e) => e.equipmentKind === 'expansion-tank')).toHaveLength(1)

    const full = materializePlan(singleStory, plan, 'level_0')
    const audit = auditScenePlumbing(full, { codeEdition: 'IPC-2021' })
    expect(audit.errorCount).toBe(0)
  })

  test('Concave L-shaped & U-shaped buildings snap hose bibbs flush to actual exterior walls and keep DWV drains below slab', () => {
    // L-shaped footprint: main wing [0..12, 0..5] + south-west wing [0..4, 5..12]; empty L-cutout at (4..12, 5..12)
    const lShaped: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', level: 0, height: 3.0 },
      w_north: { id: 'w_north', type: 'wall', parentId: 'level_0', start: [0, 0], end: [12, 0], thickness: 0.2, height: 3.0 },
      w_east_wing: { id: 'w_east_wing', type: 'wall', parentId: 'level_0', start: [12, 0], end: [12, 5], thickness: 0.2, height: 3.0 },
      w_inner_h: { id: 'w_inner_h', type: 'wall', parentId: 'level_0', start: [4, 5], end: [12, 5], thickness: 0.2, height: 3.0 },
      w_inner_v: { id: 'w_inner_v', type: 'wall', parentId: 'level_0', start: [4, 5], end: [4, 12], thickness: 0.2, height: 3.0 },
      w_south_wing: { id: 'w_south_wing', type: 'wall', parentId: 'level_0', start: [0, 12], end: [4, 12], thickness: 0.2, height: 3.0 },
      w_west: { id: 'w_west', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 12], thickness: 0.2, height: 3.0 },
      z_bath: {
        id: 'z_bath',
        type: 'zone',
        name: 'Restroom',
        parentId: 'level_0',
        polygon: [[0, 0], [4, 0], [4, 5], [0, 5]],
      },
      z_hall: {
        id: 'z_hall',
        type: 'zone',
        name: 'Gym Hall',
        parentId: 'level_0',
        polygon: [[4, 0], [12, 0], [12, 5], [4, 5]],
      },
    }

    const planL = planPlumbingAutoPopulate(lShaped, { levelId: 'level_0', foundationType: 'slab' })
    const bibbsL = planL.fixtures.filter((f) => f.fixtureKind === 'hose-bibb')
    expect(bibbsL).toHaveLength(2)

    const wallsL = extractWallSegments(lShaped, 'level_0')
    const wallMapL = new Map(wallsL.map((w) => [w.id, w]))
    for (const bibb of bibbsL) {
      expect(bibb.wallId).toBeDefined()
      const host = wallMapL.get(bibb.wallId!)!
      expect(host).toBeDefined()
      // Verify hose bibb projects strictly onto the host wall segment [0, lengthM] and sits flush at its exterior face
      const dx = bibb.position[0] - host.start[0]
      const dz = bibb.position[2] - host.start[1]
      const along = dx * host.ux + dz * host.uz
      const perp = Math.abs(dx * host.nx + dz * host.nz)
      expect(along).toBeGreaterThanOrEqual(0.15)
      expect(along).toBeLessThanOrEqual(host.lengthM - 0.15)
      expect(perp).toBeLessThanOrEqual(host.thicknessM / 2 + 0.05)
    }
    // Specifically verify front hose bibb snapped onto w_south_wing (x in [0..4]), NOT floating in L-cutout (x = 6)!
    const frontL = bibbsL.find((b) => /Front/i.test(b.name))!
    expect(frontL.wallId).toBe('w_south_wing')
    expect(frontL.position[0]).toBeGreaterThanOrEqual(0.25)
    expect(frontL.position[0]).toBeLessThanOrEqual(3.75)

    // Verify Main Building Drain exits through actual east wall span (z in [0..5]) and stays strictly below slab (y < -0.15)
    const mainDrainL = planL.pipeRuns.find((r) => r.system === 'dwv-drain' && /Main Building Drain/i.test(r.name))!
    expect(mainDrainL).toBeDefined()
    const exitPtL = mainDrainL.path[mainDrainL.path.length - 1]!
    expect(exitPtL[2]).toBeGreaterThanOrEqual(0.2)
    expect(exitPtL[2]).toBeLessThanOrEqual(4.8)
    for (const run of planL.pipeRuns.filter((r) => r.system === 'dwv-drain')) {
      for (let i = 1; i < run.path.length; i++) {
        const a = run.path[i - 1]!
        const b = run.path[i]!
        const horiz = Math.hypot(b[0] - a[0], b[2] - a[2])
        if (horiz > 0.25) {
          expect(Math.max(a[1], b[1])).toBeLessThan(-0.15)
        }
      }
    }
    expect(auditScenePlumbing(materializePlan(lShaped, planL, 'level_0')).errorCount).toBe(0)

    // U-shaped footprint: north spine [0..12, 0..4], left wing [0..3.5, 4..10], right wing [8.5..12, 4..10], courtyard (3.5..8.5, 4..10)
    const uShaped: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', level: 0, height: 2.7 },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [12, 0], thickness: 0.18, height: 2.7 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 10], thickness: 0.18, height: 2.7 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [12, 0], end: [12, 10], thickness: 0.18, height: 2.7 },
      w_fl: { id: 'w_fl', type: 'wall', parentId: 'level_0', start: [0, 10], end: [3.5, 10], thickness: 0.18, height: 2.7 },
      w_fr: { id: 'w_fr', type: 'wall', parentId: 'level_0', start: [8.5, 10], end: [12, 10], thickness: 0.18, height: 2.7 },
      w_cl: { id: 'w_cl', type: 'wall', parentId: 'level_0', start: [3.5, 4], end: [3.5, 10], thickness: 0.18, height: 2.7 },
      w_cr: { id: 'w_cr', type: 'wall', parentId: 'level_0', start: [8.5, 4], end: [8.5, 10], thickness: 0.18, height: 2.7 },
      w_cb: { id: 'w_cb', type: 'wall', parentId: 'level_0', start: [3.5, 4], end: [8.5, 4], thickness: 0.18, height: 2.7 },
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
        polygon: [[8, 0], [12, 0], [12, 4], [8, 4]],
      },
    }

    const planU = planPlumbingAutoPopulate(uShaped, { levelId: 'level_0', foundationType: 'crawlspace' })
    const frontU = planU.fixtures.find((f) => f.fixtureKind === 'hose-bibb' && /Front/i.test(f.name))!
    expect(frontU).toBeDefined()
    // Must snap onto left wing [0..3.5] or right wing [8.5..12], NEVER float in U-courtyard (3.5..8.5)!
    const onWing =
      (frontU.position[0] >= 0.2 && frontU.position[0] <= 3.3) ||
      (frontU.position[0] >= 8.7 && frontU.position[0] <= 11.8)
    expect(onWing).toBe(true)
    expect(auditScenePlumbing(materializePlan(uShaped, planU, 'level_0')).errorCount).toBe(0)
  })
})
