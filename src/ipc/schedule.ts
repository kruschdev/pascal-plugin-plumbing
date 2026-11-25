/**
 * Pure Plumbing Schedule, Load Summary, and Electrical Power Coordination Table (`src/ipc/schedule.ts`).
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import {
  type ElectricalPowerDemand,
  type SceneNodeLike,
  getEquipmentElectricalDemand,
  getFixtureElectricalDemand,
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

function readElectricalDemandFromNode(n: SceneNodeLike): ElectricalPowerDemand | null {
  const raw = n.electricalDemand as Partial<ElectricalPowerDemand> | undefined
  if (raw && typeof raw === 'object' && raw.required === true) {
    return {
      required: true,
      voltage: (raw.voltage === 240 || raw.voltage === 208 || raw.voltage === 480 ? raw.voltage : 120),
      poles: (raw.poles === 2 || raw.poles === 3 ? raw.poles : 1),
      breakerAmps: typeof raw.breakerAmps === 'number' ? raw.breakerAmps : 20,
      loadVa: typeof raw.loadVa === 'number' ? raw.loadVa : 1200,
      continuous: Boolean(raw.continuous),
      dedicatedCircuit: Boolean(raw.dedicatedCircuit),
      gfciRequired: Boolean(raw.gfciRequired),
      afciRequired: Boolean(raw.afciRequired),
      loadCategory: (raw.loadCategory ?? 'appliance') as ElectricalPowerDemand['loadCategory'],
      label: typeof raw.label === 'string' && raw.label ? raw.label : (n.name ?? n.id),
    }
  }
  if (n.type === 'plumbing:equipment' && typeof n.equipmentKind === 'string') {
    return getEquipmentElectricalDemand(
      n.equipmentKind as EquipmentKind,
      typeof n.watts === 'number' ? n.watts : undefined,
    )
  }
  if (n.type === 'plumbing:fixture' && typeof n.fixtureKind === 'string') {
    return getFixtureElectricalDemand(n.fixtureKind as FixtureKind)
  }
  return null
}

/**
 * Match powered plumbing equipment/fixtures against nearby `electrical:device` nodes in the scene
 * so users see live `WIRED` vs `UNWIRED` coordination with `@kruschdev/pascal-plugin-electrical`.
 */
export function buildElectricalCoordination(
  nodes: Readonly<Record<string, SceneNodeLike>>,
): ElectricalCoordinationRow[] {
  const all = Object.values(nodes)
  const elecDevices = all.filter((n) => n.type === 'electrical:device')
  const rows: ElectricalCoordinationRow[] = []

  for (const n of all) {
    if (n.type !== 'plumbing:equipment' && n.type !== 'plumbing:fixture') continue
    const demand = readElectricalDemandFromNode(n)
    if (!demand || !demand.required) continue

    const pos = Array.isArray(n.position) && n.position.length >= 3 ? n.position : null
    let matchedDevice: SceneNodeLike | undefined
    for (const d of elecDevices) {
      // Explicit source link (direct or inside metadata) OR close proximity (< 1.5 m) with matching voltage/poles
      const meta = d.metadata as { mepSourceNodeId?: string } | undefined
      if (d.mepSourceNodeId === n.id || meta?.mepSourceNodeId === n.id) {
        matchedDevice = d
        break
      }
      const dPos = Array.isArray(d.position) && d.position.length >= 3 ? d.position : null
      if (!pos || !dPos) continue
      const dist = Math.hypot(pos[0] - dPos[0], pos[2] - dPos[2])
      const dPoles = typeof d.poles === 'number' ? d.poles : 1
      const dAmps = typeof d.breakerAmps === 'number' ? d.breakerAmps : 15
      if (dist <= 1.5 && dPoles >= demand.poles && dAmps >= demand.breakerAmps) {
        matchedDevice = d
        break
      }
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

/**
 * Compile the full Fixture Schedule, Pipe System Summary, Load Summary, and Electrical Coordination Table.
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
    const dfu = typeof n.dfu === 'number' ? n.dfu : getFixtureDfu(kind, codeEdition)
    const wsfuCold = typeof n.wsfuCold === 'number' ? n.wsfuCold : spec.wsfuCold
    const wsfuHot = typeof n.wsfuHot === 'number' ? n.wsfuHot : spec.wsfuHot
    const wsfuTotal = typeof n.wsfuTotal === 'number' ? n.wsfuTotal : spec.wsfuTotal

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

  for (const n of all) {
    if (n.type === 'plumbing:equipment' && typeof n.gasBtuh === 'number' && n.gasBtuh > 0) {
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

  const gasSizing =
    totalGasBtuh > 0
      ? sizeFuelGasPipe({
          totalBtuh: totalGasBtuh,
          longestRunFt: Math.max(25, longestGasFt),
          material: 'black-iron',
        })
      : null

  return {
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
