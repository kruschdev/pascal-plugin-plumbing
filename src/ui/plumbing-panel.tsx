/**
 * Left-rail EditorHostPanel for `krusch:plumbing`.
 * Uses scoped inline styles and Pascal CSS variables so zero global CSS leaks.
 */

import { type AnyNode, runAsSingleSceneHistoryStep } from '@pascal-app/core'
import { openEditorView, useScene, useViewer } from '@pascal-app/editor'
import { useMemo, useState } from 'react'
import { plumbingAgentOperations } from '../agent-operations'
import { auditScenePlumbing } from '../ipc/audit'
import type { BonesIngestionMode } from '../ipc/autopopulate'
import {
  type SceneNodeLike,
  belongsToLevel,
  extractBonesPlumbingContext,
} from '../ipc/framing-interop'
import { buildPlumbingSchedule } from '../ipc/schedule'
import {
  type EquipmentKind,
  FIXTURE_SPECS,
  type FixtureKind,
  type ManifoldKind,
  PLUMBING_SYSTEM_COLORS,
  type PlumbingSystem,
} from '../ipc/tables'
import { usePlumbingUi } from './store'

export const PLUMBING_SCHEDULE_VIEW_ID = 'krusch:plumbing:schedule'

function activeLevelOf(nodes: Readonly<Record<string, AnyNode>>, selectedLevelId: string | null): string | null {
  if (selectedLevelId && nodes[selectedLevelId]) return selectedLevelId
  for (const n of Object.values(nodes)) {
    if (n.type === 'level') return n.id
  }
  return null
}

const QUICK_EQUIPMENT: ReadonlyArray<{ kind: EquipmentKind; label: string }> = [
  { kind: 'water-heater-tank-electric', label: '50 gal Electric Water Heater (30A)' },
  { kind: 'water-heater-tank-gas', label: '50 gal Gas Water Heater (40 kBTU)' },
  { kind: 'water-heater-tankless-gas', label: 'Tankless Gas WH (199 kBTU)' },
  { kind: 'water-heater-hpwh', label: 'Hybrid Heat Pump WH (HPWH)' },
  { kind: 'main-shutoff-prv', label: 'Main Shutoff + PRV + Gauge' },
  { kind: 'expansion-tank', label: 'Thermal Expansion Tank (IPC 607.3)' },
  { kind: 'water-softener', label: 'Whole-House Water Softener' },
  { kind: 'sump-pump', label: 'Sump Pump + Basin (20A GFCI)' },
  { kind: 'sewage-ejector', label: 'Sewage Ejector Basin (20A GFCI)' },
  { kind: 'recirc-pump', label: 'Hot Water Recirculation Pump' },
  { kind: 'gas-meter', label: 'Natural Gas Utility Meter' },
  { kind: 'backwater-valve', label: 'Mainline Backwater Valve' },
]

const QUICK_MANIFOLDS: ReadonlyArray<{ kind: ManifoldKind; label: string }> = [
  { kind: 'pex-homerun', label: 'PEX Home-Run Manifold (12-Port)' },
  { kind: 'copper-header', label: 'Type L Copper Header (12-Port)' },
  { kind: 'gas-csst', label: 'CSST Fuel-Gas Manifold (8-Port)' },
]

const QUICK_FIXTURES: ReadonlyArray<{ kind: FixtureKind; label: string }> = [
  { kind: 'water-closet', label: 'Water Closet (3 DFU)' },
  { kind: 'lavatory', label: 'Vanity Lavatory (1 DFU)' },
  { kind: 'kitchen-sink', label: 'Kitchen Sink (2 DFU)' },
  { kind: 'bathtub', label: 'Alcove Bathtub (2 DFU)' },
  { kind: 'shower', label: 'Walk-In Shower (2 DFU)' },
  { kind: 'tub-shower-combo', label: 'Tub / Shower Combo (2 DFU)' },
  { kind: 'dishwasher', label: 'Dishwasher Hookup (20A GFCI)' },
  { kind: 'clothes-washer', label: 'Washer Box + 2" Standpipe' },
  { kind: 'laundry-sink', label: 'Laundry / Utility Sink (2 DFU)' },
  { kind: 'bar-sink', label: 'Wet-Bar Sink (1 DFU)' },
  { kind: 'floor-drain', label: '2" Floor Drain (2 DFU)' },
  { kind: 'hose-bibb', label: 'Frost-Proof Hose Bibb (Vacuum Breaker)' },
  { kind: 'bidet', label: 'Heated Bidet (15A Dedicated GFCI)' },
  { kind: 'garbage-disposal', label: 'Garbage Disposal (20A GFCI)' },
  { kind: 'urinal', label: 'Commercial Wall-Hung Urinal' },
  { kind: 'mop-sink', label: 'Commercial Mop Basin (3" Drain)' },
  { kind: 'drinking-fountain', label: 'Commercial Drinking Fountain' },
  { kind: 'grease-interceptor', label: 'Commercial Grease Interceptor (50 GPM)' },
]

function defaultEquipmentPlacementY(kind: EquipmentKind): number {
  switch (kind) {
    case 'main-shutoff-prv':
      return 0.75
    case 'expansion-tank':
      return 1.65
    case 'recirc-pump':
      return 1.25
    case 'gas-meter':
      return 0.9
    case 'backwater-valve':
      return 0.12
    default:
      return 0
  }
}

export default function PlumbingHostPanel() {
  const nodes = useScene((s) => s.nodes)
  const createNode = useScene((s) => s.createNode)
  const createNodes = useScene((s) => s.createNodes)
  const deleteNodes = useScene((s) => s.deleteNodes)
  const updateNodes = useScene((s) => s.updateNodes)
  const selectedLevelId = useViewer((s) => s.selection.levelId)
  const wallMode = useViewer((s) => s.wallMode)
  const setWallMode = useViewer((s) => s.setWallMode)
  const xrayFamily = useViewer((s) => s.xrayFamily)
  const setXrayFamily = useViewer((s) => s.setXrayFamily)

  const {
    occupancy,
    setOccupancy,
    codeEdition,
    setCodeEdition,
    supplyTopology,
    setSupplyTopology,
    supplyMaterial,
    setSupplyMaterial,
    dwvMaterial,
    setDwvMaterial,
    foundationType,
    setFoundationType,
    waterHeaterKind,
    setWaterHeaterKind,
    includeFuelGas,
    setIncludeFuelGas,
    includeDryerVent,
    setIncludeDryerVent,
    includeHotRecirc,
    setIncludeHotRecirc,
    hiddenSystems,
    toggleSystemVisibility,
    setActiveTab,
  } = usePlumbingUi()

  const [selectedEq, setSelectedEq] = useState<EquipmentKind>('water-heater-hpwh')
  const [selectedMan, setSelectedMan] = useState<ManifoldKind>('pex-homerun')
  const [selectedFix, setSelectedFix] = useState<FixtureKind>('water-closet')
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  const record = nodes as unknown as Readonly<Record<string, SceneNodeLike>>
  const levelId = activeLevelOf(nodes, selectedLevelId)
  const audit = useMemo(
    () => auditScenePlumbing(record, { codeEdition, occupancy }),
    [record, codeEdition, occupancy],
  )
  const schedule = useMemo(
    () => buildPlumbingSchedule(record, { codeEdition, occupancy, supplyMaterial }),
    [record, codeEdition, occupancy, supplyMaterial],
  )
  const bones = useMemo(() => extractBonesPlumbingContext(record, levelId), [record, levelId])

  const unwiredPowerCount = schedule.electricalCoordination.filter((c) => !c.wired).length

  const runAutoPopulate = (bonesMode: BonesIngestionMode) => {
    if (!levelId) {
      setStatusMsg('Create a building level first before auto-populating plumbing.')
      return
    }
    const outcome = plumbingAgentOperations.plumbing_autopopulate(
      nodes,
      {
        levelId,
        occupancy,
        codeEdition,
        supplyTopology,
        supplyMaterial,
        dwvMaterial,
        foundationType,
        waterHeaterKind,
        includeFuelGas,
        includeDryerVent,
        includeHotRecirc,
        bonesMode,
        clearExisting: true,
      },
      { activeLevelId: levelId },
    )
    runAsSingleSceneHistoryStep(useScene, () => {
      if (outcome.changes?.delete && outcome.changes.delete.length > 0) {
        deleteNodes(outcome.changes.delete as never)
      }
      if (outcome.changes?.create && outcome.changes.create.length > 0) {
        createNodes(outcome.changes.create as never)
      }
    })
    setStatusMsg(String(outcome.result.summary))
  }

  const clearPlumbing = () => {
    const ids = Object.values(record)
      .filter((n) => n.type.startsWith('plumbing:') && belongsToLevel(record, n, levelId))
      .map((n) => n.id)
    if (ids.length === 0) return
    runAsSingleSceneHistoryStep(useScene, () => {
      deleteNodes(ids as never)
    })
    setStatusMsg(`Cleared ${ids.length} plumbing node(s) on active level.`)
  }

  const toggleSystem = (sys: PlumbingSystem) => {
    const willHide = !hiddenSystems[sys]
    toggleSystemVisibility(sys)
    const updates = Object.values(record)
      .filter((n) => n.type === 'plumbing:pipe-run' && n.system === sys && belongsToLevel(record, n, levelId))
      .map((n) => ({ id: n.id, data: { visible: !willHide } }))
    if (updates.length > 0) {
      updateNodes(updates as never)
    }
  }

  const placeEquipment = () => {
    if (!levelId) {
      setStatusMsg('Create a building level first before placing equipment.')
      return
    }
    const existingCount = Object.values(record).filter(
      (n) => n.type === 'plumbing:equipment' && belongsToLevel(record, n, levelId),
    ).length
    const ox = Math.round((0.8 + (existingCount % 5) * 0.65) * 100) / 100
    const oz = Math.round((0.8 + Math.floor(existingCount / 5) * 0.65) * 100) / 100
    const oy = defaultEquipmentPlacementY(selectedEq)
    const outcome = plumbingAgentOperations.plumbing_place_equipment(
      nodes,
      { levelId, equipmentKind: selectedEq, position: [ox, oy, oz] },
      { activeLevelId: levelId },
    )
    const created = outcome.changes?.create?.[0]
    if (created) {
      createNode(created.node, created.parentId as never)
      setStatusMsg(`Placed ${String(outcome.result.name)}.`)
    }
  }

  const placeManifold = () => {
    if (!levelId) {
      setStatusMsg('Create a building level first before placing manifolds.')
      return
    }
    const existingCount = Object.values(record).filter(
      (n) => n.type === 'plumbing:manifold' && belongsToLevel(record, n, levelId),
    ).length
    const ox = Math.round((1.0 + (existingCount % 5) * 0.6) * 100) / 100
    const oz = Math.round((0.5 + Math.floor(existingCount / 5) * 0.6) * 100) / 100
    const portCount = selectedMan === 'gas-csst' ? 8 : 12
    const outcome = plumbingAgentOperations.plumbing_place_manifold(
      nodes,
      { levelId, manifoldKind: selectedMan, portCount, position: [ox, 1.35, oz] },
      { activeLevelId: levelId },
    )
    const created = outcome.changes?.create?.[0]
    if (created) {
      createNode(created.node, created.parentId as never)
      setStatusMsg(`Placed ${String(outcome.result.name)}.`)
    }
  }

  const placeFixture = () => {
    if (!levelId) {
      setStatusMsg('Create a building level first before placing fixtures.')
      return
    }
    const existingCount = Object.values(record).filter(
      (n) => n.type === 'plumbing:fixture' && belongsToLevel(record, n, levelId),
    ).length
    const ox = Math.round((1.2 + (existingCount % 5) * 0.75) * 100) / 100
    const oz = Math.round((1.2 + Math.floor(existingCount / 5) * 0.75) * 100) / 100
    const roughInY = FIXTURE_SPECS[selectedFix]?.roughInHeightM ?? 0.5
    const outcome = plumbingAgentOperations.plumbing_place_fixture(
      nodes,
      { levelId, fixtureKind: selectedFix, position: [ox, roughInY, oz], codeEdition },
      { activeLevelId: levelId },
    )
    const created = outcome.changes?.create?.[0]
    if (created) {
      createNode(created.node, created.parentId as never)
      setStatusMsg(`Placed ${String(outcome.result.name)}.`)
    }
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>Plumbing ({codeEdition})</strong>
        <button
          type="button"
          onClick={() => openEditorView(PLUMBING_SCHEDULE_VIEW_ID, { beside: true })}
          style={primaryBtnStyle}
        >
          Open Schedule
        </button>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <select value={codeEdition} onChange={(e) => setCodeEdition(e.target.value as 'IPC-2021' | 'UPC-2021')} style={selectStyle}>
            <option value="IPC-2021">IPC 2021</option>
            <option value="UPC-2021">UPC 2021</option>
          </select>
          <select value={occupancy} onChange={(e) => setOccupancy(e.target.value as 'residential' | 'commercial')} style={selectStyle}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </select>
          <select value={supplyTopology} onChange={(e) => setSupplyTopology(e.target.value as 'manifold' | 'trunk-and-branch')} style={selectStyle}>
            <option value="manifold">PEX Home-Run Manifold</option>
            <option value="trunk-and-branch">Trunk &amp; Branch</option>
          </select>
          <select value={foundationType} onChange={(e) => setFoundationType(e.target.value as 'slab' | 'crawlspace' | 'basement')} style={selectStyle}>
            <option value="crawlspace">Crawlspace (Under Joists)</option>
            <option value="slab">Slab-on-Grade (Under Slab)</option>
            <option value="basement">Basement (Below Joists)</option>
          </select>
          <select value={supplyMaterial} onChange={(e) => setSupplyMaterial(e.target.value as 'pex-a' | 'pex-b' | 'copper-l' | 'cpvc')} style={selectStyle}>
            <option value="pex-a">PEX-A (Expansion)</option>
            <option value="pex-b">PEX-B (Crimp)</option>
            <option value="copper-l">Type L Copper</option>
            <option value="cpvc">CPVC</option>
          </select>
          <select value={dwvMaterial} onChange={(e) => setDwvMaterial(e.target.value as 'pvc-dwv' | 'abs-dwv' | 'cast-iron')} style={selectStyle}>
            <option value="pvc-dwv">PVC Sch-40 DWV</option>
            <option value="abs-dwv">ABS DWV</option>
            <option value="cast-iron">Cast Iron (Quiet)</option>
          </select>
        </div>

        <select
          value={waterHeaterKind}
          onChange={(e) =>
            setWaterHeaterKind(
              e.target.value as
                | 'water-heater-tank-electric'
                | 'water-heater-tank-gas'
                | 'water-heater-tankless-gas'
                | 'water-heater-hpwh',
            )
          }
          style={selectStyle}
        >
          <option value="water-heater-tank-electric">Water Heater: 50 gal Electric Tank (30A 240V)</option>
          <option value="water-heater-tank-gas">Water Heater: 50 gal Gas Tank (40 kBTU)</option>
          <option value="water-heater-tankless-gas">Water Heater: Condensing Tankless Gas</option>
          <option value="water-heater-hpwh">Water Heater: Hybrid Heat Pump (HPWH)</option>
        </select>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={includeFuelGas} onChange={(e) => setIncludeFuelGas(e.target.checked)} />
            Fuel Gas (IFGC)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={includeDryerVent} onChange={(e) => setIncludeDryerVent(e.target.checked)} />
            Dryer Vent
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={includeHotRecirc} onChange={(e) => setIncludeHotRecirc(e.target.checked)} />
            Hot Recirc
          </label>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => runAutoPopulate('auto')} style={{ ...primaryBtnStyle, flex: 1 }}>
            Auto-Populate Plumbing
          </button>
          <button type="button" onClick={clearPlumbing} style={ghostBtnStyle}>
            Clear
          </button>
        </div>

        {bones.hasPlumbingSchematic && (
          <button
            type="button"
            onClick={() => runAutoPopulate('import-only')}
            style={{ ...ghostBtnStyle, width: '100%', borderColor: 'rgba(14,165,233,0.5)' }}
          >
            Import &amp; Route Bones Anchors
          </button>
        )}
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>DWV / Supply Loads</span>
          <strong>
            {schedule.loads.totalDfu} DFU · {schedule.loads.peakDemandGpm} GPM
          </strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.85 }}>
          <span>Main Drain / Stack</span>
          <span>
            {schedule.loads.recommendedBuildingDrain} / {schedule.loads.recommendedVentStack}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
          <span>IPC / IFGC Audit</span>
          <button
            type="button"
            onClick={() => {
              setActiveTab('audit')
              openEditorView(PLUMBING_SCHEDULE_VIEW_ID, { beside: true })
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: audit.errorCount > 0 ? '#ef4444' : '#22c55e',
              fontWeight: 600,
              fontSize: 11,
            }}
          >
            {audit.errorCount} Err · {audit.warningCount} Warn
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
          <span>Electrical Power Loads</span>
          <span style={{ color: unwiredPowerCount > 0 ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>
            {schedule.electricalCoordination.length - unwiredPowerCount}/{schedule.electricalCoordination.length} Wired
          </span>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 600, fontSize: 11 }}>3D Pipe &amp; Sub-Slab Inspection</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          <button
            type="button"
            onClick={() => {
              setXrayFamily(null)
              setWallMode('up')
            }}
            style={{
              ...ghostBtnStyle,
              background: xrayFamily === null && wallMode === 'up' ? 'rgba(56,189,248,0.2)' : 'transparent',
              borderColor: xrayFamily === null && wallMode === 'up' ? 'rgba(56,189,248,0.6)' : undefined,
              fontWeight: xrayFamily === null && wallMode === 'up' ? 600 : 400,
            }}
          >
            Full Walls
          </button>
          <button
            type="button"
            onClick={() => {
              setXrayFamily(null)
              setWallMode('cutaway')
            }}
            style={{
              ...ghostBtnStyle,
              background: xrayFamily === null && wallMode === 'cutaway' ? 'rgba(56,189,248,0.2)' : 'transparent',
              borderColor: xrayFamily === null && wallMode === 'cutaway' ? 'rgba(56,189,248,0.6)' : undefined,
              fontWeight: xrayFamily === null && wallMode === 'cutaway' ? 600 : 400,
            }}
          >
            Cutaway
          </button>
          <button
            type="button"
            onClick={() => {
              setXrayFamily(null)
              setWallMode('down')
            }}
            style={{
              ...ghostBtnStyle,
              background: xrayFamily === null && wallMode === 'down' ? 'rgba(56,189,248,0.2)' : 'transparent',
              borderColor: xrayFamily === null && wallMode === 'down' ? 'rgba(56,189,248,0.6)' : undefined,
              fontWeight: xrayFamily === null && wallMode === 'down' ? 600 : 400,
            }}
          >
            Low Walls
          </button>
          <button
            type="button"
            onClick={() => setXrayFamily(xrayFamily === 'other' ? null : 'other')}
            style={{
              ...ghostBtnStyle,
              background: xrayFamily === 'other' ? 'rgba(16,185,129,0.22)' : 'transparent',
              borderColor: xrayFamily === 'other' ? 'rgba(16,185,129,0.65)' : undefined,
              fontWeight: xrayFamily === 'other' ? 600 : 400,
            }}
          >
            X-Ray Plumbing
          </button>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 600, fontSize: 11 }}>System Layers (Toggle Visibility)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {(Object.keys(PLUMBING_SYSTEM_COLORS) as PlumbingSystem[]).map((sys) => {
            const meta = PLUMBING_SYSTEM_COLORS[sys]
            const hidden = hiddenSystems[sys]
            return (
              <button
                key={sys}
                type="button"
                onClick={() => toggleSystem(sys)}
                style={{
                  padding: '3px 7px',
                  borderRadius: 999,
                  fontSize: 10,
                  cursor: 'pointer',
                  border: `1px solid ${meta.hex}`,
                  background: hidden ? 'transparent' : `${meta.hex}26`,
                  opacity: hidden ? 0.45 : 1,
                  color: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: meta.hex }} />
                {meta.label}
              </button>
            )
          })}
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 600, fontSize: 11 }}>Catalog Placement</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={selectedEq} onChange={(e) => setSelectedEq(e.target.value as EquipmentKind)} style={{ ...selectStyle, flex: 1 }}>
            {QUICK_EQUIPMENT.map((item) => (
              <option key={item.kind} value={item.kind}>
                {item.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={placeEquipment} style={ghostBtnStyle}>
            + Eq
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={selectedMan} onChange={(e) => setSelectedMan(e.target.value as ManifoldKind)} style={{ ...selectStyle, flex: 1 }}>
            {QUICK_MANIFOLDS.map((item) => (
              <option key={item.kind} value={item.kind}>
                {item.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={placeManifold} style={ghostBtnStyle}>
            + Man
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={selectedFix} onChange={(e) => setSelectedFix(e.target.value as FixtureKind)} style={{ ...selectStyle, flex: 1 }}>
            {QUICK_FIXTURES.map((item) => (
              <option key={item.kind} value={item.kind}>
                {item.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={placeFixture} style={ghostBtnStyle}>
            + Fix
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setActiveTab('manifold')
            openEditorView(PLUMBING_SCHEDULE_VIEW_ID, { beside: true })
          }}
          style={{ ...ghostBtnStyle, width: '100%' }}
        >
          Inspect 3D Manifold &amp; Wet-Wall Cutaway
        </button>
      </div>

      {statusMsg && <div style={{ fontSize: 11, opacity: 0.8 }}>{statusMsg}</div>}
    </div>
  )
}

const sectionStyle = {
  padding: 8,
  borderRadius: 8,
  border: '1px solid var(--border, rgba(255,255,255,0.14))',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
}

const selectStyle = {
  padding: '4px 6px',
  borderRadius: 6,
  border: '1px solid var(--border, rgba(255,255,255,0.18))',
  background: 'var(--background, rgba(15,23,42,0.75))',
  color: 'inherit',
  fontSize: 11,
}

const primaryBtnStyle = {
  padding: '5px 9px',
  borderRadius: 6,
  border: '1px solid rgba(37,99,235,0.6)',
  background: 'rgba(37,99,235,0.22)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
}

const ghostBtnStyle = {
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid var(--border, rgba(255,255,255,0.2))',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 11,
}
