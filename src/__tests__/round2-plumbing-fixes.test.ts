import { describe, expect, test } from 'bun:test'
import { auditScenePlumbing } from '../ipc/audit'
import { planPlumbingAutoPopulate } from '../ipc/autopopulate'
import type { SceneNodeLike } from '../ipc/framing-interop'
import {
  buildPlumbingRoofYAt,
  classifyRoomName,
  resolveLevelHeightM,
  routePressurizedPipeRun,
  routeVentRun,
} from '../ipc/routing'
import { getPipeOuterDiameterM } from '../ipc/tables'

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

describe('Round 2 Audit Fixes (R2-PLB-01 & R2-PLB-02)', () => {
  test('R2-PLB-01a: explicit flat/low-slope roof-segment on unwalled upper level keeps Re-Vent and supply runs below real roof', () => {
    const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 8 }
    const scene: Record<string, SceneNodeLike> = {
      bldg_1: { id: 'bldg_1', type: 'building' },
      level_0: { id: 'level_0', type: 'level', parentId: 'bldg_1', level: 0, height: 3.0 },
      // Unwalled roof level above level_0 in the same building (classic Pascal roof-level pattern)
      level_roof: { id: 'level_roof', type: 'level', parentId: 'bldg_1', level: 1 },
      // Explicit flat roof-segment under a rotated parent roof node
      roof_grp: {
        id: 'roof_grp',
        type: 'roof',
        parentId: 'level_roof',
        position: [5, 0, 4],
        rotation: 0,
      },
      roof_seg_flat: {
        id: 'roof_seg_flat',
        type: 'roof-segment',
        parentId: 'roof_grp',
        position: [0, 0, 0],
        rotation: 0,
        width: 10.4,
        depth: 8.4,
        roofType: 'flat',
        pitch: 0,
        overhang: 0.35,
      },
      // Walls with explicit 2.6m height (must beat level_0.height = 3.0m via resolveLevelHeightM)
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], thickness: 0.165, height: 2.6 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 8], end: [10, 8], thickness: 0.165, height: 2.6 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 8], thickness: 0.165, height: 2.6 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], thickness: 0.165, height: 2.6 },
      w_mid: { id: 'w_mid', type: 'wall', parentId: 'level_0', start: [5, 0], end: [5, 8], thickness: 0.165, height: 2.6 },
      // Header beam near top of interior wall that previously caused Re-Vent to hop up into a phantom 6/12 gable attic
      hdr_mid: {
        id: 'hdr_mid',
        type: 'structural:beam',
        role: 'header',
        name: 'Header over Interior Door',
        parentId: 'level_0',
        start: [5, 1.0],
        end: [5, 6.5],
        elevationY: 2.38,
        widthIn: 3.5,
        depthIn: 7.25,
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

    // 1. resolveLevelHeightM prefers explicit maxWallH (2.6) over level.height (3.0)
    expect(resolveLevelHeightM(scene, 'level_0')).toBe(2.6)

    // 2. buildPlumbingRoofYAt evaluates the flat roof-segment on unwalled level_roof (2.6m everywhere, NOT 6/12 gable 4.6m)
    const roofYAt = buildPlumbingRoofYAt(scene, 'level_0', bounds, 2.6, 6)
    expect(roofYAt(5, 4)).toBeCloseTo(2.6, 3)
    expect(roofYAt(2, 2)).toBeCloseTo(2.6, 3)

    // 3. End-to-end autopopulate on slab keeps EVERY non-main-stack Re-Vent & supply pipe strictly under 2.6 - 0.08
    const plan = planPlumbingAutoPopulate(scene, { levelId: 'level_0', foundationType: 'slab' })
    const reVents = plan.pipeRuns.filter((r) => r.system === 'dwv-vent' && !r.isMainVentStack)
    expect(reVents.length).toBeGreaterThan(0)

    for (const run of plan.pipeRuns) {
      if (run.isMainVentStack) continue
      const pipeRadiusM = getPipeOuterDiameterM(run.nominalSize, run.material) / 2
      for (const pt of run.path) {
        if (pt[0] >= 0 && pt[0] <= 10 && pt[2] >= 0 && pt[2] <= 8) {
          expect(pt[1] + pipeRadiusM).toBeLessThanOrEqual(roofYAt(pt[0], pt[2]) - 0.08 + 0.01)
        }
      }
    }

    const fullScene = materializePlan(scene, plan, 'level_0')
    const audit = auditScenePlumbing(fullScene, { codeEdition: 'IPC-2021' })
    expect(audit.errorCount).toBe(0)
  })

  test('R2-PLB-01b: roofPitchRise === 0 is treated as flat (0, not fallback 6) and shed roof-segment slope is honored', () => {
    const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 8 }
    const flatAssemblyScene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', level: 0 },
      asm_0: { id: 'asm_0', type: 'structural:assembly', parentId: 'level_0', roofPitchRise: 0 },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], thickness: 0.165, height: 2.7 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 8], end: [10, 8], thickness: 0.165, height: 2.7 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 8], thickness: 0.165, height: 2.7 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], thickness: 0.165, height: 2.7 },
      // High header beam at 2.42m forces routeVentRun to evaluate roof cap rather than hopping to 2.7 + 0.28
      hdr_center: {
        id: 'hdr_center',
        type: 'structural:beam',
        role: 'header',
        name: 'Center Header',
        parentId: 'level_0',
        start: [4, 0],
        end: [4, 8],
        elevationY: 2.46,
        widthIn: 3.5,
        depthIn: 7.25,
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
        polygon: [[4, 0], [10, 0], [10, 4], [4, 4]],
      },
    }

    const flatRoofYAt = buildPlumbingRoofYAt(flatAssemblyScene, 'level_0', bounds, 2.7, 0)
    expect(flatRoofYAt(5, 4)).toBeCloseTo(2.7, 4)

    const plan = planPlumbingAutoPopulate(flatAssemblyScene, { levelId: 'level_0', foundationType: 'slab' })
    for (const run of plan.pipeRuns) {
      if (run.isMainVentStack) continue
      const pipeRadiusM = getPipeOuterDiameterM(run.nominalSize, run.material) / 2
      for (const pt of run.path) {
        if (pt[0] >= 0 && pt[0] <= 10 && pt[2] >= 0 && pt[2] <= 8) {
          expect(pt[1] + pipeRadiusM).toBeLessThanOrEqual(2.7 - 0.08 + 0.01)
        }
      }
    }

    // Direct shed roof-segment test: low eave on +Z side dips down to 2.35m while high side rises
    const shedScene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', level: 0 },
      roof_shed: {
        id: 'roof_shed',
        type: 'roof-segment',
        parentId: 'level_0',
        position: [5, 2.35, 4],
        rotation: 0,
        width: 10,
        depth: 8,
        roofType: 'shed',
        pitch: 5,
        overhang: 0.35,
      },
    }
    const shedRoofYAt = buildPlumbingRoofYAt(shedScene, 'level_0', bounds, 2.7, 6)
    expect(shedRoofYAt(5, 7.5)).toBeLessThan(2.5)
    expect(shedRoofYAt(5, 0.5)).toBeGreaterThan(shedRoofYAt(5, 7.5))

    const ventUnderShed = routeVentRun({
      from: [2, 0.5, 7.2],
      stackPoint: [8, 7.2],
      floodRimHeightM: 0.85,
      ceilingHeightM: 2.7,
      nominalSize: '1-1/2"',
      maxRoofYAt: shedRoofYAt,
    })
    for (const pt of ventUnderShed.path) {
      expect(pt[1]).toBeLessThanOrEqual(shedRoofYAt(pt[0], pt[2]) - 0.08)
    }

    const supplyUnderShed = routePressurizedPipeRun({
      from: [2, 1.35, 7.2],
      to: [8, 0.6, 7.2],
      routingPlaneY: 2.5,
      nominalSize: '3/4"',
      material: 'pex-a',
      euclideanInCavity: false,
      maxRoofYAt: shedRoofYAt,
    })
    for (const pt of supplyUnderShed.path) {
      expect(pt[1]).toBeLessThanOrEqual(shedRoofYAt(pt[0], pt[2]) - 0.08)
    }

    // Default fallback when neither walls nor level specify height aligns with Structural (2.7m)
    expect(resolveLevelHeightM({ level_0: { id: 'level_0', type: 'level' } }, 'level_0')).toBe(2.7)
  })

  test('R2-PLB-02: compound indoor wet/habitable names stay indoor, pure exterior stays exterior, and Fuel Gas respects buildingBounds', () => {
    // Compound indoor names MUST NOT return 'exterior' early
    expect(classifyRoomName('Pool Bathroom')).toBe('bathroom')
    expect(classifyRoomName('Garden Bath')).toBe('bathroom')
    expect(classifyRoomName('Patio Kitchen')).toBe('kitchen')
    expect(classifyRoomName('Pool WC')).toBe('half-bath')
    expect(classifyRoomName('Garden Laundry')).toBe('laundry')
    expect(classifyRoomName('Pool Utility')).toBe('utility')
    expect(classifyRoomName('Garden Bedroom')).toBe('bedroom')
    expect(classifyRoomName('Terrace Living Room')).toBe('living')
    expect(classifyRoomName('Patio Dining')).toBe('living')
    expect(classifyRoomName('Garden Office')).toBe('living')

    // Pure exterior names remain 'exterior'
    expect(classifyRoomName('Pool')).toBe('exterior')
    expect(classifyRoomName('Swimming Pool')).toBe('exterior')
    expect(classifyRoomName('Patio')).toBe('exterior')
    expect(classifyRoomName('Terrace')).toBe('exterior')
    expect(classifyRoomName('Balcony')).toBe('exterior')
    expect(classifyRoomName('Garden')).toBe('exterior')
    expect(classifyRoomName('Yard')).toBe('exterior')

    // End-to-end: Pool Bathroom gets fixtures, Swimming Pool is excluded, and Fuel Gas detours stay inside buildingBounds
    const scene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.7 },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], thickness: 0.165, height: 2.7 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 8], end: [10, 8], thickness: 0.165, height: 2.7 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 8], thickness: 0.165, height: 2.7 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], thickness: 0.165, height: 2.7 },
      w_div: { id: 'w_div', type: 'wall', parentId: 'level_0', start: [5, 0], end: [5, 8], thickness: 0.165, height: 2.7 },
      // Structural column near perimeter wall on gas route path to force detour inside bounds
      col_near_edge: {
        id: 'col_near_edge',
        type: 'structural:column',
        name: 'Perimeter Column',
        parentId: 'level_0',
        position: [1.2, 0, 7.4],
        widthIn: 8,
        depthIn: 8,
        heightM: 2.7,
      },
      // Gas furnace near south-east corner
      hvac_furnace: {
        id: 'hvac_furnace',
        type: 'hvac:equipment',
        name: 'Gas Furnace',
        parentId: 'level_0',
        position: [9.4, 0, 7.5],
        gasBtuh: 80000,
      },
      z_pool_bath: {
        id: 'z_pool_bath',
        type: 'zone',
        name: 'Pool Bathroom',
        parentId: 'level_0',
        polygon: [[0, 0], [5, 0], [5, 4], [0, 4]],
      },
      z_utility: {
        id: 'z_utility',
        type: 'zone',
        name: 'Utility',
        parentId: 'level_0',
        polygon: [[0, 4], [5, 4], [5, 8], [0, 8]],
      },
      z_ext_pool: {
        id: 'z_ext_pool',
        type: 'zone',
        name: 'Swimming Pool',
        parentId: 'level_0',
        polygon: [[11, 0], [18, 0], [18, 8], [11, 8]],
      },
    }

    const plan = planPlumbingAutoPopulate(scene, {
      levelId: 'level_0',
      waterHeaterKind: 'water-heater-tank-gas',
      includeFuelGas: true,
    })

    // Pool Bathroom receives fixtures; Swimming Pool does not
    expect(plan.fixtures.some((f) => f.roomName === 'Pool Bathroom' && f.fixtureKind === 'water-closet')).toBe(true)
    expect(plan.fixtures.some((f) => f.roomName === 'Swimming Pool')).toBe(false)

    // Fuel gas runs stay strictly within buildingBounds (allowing only the exterior gas-meter entry stub at minX - 0.15)
    const gasRuns = plan.pipeRuns.filter((r) => r.system === 'fuel-gas')
    expect(gasRuns.length).toBeGreaterThanOrEqual(2)
    for (const run of gasRuns) {
      for (const pt of run.path) {
        expect(pt[0]).toBeGreaterThanOrEqual(-0.2)
        expect(pt[0]).toBeLessThanOrEqual(10.05)
        expect(pt[2]).toBeGreaterThanOrEqual(-0.05)
        expect(pt[2]).toBeLessThanOrEqual(8.05)
      }
    }

    const fullScene = materializePlan(scene, plan, 'level_0')
    const audit = auditScenePlumbing(fullScene, { codeEdition: 'IPC-2021' })
    expect(audit.errorCount).toBe(0)
  })

  test('Phase 3A-2 kernel delegation: buildPlumbingRoofYAt fixes baseElevation: 0 story ordering and supports all 7 roof types', () => {
    const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 8 }

    // 1. Multi-story baseElevation: 0 trap: level_0 & level_1 both have baseElevation: 0, distinguished only by `level` ordinal
    const multiStoryZeroBase: Record<string, SceneNodeLike> = {
      bldg_1: { id: 'bldg_1', type: 'building' },
      level_0: { id: 'level_0', type: 'level', parentId: 'bldg_1', level: 0, baseElevation: 0, height: 2.7 },
      level_1: { id: 'level_1', type: 'level', parentId: 'bldg_1', level: 1, baseElevation: 0, height: 2.7 },
      level_roof: { id: 'level_roof', type: 'level', parentId: 'bldg_1', level: 2, baseElevation: 0 },
      w0: { id: 'w0', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], height: 2.7 },
      w1: { id: 'w1', type: 'wall', parentId: 'level_1', start: [0, 0], end: [10, 0], height: 2.7 },
      roof_top_hip: {
        id: 'roof_top_hip',
        type: 'roof-segment',
        parentId: 'level_roof',
        position: [5, 0, 4],
        width: 10,
        depth: 8,
        roofType: 'hip',
        pitch: 30,
        overhang: 0.35,
      },
    }

    // Lower story must get flat wallH fallback (2.7 m), never adopting level_roof or synthetic gable
    const lowerRoofYAt = buildPlumbingRoofYAt(multiStoryZeroBase, 'level_0', bounds, 2.7, 6)
    expect(lowerRoofYAt(5, 4)).toBeCloseTo(2.7, 4)

    // Upper story adopts the hip roof from unwalled level_roof: slopes down toward BOTH X and Z eaves
    const upperRoofYAt = buildPlumbingRoofYAt(multiStoryZeroBase, 'level_1', bounds, 2.7, 6)
    expect(upperRoofYAt(5, 4)).toBeGreaterThan(4.5)
    expect(upperRoofYAt(0.5, 4)).toBeLessThan(upperRoofYAt(5, 4) - 1.5) // Hip end slope along X

    // 2. Mansard, Dutch, and Conical roof types evaluate finite, distinct roof surfaces
    for (const roofType of ['dutch', 'mansard', 'conical'] as const) {
      const scene: Record<string, SceneNodeLike> = {
        level_0: { id: 'level_0', type: 'level', level: 0 },
        seg: {
          id: 'seg',
          type: 'roof-segment',
          parentId: 'level_0',
          position: [5, 0, 4],
          width: 10,
          depth: 8,
          roofType,
          pitch: 30,
          overhang: 0.35,
        },
      }
      const roofYAt = buildPlumbingRoofYAt(scene, 'level_0', bounds, 2.7, 6)
      expect(roofYAt(5, 4)).toBeGreaterThan(2.7)
      expect(roofYAt(5, 4)).toBeGreaterThan(roofYAt(5, 7.8))
    }
  })
})
