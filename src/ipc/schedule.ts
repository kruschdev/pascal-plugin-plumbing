/**
 * Pure Plumbing Schedule, Load Summary, and Electrical Power Coordination Table (`src/ipc/schedule.ts`).
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import {
  type ElectricalPowerDemand,
  type SceneNodeLike,
  getEquipmentElectricalDemand,
  getFixtureElectricalDemand,
  resolveNodeLevelId,
} from './framing-interop'
import { polylineLengthM } from './routing'
import {
  sizeBuildingDrain,
  sizeFuelGasPipe,
  sizeSupplyPipe,
  sizeVentStack,
  sizeWaterHeater,
  wsfuToGpm,
} from './sizing'
import {
  type CodeEdition,
  type EquipmentKind,
  FIXTURE_SPECS,
  type FixtureKind,
  METERS_TO_FEET,
  type OccupancyType,
  type PipeMaterial,
  type PipeNominalSize,
  type PlumbingSystem,
  getFixtureDfu,
  getFixtureWsfu,
  round2,
} from './tables'

export type FixtureScheduleRow = {
  nodeId: string
  name: string
  roomName: string
  fixtureKind: FixtureKind
  dfu: number
  wsfuCold: number
  wsfuHot: number
  wsfuTotal: number
  trapSize: PipeNominalSize | null
  drainSize: PipeNominalSize | null
  ventSize: PipeNominalSize | null
  supplySize: PipeNominalSize | null
  roughInHeightIn: number
}

export type PipeSystemSummaryRow = {
  system: PlumbingSystem
  material: PipeMaterial
  nominalSize: PipeNominalSize
  runCount: number
  totalLengthFt: number
}

export type ElectricalCoordinationRow = {
  sourceNodeId: string
  sourceType: 'plumbing:equipment' | 'plumbing:fixture'
  label: string
  voltage: number
  poles: 1 | 2 | 3
  breakerAmps: number
  loadVa: number
  dedicatedCircuit: boolean
  gfciRequired: boolean
  wired: boolean
  matchedElectricalDeviceId?: string
  matchedCircuitNumber?: number
}

export type PlumbingLoadSummary = {
  codeEdition: CodeEdition
  occupancy: OccupancyType
  fixtureCount: number
  waterClosetCount: number
  totalDfu: number
  totalWsfuCold: number
  totalWsfuHot: number
  totalWsfu: number
  peakDemandGpm: number
  recommendedBuildingDrain: PipeNominalSize
  recommendedVentStack: PipeNominalSize
  recommendedColdMain: PipeNominalSize
  recommendedHotMain: PipeNominalSize
  coldVelocityFps: number
  hotVelocityFps: number
  totalGasBtuh: number
  recommendedGasMain: PipeNominalSize | null
  waterHeaterRecommendation: ReturnType<typeof sizeWaterHeater>
}

export type PlumbingSchedule = {
  fixtures: FixtureScheduleRow[]
  pipeSummary: PipeSystemSummaryRow[]
  electricalCoordination: ElectricalCoordinationRow[]
  loads: PlumbingLoadSummary
}

/**
 * Resolve the authoritative electrical power demand for a plumbing equipment or fixture node.
 * Recomputes from the current `equipmentKind` / `fixtureKind` whenever the unit is passive
 * or persisted `electricalDemand` metadata is stale from a previous kind switch.
 */
export function resolveNodeElectricalDemand(n: SceneNodeLike): ElectricalPowerDemand | null {
  const raw = n.electricalDemand as Partial<ElectricalPowerDemand> | undefined

  if (n.type === 'plumbing:equipment' && typeof n.equipmentKind === 'string') {
    const expected = getEquipmentElectricalDemand(
      n.equipmentKind as EquipmentKind,
      typeof n.watts === 'number' && n.watts > 0 ? n.watts : undefined,
    )
    if (!expected) return null
    if (
      raw &&
      typeof raw === 'object' &&
      raw.required === true &&
      raw.voltage === expected.voltage &&
      raw.poles === expected.poles &&
      raw.loadVa === expected.loadVa &&
      raw.breakerAmps === expected.breakerAmps &&
      raw.label === expected.label
    ) {
      return {
        ...expected,
        gfciRequired: typeof raw.gfciRequired === 'boolean' ? raw.gfciRequired : expected.gfciRequired,
        afciRequired: typeof raw.afciRequired === 'boolean' ? raw.afciRequired : expected.afciRequired,
      }
    }
    return expected
  }

  if (n.type === 'plumbing:fixture' && typeof n.fixtureKind === 'string') {
    const expected = getFixtureElectricalDemand(n.fixtureKind as FixtureKind)
    if (!expected) return null
    if (
      raw &&
      typeof raw === 'object' &&
      raw.required === true &&
      raw.voltage === expected.voltage &&
      raw.poles === expected.poles &&
      raw.loadVa === expected.loadVa &&
      raw.breakerAmps === expected.breakerAmps &&
      raw.label === expected.label
    ) {
      return {
        ...expected,
        gfciRequired: typeof raw.gfciRequired === 'boolean' ? raw.gfciRequired : expected.gfciRequired,
        afciRequired: typeof raw.afciRequired === 'boolean' ? raw.afciRequired : expected.afciRequired,
      }
    }
    return expected
  }

  return null
}

/**
 * Match powered plumbing equipment/fixtures against same-level `electrical:device` nodes in the scene
 * so users see live `WIRED` vs `UNWIRED` coordination with `@kruschdev/pascal-plugin-electrical`.
 */
export function buildElectricalCoordination(
  nodes: Readonly<Record<string, SceneNodeLike>>,
): ElectricalCoordinationRow[] {
  const all = Object.values(nodes)
  const elecDevices = all.filter((n) => n.type === 'electrical:device')

  // Count how many devices share each (panelId, circuitNumber) so dedicated plumbing loads do not match shared countertop circuits
  const circuitDeviceCounts = new Map<string, number>()
  for (const d of elecDevices) {
    if (typeof d.circuitNumber === 'number' && d.circuitNumber > 0) {
      const key = `${String(d.panelId ?? '')}:${d.circuitNumber}`
      circuitDeviceCounts.set(key, (circuitDeviceCounts.get(key) ?? 0) + 1)
    }
  }

  const rows: ElectricalCoordinationRow[] = []

  for (const n of all) {
    if (n.type !== 'plumbing:equipment' && n.type !== 'plumbing:fixture') continue
    const demand = resolveNodeElectricalDemand(n)
    if (!demand || !demand.required) continue

    const nodeLevelId = resolveNodeLevelId(nodes, n)
    const pos = Array.isArray(n.position) && n.position.length >= 3 ? n.position : null
    let matchedDevice: SceneNodeLike | undefined
    for (const d of elecDevices) {
      // Explicit source link (direct or inside metadata) always wins
      const meta = d.metadata as { mepSourceNodeId?: string } | undefined
      if (d.mepSourceNodeId === n.id || meta?.mepSourceNodeId === n.id) {
        matchedDevice = d
        break
      }
      // Never match devices across different building levels!
      if (resolveNodeLevelId(nodes, d) !== nodeLevelId) continue

      const dPos = Array.isArray(d.position) && d.position.length >= 3 ? d.position : null
      if (!pos || !dPos) continue
      const dist = Math.hypot(pos[0] - dPos[0], pos[2] - dPos[2])
      const dPoles = typeof d.poles === 'number' ? d.poles : 1
      const dAmps = typeof d.breakerAmps === 'number' ? d.breakerAmps : 15
      if (dist > 1.5 || dPoles < demand.poles || dAmps < demand.breakerAmps) continue

      // When the plumbing load requires a dedicated circuit, require a dedicated/single-load circuit match
      if (demand.dedicatedCircuit) {
        const isDedicatedKind = d.deviceKind === 'dedicated-240v' || dPoles >= 2
        const cktKey =
          typeof d.circuitNumber === 'number' && d.circuitNumber > 0
            ? `${String(d.panelId ?? '')}:${d.circuitNumber}`
            : null
        const isSingleLoadCircuit = cktKey !== null && (circuitDeviceCounts.get(cktKey) ?? 0) === 1
        if (!isDedicatedKind && !isSingleLoadCircuit) continue
      }
      matchedDevice = d
      break
    }

    rows.push({
      sourceNodeId: n.id,
      sourceType: n.type as 'plumbing:equipment' | 'plumbing:fixture',
      label: demand.label,
      voltage: demand.voltage,
      poles: demand.poles,
      breakerAmps: demand.breakerAmps,
      loadVa: demand.loadVa,
      dedicatedCircuit: demand.dedicatedCircuit,
      gfciRequired: demand.gfciRequired,
      wired: Boolean(matchedDevice),
      matchedElectricalDeviceId: matchedDevice?.id,
      matchedCircuitNumber:
        typeof matchedDevice?.circuitNumber === 'number' ? matchedDevice.circuitNumber : undefined,
    })
  }
  return rows
}

const scheduleCache = new WeakMap<
  Readonly<Record<string, SceneNodeLike>>,
  Map<string, PlumbingSchedule>
>()

/**
 * Compile the full Fixture Schedule, Pipe System Summary, Load Summary, and Electrical Coordination Table.
 * WeakMap-memoized per scene nodes object reference.
 */
export function buildPlumbingSchedule(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  options: {
    codeEdition?: CodeEdition
    occupancy?: OccupancyType
    supplyMaterial?: 'pex-a' | 'pex-b' | 'copper-l' | 'copper-m' | 'cpvc'
  } = {},
): PlumbingSchedule {
  const { codeEdition = 'IPC-2021', occupancy = 'residential', supplyMaterial = 'pex-a' } = options
  const cacheKey = `${codeEdition}|${occupancy}|${supplyMaterial}`
  let byKey = scheduleCache.get(nodes)
  if (!byKey) {
    byKey = new Map()
    scheduleCache.set(nodes, byKey)
  }
  const cached = byKey.get(cacheKey)
  if (cached) return cached

  const all = Object.values(nodes)

  const fixtures: FixtureScheduleRow[] = []
  let totalDfu = 0
  let totalWsfuCold = 0
  let totalWsfuHot = 0
  let totalWsfu = 0
  let wcCount = 0

  for (const n of all) {
    if (n.type !== 'plumbing:fixture') continue
    const kind = (typeof n.fixtureKind === 'string' && n.fixtureKind in FIXTURE_SPECS
      ? n.fixtureKind
      : 'lavatory') as FixtureKind
    const spec = FIXTURE_SPECS[kind]
    const ratedWsfu = getFixtureWsfu(kind, occupancy)
    const dfu = typeof n.dfu === 'number' ? n.dfu : getFixtureDfu(kind, codeEdition)
    const wsfuCold =
      occupancy === 'commercial'
        ? Math.max(ratedWsfu.cold, typeof n.wsfuCold === 'number' ? n.wsfuCold : 0)
        : typeof n.wsfuCold === 'number'
          ? n.wsfuCold
          : ratedWsfu.cold
    const wsfuHot =
      occupancy === 'commercial'
        ? Math.max(ratedWsfu.hot, typeof n.wsfuHot === 'number' ? n.wsfuHot : 0)
        : typeof n.wsfuHot === 'number'
          ? n.wsfuHot
          : ratedWsfu.hot
    const wsfuTotal =
      occupancy === 'commercial'
        ? Math.max(ratedWsfu.total, typeof n.wsfuTotal === 'number' ? n.wsfuTotal : 0)
        : typeof n.wsfuTotal === 'number'
          ? n.wsfuTotal
          : ratedWsfu.total

    totalDfu += dfu
    totalWsfuCold += wsfuCold
    totalWsfuHot += wsfuHot
    totalWsfu += wsfuTotal
    if (kind === 'water-closet') wcCount += 1

    fixtures.push({
      nodeId: n.id,
      name: typeof n.name === 'string' && n.name ? n.name : spec.label,
      roomName: typeof n.roomName === 'string' && n.roomName ? n.roomName : 'General',
      fixtureKind: kind,
      dfu,
      wsfuCold,
      wsfuHot,
      wsfuTotal,
      trapSize: (n.trapSize as PipeNominalSize | null | undefined) ?? spec.minTrapIn,
      drainSize: (n.drainSize as PipeNominalSize | null | undefined) ?? spec.minDrainIn,
      ventSize: (n.ventSize as PipeNominalSize | null | undefined) ?? spec.minVentIn,
      supplySize: (n.supplySize as PipeNominalSize | null | undefined) ?? spec.supplySizeIn,
      roughInHeightIn: Math.round(spec.roughInHeightM * 39.37),
    })
  }

  // Group pipe runs by (system, material, nominalSize)
  const pipeMap = new Map<string, PipeSystemSummaryRow>()
  let longestGasFt = 0
  let totalGasBtuh = 0
  let hasCsstGas = false
  let hasBlackIronGas = false

  for (const n of all) {
    if (n.type === 'plumbing:manifold' && n.manifoldKind === 'gas-csst') {
      hasCsstGas = true
    }
    // Exclude supply-source gas-meter from appliance demand summation so totalGasBtuh is never doubled.
    // Also ingest `hvac:equipment` gas furnaces (zero-coupling cross-trade IFGC gas demand).
    if (
      ((n.type === 'plumbing:equipment' && n.equipmentKind !== 'gas-meter') ||
        n.type === 'hvac:equipment') &&
      typeof n.gasBtuh === 'number' &&
      n.gasBtuh > 0
    ) {
      totalGasBtuh += n.gasBtuh
    }
    if (n.type !== 'plumbing:pipe-run') continue
    const system = (n.system as PlumbingSystem) || 'cold-water'
    const material = (n.material as PipeMaterial) || 'pex-a'
    const nominalSize = (n.nominalSize as PipeNominalSize) || '1/2"'
    const path = Array.isArray(n.path) ? (n.path as ReadonlyArray<readonly [number, number, number]>) : []
    const lengthFt = polylineLengthM(path) * METERS_TO_FEET

    if (system === 'fuel-gas') {
      longestGasFt = Math.max(longestGasFt, lengthFt)
      if (material === 'csst') hasCsstGas = true
      if (material === 'black-iron') hasBlackIronGas = true
      if (typeof n.gasBtuh === 'number' && n.gasBtuh > totalGasBtuh) {
        totalGasBtuh = n.gasBtuh
      }
    }

    const key = `${system}|${material}|${nominalSize}`
    const existing = pipeMap.get(key)
    if (existing) {
      existing.runCount += 1
      existing.totalLengthFt = round2(existing.totalLengthFt + lengthFt)
    } else {
      pipeMap.set(key, {
        system,
        material,
        nominalSize,
        runCount: 1,
        totalLengthFt: round2(lengthFt),
      })
    }
  }

  const flushType = occupancy === 'commercial' ? 'flushometer' : 'flush-tank'
  const drainSizing = sizeBuildingDrain({
    totalDfu,
    slopeInPerFt: 0.25,
    hasWaterCloset: wcCount > 0,
    waterClosetCount: wcCount,
    codeEdition,
  })
  const ventSizing = sizeVentStack({ totalDfu, isMainStack: true })
  const coldMain = sizeSupplyPipe({
    wsfu: Math.max(1, totalWsfu),
    material: supplyMaterial,
    isHot: false,
    minSize: '3/4"',
    flushType,
  })
  const hotMain = sizeSupplyPipe({
    wsfu: Math.max(1, totalWsfuHot),
    material: supplyMaterial,
    isHot: true,
    minSize: '3/4"',
    flushType,
  })

  const peakDemandGpm = wsfuToGpm(totalWsfu, flushType)
  const bathroomCount = Math.max(1, wcCount)
  const whRec = sizeWaterHeater({
    bathrooms: bathroomCount,
    bedrooms: Math.max(2, bathroomCount + 1),
    occupancy,
    peakGpm: peakDemandGpm,
  })

  const detectedGasMaterial: 'black-iron' | 'csst' = hasCsstGas && !hasBlackIronGas ? 'csst' : 'black-iron'
  const gasSizing =
    totalGasBtuh > 0
      ? sizeFuelGasPipe({
          totalBtuh: totalGasBtuh,
          longestRunFt: Math.max(25, longestGasFt),
          material: detectedGasMaterial,
        })
      : null

  const result: PlumbingSchedule = {
    fixtures,
    pipeSummary: [...pipeMap.values()].sort((a, b) => a.system.localeCompare(b.system)),
    electricalCoordination: buildElectricalCoordination(nodes),
    loads: {
      codeEdition,
      occupancy,
      fixtureCount: fixtures.length,
      waterClosetCount: wcCount,
      totalDfu: round2(totalDfu),
      totalWsfuCold: round2(totalWsfuCold),
      totalWsfuHot: round2(totalWsfuHot),
      totalWsfu: round2(totalWsfu),
      peakDemandGpm,
      recommendedBuildingDrain: drainSizing.recommendedSize,
      recommendedVentStack: ventSizing.recommendedSize,
      recommendedColdMain: coldMain.size,
      recommendedHotMain: hotMain.size,
      coldVelocityFps: coldMain.velocityFps,
      hotVelocityFps: hotMain.velocityFps,
      totalGasBtuh,
      recommendedGasMain: gasSizing ? gasSizing.recommendedSize : null,
      waterHeaterRecommendation: whRec,
    },
  }
  byKey.set(cacheKey, result)
  return result
}

function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function formatPlumbingScheduleCsv(schedule: PlumbingSchedule): string {
  const header = [
    'Fixture',
    'Room',
    'Kind',
    'DFU',
    'Cold WSFU',
    'Hot WSFU',
    'Trap',
    'Drain',
    'Vent',
    'Supply',
    'Rough-In (in AFF)',
  ]
  const rows = schedule.fixtures.map((f) =>
    [
      f.name,
      f.roomName,
      f.fixtureKind,
      f.dfu,
      f.wsfuCold,
      f.wsfuHot,
      f.trapSize ?? '-',
      f.drainSize ?? '-',
      f.ventSize ?? '-',
      f.supplySize ?? '-',
      f.roughInHeightIn,
    ]
      .map(csvEscape)
      .join(','),
  )
  return [header.join(','), ...rows].join('\n')
}
