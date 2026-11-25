import { describe, expect, test } from 'bun:test'
import { Box3 } from 'three'
import { PLUMBING_CAD_CATALOG, buildPipeRunCad, buildPlumbingCadPart } from '../cad/catalog'

describe('42-Model Clean-Room MIT 3D Plumbing CAD Library', () => {
  test('catalog contains all 42 parts and each builds non-empty 3D geometry with positive bounds', () => {
    expect(PLUMBING_CAD_CATALOG.length).toBe(42)
    const seenIds = new Set<string>()

    for (const part of PLUMBING_CAD_CATALOG) {
      expect(seenIds.has(part.id)).toBe(false)
      seenIds.add(part.id)
      const group = buildPlumbingCadPart(part.id)
      expect(group).not.toBeNull()
      expect(group!.children.length).toBeGreaterThan(0)
      const box = new Box3().setFromObject(group!)
      expect(box.isEmpty()).toBe(false)
    }
  })

  test('buildPipeRunCad builds swept cylindrical pipe segments with 3D framing bore rings and nail plates', () => {
    const group = buildPipeRunCad({
      id: 'test_pipe',
      path: [
        [0, 0.5, 0],
        [4, 0.5, 0],
        [4, 2.2, 0],
      ],
      system: 'dwv-drain',
      material: 'pvc-dwv',
      nominalSize: '3"',
      hasCleanout: true,
      penetrations: [
        {
          position: [1.2, 0.5, 0],
          pipeDirection: [1, 0, 0],
          holeSawIn: 3.75,
          needsNailPlate: true,
          codeCompliant: true,
          memberKind: 'stud',
        },
      ],
    })
    expect(group.children.length).toBeGreaterThanOrEqual(5)
  })
})
