/**
 * Layer 3 — Single-Source Declarative IPC / IRC / IFGC Code Rules (`src/ipc/rules.ts`).
 *
 * Encodes plumbing code thresholds ONCE as a validated `DeclarativeRule[]` table consumed by
 * BOTH placement/routing generators (`autopopulate.ts`, `routing.ts`, `sizing.ts`) in `'placement'`
 * mode and the post-hoc compliance auditor (`audit.ts`) in `'audit'` mode (`INV-MEP-08`).
 *
 * Framework-free: zero React, Three.js, `@pascal-app/*`, Next, Zod, or `node:*` imports.
 */

import {
  type CandidateEvaluationResult,
  type DeclarativeRule,
  type ElevationBandRule,
  type MaterialPolicyRule,
  type PlacementCandidate,
  type RoutingConstraintRule,
  type RuleEvaluationMode,
  type WallCavityFitRule,
  effectivePlacementThreshold,
  evaluatePlacementCandidate,
  validateRuleTable,
} from '@kruschdev/pascal-mep-kernel'

const IPC_704_1_DRAIN_SLOPE_SMALL_RULE: RoutingConstraintRule = {
  id: 'ipc-704-1-drain-slope-small',
  kind: 'routing-constraint',
  trade: 'plumbing',
  codeRef: 'IPC 704.1',
  severity: 'error',
  category: 'dwv-slope',
  title: 'DWV drain (<= 2-1/2") slope below 1/4" per foot minimum',
  suggestedFix: 'Increase downward pitch to at least 0.25"/ft (2.08%) per IPC Table 704.1.',
  params: {
    targetSystems: ['dwv-drain-small'],
    minSlopeInPerFt: 0.25,
  },
}

const IPC_704_1_DRAIN_SLOPE_LARGE_RULE: RoutingConstraintRule = {
  id: 'ipc-704-1-drain-slope-large',
  kind: 'routing-constraint',
  trade: 'plumbing',
  codeRef: 'IPC 704.1',
  severity: 'error',
  category: 'dwv-slope',
  title: 'DWV drain (>= 3") slope below 1/8" per foot minimum',
  suggestedFix: 'Increase downward pitch to at least 0.125"/ft (1.04%) per IPC Table 704.1.',
  params: {
    targetSystems: ['dwv-drain-large'],
    minSlopeInPerFt: 0.125,
  },
}

const IPC_905_5_DRY_VENT_HEIGHT_RULE: ElevationBandRule = {
  id: 'ipc-905-5-dry-vent-height',
  kind: 'elevation-band',
  trade: 'plumbing',
  codeRef: 'IPC 905.5',
  severity: 'error',
  category: 'dwv-vent',
  title: 'Horizontal dry vent below 6" above fixture flood-level rim',
  suggestedFix:
    'Rise vertically inside wet wall to at least 6" above fixture flood-level rim before turning horizontal.',
  placementMarginM: 0.04,
  params: {
    targetKinds: ['dwv-vent', 'dwv-dry-vent'],
    minAboveFloodRimM: 0.1524,
  },
}

const IPC_903_1_MAIN_VENT_STACK_RULE: RoutingConstraintRule = {
  id: 'ipc-903-1-main-vent-stack',
  kind: 'routing-constraint',
  trade: 'plumbing',
  codeRef: 'IPC 903.1',
  severity: 'error',
  category: 'dwv-vent',
  title: 'Main vent stack below 3" minimum diameter',
  suggestedFix: 'Upsize the main vent stack through roof to at least 3" per IPC 903.1.',
  params: {
    targetSystems: ['dwv-main-vent-stack'],
    minNominalSizeIn: 3,
  },
}

const IPC_708_1_CLEANOUT_INTERVAL_RULE: RoutingConstraintRule = {
  id: 'ipc-708-1-cleanout-interval',
  kind: 'routing-constraint',
  trade: 'plumbing',
  codeRef: 'IPC 708.1',
  severity: 'warning',
  category: 'dwv-cleanout',
  title: 'Building drain > 100 ft without intermediate cleanout',
  suggestedFix: 'Add an accessible two-way cleanout at <= 100 ft intervals.',
  params: {
    targetSystems: ['dwv-drain', 'dwv-drain-small', 'dwv-drain-large'],
    maxLengthFtWithoutCleanout: 100,
  },
}

const IRC_R602_6_WET_WALL_FIT_RULE: WallCavityFitRule = {
  id: 'irc-r602-6-wet-wall-fit',
  kind: 'wall-cavity-fit',
  trade: 'plumbing',
  codeRef: 'IRC R602.6 / Wet Wall',
  severity: 'error',
  category: 'wet-wall',
  title: 'Wet wall too thin for >= 3" DWV pipe',
  suggestedFix: 'Upgrade this wet wall to 2x6 framing (>= 0.15 m thick) or add a dedicated pipe chase.',
  placementMarginM: 0.005,
  params: {
    minPipeNominalIn: 3,
    minWallThicknessM: 0.14,
    max2x4WallThicknessM: 0.125,
  },
}

const IRC_M1502_4_DRYER_VENT_RULE: RoutingConstraintRule = {
  id: 'irc-m1502-4-dryer-vent',
  kind: 'routing-constraint',
  trade: 'plumbing',
  codeRef: 'IRC M1502.4.5.1',
  severity: 'error',
  category: 'dryer-vent',
  title: 'Dryer vent effective length exceeds 35 ft max',
  suggestedFix:
    'Shorten exhaust run, eliminate unnecessary 90° elbows, or add a listed dryer exhaust booster fan.',
  params: {
    targetSystems: ['dryer-vent'],
    maxEffectiveLengthFt: 35,
  },
}

const IRC_M1502_4_1_DRYER_VENT_MATERIAL_RULE: MaterialPolicyRule = {
  id: 'irc-m1502-4-1-dryer-vent-material',
  kind: 'material-policy',
  trade: 'plumbing',
  codeRef: 'IRC M1502.4.1',
  severity: 'error',
  category: 'dryer-vent',
  title: 'Dryer exhaust duct must be smooth rigid metal',
  suggestedFix: 'Switch dryer vent material to 4" rigid-aluminum (never vinyl or foil flex).',
  params: {
    targetSystems: ['dryer-vent'],
    requiredMaterials: ['rigid-aluminum'],
  },
}

const IFGC_402_4_FUEL_GAS_MAX_LEN_RULE: RoutingConstraintRule = {
  id: 'ifgc-402-4-fuel-gas-max-len',
  kind: 'routing-constraint',
  trade: 'plumbing',
  codeRef: 'IFGC 402.4',
  severity: 'error',
  category: 'fuel-gas',
  title: 'Fuel gas run exceeds 200 ft IFGC table limit',
  suggestedFix:
    'Shorten gas piping run, switch to higher-capacity material/size, or design a 2 psi system with line regulators per IFGC 402.4.',
  params: {
    targetSystems: ['fuel-gas'],
    maxEffectiveLengthFt: 200,
  },
}

/**
 * Authoritative single-source IPC / IRC / IFGC declarative code rule table (`INV-MEP-08`).
 */
export const IPC_DECLARATIVE_RULES: readonly DeclarativeRule[] = Object.freeze([
  IPC_704_1_DRAIN_SLOPE_SMALL_RULE,
  IPC_704_1_DRAIN_SLOPE_LARGE_RULE,
  IPC_905_5_DRY_VENT_HEIGHT_RULE,
  IPC_903_1_MAIN_VENT_STACK_RULE,
  IPC_708_1_CLEANOUT_INTERVAL_RULE,
  IRC_R602_6_WET_WALL_FIT_RULE,
  IRC_M1502_4_DRYER_VENT_RULE,
  IRC_M1502_4_1_DRYER_VENT_MATERIAL_RULE,
  IFGC_402_4_FUEL_GAS_MAX_LEN_RULE,
])

const ruleValidation = validateRuleTable(IPC_DECLARATIVE_RULES)
if (!ruleValidation.valid) {
  throw new Error(`Invalid IPC_DECLARATIVE_RULES table: ${ruleValidation.errors.join('; ')}`)
}

export type IpcRuleId =
  | 'ipc-704-1-drain-slope-small'
  | 'ipc-704-1-drain-slope-large'
  | 'ipc-905-5-dry-vent-height'
  | 'ipc-903-1-main-vent-stack'
  | 'ipc-708-1-cleanout-interval'
  | 'irc-r602-6-wet-wall-fit'
  | 'irc-m1502-4-dryer-vent'
  | 'irc-m1502-4-1-dryer-vent-material'
  | 'ifgc-402-4-fuel-gas-max-len'

export type IpcRuleByIdMap = {
  readonly 'ipc-704-1-drain-slope-small': RoutingConstraintRule
  readonly 'ipc-704-1-drain-slope-large': RoutingConstraintRule
  readonly 'ipc-905-5-dry-vent-height': ElevationBandRule
  readonly 'ipc-903-1-main-vent-stack': RoutingConstraintRule
  readonly 'ipc-708-1-cleanout-interval': RoutingConstraintRule
  readonly 'irc-r602-6-wet-wall-fit': WallCavityFitRule
  readonly 'irc-m1502-4-dryer-vent': RoutingConstraintRule
  readonly 'irc-m1502-4-1-dryer-vent-material': MaterialPolicyRule
  readonly 'ifgc-402-4-fuel-gas-max-len': RoutingConstraintRule
}

const IPC_RULES_BY_ID: IpcRuleByIdMap = {
  'ipc-704-1-drain-slope-small': IPC_704_1_DRAIN_SLOPE_SMALL_RULE,
  'ipc-704-1-drain-slope-large': IPC_704_1_DRAIN_SLOPE_LARGE_RULE,
  'ipc-905-5-dry-vent-height': IPC_905_5_DRY_VENT_HEIGHT_RULE,
  'ipc-903-1-main-vent-stack': IPC_903_1_MAIN_VENT_STACK_RULE,
  'ipc-708-1-cleanout-interval': IPC_708_1_CLEANOUT_INTERVAL_RULE,
  'irc-r602-6-wet-wall-fit': IRC_R602_6_WET_WALL_FIT_RULE,
  'irc-m1502-4-dryer-vent': IRC_M1502_4_DRYER_VENT_RULE,
  'irc-m1502-4-1-dryer-vent-material': IRC_M1502_4_1_DRYER_VENT_MATERIAL_RULE,
  'ifgc-402-4-fuel-gas-max-len': IFGC_402_4_FUEL_GAS_MAX_LEN_RULE,
}

/**
 * Retrieve a strongly-typed declarative IPC/IRC/IFGC rule by canonical `IpcRuleId`.
 */
export function getIpcRuleById<K extends IpcRuleId>(id: K): IpcRuleByIdMap[K] {
  return IPC_RULES_BY_ID[id]
}

/**
 * Authoritative single-source numeric thresholds derived directly from `IPC_DECLARATIVE_RULES`.
 * Zero duplicated magic numbers between generators (`'placement'`) and auditors (`'audit'`).
 */
export const IPC_RULE_THRESHOLDS = Object.freeze({
  drainSlopeSmallInPerFt: IPC_704_1_DRAIN_SLOPE_SMALL_RULE.params.minSlopeInPerFt as 0.25,
  drainSlopeLargeInPerFt: IPC_704_1_DRAIN_SLOPE_LARGE_RULE.params.minSlopeInPerFt as 0.125,
  ventMinAboveFloodRimM: IPC_905_5_DRY_VENT_HEIGHT_RULE.params.minAboveFloodRimM!,
  ventPlacementMarginM: IPC_905_5_DRY_VENT_HEIGHT_RULE.placementMarginM!,
  ventPlacementMinAboveFloodRimM: effectivePlacementThreshold(
    IPC_905_5_DRY_VENT_HEIGHT_RULE.params.minAboveFloodRimM!,
    IPC_905_5_DRY_VENT_HEIGHT_RULE.placementMarginM,
    'min',
  ),
  mainVentStackMinNominalIn: IPC_903_1_MAIN_VENT_STACK_RULE.params.minNominalSizeIn!,
  cleanoutMaxIntervalFt: IPC_708_1_CLEANOUT_INTERVAL_RULE.params.maxLengthFtWithoutCleanout!,
  wetWallMinPipeNominalIn: IRC_R602_6_WET_WALL_FIT_RULE.params.minPipeNominalIn,
  wetWallMinThicknessM: IRC_R602_6_WET_WALL_FIT_RULE.params.minWallThicknessM,
  wetWallPlacementMinThicknessM: effectivePlacementThreshold(
    IRC_R602_6_WET_WALL_FIT_RULE.params.minWallThicknessM,
    IRC_R602_6_WET_WALL_FIT_RULE.placementMarginM,
    'min',
  ),
  wetWallMax2x4ThicknessM: IRC_R602_6_WET_WALL_FIT_RULE.params.max2x4WallThicknessM,
  dryerVentMaxEffectiveLengthFt: IRC_M1502_4_DRYER_VENT_RULE.params.maxEffectiveLengthFt!,
  dryerVentRequiredMaterials: IRC_M1502_4_1_DRYER_VENT_MATERIAL_RULE.params.requiredMaterials!,
  fuelGasMaxEffectiveLengthFt: IFGC_402_4_FUEL_GAS_MAX_LEN_RULE.params.maxEffectiveLengthFt!,
  /** Unified IFGC 402.4 minimum sizing table row: 10 ft statutory audit floor, 15 ft conservative placement floor (>= audit). */
  fuelGasMinSizingLengthAuditFt: 10,
  fuelGasMinSizingLengthPlacementFt: 15,
})

/**
 * Evaluate a plumbing candidate against `IPC_DECLARATIVE_RULES` (or a targeted subset)
 * in either `'placement'` (conservative) or `'audit'` (exact statutory) mode.
 */
export function evaluateIpcRuleCandidate(
  candidate: PlacementCandidate,
  mode: RuleEvaluationMode = 'placement',
  ruleIds?: readonly IpcRuleId[],
): CandidateEvaluationResult {
  const rules = ruleIds ? ruleIds.map((id) => IPC_RULES_BY_ID[id]) : IPC_DECLARATIVE_RULES
  return evaluatePlacementCandidate(rules, candidate, mode)
}
