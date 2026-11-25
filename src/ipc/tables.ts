/**
 * Pure TypeScript IPC 2021 / UPC 2021 / IFGC 2021 / IRC 2021 plumbing tables and constants.
 * Framework-free: zero Three.js, React, or `@pascal-app/*` imports.
 */

export const FEET_TO_METERS = 0.3048
export const METERS_TO_FEET = 1 / FEET_TO_METERS
export const INCHES_TO_METERS = 0.0254
export const METERS_TO_INCHES = 1 / INCHES_TO_METERS

export type CodeEdition = 'IPC-2021' | 'UPC-2021'
export type OccupancyType = 'residential' | 'commercial'
export type SupplyTopology = 'manifold' | 'trunk-and-branch'
export type FoundationType = 'slab' | 'crawlspace' | 'basement'

export type PlumbingSystem =
  | 'cold-water'
  | 'hot-water'
  | 'hot-recirc'
  | 'dwv-drain'
  | 'dwv-vent'
  | 'fuel-gas'
  | 'condensate'
  | 'dryer-vent'

export type PipeMaterial =
  | 'pex-a'
  | 'pex-b'
  | 'copper-l'
  | 'copper-m'
  | 'cpvc'
  | 'pvc-dwv'
  | 'abs-dwv'
  | 'cast-iron'
  | 'csst'
  | 'black-iron'
  | 'rigid-aluminum'

export type PipeNominalSize =
  | '3/8"'
  | '1/2"'
  | '3/4"'
  | '1"'
  | '1-1/4"'
  | '1-1/2"'
  | '2"'
  | '2-1/2"'
  | '3"'
  | '4"'
  | '6"'

export const PIPE_SIZE_ORDER: readonly PipeNominalSize[] = [
  '3/8"',
  '1/2"',
  '3/4"',
  '1"',
  '1-1/4"',
  '1-1/2"',
  '2"',
  '2-1/2"',
  '3"',
  '4"',
  '6"',
] as const

export const PIPE_NOMINAL_INCHES: Readonly<Record<PipeNominalSize, number>> = {
  '3/8"': 0.375,
  '1/2"': 0.5,
  '3/4"': 0.75,
  '1"': 1.0,
  '1-1/4"': 1.25,
  '1-1/2"': 1.5,
  '2"': 2.0,
  '2-1/2"': 2.5,
  '3"': 3.0,
  '4"': 4.0,
  '6"': 6.0,
}

/**
 * Actual outer diameter (inches) for stud-boring and 3D CAD rendering.
 * Copper/PEX CTS vs IPS Sch-40 PVC/ABS/Black-Iron.
 */
export const PIPE_OD_INCHES: Readonly<Record<PipeNominalSize, { cts: number; ips: number }>> = {
  '3/8"': { cts: 0.5, ips: 0.675 },
  '1/2"': { cts: 0.625, ips: 0.84 },
  '3/4"': { cts: 0.875, ips: 1.05 },
  '1"': { cts: 1.125, ips: 1.315 },
  '1-1/4"': { cts: 1.375, ips: 1.66 },
  '1-1/2"': { cts: 1.625, ips: 1.9 },
  '2"': { cts: 2.125, ips: 2.375 },
  '2-1/2"': { cts: 2.625, ips: 2.875 },
  '3"': { cts: 3.125, ips: 3.5 },
  '4"': { cts: 4.125, ips: 4.5 },
  '6"': { cts: 6.125, ips: 6.625 },
}

/**
 * Actual inner diameter (inches) by material family for velocity & Hazen-Williams head loss.
 */
export const SUPPLY_ID_INCHES: Readonly<
  Record<'pex-a' | 'pex-b' | 'copper-l' | 'copper-m' | 'cpvc', Readonly<Record<string, number>>>
> = {
  'pex-a': {
    '3/8"': 0.35,
    '1/2"': 0.475,
    '3/4"': 0.671,
    '1"': 0.862,
    '1-1/4"': 1.054,
    '1-1/2"': 1.244,
    '2"': 1.629,
  },
  'pex-b': {
    '3/8"': 0.35,
    '1/2"': 0.475,
    '3/4"': 0.671,
    '1"': 0.862,
    '1-1/4"': 1.054,
    '1-1/2"': 1.244,
    '2"': 1.629,
  },
  'copper-l': {
    '3/8"': 0.43,
    '1/2"': 0.545,
    '3/4"': 0.785,
    '1"': 1.025,
    '1-1/4"': 1.265,
    '1-1/2"': 1.505,
    '2"': 1.985,
  },
  'copper-m': {
    '3/8"': 0.45,
    '1/2"': 0.569,
    '3/4"': 0.811,
    '1"': 1.055,
    '1-1/4"': 1.291,
    '1-1/2"': 1.527,
    '2"': 2.009,
  },
  cpvc: {
    '3/8"': 0.36,
    '1/2"': 0.469,
    '3/4"': 0.695,
    '1"': 0.901,
    '1-1/4"': 1.105,
    '1-1/2"': 1.309,
    '2"': 1.716,
  },
}

/** Hazen-Williams C roughness factors and maximum allowable water velocity (ft/s). */
export const SUPPLY_MATERIAL_HYDRAULICS: Readonly<
  Record<
    'pex-a' | 'pex-b' | 'copper-l' | 'copper-m' | 'cpvc',
    { cFactor: number; maxVelocityColdFps: number; maxVelocityHotFps: number; stickOrRollFt: number; unitLabel: string }
  >
> = {
  'pex-a': { cFactor: 150, maxVelocityColdFps: 8, maxVelocityHotFps: 8, stickOrRollFt: 100, unitLabel: '100 ft roll' },
  'pex-b': { cFactor: 150, maxVelocityColdFps: 8, maxVelocityHotFps: 8, stickOrRollFt: 100, unitLabel: '100 ft roll' },
  'copper-l': { cFactor: 130, maxVelocityColdFps: 8, maxVelocityHotFps: 5, stickOrRollFt: 20, unitLabel: '20 ft stick' },
  'copper-m': { cFactor: 130, maxVelocityColdFps: 8, maxVelocityHotFps: 5, stickOrRollFt: 20, unitLabel: '20 ft stick' },
  cpvc: { cFactor: 150, maxVelocityColdFps: 8, maxVelocityHotFps: 8, stickOrRollFt: 10, unitLabel: '10 ft stick' },
}

export type FixtureKind =
  | 'water-closet'
  | 'lavatory'
  | 'kitchen-sink'
  | 'bathtub'
  | 'shower'
  | 'tub-shower-combo'
  | 'dishwasher'
  | 'clothes-washer'
  | 'laundry-sink'
  | 'bar-sink'
  | 'floor-drain'
  | 'hose-bibb'
  | 'bidet'
  | 'garbage-disposal'
  | 'urinal'
  | 'mop-sink'
  | 'drinking-fountain'
  | 'grease-interceptor'

export type EquipmentKind =
  | 'water-heater-tank-gas'
  | 'water-heater-tank-electric'
  | 'water-heater-tankless-gas'
  | 'water-heater-hpwh'
  | 'expansion-tank'
  | 'main-shutoff-prv'
  | 'water-softener'
  | 'sump-pump'
  | 'sewage-ejector'
  | 'recirc-pump'
  | 'gas-meter'
  | 'backwater-valve'

export type ManifoldKind = 'pex-homerun' | 'copper-header' | 'gas-csst'

export type FixtureSpec = {
  kind: FixtureKind
  label: string
  dfuIpc: number
  dfuUpc: number
  wsfuCold: number
  wsfuHot: number
  wsfuTotal: number
  minTrapIn: PipeNominalSize | null
  minDrainIn: PipeNominalSize | null
  minVentIn: PipeNominalSize | null
  supplySizeIn: PipeNominalSize | null
  needsHotWater: boolean
  needsPTrap: boolean
  /** Standard rough-in drain/supply centerline height above finished floor (meters). */
  roughInHeightM: number
  /** Flood-level rim height above finished floor (meters) for IPC 905.5 vent checks. */
  floodRimHeightM: number
  /** Nominal fixture footprint [widthM, heightM, depthM]. */
  dimensionsM: readonly [number, number, number]
  commercialOnly?: boolean
}

/**
 * IPC Table 709.1 (DFU), UPC Table 702.1 (DFU), and IPC Table E103.3(2) (WSFU).
 */
export const FIXTURE_SPECS: Readonly<Record<FixtureKind, FixtureSpec>> = {
  'water-closet': {
    kind: 'water-closet',
    label: 'Water Closet (1.28/1.6 GPF)',
    dfuIpc: 3,
    dfuUpc: 3,
    wsfuCold: 2.2,
    wsfuHot: 0,
    wsfuTotal: 2.2,
    minTrapIn: '3"',
    minDrainIn: '3"',
    minVentIn: '2"',
    supplySizeIn: '1/2"',
    needsHotWater: false,
    needsPTrap: false, // Integral trap inside porcelain bowl
    roughInHeightM: 0.15,
    floodRimHeightM: 0.42,
    dimensionsM: [0.42, 0.78, 0.70],
  },
  lavatory: {
    kind: 'lavatory',
    label: 'Lavatory / Vanity Sink',
    dfuIpc: 1,
    dfuUpc: 1,
    wsfuCold: 0.5,
    wsfuHot: 0.5,
    wsfuTotal: 0.7,
    minTrapIn: '1-1/4"',
    minDrainIn: '1-1/2"',
    minVentIn: '1-1/2"',
    supplySizeIn: '1/2"',
    needsHotWater: true,
    needsPTrap: true,
    roughInHeightM: 0.53, // ~21" AFF drain rough-in
    floodRimHeightM: 0.84,
    dimensionsM: [0.60, 0.84, 0.50],
  },
  'kitchen-sink': {
    kind: 'kitchen-sink',
    label: 'Kitchen Sink',
    dfuIpc: 2,
    dfuUpc: 2,
    wsfuCold: 1.0,
    wsfuHot: 1.0,
    wsfuTotal: 1.4,
    minTrapIn: '1-1/2"',
    minDrainIn: '2"',
    minVentIn: '1-1/2"',
    supplySizeIn: '1/2"',
    needsHotWater: true,
    needsPTrap: true,
    roughInHeightM: 0.46, // ~18" AFF drain rough-in
    floodRimHeightM: 0.91,
    dimensionsM: [0.84, 0.91, 0.56],
  },
  bathtub: {
    kind: 'bathtub',
    label: 'Alcove Bathtub',
    dfuIpc: 2,
    dfuUpc: 2,
    wsfuCold: 1.0,
    wsfuHot: 1.0,
    wsfuTotal: 1.4,
    minTrapIn: '1-1/2"',
    minDrainIn: '1-1/2"',
    minVentIn: '1-1/2"',
    supplySizeIn: '1/2"',
    needsHotWater: true,
    needsPTrap: true,
    roughInHeightM: 0.15,
    floodRimHeightM: 0.46,
    dimensionsM: [1.52, 0.50, 0.76],
  },
  shower: {
    kind: 'shower',
    label: 'Walk-In Shower',
    dfuIpc: 2,
    dfuUpc: 2,
    wsfuCold: 1.0,
    wsfuHot: 1.0,
    wsfuTotal: 1.4,
    minTrapIn: '2"',
    minDrainIn: '2"',
    minVentIn: '1-1/2"',
    supplySizeIn: '1/2"',
    needsHotWater: true,
    needsPTrap: true,
    roughInHeightM: 0.05,
    floodRimHeightM: 0.18,
    dimensionsM: [0.96, 2.05, 0.96],
  },
  'tub-shower-combo': {
    kind: 'tub-shower-combo',
    label: 'Tub / Shower Combo',
    dfuIpc: 2,
    dfuUpc: 2,
    wsfuCold: 1.0,
    wsfuHot: 1.0,
    wsfuTotal: 1.4,
    minTrapIn: '1-1/2"',
    minDrainIn: '2"',
    minVentIn: '1-1/2"',
    supplySizeIn: '1/2"',
    needsHotWater: true,
    needsPTrap: true,
    roughInHeightM: 0.15,
    floodRimHeightM: 0.46,
    dimensionsM: [1.52, 2.05, 0.80],
  },
  dishwasher: {
    kind: 'dishwasher',
    label: 'Dishwasher Hookup',
    dfuIpc: 2,
    dfuUpc: 2,
    wsfuCold: 0,
    wsfuHot: 1.4,
    wsfuTotal: 1.4,
    minTrapIn: '1-1/2"',
    minDrainIn: '2"',
    minVentIn: '1-1/2"',
    supplySizeIn: '1/2"',
    needsHotWater: true,
    needsPTrap: false, // Indirect drain via kitchen sink trap / disposal
    roughInHeightM: 0.40,
    floodRimHeightM: 0.86,
    dimensionsM: [0.60, 0.86, 0.60],
  },
  'clothes-washer': {
    kind: 'clothes-washer',
    label: 'Washer Outlet Box (2" Standpipe)',
    dfuIpc: 2,
    dfuUpc: 3,
    wsfuCold: 1.0,
    wsfuHot: 1.0,
    wsfuTotal: 1.4,
    minTrapIn: '2"',
    minDrainIn: '2"',
    minVentIn: '1-1/2"',
    supplySizeIn: '1/2"',
    needsHotWater: true,
    needsPTrap: true,
    roughInHeightM: 1.07, // ~42" AFF recessed washer box
    floodRimHeightM: 1.07,
    dimensionsM: [0.24, 0.22, 0.11],
  },
  'laundry-sink': {
    kind: 'laundry-sink',
    label: 'Laundry / Utility Sink',
    dfuIpc: 2,
    dfuUpc: 2,
    wsfuCold: 1.0,
    wsfuHot: 1.0,
    wsfuTotal: 1.4,
    minTrapIn: '1-1/2"',
    minDrainIn: '2"',
    minVentIn: '1-1/2"',
    supplySizeIn: '1/2"',
    needsHotWater: true,
    needsPTrap: true,
    roughInHeightM: 0.46,
    floodRimHeightM: 0.89,
    dimensionsM: [0.62, 0.89, 0.56],
  },
  'bar-sink': {
    kind: 'bar-sink',
    label: 'Wet-Bar Sink',
    dfuIpc: 1,
    dfuUpc: 1,
    wsfuCold: 0.5,
    wsfuHot: 0.5,
    wsfuTotal: 0.7,
    minTrapIn: '1-1/2"',
    minDrainIn: '1-1/2"',
    minVentIn: '1-1/2"',
    supplySizeIn: '1/2"',
    needsHotWater: true,
    needsPTrap: true,
    roughInHeightM: 0.46,
    floodRimHeightM: 0.91,
    dimensionsM: [0.46, 0.91, 0.46],
  },
  'floor-drain': {
    kind: 'floor-drain',
    label: 'Floor Drain (2" Trap)',
    dfuIpc: 2,
    dfuUpc: 2,
    wsfuCold: 0,
    wsfuHot: 0,
    wsfuTotal: 0,
    minTrapIn: '2"',
    minDrainIn: '2"',
    minVentIn: '1-1/2"',
    supplySizeIn: null,
    needsHotWater: false,
    needsPTrap: true,
    roughInHeightM: 0.0,
    floodRimHeightM: 0.0,
    dimensionsM: [0.16, 0.04, 0.16],
  },
  'hose-bibb': {
    kind: 'hose-bibb',
    label: 'Frost-Proof Hose Bibb (Vacuum Breaker)',
    dfuIpc: 0,
    dfuUpc: 0,
    wsfuCold: 2.5,
    wsfuHot: 0,
    wsfuTotal: 2.5,
    minTrapIn: null,
    minDrainIn: null,
    minVentIn: null,
    supplySizeIn: '1/2"',
    needsHotWater: false,
    needsPTrap: false,
    roughInHeightM: 0.46, // ~18" AFF exterior wall
    floodRimHeightM: 0.46,
    dimensionsM: [0.12, 0.14, 0.22],
  },
  bidet: {
    kind: 'bidet',
    label: 'Bidet',
    dfuIpc: 1,
    dfuUpc: 1,
    wsfuCold: 0.5,
    wsfuHot: 0.5,
    wsfuTotal: 0.7,
    minTrapIn: '1-1/4"',
    minDrainIn: '1-1/2"',
    minVentIn: '1-1/2"',
    supplySizeIn: '1/2"',
    needsHotWater: true,
    needsPTrap: true,
    roughInHeightM: 0.20,
    floodRimHeightM: 0.40,
    dimensionsM: [0.38, 0.42, 0.58],
  },
  'garbage-disposal': {
    kind: 'garbage-disposal',
    label: 'Garbage Disposal (3/4 HP)',
    dfuIpc: 2,
    dfuUpc: 2,
    wsfuCold: 0,
    wsfuHot: 0,
    wsfuTotal: 0,
    minTrapIn: '1-1/2"',
    minDrainIn: '2"',
    minVentIn: '1-1/2"',
    supplySizeIn: null,
    needsHotWater: false,
    needsPTrap: true,
    roughInHeightM: 0.42,
    floodRimHeightM: 0.91,
    dimensionsM: [0.22, 0.34, 0.22],
  },
  urinal: {
    kind: 'urinal',
    label: 'Commercial Wall-Hung Urinal',
    dfuIpc: 4,
    dfuUpc: 2,
    wsfuCold: 5.0,
    wsfuHot: 0,
    wsfuTotal: 5.0,
    minTrapIn: '2"',
    minDrainIn: '2"',
    minVentIn: '1-1/2"',
    supplySizeIn: '3/4"',
    needsHotWater: false,
    needsPTrap: false,
    roughInHeightM: 0.46,
    floodRimHeightM: 0.61,
    dimensionsM: [0.36, 0.66, 0.36],
    commercialOnly: true,
  },
  'mop-sink': {
    kind: 'mop-sink',
    label: 'Commercial Mop / Service Basin',
    dfuIpc: 3,
    dfuUpc: 3,
    wsfuCold: 1.5,
    wsfuHot: 1.5,
    wsfuTotal: 2.0,
    minTrapIn: '3"',
    minDrainIn: '3"',
    minVentIn: '2"',
    supplySizeIn: '1/2"',
    needsHotWater: true,
    needsPTrap: true,
    roughInHeightM: 0.05,
    floodRimHeightM: 0.30,
    dimensionsM: [0.61, 0.32, 0.61],
    commercialOnly: true,
  },
  'drinking-fountain': {
    kind: 'drinking-fountain',
    label: 'Commercial Drinking Fountain',
    dfuIpc: 0.5,
    dfuUpc: 0.5,
    wsfuCold: 0.25,
    wsfuHot: 0,
    wsfuTotal: 0.25,
    minTrapIn: '1-1/4"',
    minDrainIn: '1-1/2"',
    minVentIn: '1-1/4"',
    supplySizeIn: '1/2"',
    needsHotWater: false,
    needsPTrap: true,
    roughInHeightM: 0.68,
    floodRimHeightM: 0.91,
    dimensionsM: [0.46, 0.55, 0.46],
    commercialOnly: true,
  },
  'grease-interceptor': {
    kind: 'grease-interceptor',
    label: 'Commercial Grease Interceptor (50 GPM)',
    dfuIpc: 4,
    dfuUpc: 4,
    wsfuCold: 0,
    wsfuHot: 0,
    wsfuTotal: 0,
    minTrapIn: '3"',
    minDrainIn: '3"',
    minVentIn: '2"',
    supplySizeIn: null,
    needsHotWater: false,
    needsPTrap: false,
    roughInHeightM: 0.15,
    floodRimHeightM: 0.48,
    dimensionsM: [0.85, 0.50, 0.60],
    commercialOnly: true,
  },
}

/**
 * IPC Table 710.1(1) — Building Drains & Sewers maximum DFU by nominal size and slope (in/ft).
 */
export const IPC_BUILDING_DRAIN_MAX_DFU: ReadonlyArray<{
  size: PipeNominalSize
  slopeEighth: number | null // 1/8" per foot (1.04%) — allowed only for >= 3"
  slopeQuarter: number // 1/4" per foot (2.08%)
  slopeHalf: number // 1/2" per foot (4.17%)
}> = [
  { size: '1-1/2"', slopeEighth: null, slopeQuarter: 3, slopeHalf: 3 },
  { size: '2"', slopeEighth: null, slopeQuarter: 21, slopeHalf: 26 },
  { size: '2-1/2"', slopeEighth: null, slopeQuarter: 24, slopeHalf: 31 },
  { size: '3"', slopeEighth: 36, slopeQuarter: 42, slopeHalf: 50 },
  { size: '4"', slopeEighth: 180, slopeQuarter: 216, slopeHalf: 250 },
  { size: '6"', slopeEighth: 700, slopeQuarter: 840, slopeHalf: 1000 },
]

/**
 * IPC Table 710.1(2) — Horizontal Fixture Branches & Vertical Stacks max DFU.
 */
export const IPC_HORIZONTAL_BRANCH_MAX_DFU: ReadonlyArray<{
  size: PipeNominalSize
  maxBranchDfu: number
  maxStackDfu: number
}> = [
  { size: '1-1/2"', maxBranchDfu: 3, maxStackDfu: 4 },
  { size: '2"', maxBranchDfu: 6, maxStackDfu: 10 },
  { size: '2-1/2"', maxBranchDfu: 12, maxStackDfu: 20 },
  { size: '3"', maxBranchDfu: 20, maxStackDfu: 48 },
  { size: '4"', maxBranchDfu: 160, maxStackDfu: 240 },
  { size: '6"', maxBranchDfu: 620, maxStackDfu: 960 },
]

/**
 * IPC Table 909.1 — Maximum distance from trap to vent (feet) at 1/4"/ft slope (1/8"/ft for 3"-4").
 */
export const IPC_MAX_TRAP_ARM_FT: Readonly<Record<string, number>> = {
  '1-1/4"': 5,
  '1-1/2"': 6,
  '2"': 8,
  '3"': 12,
  '4"': 16,
}

/**
 * IPC Table 906.1 — Minimum vent stack / branch vent diameter by connected DFU (simplified up to 100 ft developed length).
 */
export const IPC_VENT_SIZING_TABLE: ReadonlyArray<{
  maxDfu: number
  minVentIn: PipeNominalSize
  maxDevelopedFt: number
}> = [
  { maxDfu: 8, minVentIn: '1-1/2"', maxDevelopedFt: 50 },
  { maxDfu: 24, minVentIn: '2"', maxDevelopedFt: 120 },
  { maxDfu: 48, minVentIn: '2"', maxDevelopedFt: 75 },
  { maxDfu: 212, minVentIn: '3"', maxDevelopedFt: 200 },
  { maxDfu: 500, minVentIn: '4"', maxDevelopedFt: 300 },
]

/**
 * IPC Table E103.3(3) — Modified Hunter's Curve: WSFU -> Peak Demand GPM (Flush-Tank & Flushometer).
 */
export const HUNTERS_CURVE_WSFU_TO_GPM: ReadonlyArray<{
  wsfu: number
  gpmTank: number
  gpmFlushometer: number
}> = [
  { wsfu: 1, gpmTank: 3.0, gpmFlushometer: 3.0 },
  { wsfu: 2, gpmTank: 5.0, gpmFlushometer: 5.0 },
  { wsfu: 4, gpmTank: 8.0, gpmFlushometer: 12.0 },
  { wsfu: 6, gpmTank: 10.7, gpmFlushometer: 18.0 },
  { wsfu: 10, gpmTank: 14.6, gpmFlushometer: 27.0 },
  { wsfu: 15, gpmTank: 17.0, gpmFlushometer: 31.0 },
  { wsfu: 20, gpmTank: 19.6, gpmFlushometer: 35.0 },
  { wsfu: 25, gpmTank: 22.0, gpmFlushometer: 38.0 },
  { wsfu: 30, gpmTank: 24.3, gpmFlushometer: 41.0 },
  { wsfu: 40, gpmTank: 28.5, gpmFlushometer: 46.5 },
  { wsfu: 50, gpmTank: 32.5, gpmFlushometer: 51.5 },
  { wsfu: 75, gpmTank: 41.5, gpmFlushometer: 61.0 },
  { wsfu: 100, gpmTank: 49.0, gpmFlushometer: 68.0 },
  { wsfu: 150, gpmTank: 62.5, gpmFlushometer: 80.0 },
  { wsfu: 200, gpmTank: 74.0, gpmFlushometer: 90.0 },
]

/**
 * IFGC Table 402.4(2) — Schedule 40 Black Iron Natural Gas capacity (kBTU/hr at 0.5" WC drop, 0.60 SG).
 * Keyed by longest equivalent length (ft).
 */
export const IFGC_GAS_BLACK_IRON_KBTUH: ReadonlyArray<{
  maxLengthFt: number
  capacityBySize: Readonly<Record<'1/2"' | '3/4"' | '1"' | '1-1/4"' | '1-1/2"' | '2"', number>>
}> = [
  { maxLengthFt: 20, capacityBySize: { '1/2"': 118, '3/4"': 247, '1"': 466, '1-1/4"': 957, '1-1/2"': 1430, '2"': 2760 } },
  { maxLengthFt: 40, capacityBySize: { '1/2"': 81, '3/4"': 170, '1"': 320, '1-1/4"': 657, '1-1/2"': 985, '2"': 1900 } },
  { maxLengthFt: 60, capacityBySize: { '1/2"': 65, '3/4"': 137, '1"': 257, '1-1/4"': 528, '1-1/2"': 791, '2"': 1520 } },
  { maxLengthFt: 80, capacityBySize: { '1/2"': 56, '3/4"': 117, '1"': 220, '1-1/4"': 452, '1-1/2"': 677, '2"': 1300 } },
  { maxLengthFt: 100, capacityBySize: { '1/2"': 50, '3/4"': 104, '1"': 195, '1-1/4"': 400, '1-1/2"': 600, '2"': 1160 } },
  { maxLengthFt: 150, capacityBySize: { '1/2"': 40, '3/4"': 83, '1"': 157, '1-1/4"': 322, '1-1/2"': 482, '2"': 928 } },
  { maxLengthFt: 200, capacityBySize: { '1/2"': 34, '3/4"': 71, '1"': 134, '1-1/4"': 275, '1-1/2"': 412, '2"': 794 } },
]

/**
 * IFGC Table 402.4(15) — CSST Natural Gas capacity (kBTU/hr at 0.5" WC drop), mapped to nominal trade sizes.
 */
export const IFGC_GAS_CSST_KBTUH: ReadonlyArray<{
  maxLengthFt: number
  capacityBySize: Readonly<Record<'1/2"' | '3/4"' | '1"' | '1-1/4"', number>>
}> = [
  { maxLengthFt: 20, capacityBySize: { '1/2"': 92, '3/4"': 234, '1"': 544, '1-1/4"': 1080 } },
  { maxLengthFt: 40, capacityBySize: { '1/2"': 63, '3/4"': 161, '1"': 375, '1-1/4"': 745 } },
  { maxLengthFt: 60, capacityBySize: { '1/2"': 51, '3/4"': 129, '1"': 302, '1-1/4"': 600 } },
  { maxLengthFt: 80, capacityBySize: { '1/2"': 43, '3/4"': 111, '1"': 259, '1-1/4"': 515 } },
  { maxLengthFt: 100, capacityBySize: { '1/2"': 38, '3/4"': 98, '1"': 230, '1-1/4"': 458 } },
  { maxLengthFt: 150, capacityBySize: { '1/2"': 31, '3/4"': 79, '1"': 185, '1-1/4"': 368 } },
  { maxLengthFt: 200, capacityBySize: { '1/2"': 26, '3/4"': 67, '1"': 158, '1-1/4"': 315 } },
]

/** Color coding across 3D view, 2D floorplan, and left-rail System Legend. */
export const PLUMBING_SYSTEM_COLORS: Readonly<
  Record<PlumbingSystem, { label: string; hex: string; num: number; dash2d: boolean }>
> = {
  'cold-water': { label: 'Cold Supply', hex: '#2563eb', num: 0x2563eb, dash2d: false },
  'hot-water': { label: 'Hot Supply', hex: '#dc2626', num: 0xdc2626, dash2d: true },
  'hot-recirc': { label: 'Hot Recirc', hex: '#f97316', num: 0xf97316, dash2d: true },
  'dwv-drain': { label: 'DWV Drain / Waste', hex: '#64748b', num: 0x64748b, dash2d: false },
  'dwv-vent': { label: 'DWV Vent Stack', hex: '#16a34a', num: 0x16a34a, dash2d: true },
  'fuel-gas': { label: 'Fuel Gas (IFGC)', hex: '#eab308', num: 0xeab308, dash2d: true },
  condensate: { label: 'Condensate Drain', hex: '#06b6d4', num: 0x06b6d4, dash2d: false },
  'dryer-vent': { label: 'Dryer Vent (4" Rigid)', hex: '#94a3b8', num: 0x94a3b8, dash2d: true },
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function comparePipeSizes(a: PipeNominalSize, b: PipeNominalSize): number {
  return PIPE_SIZE_ORDER.indexOf(a) - PIPE_SIZE_ORDER.indexOf(b)
}

export function largerPipeSize(a: PipeNominalSize, b: PipeNominalSize): PipeNominalSize {
  return comparePipeSizes(a, b) >= 0 ? a : b
}

export function getFixtureDfu(kind: FixtureKind, codeEdition: CodeEdition = 'IPC-2021'): number {
  const spec = FIXTURE_SPECS[kind]
  return codeEdition === 'UPC-2021' ? spec.dfuUpc : spec.dfuIpc
}

export function isCtsMaterial(material: PipeMaterial): boolean {
  return (
    material === 'pex-a' ||
    material === 'pex-b' ||
    material === 'copper-l' ||
    material === 'copper-m' ||
    material === 'cpvc'
  )
}

export function getPipeOuterDiameterM(size: PipeNominalSize, material: PipeMaterial): number {
  const entry = PIPE_OD_INCHES[size]
  const odIn = isCtsMaterial(material) ? entry.cts : entry.ips
  return odIn * INCHES_TO_METERS
}
