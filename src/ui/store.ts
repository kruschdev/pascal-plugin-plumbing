'use client'

/**
 * Isolated Zustand UI state store for `krusch:plumbing`.
 * Never mutates or extends Pascal's `useScene`, `useEditor`, or `useViewer` stores.
 */

import { create } from 'zustand'
import type { ManifoldCutawayViewMode } from '../cad/manifold-interior'
import type {
  CodeEdition,
  FoundationType,
  OccupancyType,
  PlumbingSystem,
  SupplyTopology,
} from '../ipc/tables'

export type PlumbingScheduleTab =
  | 'fixtures'
  | 'loads'
  | 'audit'
  | 'penetrations'
  | 'bom'
  | 'manifold'

type PlumbingUiState = {
  occupancy: OccupancyType
  codeEdition: CodeEdition
  supplyTopology: SupplyTopology
  supplyMaterial: 'pex-a' | 'pex-b' | 'copper-l' | 'cpvc'
  dwvMaterial: 'pvc-dwv' | 'abs-dwv' | 'cast-iron'
  foundationType: FoundationType
  waterHeaterKind:
    | 'water-heater-tank-electric'
    | 'water-heater-tank-gas'
    | 'water-heater-tankless-gas'
    | 'water-heater-hpwh'
  includeFuelGas: boolean
  includeDryerVent: boolean
  includeHotRecirc: boolean
  activeTab: PlumbingScheduleTab
  manifoldViewMode: ManifoldCutawayViewMode
  selectedManifoldId: string | null
  hiddenSystems: Readonly<Record<PlumbingSystem, boolean>>
  setOccupancy: (v: OccupancyType) => void
  setCodeEdition: (v: CodeEdition) => void
  setSupplyTopology: (v: SupplyTopology) => void
  setSupplyMaterial: (v: 'pex-a' | 'pex-b' | 'copper-l' | 'cpvc') => void
  setDwvMaterial: (v: 'pvc-dwv' | 'abs-dwv' | 'cast-iron') => void
  setFoundationType: (v: FoundationType) => void
  setWaterHeaterKind: (
    v:
      | 'water-heater-tank-electric'
      | 'water-heater-tank-gas'
      | 'water-heater-tankless-gas'
      | 'water-heater-hpwh',
  ) => void
  setIncludeFuelGas: (v: boolean) => void
  setIncludeDryerVent: (v: boolean) => void
  setIncludeHotRecirc: (v: boolean) => void
  setActiveTab: (v: PlumbingScheduleTab) => void
  setManifoldViewMode: (v: ManifoldCutawayViewMode) => void
  setSelectedManifoldId: (id: string | null) => void
  toggleSystemVisibility: (sys: PlumbingSystem) => void
}

export const usePlumbingUi = create<PlumbingUiState>((set) => ({
  occupancy: 'residential',
  codeEdition: 'IPC-2021',
  supplyTopology: 'manifold',
  supplyMaterial: 'pex-a',
  dwvMaterial: 'pvc-dwv',
  foundationType: 'crawlspace',
  waterHeaterKind: 'water-heater-tank-electric',
  includeFuelGas: false,
  includeDryerVent: true,
  includeHotRecirc: false,
  activeTab: 'fixtures',
  manifoldViewMode: 'wet-wall-cutaway',
  selectedManifoldId: null,
  hiddenSystems: {
    'cold-water': false,
    'hot-water': false,
    'hot-recirc': false,
    'dwv-drain': false,
    'dwv-vent': false,
    'fuel-gas': false,
    condensate: false,
    'dryer-vent': false,
  },
  setOccupancy: (occupancy) => set({ occupancy }),
  setCodeEdition: (codeEdition) => set({ codeEdition }),
  setSupplyTopology: (supplyTopology) => set({ supplyTopology }),
  setSupplyMaterial: (supplyMaterial) => set({ supplyMaterial }),
  setDwvMaterial: (dwvMaterial) => set({ dwvMaterial }),
  setFoundationType: (foundationType) => set({ foundationType }),
  setWaterHeaterKind: (waterHeaterKind) => set({ waterHeaterKind }),
  setIncludeFuelGas: (includeFuelGas) => set({ includeFuelGas }),
  setIncludeDryerVent: (includeDryerVent) => set({ includeDryerVent }),
  setIncludeHotRecirc: (includeHotRecirc) => set({ includeHotRecirc }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setManifoldViewMode: (manifoldViewMode) => set({ manifoldViewMode }),
  setSelectedManifoldId: (selectedManifoldId) => set({ selectedManifoldId }),
  toggleSystemVisibility: (sys) =>
    set((s) => ({
      hiddenSystems: { ...s.hiddenSystems, [sys]: !s.hiddenSystems[sys] },
    })),
}))
