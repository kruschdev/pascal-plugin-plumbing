/**
 * Pure deterministic IPC / UPC / IFGC / IRC sizing calculations:
 * - DFU horizontal branch, vertical stack, and building drain sizing
 * - Vent stack sizing & trap-arm distance verification
 * - WSFU -> Hunter's Curve GPM, velocity, and Hazen-Williams pressure drop
 * - Water heater (tank / tankless / HPWH) & expansion tank sizing
 * - IFGC longest-length fuel-gas pipe sizing
 * - IRC M1502.4 rigid dryer vent effective-length check
 */

import {
  type CodeEdition,
  HUNTERS_CURVE_WSFU_TO_GPM,
  IFGC_GAS_BLACK_IRON_KBTUH,
  IFGC_GAS_CSST_KBTUH,
  IPC_BUILDING_DRAIN_MAX_DFU,
  IPC_HORIZONTAL_BRANCH_MAX_DFU,
  IPC_MAX_TRAP_ARM_FT,
  IPC_VENT_SIZING_TABLE,
  type OccupancyType,
  type PipeNominalSize,
  SUPPLY_ID_INCHES,
  SUPPLY_MATERIAL_HYDRAULICS,
  largerPipeSize,
  round2,
} from './tables'

export type DrainSizingResult = {
  dfu: number
  recommendedSize: PipeNominalSize
  minSlopeInPerFt: 0.125 | 0.25
  maxAllowedDfuAtSize: number
  codeRef: string
}

/**
 * Minimum code slope (IPC Table 704.1):
 * - <= 2-1/2": 1/4" per foot (0.25 in/ft = 2.08%)
 * - >= 3": 1/8" per foot minimum (0.125 in/ft = 1.04%), 1/4" per foot preferred.
 */
export function getMinRequiredDrainSlopeInPerFt(size: PipeNominalSize): 0.125 | 0.25 {
  if (size === '3"' || size === '4"' || size === '6"') return 0.125
  return 0.25
}

/**
 * Size a horizontal fixture branch per IPC Table 710.1(2).
 * Enforces >= 3" whenever a water closet is upstream and non-decreasing downstream sizing.
 */
export function sizeDrainBranch(params: {
  dfu: number
  hasWaterCloset?: boolean
  waterClosetCount?: number
  minUpstreamSize?: PipeNominalSize
  codeEdition?: CodeEdition
}): DrainSizingResult {
  const { dfu, hasWaterCloset = false, waterClosetCount = 0, minUpstreamSize, codeEdition = 'IPC-2021' } = params
  const effectiveWc = hasWaterCloset || waterClosetCount > 0
  let chosen = IPC_HORIZONTAL_BRANCH_MAX_DFU[IPC_HORIZONTAL_BRANCH_MAX_DFU.length - 1]!
  for (const row of IPC_HORIZONTAL_BRANCH_MAX_DFU) {
    if (dfu <= row.maxBranchDfu) {
      chosen = row
      break
    }
  }

  let size = chosen.size
  // IPC Table 710.1(2) footnote b: max 2 water closets on a 3" horizontal branch (3+ WCs -> 4")
  if (waterClosetCount > 2) {
    size = largerPipeSize(size, '4"')
  } else if (effectiveWc) {
    size = largerPipeSize(size, '3"')
  }
  if (minUpstreamSize) {
    size = largerPipeSize(size, minUpstreamSize)
  }

  const finalRow =
    IPC_HORIZONTAL_BRANCH_MAX_DFU.find((r) => r.size === size) ??
    IPC_HORIZONTAL_BRANCH_MAX_DFU[IPC_HORIZONTAL_BRANCH_MAX_DFU.length - 1]!

  return {
    dfu: round2(dfu),
    recommendedSize: size,
    minSlopeInPerFt: getMinRequiredDrainSlopeInPerFt(size),
    maxAllowedDfuAtSize: finalRow.maxBranchDfu,
    codeRef: codeEdition === 'UPC-2021' ? 'UPC Table 703.2' : 'IPC Table 710.1(2)',
  }
}

/**
 * Size the main building drain / sewer per IPC Table 710.1(1).
 */
export function sizeBuildingDrain(params: {
  totalDfu: number
  slopeInPerFt?: 0.125 | 0.25 | 0.5
  hasWaterCloset?: boolean
  waterClosetCount?: number
  codeEdition?: CodeEdition
}): DrainSizingResult {
  const {
    totalDfu,
    slopeInPerFt = 0.25,
    hasWaterCloset = true,
    waterClosetCount = hasWaterCloset ? 1 : 0,
    codeEdition = 'IPC-2021',
  } = params

  let chosen = IPC_BUILDING_DRAIN_MAX_DFU[IPC_BUILDING_DRAIN_MAX_DFU.length - 1]!
  for (const row of IPC_BUILDING_DRAIN_MAX_DFU) {
    const cap =
      slopeInPerFt <= 0.125
        ? row.slopeEighth
        : slopeInPerFt >= 0.5
          ? row.slopeHalf
          : row.slopeQuarter
    if (cap !== null && totalDfu <= cap) {
      chosen = row
      break
    }
  }

  let size = chosen.size
  // IPC 710.1: building drain receiving discharge of 3+ water closets or > 20 DFU is commonly 4"; min 3" with any WC
  if (waterClosetCount >= 4) {
    size = largerPipeSize(size, '4"')
  } else if (hasWaterCloset || waterClosetCount > 0) {
    size = largerPipeSize(size, '3"')
  }

  const finalRow =
    IPC_BUILDING_DRAIN_MAX_DFU.find((r) => r.size === size) ??
    IPC_BUILDING_DRAIN_MAX_DFU[IPC_BUILDING_DRAIN_MAX_DFU.length - 1]!
  const finalCap =
    slopeInPerFt <= 0.125
      ? (finalRow.slopeEighth ?? finalRow.slopeQuarter)
      : slopeInPerFt >= 0.5
        ? finalRow.slopeHalf
        : finalRow.slopeQuarter

  return {
    dfu: round2(totalDfu),
    recommendedSize: size,
    minSlopeInPerFt: getMinRequiredDrainSlopeInPerFt(size),
    maxAllowedDfuAtSize: finalCap,
    codeRef: codeEdition === 'UPC-2021' ? 'UPC Table 703.2' : 'IPC Table 710.1(1)',
  }
}

/**
 * Size the main vent stack per IPC Table 906.1 & IPC 903.1 (at least one 3" main stack in residential buildings).
 */
export function sizeVentStack(params: {
  totalDfu: number
  isMainStack?: boolean
  developedLengthFt?: number
}): { recommendedSize: PipeNominalSize; maxDevelopedFt: number; codeRef: string } {
  const { totalDfu, isMainStack = true } = params
  let row = IPC_VENT_SIZING_TABLE[IPC_VENT_SIZING_TABLE.length - 1]!
  for (const entry of IPC_VENT_SIZING_TABLE) {
    if (totalDfu <= entry.maxDfu) {
      row = entry
      break
    }
  }
  const size = isMainStack ? largerPipeSize(row.minVentIn, '3"') : row.minVentIn
  return {
    recommendedSize: size,
    maxDevelopedFt: row.maxDevelopedFt,
    codeRef: isMainStack ? 'IPC 903.1 / Table 906.1' : 'IPC Table 906.1',
  }
}

/**
 * Check trap-arm developed distance against IPC Table 909.1.
 */
export function checkTrapArmDistance(trapSize: PipeNominalSize, distanceFt: number): {
  ok: boolean
  maxAllowedFt: number
  distanceFt: number
  codeRef: string
} {
  const maxAllowedFt = IPC_MAX_TRAP_ARM_FT[trapSize] ?? 6
  return {
    ok: distanceFt <= maxAllowedFt + 0.05,
    maxAllowedFt,
    distanceFt: round2(distanceFt),
    codeRef: 'IPC Table 909.1',
  }
}

/**
 * Convert Water Supply Fixture Units (WSFU) to Peak Demand GPM via Modified Hunter's Curve
 * (linear interpolation across IPC Table E103.3(3)).
 */
export function wsfuToGpm(totalWsfu: number, flushType: 'flush-tank' | 'flushometer' = 'flush-tank'): number {
  if (totalWsfu <= 0) return 0
  const rows = HUNTERS_CURVE_WSFU_TO_GPM
  const field = flushType === 'flushometer' ? 'gpmFlushometer' : 'gpmTank'

  if (totalWsfu <= rows[0]!.wsfu) {
    return round2((totalWsfu / rows[0]!.wsfu) * rows[0]![field])
  }
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!
    const cur = rows[i]!
    if (totalWsfu <= cur.wsfu) {
      const t = (totalWsfu - prev.wsfu) / (cur.wsfu - prev.wsfu)
      return round2(prev[field] + t * (cur[field] - prev[field]))
    }
  }
  // Extrapolate gently above 200 WSFU
  const last = rows[rows.length - 1]!
  const prev = rows[rows.length - 2]!
  const slope = (last[field] - prev[field]) / (last.wsfu - prev.wsfu)
  return round2(last[field] + slope * (totalWsfu - last.wsfu))
}

export type SupplyHydraulicsResult = {
  size: PipeNominalSize
  innerDiameterIn: number
  gpm: number
  velocityFps: number
  maxVelocityFps: number
  velocityOk: boolean
  frictionLossPsiPer100Ft: number
  totalFrictionLossPsi: number
  codeRef: string
}

/**
 * Compute water velocity (ft/s) and Hazen-Williams pressure loss (psi/100 ft) for a given supply pipe.
 */
export function calculateSupplyHydraulics(params: {
  gpm: number
  size: PipeNominalSize
  material?: 'pex-a' | 'pex-b' | 'copper-l' | 'copper-m' | 'cpvc'
  isHot?: boolean
  lengthFt?: number
}): SupplyHydraulicsResult {
  const { gpm, size, material = 'pex-a', isHot = false, lengthFt = 50 } = params
  const hyd = SUPPLY_MATERIAL_HYDRAULICS[material]
  const idMap = SUPPLY_ID_INCHES[material]
  const idIn = idMap[size] ?? 0.671

  // v (ft/s) = 0.4085 * Q (gpm) / d(in)^2
  const velocityFps = gpm > 0 ? round2((0.4085 * gpm) / (idIn * idIn)) : 0
  const maxVelocityFps = isHot ? hyd.maxVelocityHotFps : hyd.maxVelocityColdFps

  // Hazen-Williams: hf (psi/100ft) = 452 * Q^1.852 / (C^1.852 * d^4.87)
  const frictionLossPsiPer100Ft =
    gpm > 0
      ? round2(
          (452 * Math.pow(gpm, 1.852)) / (Math.pow(hyd.cFactor, 1.852) * Math.pow(idIn, 4.87)),
        )
      : 0
  const totalFrictionLossPsi = round2((frictionLossPsiPer100Ft * lengthFt) / 100)

  return {
    size,
    innerDiameterIn: idIn,
    gpm: round2(gpm),
    velocityFps,
    maxVelocityFps,
    velocityOk: velocityFps <= maxVelocityFps,
    frictionLossPsiPer100Ft,
    totalFrictionLossPsi,
    codeRef: 'IPC 604.3 / Appendix E',
  }
}

/**
 * Select the smallest compliant domestic water supply pipe size that stays within velocity & friction limits.
 */
export function sizeSupplyPipe(params: {
  wsfu: number
  material?: 'pex-a' | 'pex-b' | 'copper-l' | 'copper-m' | 'cpvc'
  isHot?: boolean
  lengthFt?: number
  minSize?: PipeNominalSize
  flushType?: 'flush-tank' | 'flushometer'
  maxFrictionPsiPer100Ft?: number
}): SupplyHydraulicsResult {
  const {
    wsfu,
    material = 'pex-a',
    isHot = false,
    lengthFt = 50,
    minSize = '1/2"',
    flushType = 'flush-tank',
    maxFrictionPsiPer100Ft = 15,
  } = params
  const gpm = wsfuToGpm(wsfu, flushType)
  const candidates: PipeNominalSize[] = ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"']
  const startIdx = Math.max(0, candidates.indexOf(minSize))

  let lastResult = calculateSupplyHydraulics({
    gpm,
    size: candidates[candidates.length - 1]!,
    material,
    isHot,
    lengthFt,
  })
  for (let i = startIdx; i < candidates.length; i++) {
    const res = calculateSupplyHydraulics({
      gpm,
      size: candidates[i]!,
      material,
      isHot,
      lengthFt,
    })
    lastResult = res
    if (res.velocityOk && res.frictionLossPsiPer100Ft <= maxFrictionPsiPer100Ft) {
      return res
    }
  }
  return lastResult
}

export type WaterHeaterSizingResult = {
  recommendedTankGal: number
  recommendedTanklessGpm: number
  recommendedTanklessBtuh: number
  expansionTankGal: number
  electricalLoadWatts: number
  electricalBreakerAmps: number
  gasBtuh: number
  hpwhMinRoomCuFt: number
  codeRef: string
}

/**
 * Size residential or light-commercial water heating & thermal expansion tank (IPC 501 / 607.3).
 */
export function sizeWaterHeater(params: {
  bathrooms: number
  bedrooms: number
  occupancy?: OccupancyType
  fuelType?: 'gas' | 'electric' | 'hpwh' | 'tankless-gas'
  peakGpm?: number
}): WaterHeaterSizingResult {
  const { bathrooms, bedrooms, occupancy = 'residential', fuelType = 'gas', peakGpm } = params
  const effectiveBaths = Math.max(1, bathrooms)
  const effectiveBeds = Math.max(1, bedrooms)

  let recommendedTankGal = 40
  if (occupancy === 'commercial' || effectiveBaths >= 4 || effectiveBeds >= 5) {
    recommendedTankGal = 75
  } else if (effectiveBaths >= 2 || effectiveBeds >= 3) {
    recommendedTankGal = 50
  }

  const simultaneousGpm = peakGpm ? Math.min(peakGpm, 11) : Math.max(5.5, effectiveBaths * 2.5 + 1.5)
  const recommendedTanklessGpm = round2(Math.max(6.5, simultaneousGpm))
  // BTU/hr = GPM * 500 * deltaT (70°F typical) / 0.90 efficiency
  const recommendedTanklessBtuh = Math.ceil((recommendedTanklessGpm * 500 * 70) / 0.9 / 10000) * 10000

  // IPC 607.3 thermal expansion tank: 2 gal for <= 50 gal tank, 4.5 gal for 55-80 gal tank
  const expansionTankGal = recommendedTankGal <= 50 ? 2.0 : 4.5

  const electricalLoadWatts =
    fuelType === 'electric' ? 4500 : fuelType === 'hpwh' ? 4500 : 0
  const electricalBreakerAmps =
    fuelType === 'electric' || fuelType === 'hpwh' ? 30 : 0
  const gasBtuh =
    fuelType === 'tankless-gas'
      ? recommendedTanklessBtuh
      : fuelType === 'gas'
        ? recommendedTankGal >= 75
          ? 75000
          : 40000
        : 0

  return {
    recommendedTankGal,
    recommendedTanklessGpm,
    recommendedTanklessBtuh,
    expansionTankGal,
    electricalLoadWatts,
    electricalBreakerAmps,
    gasBtuh,
    hpwhMinRoomCuFt: 700,
    codeRef: 'IPC 501 / 607.3',
  }
}

export type FuelGasSizingResult = {
  totalBtuh: number
  longestRunFt: number
  material: 'black-iron' | 'csst'
  recommendedSize: PipeNominalSize
  capacityBtuh: number
  ok: boolean
  codeRef: string
}

/**
 * Longest-length natural gas pipe sizing per IFGC Table 402.4(2) (Black Iron) & Table 402.4(15) (CSST).
 */
export function sizeFuelGasPipe(params: {
  totalBtuh: number
  longestRunFt: number
  material?: 'black-iron' | 'csst'
}): FuelGasSizingResult {
  const { totalBtuh, longestRunFt, material = 'black-iron' } = params
  const kbtuh = Math.max(0, totalBtuh / 1000)

  if (material === 'csst') {
    const row =
      IFGC_GAS_CSST_KBTUH.find((r) => longestRunFt <= r.maxLengthFt) ??
      IFGC_GAS_CSST_KBTUH[IFGC_GAS_CSST_KBTUH.length - 1]!
    const sizes: Array<'1/2"' | '3/4"' | '1"' | '1-1/4"'> = ['1/2"', '3/4"', '1"', '1-1/4"']
    for (const sz of sizes) {
      if (kbtuh <= row.capacityBySize[sz]) {
        return {
          totalBtuh,
          longestRunFt: round2(longestRunFt),
          material,
          recommendedSize: sz,
          capacityBtuh: row.capacityBySize[sz] * 1000,
          ok: true,
          codeRef: 'IFGC Table 402.4(15)',
        }
      }
    }
    return {
      totalBtuh,
      longestRunFt: round2(longestRunFt),
      material,
      recommendedSize: '1-1/4"',
      capacityBtuh: row.capacityBySize['1-1/4"'] * 1000,
      ok: false,
      codeRef: 'IFGC Table 402.4(15)',
    }
  }

  const row =
    IFGC_GAS_BLACK_IRON_KBTUH.find((r) => longestRunFt <= r.maxLengthFt) ??
    IFGC_GAS_BLACK_IRON_KBTUH[IFGC_GAS_BLACK_IRON_KBTUH.length - 1]!
  const sizes: Array<'1/2"' | '3/4"' | '1"' | '1-1/4"' | '1-1/2"' | '2"'> = [
    '1/2"',
    '3/4"',
    '1"',
    '1-1/4"',
    '1-1/2"',
    '2"',
  ]
  for (const sz of sizes) {
    if (kbtuh <= row.capacityBySize[sz]) {
      return {
        totalBtuh,
        longestRunFt: round2(longestRunFt),
        material,
        recommendedSize: sz,
        capacityBtuh: row.capacityBySize[sz] * 1000,
        ok: true,
        codeRef: 'IFGC Table 402.4(2)',
      }
    }
  }
  return {
    totalBtuh,
    longestRunFt: round2(longestRunFt),
    material,
    recommendedSize: '2"',
    capacityBtuh: row.capacityBySize['2"'] * 1000,
    ok: false,
    codeRef: 'IFGC Table 402.4(2)',
  }
}

/**
 * IRC M1502.4.5.1 — Clothes dryer exhaust duct maximum equivalent length (35 ft; -5 ft per 90° elbow, -2.5 ft per 45°).
 */
export function checkDryerVentRun(params: {
  lengthFt: number
  elbows90?: number
  elbows45?: number
}): {
  ok: boolean
  lengthFt: number
  effectiveLengthFt: number
  maxAllowedFt: number
  codeRef: string
} {
  const { lengthFt, elbows90 = 2, elbows45 = 0 } = params
  const effectiveLengthFt = round2(lengthFt + elbows90 * 5 + elbows45 * 2.5)
  const maxAllowedFt = 35
  return {
    ok: effectiveLengthFt <= maxAllowedFt,
    lengthFt: round2(lengthFt),
    effectiveLengthFt,
    maxAllowedFt,
    codeRef: 'IRC M1502.4.5.1',
  }
}
