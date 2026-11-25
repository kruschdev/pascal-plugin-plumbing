/**
 * 42-Model Clean-Room MIT 3D Plumbing CAD Catalog Registry (`src/cad/catalog.ts`).
 * Editor-free and React-free: zero React or `@pascal-app/editor` imports.
 */

import type { Group } from 'three'
import type { EquipmentKind, FixtureKind, ManifoldKind } from '../ipc/tables'
import { buildEquipmentCad } from './equipment'
import { type FittingCadKind, buildFittingCad, buildPipeRunCad } from './fittings'
import { buildFixtureCad } from './fixtures'
import { buildManifoldCad, buildWiredManifoldCutawayCad } from './manifold-interior'

export type PlumbingCadCategory =
  | 'Water Heaters & Mechanical Equipment'
  | 'PEX & Fuel-Gas Manifolds'
  | 'Residential & Commercial Fixtures'
  | 'DWV Fittings & Cleanouts'
  | 'Supply & Fuel-Gas Valves'
  | 'Pipe Runs & Cutaway Assemblies'

export type PlumbingCadPartEntry = {
  id: string
  category: PlumbingCadCategory
  title: string
  codeRef: string
  build: () => Group
}

const eqEntry = (id: string, kind: EquipmentKind, title: string, codeRef: string): PlumbingCadPartEntry => ({
  id,
  category: 'Water Heaters & Mechanical Equipment',
  title,
  codeRef,
  build: () => buildEquipmentCad({ equipmentKind: kind }),
})

const fixEntry = (id: string, kind: FixtureKind, title: string, codeRef: string): PlumbingCadPartEntry => ({
  id,
  category: 'Residential & Commercial Fixtures',
  title,
  codeRef,
  build: () => buildFixtureCad({ fixtureKind: kind }),
})

const fitEntry = (
  id: string,
  kind: FittingCadKind,
  category: PlumbingCadCategory,
  title: string,
  codeRef: string,
): PlumbingCadPartEntry => ({
  id,
  category,
  title,
  codeRef,
  build: () => buildFittingCad(kind),
})

const manEntry = (
  id: string,
  kind: ManifoldKind,
  portCount: number,
  coverRemoved: boolean,
  title: string,
  codeRef: string,
): PlumbingCadPartEntry => ({
  id,
  category: 'PEX & Fuel-Gas Manifolds',
  title,
  codeRef,
  build: () => buildManifoldCad({ manifoldKind: kind, portCount, coverRemoved }),
})

export const PLUMBING_CAD_CATALOG: readonly PlumbingCadPartEntry[] = [
  // Category 1: Water Heaters & Mechanical Equipment (12)
  eqEntry('wh-tank-electric-50', 'water-heater-tank-electric', '50 Gal Electric Tank Water Heater', 'IPC 501 / 504'),
  eqEntry('wh-tank-gas-50', 'water-heater-tank-gas', '50 Gal Gas Tank Water Heater w/ Flue', 'IPC 501 / IFGC'),
  eqEntry('wh-tankless-gas', 'water-heater-tankless-gas', 'Wall-Hung Condensing Tankless Gas WH', 'IPC 501 / IFGC'),
  eqEntry('wh-hybrid-hpwh', 'water-heater-hpwh', 'Hybrid Heat Pump Water Heater (HPWH)', 'IPC 501 / IMC 304'),
  eqEntry('thermal-expansion-tank', 'expansion-tank', '2 Gal Thermal Expansion Tank', 'IPC 607.3'),
  eqEntry('main-shutoff-prv-assembly', 'main-shutoff-prv', 'Main Water Shutoff, PRV & Pressure Gauge', 'IPC 604.8 / 606'),
  eqEntry('whole-house-water-softener', 'water-softener', 'Whole-House Water Softener & Brine Tank', 'IPC 611'),
  eqEntry('sump-pump-basin', 'sump-pump', 'Cast-Iron Sump Pump, Basin & Check Valve', 'IPC 1113'),
  eqEntry('sewage-ejector-basin', 'sewage-ejector', 'Sealed Sewage Ejector Basin w/ 2" Vent', 'IPC 712'),
  eqEntry('hot-water-recirc-pump', 'recirc-pump', 'Hot Water Recirculation Pump', 'IPC 607.2'),
  eqEntry('utility-gas-meter', 'gas-meter', 'Natural Gas Utility Meter & Regulator', 'IFGC 402'),
  eqEntry('mainline-backwater-valve', 'backwater-valve', 'Mainline Sanitary Backwater Valve', 'IPC 714'),

  // Category 2: PEX & Fuel-Gas Manifolds (4)
  manEntry('pex-manifold-12-open', 'pex-homerun', 12, true, '12-Port PEX Home-Run Manifold (Open)', 'IPC 604 / 606'),
  manEntry('pex-manifold-24-closed', 'pex-homerun', 24, false, '24-Port PEX Manifold w/ Steel Enclosure', 'IPC 604 / 606'),
  manEntry('copper-distribution-header', 'copper-header', 12, true, 'Type L Copper Trunk Distribution Header', 'IPC 605.3'),
  manEntry('csst-gas-manifold', 'gas-csst', 8, true, '8-Port CSST Fuel-Gas Distribution Manifold', 'IFGC 402.4(15)'),

  // Category 3: Residential & Commercial Fixtures (14)
  fixEntry('fixture-water-closet', 'water-closet', 'Elongated Water Closet (1.28 GPF)', 'IPC Table 709.1'),
  fixEntry('fixture-lavatory', 'lavatory', 'Vanity Lavatory w/ P-Trap & Angle Stops', 'IPC Table 709.1'),
  fixEntry('fixture-kitchen-sink', 'kitchen-sink', 'Undermount Kitchen Sink w/ Gooseneck Faucet', 'IPC Table 709.1'),
  fixEntry('fixture-bathtub', 'bathtub', 'Alcove Bathtub w/ Mixing Valve & Spout', 'IPC Table 709.1'),
  fixEntry('fixture-shower', 'shower', 'Walk-In Shower Pan & Pressure-Balance Valve', 'IPC 412.3'),
  fixEntry('fixture-tub-shower-combo', 'tub-shower-combo', 'Tub / Shower Combo Rough-In Assembly', 'IPC 412.3'),
  fixEntry('fixture-dishwasher', 'dishwasher', 'Dishwasher Rough-In & Indirect Drain', 'IPC 802.1.6'),
  fixEntry('fixture-washer-box', 'clothes-washer', 'Recessed Washer Outlet Box & 2" Standpipe', 'IPC 802.4.3.1'),
  fixEntry('fixture-laundry-sink', 'laundry-sink', 'Laundry / Utility Basin w/ Rough-In', 'IPC Table 709.1'),
  fixEntry('fixture-bar-sink', 'bar-sink', 'Wet-Bar Sink Assembly', 'IPC Table 709.1'),
  fixEntry('fixture-floor-drain', 'floor-drain', '2" Cast-Iron Floor Drain w/ Chrome Strainer', 'IPC 413'),
  fixEntry('fixture-hose-bibb', 'hose-bibb', 'Frost-Proof Exterior Hose Bibb w/ Vacuum Breaker', 'IPC 608.15.4.2'),
  fixEntry('fixture-urinal', 'urinal', 'Commercial Wall-Hung Urinal w/ Flushometer', 'IPC Table 709.1'),
  fixEntry('fixture-mop-sink', 'mop-sink', 'Commercial Mop / Service Basin (3" Drain)', 'IPC Table 709.1'),

  // Category 4: DWV Fittings & Cleanouts (7)
  fitEntry('fitting-p-trap', 'p-trap', 'DWV Fittings & Cleanouts', '1-1/2" / 2" Solvent-Weld PVC P-Trap', 'IPC 1002.1'),
  fitEntry('fitting-sanitary-tee', 'sanitary-tee', 'DWV Fittings & Cleanouts', '3" Vertical Sanitary Tee', 'IPC Table 706.3'),
  fitEntry('fitting-wye-combo', 'wye-combo', 'DWV Fittings & Cleanouts', '3" 45° Wye / Combo Drainage Fitting', 'IPC Table 706.3'),
  fitEntry('fitting-long-sweep-90', 'long-sweep-90', 'DWV Fittings & Cleanouts', '3" Long-Sweep 90° DWV Elbow', 'IPC Table 706.3'),
  fitEntry('fitting-cleanout-tee', 'cleanout-tee', 'DWV Fittings & Cleanouts', '3" Two-Way Cleanout Tee w/ Brass Plug', 'IPC 708.1'),
  fitEntry('fitting-roof-vent-flashing', 'roof-vent-flashing', 'DWV Fittings & Cleanouts', '3" Roof Vent Stack Flashing Boot', 'IPC 903.2'),
  fitEntry('fitting-aav-studor', 'aav-studor', 'DWV Fittings & Cleanouts', 'Air Admittance Valve (AAV / Studor)', 'IPC 918'),

  // Category 5: Supply & Fuel-Gas Valves (4)
  fitEntry('valve-full-port-ball', 'ball-valve', 'Supply & Fuel-Gas Valves', '3/4" Full-Port Brass Ball Valve', 'IPC 606'),
  fitEntry('valve-quarter-turn-stop', 'angle-stop', 'Supply & Fuel-Gas Valves', 'Quarter-Turn Chrome Angle Stop', 'IPC 606.2'),
  fitEntry('valve-thermostatic-mixing', 'mixing-valve', 'Supply & Fuel-Gas Valves', 'Thermostatic Anti-Scald Mixing Valve', 'IPC 607.1.2'),
  fitEntry('valve-gas-drip-leg', 'gas-drip-leg', 'Supply & Fuel-Gas Valves', 'Fuel-Gas Sediment Trap (Drip Leg) & Shutoff', 'IFGC 408.4 / 409.5'),

  // Category 6: Pipe Runs & Cutaway Assemblies (1 + hanger = 2 -> 43 total, or 42 exact!)
  {
    id: 'assembly-wet-wall-manifold-cutaway',
    category: 'Pipe Runs & Cutaway Assemblies',
    title: '2x6 Wet-Wall PEX Manifold & 3" Stack Cutaway',
    codeRef: 'IRC R602.6 / IPC 604',
    build: () =>
      buildWiredManifoldCutawayCad({
        manifoldKind: 'pex-homerun',
        portCount: 12,
        viewMode: 'wet-wall-cutaway',
      }),
  },
] as const

export function buildPlumbingCadPart(partId: string): Group | null {
  const entry = PLUMBING_CAD_CATALOG.find((p) => p.id === partId)
  return entry ? entry.build() : null
}

export { buildPipeRunCad }
