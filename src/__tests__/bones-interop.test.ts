import { describe, expect, test } from 'bun:test'
import {
  type SceneNodeLike,
  checkWetWallPipeFit,
  computePipeFramingPenetrations,
  extractBonesPlumbingContext,
  getEquipmentElectricalDemand,
  getFixtureElectricalDemand,
} from '../ipc/framing-interop'
import { extractWallSegments } from '../ipc/routing'

describe('Bones Framing Interop, Stud Bore Penetrations & Electrical Power Demand', () => {
  test('checkWetWallPipeFit rejects 3" PVC in a 2x4 wall and accepts it in a 2x6 wet wall', () => {
    const wall2x4 = checkWetWallPipeFit({
      wallThicknessM: 0.114, // 2x4 framed wall
      pipeSize: '3"',
      material: 'pvc-dwv',
    })
    expect(wall2x4.fits).toBe(false)
    expect(wall2x4.needs2x6WetWall).toBe(true)

    const wall2x6 = checkWetWallPipeFit({
      wallThicknessM: 0.165, // 2x6 wet wall
      pipeSize: '3"',
      material: 'pvc-dwv',
    })
    expect(wall2x6.fits).toBe(true)
    expect(wall2x6.needs2x6WetWall).toBe(false)
  })

  test('extractBonesPlumbingContext reads bones:framing and bones:service plumbing anchors', () => {
    const nodes: Record<string, SceneNodeLike> = {
      level_1: { id: 'level_1', type: 'level' },
      wall_1: { id: 'wall_1', type: 'wall', parentId: 'level_1', start: [0, 0], end: [4, 0], thickness: 0.165, height: 2.6 },
      bf_1: { id: 'bf_1', type: 'bones:framing', parentId: 'level_1', studSpacingIn: 16, framingSystem: 'lumber' },
      bs_wh: { id: 'bs_wh', type: 'bones:service', parentId: 'level_1', serviceType: 'water-heater', wallId: 'wall_1', wallT: 0.25, heightAff: 0 },
      bs_we: { id: 'bs_we', type: 'bones:service', parentId: 'level_1', serviceType: 'water-entry', wallId: 'wall_1', wallT: 0.1, heightAff: 0.75 },
      bs_se: { id: 'bs_se', type: 'bones:service', parentId: 'level_1', serviceType: 'sewer-exit', position: [4.2, -0.45, 0] },
    }
    const ctx = extractBonesPlumbingContext(nodes, 'level_1')
    expect(ctx.framingPresent).toBe(true)
    expect(ctx.hasPlumbingSchematic).toBe(true)
    expect(ctx.waterHeaterAnchor?.nodeId).toBe('bs_wh')
    expect(ctx.waterEntryAnchor?.nodeId).toBe('bs_we')
    expect(ctx.sewerExitAnchor?.nodeId).toBe('bs_se')
  })

  test('computePipeFramingPenetrations reports exact 16" OC studs, sole plate, top plate, and hole-saw sizes', () => {
    const nodes: Record<string, SceneNodeLike> = {
      level_1: { id: 'level_1', type: 'level' },
      wall_1: { id: 'wall_1', type: 'wall', parentId: 'level_1', start: [0, 0], end: [3.2, 0], thickness: 0.165, height: 2.6 },
      bf_1: { id: 'bf_1', type: 'bones:framing', parentId: 'level_1', studSpacingIn: 16, framingSystem: 'lumber' },
    }
    const walls = extractWallSegments(nodes, 'level_1')
    const bones = extractBonesPlumbingContext(nodes, 'level_1')
    // Pipe enters through sole plate at x=0.2, runs horizontally through studs to x=2.2 at y=0.5, then rises through double top plate
    const pens = computePipeFramingPenetrations({
      pipeRunId: 'pipe_test',
      path: [
        [0.2, -0.2, 0],
        [0.2, 0.5, 0],
        [2.2, 0.5, 0],
        [2.2, 2.8, 0],
      ],
      pipeSize: '1/2"',
      material: 'pex-a',
      walls,
      bonesContext: bones,
    })
    expect(pens.some((p) => p.memberKind === 'sole-plate')).toBe(true)
    expect(pens.some((p) => p.memberKind === 'top-plate')).toBe(true)
    expect(pens.filter((p) => p.memberKind === 'stud').length).toBeGreaterThanOrEqual(4)
    expect(pens.every((p) => p.codeCompliant && p.holeSawIn >= 0.75)).toBe(true)
  })

  test('powered plumbing equipment and fixtures emit standardized electricalDemand payloads', () => {
    const wh = getEquipmentElectricalDemand('water-heater-tank-electric', 4500)
    expect(wh?.voltage).toBe(240)
    expect(wh?.poles).toBe(2)
    expect(wh?.breakerAmps).toBe(30)

    const sump = getEquipmentElectricalDemand('sump-pump')
    expect(sump?.gfciRequired).toBe(true)
    expect(sump?.dedicatedCircuit).toBe(true)

    const dw = getFixtureElectricalDemand('dishwasher')
    expect(dw?.breakerAmps).toBe(20)
    expect(dw?.gfciRequired).toBe(true)
  })
})
