/**
 * Pure Priced Plumbing BOM Takeoff & CSV Export (`src/ipc/pricing.ts`).
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import type { SceneNodeLike } from './framing-interop'
import { type PlumbingSchedule, buildPlumbingSchedule } from './schedule'
import {
  type CodeEdition,
  type EquipmentKind,
  type FixtureKind,
  type ManifoldKind,
  type OccupancyType,
  type PipeMaterial,
  type PipeNominalSize,
  round2,
} from './tables'

export type PlumbingPricingOptions = {
  laborRateUsd?: number
  materialMarkupPct?: number
  salesTaxPct?: number
  codeEdition?: CodeEdition
  occupancy?: OccupancyType
  /** Optional precomputed schedule to avoid redundant scene scans. */
  schedule?: PlumbingSchedule
}

export type PlumbingBomLine = {
  category: 'Equipment' | 'Manifolds' | 'Fixtures' | 'Pipe & Tubing' | 'Fittings & Accessories'
  item: string
  unit: string
  quantity: number
  unitMaterialUsd: number
  materialUsd: number
  laborHours: number
  laborUsd: number
  totalUsd: number
}

export type PlumbingBomResult = {
  lines: PlumbingBomLine[]
  subtotalMaterialUsd: number
  markupUsd: number
  taxUsd: number
  subtotalLaborUsd: number
  totalLaborHours: number
  grandTotalUsd: number
}

const EQUIPMENT_PRICES: Readonly<Record<EquipmentKind, { mat: number; hrs: number; label: string }>> = {
  'water-heater-tank-gas': { mat: 980, hrs: 5.0, label: 'Gas Tank Water Heater (50/75 gal)' },
  'water-heater-tank-electric': { mat: 780, hrs: 4.0, label: 'Electric Tank Water Heater (50/75 gal)' },
  'water-heater-tankless-gas': { mat: 1650, hrs: 7.5, label: 'Tankless Condensing Gas Water Heater' },
  'water-heater-hpwh': { mat: 1890, hrs: 5.5, label: 'Hybrid Heat Pump Water Heater' },
  'expansion-tank': { mat: 68, hrs: 0.75, label: 'Thermal Expansion Tank (IPC 607.3)' },
  'main-shutoff-prv': { mat: 215, hrs: 2.0, label: 'Main Shutoff + PRV + Check Valve Assembly' },
  'water-softener': { mat: 890, hrs: 3.5, label: 'Whole-House Water Softener + Brine Tank' },
  'sump-pump': { mat: 460, hrs: 4.0, label: 'Cast-Iron Sump Pump + Basin + Check Valve' },
  'sewage-ejector': { mat: 840, hrs: 5.5, label: 'Sewage Ejector Pump + Sealed Basin' },
  'recirc-pump': { mat: 295, hrs: 2.0, label: 'Hot Water Recirculation Pump + Aquastat' },
  'gas-meter': { mat: 320, hrs: 2.5, label: 'Gas Service Meter Bar & Regulator Assembly' },
  'backwater-valve': { mat: 195, hrs: 2.0, label: 'Mainline Backwater Valve (IPC 714)' },
}

const MANIFOLD_PRICES: Readonly<Record<ManifoldKind, { mat: number; hrs: number; label: string }>> = {
  'pex-homerun': { mat: 345, hrs: 3.5, label: 'PEX Home-Run Manifold w/ Ball Valves' },
  'copper-header': { mat: 265, hrs: 3.0, label: 'Type L Copper Distribution Header' },
  'gas-csst': { mat: 185, hrs: 2.0, label: 'CSST Fuel Gas Distribution Manifold' },
}

const FIXTURE_ROUGH_PRICES: Readonly<Record<FixtureKind, { mat: number; hrs: number }>> = {
  'water-closet': { mat: 290, hrs: 2.5 },
  lavatory: { mat: 240, hrs: 2.0 },
  'kitchen-sink': { mat: 380, hrs: 2.5 },
  bathtub: { mat: 520, hrs: 4.0 },
  shower: { mat: 640, hrs: 4.5 },
  'tub-shower-combo': { mat: 680, hrs: 5.0 },
  dishwasher: { mat: 65, hrs: 1.0 },
  'clothes-washer': { mat: 95, hrs: 1.5 },
  'laundry-sink': { mat: 210, hrs: 2.0 },
  'bar-sink': { mat: 190, hrs: 1.8 },
  'floor-drain': { mat: 85, hrs: 1.5 },
  'hose-bibb': { mat: 58, hrs: 1.0 },
  bidet: { mat: 310, hrs: 2.0 },
  'garbage-disposal': { mat: 185, hrs: 1.2 },
  urinal: { mat: 420, hrs: 3.0 },
  'mop-sink': { mat: 360, hrs: 2.8 },
  'drinking-fountain': { mat: 680, hrs: 3.0 },
  'grease-interceptor': { mat: 1150, hrs: 6.0 },
}

function pipeUnitPricing(material: PipeMaterial, size: PipeNominalSize): {
  unit: string
  unitFt: number
  matPerUnit: number
  hrsPer100Ft: number
} {
  if (material === 'pex-a' || material === 'pex-b') {
    const mat = size === '1"' ? 145 : size === '3/4"' ? 95 : 62
    return { unit: '100 ft roll', unitFt: 100, matPerUnit: mat, hrsPer100Ft: 3.2 }
  }
  if (material === 'copper-l' || material === 'copper-m') {
    const mat = size === '1"' ? 128 : size === '3/4"' ? 86 : 54
    return { unit: '20 ft stick', unitFt: 20, matPerUnit: mat, hrsPer100Ft: 7.5 }
  }
  if (material === 'pvc-dwv' || material === 'abs-dwv') {
    const mat = size === '4"' ? 42 : size === '3"' ? 28 : size === '2"' ? 16 : 12
    return { unit: '10 ft stick', unitFt: 10, matPerUnit: mat, hrsPer100Ft: 5.5 }
  }
  if (material === 'cast-iron') {
    const mat = size === '4"' ? 125 : size === '3"' ? 92 : 68
    return { unit: '10 ft stick', unitFt: 10, matPerUnit: mat, hrsPer100Ft: 9.0 }
  }
  if (material === 'black-iron' || material === 'csst') {
    const mat = material === 'csst' ? 165 : size === '1"' ? 68 : size === '3/4"' ? 48 : 36
    const unitFt = material === 'csst' ? 50 : 10
    return { unit: `${unitFt} ft`, unitFt, matPerUnit: mat, hrsPer100Ft: material === 'csst' ? 4.0 : 8.5 }
  }
  return { unit: '10 ft stick', unitFt: 10, matPerUnit: 24, hrsPer100Ft: 4.5 }
}

/**
 * Generate a complete priced plumbing BOM takeoff for the scene.
 */
export function buildPlumbingBom(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  options: PlumbingPricingOptions = {},
): PlumbingBomResult {
  const {
    laborRateUsd = 115,
    materialMarkupPct = 0,
    salesTaxPct = 0,
    codeEdition = 'IPC-2021',
    occupancy = 'residential',
  } = options
  const schedule = options.schedule ?? buildPlumbingSchedule(nodes, { codeEdition, occupancy })
  const all = Object.values(nodes)
  const lines: PlumbingBomLine[] = []

  const addLine = (
    category: PlumbingBomLine['category'],
    item: string,
    unit: string,
    quantity: number,
    unitMaterialUsd: number,
    laborHours: number,
  ) => {
    if (quantity <= 0) return
    const mat = round2(quantity * unitMaterialUsd)
    const hrs = round2(laborHours)
    const lab = round2(hrs * laborRateUsd)
    lines.push({
      category,
      item,
      unit,
      quantity,
      unitMaterialUsd: round2(unitMaterialUsd),
      materialUsd: mat,
      laborHours: hrs,
      laborUsd: lab,
      totalUsd: round2(mat + lab),
    })
  }

  // 1. Equipment
  const eqCounts = new Map<EquipmentKind, number>()
  for (const n of all) {
    if (n.type !== 'plumbing:equipment') continue
    const k = (n.equipmentKind as EquipmentKind) || 'water-heater-tank-electric'
    eqCounts.set(k, (eqCounts.get(k) ?? 0) + 1)
  }
  for (const [k, qty] of eqCounts) {
    const p = EQUIPMENT_PRICES[k] ?? { mat: 350, hrs: 2.5, label: k }
    addLine('Equipment', p.label, 'ea', qty, p.mat, qty * p.hrs)
  }

  // 2. Manifolds
  const manCounts = new Map<ManifoldKind, number>()
  for (const n of all) {
    if (n.type !== 'plumbing:manifold') continue
    const k = (n.manifoldKind as ManifoldKind) || 'pex-homerun'
    manCounts.set(k, (manCounts.get(k) ?? 0) + 1)
  }
  for (const [k, qty] of manCounts) {
    const p = MANIFOLD_PRICES[k] ?? { mat: 295, hrs: 3.0, label: k }
    addLine('Manifolds', p.label, 'ea', qty, p.mat, qty * p.hrs)
  }

  // 3. Fixtures
  const fixCounts = new Map<FixtureKind, number>()
  for (const f of schedule.fixtures) {
    fixCounts.set(f.fixtureKind, (fixCounts.get(f.fixtureKind) ?? 0) + 1)
  }
  for (const [k, qty] of fixCounts) {
    const p = FIXTURE_ROUGH_PRICES[k] ?? { mat: 200, hrs: 2.0 }
    addLine('Fixtures', `${k} (rough-in + trim)`, 'ea', qty, p.mat, qty * p.hrs)
  }

  // 4. Pipe & Tubing (with 10% waste factor)
  let totalPipeFt = 0
  let totalDwvFt = 0
  let totalSupplyFt = 0
  for (const row of schedule.pipeSummary) {
    const billedFt = row.totalLengthFt * 1.1
    totalPipeFt += billedFt
    if (row.system === 'dwv-drain' || row.system === 'dwv-vent') totalDwvFt += billedFt
    if (row.system === 'cold-water' || row.system === 'hot-water' || row.system === 'hot-recirc') {
      totalSupplyFt += billedFt
    }
    const p = pipeUnitPricing(row.material, row.nominalSize)
    const qty = Math.max(1, Math.ceil(billedFt / p.unitFt))
    addLine(
      'Pipe & Tubing',
      `${row.nominalSize} ${row.material.toUpperCase()} (${row.system})`,
      p.unit,
      qty,
      p.matPerUnit,
      (billedFt / 100) * p.hrsPer100Ft,
    )
  }

  // 5. Fittings, Hangers, P-Traps, Cleanouts, Angle Stops & Consumables
  const fixTotal = schedule.fixtures.length
  if (fixTotal > 0 || totalPipeFt > 0) {
    const pTraps = all.filter((n) => n.type === 'plumbing:fixture' && n.hasPTrap !== false && n.drainSize).length
    const cleanouts = Math.max(2, all.filter((n) => n.type === 'plumbing:pipe-run' && n.hasCleanout).length)
    const dwvFittings = Math.ceil(fixTotal * 3 + totalDwvFt / 10)
    const supplyFittings = Math.ceil(fixTotal * 4 + totalSupplyFt / 15)
    const hangers = Math.ceil(totalPipeFt / 4)
    const NO_ANGLE_STOP_FIXTURES = new Set<FixtureKind>([
      'bathtub',
      'shower',
      'tub-shower-combo',
      'floor-drain',
      'hose-bibb',
      'garbage-disposal',
      'grease-interceptor',
      'urinal',
      'mop-sink',
      'drinking-fountain',
    ])
    const angleStops = schedule.fixtures.reduce((sum, f) => {
      if (NO_ANGLE_STOP_FIXTURES.has(f.fixtureKind)) return sum
      return sum + (f.wsfuCold > 0 ? 1 : 0) + (f.wsfuHot > 0 ? 1 : 0)
    }, 0)

    addLine('Fittings & Accessories', 'DWV Fittings (Wyes, Combos, Sweeps, San-Tees)', 'ea', dwvFittings, 7.5, dwvFittings * 0.08)
    addLine('Fittings & Accessories', 'Supply Fittings & Crimp/Expansion Rings', 'ea', supplyFittings, 4.2, supplyFittings * 0.05)
    addLine('Fittings & Accessories', 'P-Trap Assemblies (1-1/2" / 2")', 'ea', pTraps, 16, pTraps * 0.25)
    addLine('Fittings & Accessories', 'Cleanout Tees & Brass/PVC Plugs', 'ea', cleanouts, 24, cleanouts * 0.4)
    addLine('Fittings & Accessories', 'Quarter-Turn Angle Stops & Braided Supply Lines', 'ea', angleStops, 18, angleStops * 0.15)
    addLine('Fittings & Accessories', 'Pipe Hangers, J-Hooks, Nail Plates & Solvent Cement', 'ea', hangers, 2.5, hangers * 0.04)
  }

  const subtotalMaterialUsd = round2(lines.reduce((s, l) => s + l.materialUsd, 0))
  const subtotalLaborUsd = round2(lines.reduce((s, l) => s + l.laborUsd, 0))
  const totalLaborHours = round2(lines.reduce((s, l) => s + l.laborHours, 0))
  const markupUsd = round2(subtotalMaterialUsd * (materialMarkupPct / 100))
  const taxUsd = round2((subtotalMaterialUsd + markupUsd) * (salesTaxPct / 100))
  const grandTotalUsd = round2(subtotalMaterialUsd + markupUsd + taxUsd + subtotalLaborUsd)

  return {
    lines,
    subtotalMaterialUsd,
    markupUsd,
    taxUsd,
    subtotalLaborUsd,
    totalLaborHours,
    grandTotalUsd,
  }
}

function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function formatPlumbingBomCsv(bom: PlumbingBomResult): string {
  const header = ['Category', 'Item', 'Unit', 'Qty', 'Unit Material ($)', 'Material ($)', 'Labor (hrs)', 'Labor ($)', 'Total ($)']
  const rows = bom.lines.map((l) =>
    [
      l.category,
      l.item,
      l.unit,
      l.quantity,
      l.unitMaterialUsd.toFixed(2),
      l.materialUsd.toFixed(2),
      l.laborHours.toFixed(2),
      l.laborUsd.toFixed(2),
      l.totalUsd.toFixed(2),
    ]
      .map(csvEscape)
      .join(','),
  )
  rows.push(['Summary', 'Material Subtotal', '', '', '', bom.subtotalMaterialUsd.toFixed(2), '', '', bom.subtotalMaterialUsd.toFixed(2)].join(','))
  if (bom.markupUsd > 0) {
    rows.push(['Summary', 'Material Markup', '', '', '', bom.markupUsd.toFixed(2), '', '', bom.markupUsd.toFixed(2)].join(','))
  }
  if (bom.taxUsd > 0) {
    rows.push(['Summary', 'Sales Tax', '', '', '', bom.taxUsd.toFixed(2), '', '', bom.taxUsd.toFixed(2)].join(','))
  }
  rows.push(['Summary', 'Labor Subtotal', '', '', '', '', bom.totalLaborHours.toFixed(2), bom.subtotalLaborUsd.toFixed(2), bom.subtotalLaborUsd.toFixed(2)].join(','))
  rows.push(['Summary', 'Grand Total', '', '', '', (bom.subtotalMaterialUsd + bom.markupUsd + bom.taxUsd).toFixed(2), bom.totalLaborHours.toFixed(2), bom.subtotalLaborUsd.toFixed(2), bom.grandTotalUsd.toFixed(2)].join(','))
  return [header.join(','), ...rows].join('\n')
}
