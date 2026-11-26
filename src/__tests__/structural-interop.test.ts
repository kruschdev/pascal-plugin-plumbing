import { describe, expect, test } from 'bun:test'
import {
  type SceneNodeLike,
  computePipeFramingPenetrations,
  extractBonesPlumbingContext,
} from '../ipc/framing-interop'
import { extractPlumbingObstacles, extractWallSegments } from '../ipc/routing'

describe('Priority #1 @kruschdev/pascal-plugin-structural Interop (Plumbing)', () => {
  test('prefers structural:assembly over bones:framing and preserves floorSystem + wet-wall/bearing flags', () => {
    const nodes = {
      lvl1: { id: 'lvl1', type: 'level' },
      bones1: { id: 'bones1', type: 'bones:framing', parentId: 'lvl1', studSpacingIn: 24 },
      str1: {
        id: 'str1',
        type: 'structural:assembly',
        parentId: 'lvl1',
        studSpacingIn: 16,
        floorSystem: 'tji-ijoist',
        wallOverrides: {
          w_wet: { construction: 'wood-framed', studSpacingIn: 16, isLoadBearing: true, isWetWall: true },
        },
      },
    }
    const ctx = extractBonesPlumbingContext(nodes, 'lvl1')
    expect(ctx.framingPresent).toBe(true)
    expect(ctx.source).toBe('structural')
    expect(ctx.floorSystem).toBe('tji-ijoist')
    expect(ctx.wallRules.get('w_wet')?.isWetWall).toBe(true)
    expect(ctx.wallRules.get('w_wet')?.isLoadBearing).toBe(true)
  })

  test('extracts structural:beam & structural:column as hard structural obstacles and flags R302.11(5) plate firestopping', () => {
    const nodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      str1: { id: 'str1', type: 'structural:assembly', parentId: 'lvl1', studSpacingIn: 16 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [5, 0], height: 2.74, thickness: 0.165 },
      bm1: {
        id: 'bm1',
        type: 'structural:beam',
        parentId: 'lvl1',
        start: [0, 4],
        end: [6, 4],
        elevationY: 2.4,
        widthIn: 5.25,
        depthIn: 14,
        designation: '5-1/4"x14" 2.0E PSL',
      },
      col1: {
        id: 'col1',
        type: 'structural:column',
        parentId: 'lvl1',
        position: [0, 0, 4],
        widthIn: 5.5,
        depthIn: 5.5,
        heightM: 2.74,
        designation: '6x6 DF-L #2 Post',
      },
    }

    const obs = extractPlumbingObstacles(nodes, 'lvl1')
    expect(obs.some((o) => o.id === 'bm1' && o.category === 'structural')).toBe(true)
    expect(obs.some((o) => o.id === 'col1' && o.category === 'structural')).toBe(true)

    const ctx = extractBonesPlumbingContext(nodes, 'lvl1')
    const walls = extractWallSegments(nodes, 'lvl1')
    const pens = computePipeFramingPenetrations({
      pipeRunId: 'pipe_stack',
      path: [
        [2, -0.2, 0],
        [2, 2.9, 0],
      ],
      pipeSize: '2"',
      material: 'pvc-dwv',
      walls,
      bonesContext: ctx,
    })
    expect(pens.some((p) => p.memberKind === 'top-plate' && p.codeRef.includes('R302.11(5)'))).toBe(true)
  })

  test('R1-BUG-12 & R1-BUG-07: handles string-shorthand wallOverrides, maps shear-wall to isLoadBearing, and subdivides diagonal structural:beam', () => {
    const nodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      str1: {
        id: 'str1',
        type: 'structural:assembly',
        parentId: 'lvl1',
        studSpacingIn: 24,
        wallOverrides: {
          w_shorthand_shear: 'shear-wall',
          w_shorthand_cmu: 'cmu',
          w_obj_shear: { construction: 'shear-wall', studSpacingIn: 16 },
        },
      },
      bm_diag: {
        id: 'bm_diag',
        type: 'structural:beam',
        parentId: 'lvl1',
        start: [0, 0],
        end: [6, 6],
        elevationY: 2.5,
        widthIn: 3.5,
        depthIn: 11.875,
        designation: 'Hip Beam',
      },
    }
    const ctx = extractBonesPlumbingContext(nodes, 'lvl1')
    expect(ctx.wallRules.get('w_shorthand_shear')?.isLoadBearing).toBe(true)
    expect(ctx.wallRules.get('w_shorthand_cmu')?.construction).toBe('cmu')
    expect(ctx.wallRules.get('w_obj_shear')?.isLoadBearing).toBe(true)
    expect(ctx.wallRules.get('w_obj_shear')?.spacingIn).toBe(16)

    const obs = extractPlumbingObstacles(nodes, 'lvl1').filter((o) => o.id.startsWith('bm_diag:seg'))
    expect(obs.length).toBeGreaterThanOrEqual(4)
    // Far corner (0, 6) must NOT fall inside any subdivided diagonal beam box
    const coversFarCorner = obs.some(
      (o) => 0 >= o.box.minX && 0 <= o.box.maxX && 6 >= o.box.minZ && 6 <= o.box.maxZ,
    )
    expect(coversFarCorner).toBe(false)
  })
})
