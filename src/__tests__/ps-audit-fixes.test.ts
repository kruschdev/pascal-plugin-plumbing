import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { compileBuildingAnatomy } from '@kruschdev/pascal-mep-kernel'
import { auditScenePlumbing } from '../ipc/audit'
import { planPlumbingAutoPopulate } from '../ipc/autopopulate'
import {
  type SceneNodeLike,
  WALL_2X4_MAX_THICKNESS_M,
  WALL_2X6_MIN_THICKNESS_M,
} from '../ipc/framing-interop'
import {
  type PlumbingObstacle,
  extractPlumbingObstacles,
  extractWallOpenings,
  mapCanonicalWallsToOpenings,
  mapOccupancyObstaclesToPlumbing,
  routePlumbingViaLegalCavity,
  routePressurizedPipeRun,
} from '../ipc/routing'
import { IPC_RULE_THRESHOLDS } from '../ipc/rules'

/**
 * Helper: L-shaped concave house (10 m x 10 m outer envelope with an outdoor notch in [5..10, 0..5]).
 * Indoor L consists of West wing [0..5, 0..10] + South-East wing [5..10, 5..10].
 */
function buildConcaveLHouse(options: { includeClosingNotchWalls?: boolean } = {}): Record<string, SceneNodeLike> {
  const { includeClosingNotchWalls = true } = options
  const nodes: Record<string, SceneNodeLike> = {
    level_0: { id: 'level_0', type: 'level', height: 2.7 },
    // Outer boundary of the L-shape:
    // (0,0) -> (5,0) -> (5,5) -> (10,5) -> (10,10) -> (0,10) -> (0,0)
    w_north_west: {
      id: 'w_north_west',
      type: 'wall',
      parentId: 'level_0',
      start: [0, 0],
      end: [5, 0],
      thickness: 0.16,
      height: 2.7,
    },
    w_notch_vert: {
      id: 'w_notch_vert',
      type: 'wall',
      parentId: 'level_0',
      start: [5, 0],
      end: [5, 5],
      thickness: 0.16,
      height: 2.7,
    },
    w_notch_horiz: {
      id: 'w_notch_horiz',
      type: 'wall',
      parentId: 'level_0',
      start: [5, 5],
      end: [10, 5],
      thickness: 0.16,
      height: 2.7,
    },
    w_east: {
      id: 'w_east',
      type: 'wall',
      parentId: 'level_0',
      start: [10, 5],
      end: [10, 10],
      thickness: 0.16,
      height: 2.7,
    },
    w_south: {
      id: 'w_south',
      type: 'wall',
      parentId: 'level_0',
      start: [10, 10],
      end: [0, 10],
      thickness: 0.16,
      height: 2.7,
    },
    w_west: {
      id: 'w_west',
      type: 'wall',
      parentId: 'level_0',
      start: [0, 10],
      end: [0, 0],
      thickness: 0.16,
      height: 2.7,
    },
    room_west: {
      id: 'room_west',
      type: 'zone',
      name: 'West Wing Bath & Hall',
      parentId: 'level_0',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 10],
        [0, 10],
      ],
    },
    room_se: {
      id: 'room_se',
      type: 'zone',
      name: 'South East Laundry',
      parentId: 'level_0',
      polygon: [
        [5, 5],
        [10, 5],
        [10, 10],
        [5, 10],
      ],
    },
    zone_patio: {
      id: 'zone_patio',
      type: 'zone',
      name: 'Outdoor Patio',
      category: 'exterior',
      parentId: 'level_0',
      polygon: [
        [5, 0],
        [10, 0],
        [10, 5],
        [5, 5],
      ],
    },
  }
  if (!includeClosingNotchWalls) {
    // Open-plan break in wall loop forces !footprint.boundedFacesComplete while roomPolygons remain populated
    delete nodes.w_west
  }
  return nodes
}

describe('Plumbing Audit Fixes (BUG-PS-01..05, BUG-EH-11, OPT-PS-01..02, CON-PS-01..04)', () => {
  test('BUG-PS-01: routePressurizedPipeRun adopts Layer 2 cavity rescue even after exhausting maxEval=300 heuristic budget', () => {
    const nodes = buildConcaveLHouse()
    const anatomy = compileBuildingAnatomy(nodes)

    // Place a dense wall of blocking columns around the direct & offset heuristic grid lines
    // so fromJogs x toJogs x planeYs x modes easily hits evalCount >= 300,
    // while leaving a clean interior corridor through the West + South-East wing for Layer 2 cavity A*.
    const obstacles: PlumbingObstacle[] = []
    // Block from-riser slightly off-axis & block heuristic horizontal paths at z=1.5..4.5, x=5..9
    // plus a tight grid of columns at x=4.0, z=4.0 and along z=1.5..6.5 so heuristic candidates all clash
    const blockerSpecs: Array<[string, number, number, number, number, number, number]> = [
      // Overhead beam near `from` drop to trigger fromJogs (5 jogs)
      ['hdr_from', 1.75, 2.25, 2.0, 2.2, 1.35, 1.65],
      // Overhead beam near `to` drop to trigger toJogs (5 jogs)
      ['hdr_to', 8.25, 8.75, 2.0, 2.2, 6.85, 7.15],
      // Columns blocking heuristic L-elbows at (8.5, 1.5), (2.0, 7.0), and +-0.55/+-1.15 offsets
      ['col_a', 1.2, 2.8, 0.0, 2.8, 6.2, 7.8],
      ['col_b', 1.2, 2.8, 0.0, 2.8, 4.5, 6.1],
      ['col_c', 5.1, 9.8, 0.0, 2.8, 0.2, 4.9],
      // Block heuristic offset bands at x = 3.2..4.6, z = 6.2..7.8 so heuristic elbows fail while south corridor z=8.8..9.5 stays open!
      ['col_d', 3.0, 4.6, 0.0, 2.8, 5.5, 7.8],
      ['col_e', 4.6, 6.8, 0.0, 2.8, 5.5, 7.5],
      ['col_f', 6.8, 7.8, 0.0, 2.8, 5.5, 7.5],
    ]
    for (const [id, minX, maxX, minY, maxY, minZ, maxZ] of blockerSpecs) {
      obstacles.push({
        id,
        nodeId: id,
        category: 'structural',
        structuralKind: minY > 1.0 ? 'beam' : 'column',
        ...(minY > 1.0 ? { beamRole: 'header' } : {}),
        label: id,
        box: { minX, maxX, minY, maxY, minZ, maxZ },
      })
    }

    const routed = routePressurizedPipeRun({
      from: [2.0, 1.4, 1.5],
      to: [8.5, 1.4, 7.0],
      routingPlaneY: 2.4,
      nominalSize: '3/4"',
      material: 'pex-a',
      euclideanInCavity: false,
      obstacles,
      buildingBounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
      cavityContext: { nodes, levelId: 'level_0', anatomy },
    })

    // Must NOT return a clashing primary/heuristic fallback — Layer 2 rescue must bypass the exhausted budget and be adopted
    expect(routed.detoured).toBe(true)
    expect(routed.clashes.length).toBe(0)
    // And verify the rescued water main stays strictly out of the outdoor patio notch [5.5..9.5, 0.5..4.5]
    for (const pt of routed.path) {
      const inOutdoorNotch = pt[0] > 5.5 && pt[0] < 9.5 && pt[2] > 0.5 && pt[2] < 4.5
      expect(inOutdoorNotch).toBe(false)
    }
  })

  test('BUG-PS-02: extractWallOpenings preserves exact kernel-clipped span for non-child item openings lacking explicit width', () => {
    const scene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.6 },
      w1: {
        id: 'w1',
        type: 'wall',
        parentId: 'level_0',
        start: [0, 0],
        end: [4, 0],
        thickness: 0.16,
        height: 2.6,
      },
      // Non-child `item` door with width sourced strictly from `asset.dimensions[0] = 2.0`,
      // centered at x = 0.5 -> clipped to wall [0, 1.5] (widthM = 1.5, uCenterM = 0.75).
      // Previously, the redundant PLU-BUG-05 override shrank endU to 1.25 m!
      door_item_clipped: {
        id: 'door_item_clipped',
        type: 'item',
        name: 'Double Entry Door',
        category: 'door',
        parentId: 'level_0',
        wallId: 'w1',
        position: [0.5, 0, 0],
        asset: { dimensions: [2.0, 2.1, 0.1] },
      },
    }

    const openings = extractWallOpenings(scene, 'level_0')
    expect(openings.length).toBe(1)
    const op = openings[0]!
    expect(op.id).toBe('door_item_clipped')
    expect(op.startU).toBeCloseTo(0.0, 3)
    expect(op.endU).toBeCloseTo(1.5, 3)
    expect(op.widthM).toBeCloseTo(1.5, 3)
    expect(op.uCenterM).toBeCloseTo(0.75, 3)
    expect(op.centerX).toBeCloseTo(0.75, 3)
    expect(op.centerZ).toBeCloseTo(0.0, 3)
  })

  test('BUG-PS-03: exceedsConcaveFootprint uses room-first precedence to reject pipes bridging outdoor notches when boundedFacesComplete is false', () => {
    // Missing closing wall forces `!footprint.boundedFacesComplete` while roomPolygons + outdoor patio zone exist.
    // Under default `'wall-first'` precedence, kernel falls back to outer wallAabb and wrongly accepts bridging [5..10, 0..5]!
    const nodes = buildConcaveLHouse({ includeClosingNotchWalls: false })
    const anatomy = compileBuildingAnatomy(nodes)
    const fp = anatomy.getFootprint('level_0')
    expect(fp.boundedFacesComplete).toBe(false)
    expect(fp.roomPolygons.length).toBeGreaterThan(0)

    // Route from North-West wing (2.5, 2.0) to South-East wing (8.0, 7.5):
    // Primary `'x'` elbow goes (2.5, 2.0) -> (8.0, 2.0) -> (8.0, 7.5), cutting straight through the outdoor patio [5..10, 0..5]!
    const routed = routePressurizedPipeRun({
      from: [2.5, 1.4, 2.0],
      to: [8.0, 1.4, 7.5],
      routingPlaneY: 2.35,
      nominalSize: '3/4"',
      material: 'pex-a',
      euclideanInCavity: false,
      buildingBounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
      cavityContext: { nodes, levelId: 'level_0', anatomy },
    })

    expect(routed.detoured).toBe(true)
    // Verify no waypoint or segment midpoint crosses deep into the outdoor patio [5.6..9.4, 0.6..4.4]
    for (let i = 1; i < routed.path.length; i++) {
      const a = routed.path[i - 1]!
      const b = routed.path[i]!
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const px = a[0] + (b[0] - a[0]) * t
        const pz = a[2] + (b[2] - a[2]) * t
        const inOutdoorPatio = px > 5.6 && px < 9.4 && pz > 0.6 && pz < 4.4
        expect(inOutdoorPatio).toBe(false)
      }
    }
  })

  test('BUG-PS-04: routePlumbingViaLegalCavity in gravity-slope mode preserves destination Y when allowedBands excludes sub-floor bands', () => {
    const nodes: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.7 },
      w_wet: {
        id: 'w_wet',
        type: 'wall',
        parentId: 'level_0',
        start: [0, 0],
        end: [6, 0],
        thickness: 0.16,
        height: 2.7,
      },
      w_south: {
        id: 'w_south',
        type: 'wall',
        parentId: 'level_0',
        start: [0, 4],
        end: [6, 4],
        thickness: 0.16,
        height: 2.7,
      },
      w_west: {
        id: 'w_west',
        type: 'wall',
        parentId: 'level_0',
        start: [0, 0],
        end: [0, 4],
        thickness: 0.16,
        height: 2.7,
      },
      w_east: {
        id: 'w_east',
        type: 'wall',
        parentId: 'level_0',
        start: [6, 0],
        end: [6, 4],
        thickness: 0.16,
        height: 2.7,
      },
    }

    // In-wall wet-vented trap arm / collector strictly restricted to wall bands (`mid-wall`, `under-sill`)
    const wallOnly = routePlumbingViaLegalCavity({
      nodes,
      levelId: 'level_0',
      from: [1.0, 0.55, 0.0],
      to: [3.0, 0.45, 0.0],
      mode: 'gravity-slope',
      nominalSize: '2"',
      material: 'pvc-dwv',
      allowedBands: ['mid-wall', 'under-sill'],
      foundationType: 'crawlspace',
    })

    expect(wallOnly.path.length).toBeGreaterThanOrEqual(2)
    const wallEndY = wallOnly.path[wallOnly.path.length - 1]![1]
    // Must NOT be overwritten down to crawlspace subFloorY (-0.24 m)!
    expect(wallEndY).toBeGreaterThan(0.2)
    expect(wallEndY).toBeCloseTo(0.45, 1)

    // When allowedBands is omitted (default includes under-slab/crawlspace), sub-floor snap still works
    const defaultSubFloor = routePlumbingViaLegalCavity({
      nodes,
      levelId: 'level_0',
      from: [1.0, 0.55, 0.0],
      to: [3.0, 0.45, 0.0],
      mode: 'gravity-slope',
      nominalSize: '2"',
      material: 'pvc-dwv',
      foundationType: 'crawlspace',
    })
    expect(defaultSubFloor.path.length).toBeGreaterThanOrEqual(2)
    expect(defaultSubFloor.path[defaultSubFloor.path.length - 1]![1]).toBeLessThan(0)
  })

  test('BUG-PS-05: low-elevation 4" dryer vent rescue uses low/mid-wall bands while water mains (>0.6m) stay strictly in overhead-plenum/attic', () => {
    const nodes: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.7 },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [9, 0], thickness: 0.16, height: 2.7 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [0, 6], end: [9, 6], thickness: 0.16, height: 2.7 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [0, 6], thickness: 0.16, height: 2.7 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [9, 0], end: [9, 6], thickness: 0.16, height: 2.7 },
      // Interior wall S-corridor: z=1 -> x=4.5 -> z=5
      wi_1: { id: 'wi_1', type: 'wall', parentId: 'level_0', start: [0, 1], end: [4.5, 1], thickness: 0.16, height: 2.7 },
      wi_2: { id: 'wi_2', type: 'wall', parentId: 'level_0', start: [4.5, 1], end: [4.5, 5], thickness: 0.16, height: 2.7 },
      wi_3: { id: 'wi_3', type: 'wall', parentId: 'level_0', start: [4.5, 5], end: [9, 5], thickness: 0.16, height: 2.7 },
    }
    const anatomy = compileBuildingAnatomy(nodes)

    // Pinched S-corridor obstacles that block all 1-bend heuristic candidates (requiring Layer 2 cavity rescue),
    // leaving the wall cavities wi_1 -> wi_2 -> wi_3 open in low/mid-wall bands (`under-sill`/`mid-wall`).
    const dryerObstacles: PlumbingObstacle[] = [
      { id: 'c1a', nodeId: 'c1a', category: 'structural', structuralKind: 'column', label: 'c1a', box: { minX: 1.5, maxX: 4.2, minY: 0, maxY: 2.8, minZ: -0.2, maxZ: 0.75 } },
      { id: 'c1b', nodeId: 'c1b', category: 'structural', structuralKind: 'column', label: 'c1b', box: { minX: 1.5, maxX: 4.2, minY: 0, maxY: 2.8, minZ: 1.25, maxZ: 6.2 } },
      { id: 'c2a', nodeId: 'c2a', category: 'structural', structuralKind: 'column', label: 'c2a', box: { minX: 4.8, maxX: 7.5, minY: 0, maxY: 2.8, minZ: -0.2, maxZ: 4.75 } },
      { id: 'c2b', nodeId: 'c2b', category: 'structural', structuralKind: 'column', label: 'c2b', box: { minX: 4.8, maxX: 7.5, minY: 0, maxY: 2.8, minZ: 5.25, maxZ: 6.2 } },
      { id: 'c3', nodeId: 'c3', category: 'structural', structuralKind: 'column', label: 'c3', box: { minX: 4.62, maxX: 4.85, minY: 0, maxY: 2.8, minZ: 1.25, maxZ: 4.75 } },
      { id: 'c4', nodeId: 'c4', category: 'structural', structuralKind: 'column', label: 'c4', box: { minX: 4.15, maxX: 4.38, minY: 0, maxY: 2.8, minZ: 1.25, maxZ: 4.75 } },
    ]

    // Confirm heuristic-only cannot solve it (so Layer 2 cavity rescue is genuinely exercised)
    const withoutCavity = routePressurizedPipeRun({
      from: [0.5, 0.35, 1.0],
      to: [8.5, 0.35, 5.0],
      routingPlaneY: 0.35,
      nominalSize: '4"',
      material: 'rigid-aluminum',
      euclideanInCavity: false,
      obstacles: dryerObstacles,
      buildingBounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 6 },
    })
    expect(withoutCavity.clashes.length).toBeGreaterThan(0)

    const dryerRoute = routePressurizedPipeRun({
      from: [0.5, 0.35, 1.0],
      to: [8.5, 0.35, 5.0],
      routingPlaneY: 0.35,
      nominalSize: '4"',
      material: 'rigid-aluminum',
      euclideanInCavity: false,
      obstacles: dryerObstacles,
      buildingBounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 6 },
      cavityContext: { nodes, levelId: 'level_0', anatomy },
    })

    expect(dryerRoute.clashes.length).toBe(0)
    const maxDryerY = Math.max(...dryerRoute.path.map((p) => p[1]))
    // Must stay in low/mid-wall cavity (<= 1.2 m), never climbing ~2.7 m into overhead plenum/attic!
    expect(maxDryerY).toBeLessThan(1.2)

    // Compare against forced overhead-only bands to verify significant length savings vs old hardcoded behavior
    const overheadOnly = routePressurizedPipeRun({
      from: [0.5, 0.35, 1.0],
      to: [8.5, 0.35, 5.0],
      routingPlaneY: 0.35,
      nominalSize: '4"',
      material: 'rigid-aluminum',
      euclideanInCavity: false,
      obstacles: dryerObstacles,
      buildingBounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 6 },
      cavityContext: { nodes, levelId: 'level_0', anatomy },
      allowedBands: ['overhead-plenum', 'attic'],
    })
    expect(dryerRoute.lengthFt).toBeLessThan(overheadOnly.lengthFt - 5)

    // Now verify XTRADE invariant: a pressurized water main at routingPlaneY = 2.35 (> 0.6 m)
    // NEVER routes horizontal segments into mid-wall / top-plate where Electrical runs — even under Layer 2 rescue!
    const waterRoute = routePressurizedPipeRun({
      from: [0.5, 1.4, 1.0],
      to: [8.5, 1.4, 5.0],
      routingPlaneY: 2.35,
      nominalSize: '3/4"',
      material: 'pex-a',
      euclideanInCavity: false,
      obstacles: dryerObstacles,
      buildingBounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 6 },
      cavityContext: { nodes, levelId: 'level_0', anatomy },
    })
    expect(waterRoute.clashes.length).toBe(0)
    // Every horizontal travel segment (> 0.5 m) must remain in overhead-plenum/attic (>= 2.0 m), never mid-wall (~1.1 m)
    for (let i = 1; i < waterRoute.path.length; i++) {
      const a = waterRoute.path[i - 1]!
      const b = waterRoute.path[i]!
      const horiz = Math.hypot(b[0] - a[0], b[2] - a[2])
      if (horiz > 0.5) {
        expect(Math.min(a[1], b[1])).toBeGreaterThanOrEqual(2.0)
      }
    }
  })

  test('BUG-EH-11: build-dist.ts externalizes @kruschdev/pascal-mep-kernel and dist/*.d.ts stay < 15 KB', () => {
    const rootDir = path.resolve(import.meta.dir, '../..')
    const buildScript = fs.readFileSync(path.join(rootDir, 'scripts/build-dist.ts'), 'utf8')
    expect(buildScript).toContain("'@kruschdev/pascal-mep-kernel'")
    expect(buildScript).toContain("'@kruschdev/pascal-mep-kernel/*'")

    // If dist/ is present, verify .d.ts files stay < 15 KB
    const distDir = path.join(rootDir, 'dist')
    if (fs.existsSync(distDir)) {
      const checkDir = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            checkDir(full)
          } else if (entry.name.endsWith('.d.ts')) {
            const bytes = fs.statSync(full).size
            expect(bytes).toBeLessThan(15 * 1024)
          }
        }
      }
      checkDir(distDir)
    }
  })

  test('OPT-PS-01 & CON-PS-04: anatomy-derived obstacles/openings match direct extractors, no :segN nodeId leakage, and single-source IPC thresholds', () => {
    // CON-PS-04: framing-interop constants derive directly from IPC_RULE_THRESHOLDS
    expect(WALL_2X4_MAX_THICKNESS_M).toBe(IPC_RULE_THRESHOLDS.wetWallMax2x4ThicknessM)
    expect(WALL_2X6_MIN_THICKNESS_M).toBe(IPC_RULE_THRESHOLDS.wetWallMinThicknessM)

    // OPT-PS-01 parity: mapOccupancyObstaclesToPlumbing & mapCanonicalWallsToOpenings
    const scene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.7 },
      w_long: {
        id: 'w_long',
        type: 'wall',
        parentId: 'level_0',
        start: [0, 0],
        end: [6, 0],
        thickness: 0.16,
        height: 2.7,
        children: ['d1'],
      },
      w_tiny: {
        id: 'w_tiny',
        type: 'wall',
        parentId: 'level_0',
        start: [6, 0],
        end: [6.2, 0],
        thickness: 0.16,
        height: 2.7,
      },
      d1: {
        id: 'd1',
        type: 'door',
        parentId: 'w_long',
        wallId: 'w_long',
        position: [2.0, 1.05, 0],
        width: 0.9,
        height: 2.1,
      },
      diag_beam: {
        id: 'diag_beam',
        type: 'structural:beam',
        name: 'Diagonal Ridge Beam',
        parentId: 'level_0',
        start: [1, 1],
        end: [4, 4],
        elevationY: 2.2,
        widthIn: 5.5,
        depthIn: 11.875,
      },
      pipe_clash_diag: {
        id: 'pipe_clash_diag',
        type: 'plumbing:pipe-run',
        name: 'Clashing Pipe',
        parentId: 'level_0',
        system: 'cold-water',
        material: 'pex-a',
        nominalSize: '3/4"',
        path: [
          [2.5, 2.2, 1.5],
          [2.5, 2.2, 3.5],
        ],
      },
      drain_3in_ok: {
        id: 'drain_3in_ok',
        type: 'plumbing:pipe-run',
        name: '3" Drain at 1/8"/ft',
        parentId: 'level_0',
        system: 'dwv-drain',
        material: 'pvc-dwv',
        nominalSize: '3"',
        hasCleanout: true,
        path: [
          [0, -0.2, 0],
          [3.048, -0.2381, 0], // 0.15"/ft >= 0.125"/ft
        ],
      },
      drain_2in_shallow: {
        id: 'drain_2in_shallow',
        type: 'plumbing:pipe-run',
        name: '2" Drain at 1/8"/ft',
        parentId: 'level_0',
        system: 'dwv-drain',
        material: 'pvc-dwv',
        nominalSize: '2"',
        path: [
          [0, -0.2, 1],
          [3.048, -0.2381, 1], // 0.15"/ft < 0.25"/ft
        ],
      },
    }

    const anatomy = compileBuildingAnatomy(scene)
    const occGrid = anatomy.createOccupancyGrid('level_0', { forTrade: 'plumbing' })
    const mappedObs = mapOccupancyObstaclesToPlumbing(occGrid.obstacles)
    const directObs = extractPlumbingObstacles(scene, 'level_0')
    expect(mappedObs.length).toBe(directObs.length)
    expect(mappedObs.some((o) => o.id.includes(':seg0'))).toBe(true)

    const mappedOps = mapCanonicalWallsToOpenings(anatomy.getWalls('level_0'))
    const directOps = extractWallOpenings(scene, 'level_0')
    expect(mappedOps).toEqual(directOps)

    // Verify zero `:segN` leakage in audit finding.nodeIds & IPC 704.1 slope split + IPC 903.1 interpolated message
    const audit = auditScenePlumbing(scene)
    for (const f of audit.findings) {
      for (const nid of f.nodeIds) {
        expect(nid).not.toMatch(/:seg\d+$/)
      }
    }
    expect(audit.findings.some((f) => f.codeRef === 'IPC Table 704.1' && f.nodeIds.includes('drain_2in_shallow'))).toBe(
      true,
    )
    expect(audit.findings.some((f) => f.codeRef === 'IPC Table 704.1' && f.nodeIds.includes('drain_3in_ok'))).toBe(false)
    const missingStack = audit.findings.find((f) => f.codeRef === 'IPC 903.1')
    expect(missingStack).toBeDefined()
    expect(missingStack!.title).toContain(`${IPC_RULE_THRESHOLDS.mainVentStackMinNominalIn}"`)

    // Verify full autopopulate runs cleanly end-to-end with OPT-PS-01 + BUG-PS-05
    const house: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 2.7 },
      w1: { id: 'w1', type: 'wall', parentId: 'level_0', start: [0, 0], end: [8, 0], thickness: 0.16, height: 2.7 },
      w2: { id: 'w2', type: 'wall', parentId: 'level_0', start: [8, 0], end: [8, 6], thickness: 0.16, height: 2.7 },
      w3: { id: 'w3', type: 'wall', parentId: 'level_0', start: [8, 6], end: [0, 6], thickness: 0.16, height: 2.7 },
      w4: { id: 'w4', type: 'wall', parentId: 'level_0', start: [0, 6], end: [0, 0], thickness: 0.16, height: 2.7 },
      z_bath: {
        id: 'z_bath',
        type: 'zone',
        name: 'Bathroom',
        parentId: 'level_0',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      },
      z_laundry: {
        id: 'z_laundry',
        type: 'zone',
        name: 'Laundry',
        parentId: 'level_0',
        polygon: [
          [4, 0],
          [8, 0],
          [8, 3],
          [4, 3],
        ],
      },
    }
    const plan = planPlumbingAutoPopulate(house, { levelId: 'level_0', includeDryerVent: true })
    expect(plan.pipeRuns.some((r) => r.system === 'dryer-vent')).toBe(true)
  })
})
