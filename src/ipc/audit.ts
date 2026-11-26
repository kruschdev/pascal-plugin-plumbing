/**
 * Live IPC / UPC / IFGC / IRC + NEC 110.26(E) & Cross-Trade Electrical Coordination Auditor (`src/ipc/audit.ts`).
 * WeakMap-memoized per scene nodes object reference for zero-jank live React re-renders.
 *
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import {
  type BonesPlumbingContext,
  type SceneNodeLike,
  checkWetWallPipeFit,
  extractBonesPlumbingContext,
  getLowerWalledLevelIds,
  resolveEffectiveWallThicknessM,
  resolveNodeLevelId,
} from './framing-interop'
import {
  type PlumbingObstacle,
  type WallSegment2D,
  countPathElbows,
  detectPlumbingClashes,
  extractPlumbingObstacles,
  extractWallSegments,
  measureDrainPathSlope,
  polylineHorizontalLengthM,
  polylineLengthM,
} from './routing'
import { buildElectricalCoordination } from './schedule'
import {
  calculateSupplyHydraulics,
  checkDryerVentRun,
  checkTrapArmDistance,
  getMinRequiredDrainSlopeInPerFt,
  sizeBuildingDrain,
  sizeDrainBranch,
  sizeFuelGasPipe,
  wsfuToGpm,
} from './sizing'
import {
  type CodeEdition,
  FIXTURE_SPECS,
  type FixtureKind,
  METERS_TO_FEET,
  type OccupancyType,
  type PipeMaterial,
  type PipeNominalSize,
  type PlumbingSystem,
  comparePipeSizes,
  getPipeOuterDiameterM,
  round2,
} from './tables'

export type PlumbingAuditSeverity = 'error' | 'warning' | 'info'

export type PlumbingAuditFinding = {
  id: string
  severity: PlumbingAuditSeverity
  codeRef: string
  title: string
  detail: string
  suggestedFix: string
  nodeIds: string[]
}

export type PlumbingAuditResult = {
  codeEdition: CodeEdition
  errorCount: number
  warningCount: number
  infoCount: number
  findings: PlumbingAuditFinding[]
}

const auditCache = new WeakMap<Readonly<Record<string, SceneNodeLike>>, Map<string, PlumbingAuditResult>>()

export function auditScenePlumbing(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  options: { codeEdition?: CodeEdition; occupancy?: OccupancyType } = {},
): PlumbingAuditResult {
  const codeEdition = options.codeEdition ?? 'IPC-2021'
  const all = Object.values(nodes)
  const fixtures = all.filter((n) => n.type === 'plumbing:fixture')
  const inferredCommercial = fixtures.some((f) => {
    const k = f.fixtureKind as FixtureKind | undefined
    return k ? Boolean(FIXTURE_SPECS[k]?.commercialOnly) : false
  })
  const occupancy: OccupancyType = options.occupancy ?? (inferredCommercial ? 'commercial' : 'residential')
  const flushType = occupancy === 'commercial' ? 'flushometer' : 'flush-tank'
  const cacheKey = `${codeEdition}|${occupancy}`

  let byEdition = auditCache.get(nodes)
  if (!byEdition) {
    byEdition = new Map()
    auditCache.set(nodes, byEdition)
  }
  const cached = byEdition.get(cacheKey)
  if (cached) return cached

  const findings: PlumbingAuditFinding[] = []
  let seq = 1
  const push = (f: Omit<PlumbingAuditFinding, 'id'>) => {
    findings.push({ id: `ipc_finding_${seq++}`, ...f })
  }

  const equipment = all.filter((n) => n.type === 'plumbing:equipment')
  const pipeRuns = all.filter((n) => n.type === 'plumbing:pipe-run')
  const hasElectricalPanel = all.some((n) => n.type === 'electrical:panel')

  // Per-level spatial context caches so multi-story scenes never mix level-local coordinates across floors
  const wallMapByLevel = new Map<string, Map<string, WallSegment2D>>()
  const bonesByLevel = new Map<string, BonesPlumbingContext>()
  const obstaclesByLevel = new Map<string, PlumbingObstacle[]>()

  const getWallMapForLevel = (lvlId: string | null): Map<string, WallSegment2D> => {
    const key = lvlId ?? '__all__'
    let m = wallMapByLevel.get(key)
    if (!m) {
      m = new Map(extractWallSegments(nodes, lvlId).map((w) => [w.id, w]))
      wallMapByLevel.set(key, m)
    }
    return m
  }
  const getBonesForLevel = (lvlId: string | null): BonesPlumbingContext => {
    const key = lvlId ?? '__all__'
    let ctx = bonesByLevel.get(key)
    if (!ctx) {
      ctx = extractBonesPlumbingContext(nodes, lvlId)
      bonesByLevel.set(key, ctx)
    }
    return ctx
  }
  const getObstaclesForLevel = (lvlId: string | null): PlumbingObstacle[] => {
    const key = lvlId ?? '__all__'
    let obs = obstaclesByLevel.get(key)
    if (!obs) {
      obs = extractPlumbingObstacles(nodes, lvlId)
      obstaclesByLevel.set(key, obs)
    }
    return obs
  }

  // 1. Fixture-level checks
  const hasExpansionTank = equipment.some((e) => e.equipmentKind === 'expansion-tank')
  const hasMainShutoff = equipment.some((e) => e.equipmentKind === 'main-shutoff-prv')

  for (const fix of fixtures) {
    const kind = (fix.fixtureKind as FixtureKind) || 'lavatory'
    if (kind === 'hose-bibb' && fix.hasVacuumBreaker === false) {
      push({
        severity: 'error',
        codeRef: 'IPC 608.15.4.2',
        title: 'Hose bibb missing anti-siphon vacuum breaker',
        detail: `${fix.name ?? fix.id} has no backflow/vacuum breaker protection.`,
        suggestedFix: 'Enable frost-proof anti-siphon vacuum breaker on exterior hose bibb.',
        nodeIds: [fix.id],
      })
    }
    const spec = FIXTURE_SPECS[kind]
    if (spec?.needsPTrap && fix.hasPTrap === false) {
      push({
        severity: 'error',
        codeRef: 'IPC 1002.1',
        title: 'Drain fixture missing P-trap',
        detail: `${fix.name ?? fix.id} requires a dedicated trap to block sewer gas.`,
        suggestedFix: `Install ${spec.minTrapIn ?? '1-1/2"'} P-trap at fixture outlet.`,
        nodeIds: [fix.id],
      })
    }
  }

  // 2. Equipment-level checks (Water Heaters, HPWH clearance, Expansion Tank, T&P, Drain Pan)
  for (const eq of equipment) {
    const kind = String(eq.equipmentKind ?? '')
    const isWaterHeater = kind.startsWith('water-heater-')
    if (isWaterHeater) {
      if (eq.hasExpansionTank === false && !hasExpansionTank && hasMainShutoff) {
        push({
          severity: 'warning',
          codeRef: 'IPC 607.3',
          title: 'Closed domestic system missing thermal expansion tank',
          detail: `${eq.name ?? eq.id} is downstream of a PRV/check valve without an expansion tank.`,
          suggestedFix: 'Add a 2 gal (<= 50 gal WH) or 4.5 gal (> 50 gal WH) expansion tank on cold inlet.',
          nodeIds: [eq.id],
        })
      }
      if (eq.hasTpDischarge === false) {
        push({
          severity: 'error',
          codeRef: 'IPC 504.6',
          title: 'Water heater missing T&P relief discharge pipe',
          detail: `${eq.name ?? eq.id} requires a full-size 3/4" copper/CPVC T&P discharge line to exterior or approved drain.`,
          suggestedFix: 'Route 3/4" T&P discharge line downward to within 6" of floor/exterior.',
          nodeIds: [eq.id],
        })
      }
      if (eq.hasDrainPan === false) {
        push({
          severity: 'warning',
          codeRef: 'IPC 504.7',
          title: 'Water heater missing drain pan',
          detail: `${eq.name ?? eq.id} has no safety drain pan configured.`,
          suggestedFix: 'Install a >= 1.5" deep drain pan with 3/4" drain line where leakage could cause damage.',
          nodeIds: [eq.id],
        })
      }
      if (kind === 'water-heater-hpwh' && typeof eq.roomVolumeCuFt === 'number' && eq.roomVolumeCuFt < 700) {
        push({
          severity: 'warning',
          codeRef: 'Manufacturer / IMC 304',
          title: 'Heat pump water heater room < 700 cu ft',
          detail: `${eq.name ?? eq.id} room volume (${eq.roomVolumeCuFt} cu ft) is below the 700 cu ft unconditioned air minimum.`,
          suggestedFix: 'Relocate HPWH to garage/larger room or add louvered door / ducted intake.',
          nodeIds: [eq.id],
        })
      }
    }
  }

  // 3. Pipe-run checks (DWV slope, sanitary tee, trap arm, vent flood rim, wet-wall 2x6, velocity, gas, dryer vent, clashes)
  const ventedFixtureIds = new Set<string>()
  for (const r of pipeRuns) {
    if (r.system === 'dwv-vent' && typeof r.sourceNodeId === 'string') {
      ventedFixtureIds.add(r.sourceNodeId)
    }
  }

  const wcCountByLevel = new Map<string, number>()
  for (const fix of fixtures) {
    if (fix.fixtureKind === 'water-closet') {
      const lvlKey = resolveNodeLevelId(nodes, fix) ?? '__root__'
      wcCountByLevel.set(lvlKey, (wcCountByLevel.get(lvlKey) ?? 0) + 1)
    }
  }

  const dwvStateByLevel = new Map<
    string,
    { hasAnyDwvDrain: boolean; hasAnyCleanout: boolean; hasMainVentStack: boolean; sampleDrainIds: string[] }
  >()
  const getLevelDwvState = (lvlKey: string) => {
    let st = dwvStateByLevel.get(lvlKey)
    if (!st) {
      st = { hasAnyDwvDrain: false, hasAnyCleanout: false, hasMainVentStack: false, sampleDrainIds: [] }
      dwvStateByLevel.set(lvlKey, st)
    }
    return st
  }

  for (const run of pipeRuns) {
    const system = (run.system as PlumbingSystem) || 'cold-water'
    const material = (run.material as PipeMaterial) || 'pex-a'
    const size = (run.nominalSize as PipeNominalSize) || '1/2"'
    const path = Array.isArray(run.path)
      ? (run.path as ReadonlyArray<readonly [number, number, number]>)
      : []
    const lengthFt = polylineLengthM(path) * METERS_TO_FEET
    const pipeRadiusM = getPipeOuterDiameterM(size, material) / 2
    const runLevelId = resolveNodeLevelId(nodes, run)
    const runLevelKey = runLevelId ?? '__root__'
    const lvlState = getLevelDwvState(runLevelKey)

    if (run.hasCleanout === true) lvlState.hasAnyCleanout = true
    if (run.isMainVentStack === true) {
      lvlState.hasMainVentStack = true
      if (comparePipeSizes(size, '3"') < 0) {
        push({
          severity: 'error',
          codeRef: 'IPC 903.1',
          title: `Main vent stack (${size}) below 3" minimum diameter`,
          detail: `${run.name ?? run.id} is marked as a main vent stack but is sized ${size} instead of at least 3".`,
          suggestedFix: 'Upsize the main vent stack through roof to at least 3" per IPC 903.1.',
          nodeIds: [run.id],
        })
      }
    }

    // Structural & NEC 110.26(E) obstacle clashes (strictly same-level, deduplicated by base obstacle nodeId)
    if (path.length >= 2) {
      const clashes = detectPlumbingClashes(path, getObstaclesForLevel(runLevelId), pipeRadiusM)
      const reportedObsIds = new Set<string>()
      for (const obs of clashes) {
        const obsNodeId = obs.nodeId ?? obs.id.replace(/:seg\d+$/, '')
        if (reportedObsIds.has(obsNodeId)) continue
        reportedObsIds.add(obsNodeId)
        if (obs.category === 'electrical-dedicated-space') {
          push({
            severity: 'error',
            codeRef: 'NEC 110.26(E)',
            title: 'Plumbing pipe invades electrical panel dedicated overhead space',
            detail: `${run.name ?? run.id} passes directly above ${obs.label}.`,
            suggestedFix: 'Reroute pipe horizontally clear of the electrical panel footprint or install drip-shield protection above structural ceiling.',
            nodeIds: [run.id, obsNodeId],
          })
        } else {
          push({
            severity: 'error',
            codeRef: 'IRC R602 / Structural',
            title: 'Pipe run collides with structural member',
            detail: `${run.name ?? run.id} intersects ${obs.label}.`,
            suggestedFix: 'Offset pipe around structural beam or column; never cut primary structural members.',
            nodeIds: [run.id, obsNodeId],
          })
        }
      }
    }

    // Wet-wall cavity check (2x4 vs 2x6 for >= 3" DWV, honoring Bones/Structural load-bearing overrides)
    const levelWallMap = getWallMapForLevel(runLevelId)
    if (typeof run.wallId === 'string' && levelWallMap.has(run.wallId)) {
      const wall = levelWallMap.get(run.wallId)!
      const bonesCtx = getBonesForLevel(runLevelId)
      const wallRule = bonesCtx.wallRules.get(wall.id)
      const effectiveWallThicknessM = resolveEffectiveWallThicknessM(wall.thicknessM, bonesCtx, wallRule)
      const fit = checkWetWallPipeFit({
        wallThicknessM: effectiveWallThicknessM,
        pipeSize: size,
        material,
        isLoadBearing: wallRule?.isLoadBearing ?? false,
      })
      if (!fit.fits) {
        push({
          severity: 'error',
          codeRef: fit.codeRef,
          title: `Wet wall too thin for ${size} ${material.toUpperCase()} pipe`,
          detail: `${run.name ?? run.id} inside wall ${wall.id}: ${fit.reason}`,
          suggestedFix: 'Upgrade this wet wall to 2x6 framing (>= 0.15 m thick) or add a dedicated pipe chase.',
          nodeIds: [run.id, wall.id],
        })
      }
    }

    // DWV Drain checks
    if (system === 'dwv-drain') {
      lvlState.hasAnyDwvDrain = true
      if (lvlState.sampleDrainIds.length < 1) lvlState.sampleDrainIds.push(run.id)

      // IPC Table 710.1(1) / 710.1(2) DFU & water-closet drain sizing check
      const slopeInfo = path.length >= 2 ? measureDrainPathSlope(path) : null
      const dfuLoad = typeof run.dfuLoad === 'number' && run.dfuLoad > 0 ? run.dfuLoad : 0
      const srcNode = typeof run.sourceNodeId === 'string' ? nodes[run.sourceNodeId] : undefined
      const isMainBuildingDrain =
        Boolean(srcNode?.type === 'plumbing:pipe-run' && srcNode.isMainVentStack === true) ||
        /building drain|main drain/i.test(String(run.name ?? ''))
      const servesWaterCloset = Boolean(
        srcNode?.type === 'plumbing:fixture' && srcNode.fixtureKind === 'water-closet',
      )
      const levelWcCount = wcCountByLevel.get(runLevelKey) ?? 0
      if (isMainBuildingDrain && (dfuLoad > 0 || levelWcCount > 0)) {
        const rawSlopeInPerFt =
          typeof run.slopeInPerFt === 'number' && run.slopeInPerFt > 0
            ? run.slopeInPerFt
            : (slopeInfo?.overallSlopeInPerFt ?? 0.25)
        const effectiveSlope: 0.125 | 0.25 | 0.5 =
          rawSlopeInPerFt < 0.25 ? 0.125 : rawSlopeInPerFt >= 0.5 ? 0.5 : 0.25
        const drainSizing = sizeBuildingDrain({
          totalDfu: dfuLoad,
          slopeInPerFt: effectiveSlope,
          hasWaterCloset: levelWcCount > 0,
          waterClosetCount: levelWcCount,
          codeEdition,
        })
        if (comparePipeSizes(size, drainSizing.recommendedSize) < 0 || dfuLoad > drainSizing.maxAllowedDfuAtSize) {
          push({
            severity: 'error',
            codeRef: drainSizing.codeRef,
            title: `Building drain (${size}) undersized for ${dfuLoad} DFU`,
            detail: `${run.name ?? run.id} (${size} carrying ${dfuLoad} DFU${levelWcCount > 0 ? `, ${levelWcCount} WC(s)` : ''}) requires at least ${drainSizing.recommendedSize} (max ${drainSizing.maxAllowedDfuAtSize} DFU).`,
            suggestedFix: `Upsize building drain to at least ${drainSizing.recommendedSize} per ${drainSizing.codeRef}.`,
            nodeIds: [run.id],
          })
        }
      } else if (!isMainBuildingDrain && (dfuLoad > 0 || servesWaterCloset)) {
        const drainSizing = sizeDrainBranch({
          dfu: dfuLoad,
          hasWaterCloset: servesWaterCloset,
          waterClosetCount: servesWaterCloset ? 1 : 0,
          codeEdition,
        })
        if (comparePipeSizes(size, drainSizing.recommendedSize) < 0 || dfuLoad > drainSizing.maxAllowedDfuAtSize) {
          push({
            severity: 'error',
            codeRef: drainSizing.codeRef,
            title: servesWaterCloset && comparePipeSizes(size, '3"') < 0
              ? `Water closet drain (${size}) below 3" minimum`
              : `DWV drain branch (${size}) undersized for ${dfuLoad} DFU`,
            detail: `${run.name ?? run.id} (${size}, ${dfuLoad} DFU${servesWaterCloset ? ', serves water closet' : ''}) requires at least ${drainSizing.recommendedSize}.`,
            suggestedFix: `Upsize horizontal drain branch to at least ${drainSizing.recommendedSize} per ${drainSizing.codeRef}.`,
            nodeIds: [run.id],
          })
        }
      }

      const minSlope = getMinRequiredDrainSlopeInPerFt(size)
      if (slopeInfo) {
        if (slopeInfo.hasUphillSegment) {
          push({
            severity: 'error',
            codeRef: 'IPC 704.1',
            title: 'DWV drain routes uphill (gravity flow violated)',
            detail: `${run.name ?? run.id} contains an upward-sloping drainage segment.`,
            suggestedFix: `Re-slope drain continuously downward at >= ${minSlope}"/ft toward the building drain.`,
            nodeIds: [run.id],
          })
        } else if (slopeInfo.horizontalSegments > 0 && slopeInfo.minSegmentSlopeInPerFt < minSlope - 0.02) {
          push({
            severity: 'error',
            codeRef: 'IPC Table 704.1',
            title: `DWV drain slope below ${minSlope}"/ft minimum`,
            detail: `${run.name ?? run.id} (${size}) measures ${slopeInfo.minSegmentSlopeInPerFt}"/ft (requires >= ${minSlope}"/ft).`,
            suggestedFix: `Increase downward pitch to at least ${minSlope}"/ft (${minSlope === 0.25 ? '2.08%' : '1.04%'}).`,
            nodeIds: [run.id],
          })
        }
      }

      if (run.isHorizontalSanTee === true) {
        push({
          severity: 'error',
          codeRef: 'IPC Table 706.3',
          title: 'Sanitary tee prohibited on horizontal drainage turn',
          detail: `${run.name ?? run.id} uses a sanitary tee for horizontal-to-horizontal or vertical-to-horizontal drainage.`,
          suggestedFix: 'Replace sanitary tee with a 45° wye + eighth bend (combo) or long-sweep 90° elbow.',
          nodeIds: [run.id],
        })
      }

      let effectiveTrapArmFt: number | null =
        typeof run.trapArmLengthFt === 'number' && run.trapArmLengthFt > 0 ? run.trapArmLengthFt : null
      if (effectiveTrapArmFt === null && typeof run.sourceNodeId === 'string' && path.length >= 2) {
        const src = nodes[run.sourceNodeId]
        if (src && src.type === 'plumbing:fixture' && !ventedFixtureIds.has(src.id)) {
          const srcKind = (src.fixtureKind as FixtureKind) || 'lavatory'
          if (FIXTURE_SPECS[srcKind]?.needsPTrap) {
            const horizFt = round2(polylineHorizontalLengthM(path) * METERS_TO_FEET)
            if (horizFt > 0.25) effectiveTrapArmFt = horizFt
          }
        }
      }
      if (effectiveTrapArmFt !== null) {
        const trapCheck = checkTrapArmDistance(size, effectiveTrapArmFt)
        if (!trapCheck.ok) {
          push({
            severity: 'error',
            codeRef: trapCheck.codeRef,
            title: `Trap-arm length (${trapCheck.distanceFt} ft) exceeds ${trapCheck.maxAllowedFt} ft max`,
            detail: `${run.name ?? run.id} (${size}) exceeds maximum developed distance from trap weir to vent.`,
            suggestedFix: 'Move vent closer to trap, add an AAV (IPC 918), or upsize trap arm.',
            nodeIds: [run.id],
          })
        }
      }

      if (lengthFt > 100 && !run.hasCleanout) {
        push({
          severity: 'warning',
          codeRef: 'IPC 708.1',
          title: 'Building drain > 100 ft without intermediate cleanout',
          detail: `${run.name ?? run.id} spans ${round2(lengthFt)} ft without a cleanout.`,
          suggestedFix: 'Add an accessible two-way cleanout at <= 100 ft intervals.',
          nodeIds: [run.id],
        })
      }
    }

    // Vent flood-level rim check (IPC 905.5)
    if (system === 'dwv-vent' && !run.isMainVentStack && typeof run.sourceNodeId === 'string') {
      const src = nodes[run.sourceNodeId]
      if (src && src.type === 'plumbing:fixture' && path.length >= 2) {
        const kind = (src.fixtureKind as FixtureKind) || 'lavatory'
        const floodRimM = FIXTURE_SPECS[kind]?.floodRimHeightM ?? 0.85
        const minHorizontalVentY = floodRimM + 0.1524 // 6" above flood rim
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1]!
          const b = path[i]!
          const horiz = Math.hypot(b[0] - a[0], b[2] - a[2])
          if (horiz > 0.25 && Math.min(a[1], b[1]) < minHorizontalVentY - 0.02) {
            push({
              severity: 'error',
              codeRef: 'IPC 905.5',
              title: 'Horizontal dry vent below 6" above fixture flood-level rim',
              detail: `${run.name ?? run.id} runs horizontally at ${(Math.min(a[1], b[1]) * 39.37).toFixed(0)}" AFF (minimum ${(minHorizontalVentY * 39.37).toFixed(0)}" AFF).`,
              suggestedFix: 'Rise vertically inside wet wall to at least 6" above fixture flood-level rim before turning horizontal.',
              nodeIds: [run.id, src.id],
            })
            break
          }
        }
      }
    }

    // Domestic water supply velocity check
    if (
      (system === 'cold-water' || system === 'hot-water') &&
      (material === 'pex-a' ||
        material === 'pex-b' ||
        material === 'copper-l' ||
        material === 'copper-m' ||
        material === 'cpvc')
    ) {
      const wsfu = typeof run.wsfuLoad === 'number' ? run.wsfuLoad : 0
      if (wsfu > 0) {
        const gpm = wsfuToGpm(wsfu, flushType)
        const hyd = calculateSupplyHydraulics({
          gpm,
          size,
          material,
          isHot: system === 'hot-water',
          lengthFt: Math.max(10, lengthFt),
        })
        if (!hyd.velocityOk) {
          push({
            severity: 'warning',
            codeRef: hyd.codeRef,
            title: `Water supply velocity (${hyd.velocityFps} ft/s) exceeds ${hyd.maxVelocityFps} ft/s limit`,
            detail: `${run.name ?? run.id} (${size} ${material.toUpperCase()} carrying ${wsfu} WSFU / ${hyd.gpm} GPM) risks erosion-corrosion and water hammer.`,
            suggestedFix: 'Upsize supply pipe one nominal trade size to keep velocity within code limits.',
            nodeIds: [run.id],
          })
        }
      }
    }

    // Fuel Gas (IFGC 402.4 / 408.4 / 409.5)
    if (system === 'fuel-gas') {
      const btuh = typeof run.gasBtuh === 'number' ? run.gasBtuh : 0
      if (btuh > 0) {
        const gasMat = material === 'csst' ? 'csst' : 'black-iron'
        const runLenFt = Math.max(10, lengthFt)
        const sizing = sizeFuelGasPipe({
          totalBtuh: btuh,
          longestRunFt: runLenFt,
          material: gasMat,
        })
        if (!sizing.ok) {
          push({
            severity: 'error',
            codeRef: sizing.codeRef,
            title:
              runLenFt > 200
                ? `Fuel gas run (${round2(lengthFt)} ft) exceeds 200 ft IFGC table limit`
                : `Fuel gas load (${Math.round(btuh / 1000)} kBTU/hr) exceeds max ${gasMat} table capacity`,
            detail: `${run.name ?? run.id} (${round2(lengthFt)} ft ${gasMat}) exceeds ${sizing.codeRef} limits (max ${Math.round(sizing.capacityBtuh / 1000)} kBTU/hr ${runLenFt > 200 ? 'at <= 200 ft' : `at ${round2(runLenFt)} ft`}).`,
            suggestedFix: 'Shorten gas piping run, switch to higher-capacity material/size, or design a 2 psi system with line regulators per IFGC 402.4.',
            nodeIds: [run.id],
          })
        } else if (comparePipeSizes(size, sizing.recommendedSize) < 0) {
          push({
            severity: 'error',
            codeRef: sizing.codeRef,
            title: `Fuel gas pipe (${size}) undersized for ${Math.round(btuh / 1000)} kBTU/hr`,
            detail: `${run.name ?? run.id} (${round2(lengthFt)} ft ${gasMat}) requires at least ${sizing.recommendedSize}.`,
            suggestedFix: `Upsize gas line to ${sizing.recommendedSize} per ${sizing.codeRef}.`,
            nodeIds: [run.id],
          })
        }
      }
      if (run.hasSedimentTrap === false) {
        push({
          severity: 'error',
          codeRef: 'IFGC 408.4',
          title: 'Fuel gas appliance connection missing sediment trap (drip leg)',
          detail: `${run.name ?? run.id} lacks a sediment trap downstream of the appliance shutoff valve.`,
          suggestedFix: 'Install a vertical tee and >= 3" capped nipple sediment trap ahead of the appliance inlet.',
          nodeIds: [run.id],
        })
      }
      if (run.hasShutoffWithin6Ft === false) {
        push({
          severity: 'error',
          codeRef: 'IFGC 409.5',
          title: 'Fuel gas appliance missing shutoff valve within 6 ft',
          detail: `${run.name ?? run.id} does not indicate an accessible shutoff valve within 6 ft of the appliance.`,
          suggestedFix: 'Install an approved quarter-turn gas shutoff valve in the same room within 6 ft.',
          nodeIds: [run.id],
        })
      }
    }

    // Dryer Vent (IRC M1502.4)
    if (system === 'dryer-vent') {
      const { elbows90, elbows45 } = countPathElbows(path)
      const check = checkDryerVentRun({ lengthFt, elbows90, elbows45 })
      if (!check.ok) {
        push({
          severity: 'error',
          codeRef: check.codeRef,
          title: `Dryer vent effective length (${check.effectiveLengthFt} ft) exceeds 35 ft max`,
          detail: `${run.name ?? run.id} measures ${check.lengthFt} ft + ${elbows90}×90° + ${elbows45}×45° elbows.`,
          suggestedFix: 'Shorten exhaust run, eliminate unnecessary 90° elbows, or add a listed dryer exhaust booster fan.',
          nodeIds: [run.id],
        })
      }
      if (material !== 'rigid-aluminum') {
        push({
          severity: 'error',
          codeRef: 'IRC M1502.4.1',
          title: 'Dryer exhaust duct must be smooth rigid metal',
          detail: `${run.name ?? run.id} uses ${material} instead of 4" smooth rigid aluminum/galvanized metal.`,
          suggestedFix: 'Switch dryer vent material to 4" rigid-aluminum (never vinyl or foil flex).',
          nodeIds: [run.id],
        })
      }
    }
  }

  // Per-level DWV invariants (each level with drainage requires accessible cleanout & vent stack coverage;
  // upper stories in a multi-story building inherit stack-base cleanout & main vent stack coverage from
  // lower walled levels in the same building when present)
  for (const [lvlKey, st] of dwvStateByLevel.entries()) {
    const lvlSuffix = lvlKey !== '__root__' && dwvStateByLevel.size > 1 ? ` (level ${lvlKey})` : ''
    const lowerIds = lvlKey !== '__root__' ? getLowerWalledLevelIds(nodes, lvlKey) : []
    const lowerHasCleanout = lowerIds.some((lid) => dwvStateByLevel.get(lid)?.hasAnyCleanout === true)
    const lowerHasMainVent = lowerIds.some((lid) => dwvStateByLevel.get(lid)?.hasMainVentStack === true)
    if (st.hasAnyDwvDrain && !st.hasAnyCleanout && !lowerHasCleanout) {
      push({
        severity: 'error',
        codeRef: 'IPC 708.1',
        title: `DWV system missing accessible cleanout${lvlSuffix}`,
        detail: `Drainage network${lvlSuffix} has no stack-base or building-drain cleanout marked.`,
        suggestedFix: 'Add a cleanout at the base of the main soil stack and at the building drain exit.',
        nodeIds: st.sampleDrainIds,
      })
    }
    if (st.hasAnyDwvDrain && !st.hasMainVentStack && !lowerHasMainVent) {
      push({
        severity: 'warning',
        codeRef: 'IPC 903.1',
        title: `DWV system missing 3" main vent stack through roof${lvlSuffix}`,
        detail: `Every building level with plumbing drainage${lvlSuffix} requires vent stack connection extending outdoors.`,
        suggestedFix: 'Add a 3" main soil/vent stack terminating outdoors through the roof.',
        nodeIds: st.sampleDrainIds,
      })
    }
  }

  // 4. Cross-Trade Electrical Coordination Checks (when an electrical panel exists in scene)
  if (hasElectricalPanel) {
    const coord = buildElectricalCoordination(nodes)
    for (const row of coord) {
      if (!row.wired) {
        push({
          severity: 'warning',
          codeRef: 'NEC 210 / Cross-Trade Power',
          title: `Powered plumbing unit unwired: ${row.label}`,
          detail: `${row.label} requires ${row.voltage}V ${row.poles}P ${row.breakerAmps}A (${row.loadVa} VA${row.gfciRequired ? ', GFCI' : ''}${row.dedicatedCircuit ? ', dedicated' : ''}) from the electrical panel.`,
          suggestedFix: 'Run Electrical Auto-Populate or Sync MEP Loads to add the dedicated breaker and 3D power run automatically.',
          nodeIds: [row.sourceNodeId],
        })
      }
    }
  }

  const result: PlumbingAuditResult = {
    codeEdition,
    errorCount: findings.filter((f) => f.severity === 'error').length,
    warningCount: findings.filter((f) => f.severity === 'warning').length,
    infoCount: findings.filter((f) => f.severity === 'info').length,
    findings,
  }
  byEdition.set(cacheKey, result)
  return result
}
