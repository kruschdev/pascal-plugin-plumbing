/**
 * Full-pane EditorHostView (`krusch:plumbing:schedule`) that opens beside the 3D/2D scene:
 * 6 Tabs: Fixtures | Loads & Electrical | IPC/IFGC Audit | Framing Drill List | Priced BOM | 3D Manifold Cutaway.
 */

import { useScene, useViewer } from '@pascal-app/editor'
import { useMemo, useState } from 'react'
import { auditScenePlumbing } from '../ipc/audit'
import {
  type SceneNodeLike,
  type Vec3,
  computePipeFramingPenetrations,
  extractBonesPlumbingContext,
} from '../ipc/framing-interop'
import { buildPlumbingBom, formatPlumbingBomCsv } from '../ipc/pricing'
import { extractWallSegments } from '../ipc/routing'
import { buildPlumbingSchedule, formatPlumbingScheduleCsv } from '../ipc/schedule'
import type { ManifoldKind, PipeMaterial, PipeNominalSize } from '../ipc/tables'
import ManifoldCutawayView from './manifold-cutaway-view'
import { type PlumbingScheduleTab, usePlumbingUi } from './store'

export default function PlumbingScheduleView() {
  const nodes = useScene((s) => s.nodes)
  const setSelection = useViewer((s) => s.setSelection)
  const {
    codeEdition,
    occupancy,
    activeTab,
    setActiveTab,
    manifoldViewMode,
    setManifoldViewMode,
  } = usePlumbingUi()

  const [laborRateUsd, setLaborRateUsd] = useState(115)
  const [materialMarkupPct, setMaterialMarkupPct] = useState(0)
  const [salesTaxPct, setSalesTaxPct] = useState(0)
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null)

  const record = nodes as unknown as Readonly<Record<string, SceneNodeLike>>
  const schedule = useMemo(() => buildPlumbingSchedule(record, { codeEdition, occupancy }), [record, codeEdition, occupancy])
  const audit = useMemo(() => auditScenePlumbing(record, { codeEdition }), [record, codeEdition])
  const bom = useMemo(
    () => buildPlumbingBom(record, { codeEdition, laborRateUsd, materialMarkupPct, salesTaxPct }),
    [record, codeEdition, laborRateUsd, materialMarkupPct, salesTaxPct],
  )

  const penetrations = useMemo(() => {
    const walls = extractWallSegments(record, null)
    const bones = extractBonesPlumbingContext(record, null)
    const out = []
    for (const n of Object.values(record)) {
      if (n.type !== 'plumbing:pipe-run' || !Array.isArray(n.path)) continue
      out.push(
        ...computePipeFramingPenetrations({
          pipeRunId: n.id,
          path: n.path as ReadonlyArray<Vec3>,
          pipeSize: (n.nominalSize as PipeNominalSize) || '1/2"',
          material: (n.material as PipeMaterial) || 'pex-a',
          walls,
          bonesContext: bones,
        }),
      )
    }
    return out
  }, [record])

  const firstManifold = useMemo(
    () => Object.values(record).find((n) => n.type === 'plumbing:manifold') ?? null,
    [record],
  )

  const copyCsv = (label: string, csv: string) => {
    navigator.clipboard?.writeText(csv).catch(() => {})
    setCopiedMsg(`Copied ${label} CSV`)
    setTimeout(() => setCopiedMsg(null), 2000)
  }

  const tabs: ReadonlyArray<[PlumbingScheduleTab, string]> = [
    ['fixtures', `Fixtures (${schedule.fixtures.length})`],
    ['loads', 'Loads & Power'],
    ['audit', `IPC Audit (${audit.errorCount}/${audit.warningCount})`],
    ['penetrations', `Drill List (${penetrations.length})`],
    ['bom', `BOM ($${Math.round(bom.grandTotalUsd).toLocaleString()})`],
    ['manifold', '3D Manifold Cutaway'],
  ]

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong style={{ fontSize: 15 }}>Plumbing Engineering Schedule ({codeEdition})</strong>
          <div style={{ fontSize: 11, opacity: 0.75 }}>
            {schedule.loads.totalDfu} DFU · {schedule.loads.totalWsfu} WSFU ({schedule.loads.peakDemandGpm} GPM Peak) · Main Drain{' '}
            {schedule.loads.recommendedBuildingDrain} · Vent Stack {schedule.loads.recommendedVentStack}
          </div>
        </div>
        {copiedMsg && <span style={{ color: '#22c55e', fontSize: 11 }}>{copiedMsg}</span>}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--border, rgba(255,255,255,0.14))', paddingBottom: 8 }}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid var(--border, rgba(255,255,255,0.18))',
              background: activeTab === id ? 'rgba(37,99,235,0.28)' : 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: activeTab === id ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1: Fixture Schedule */}
      {activeTab === 'fixtures' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => copyCsv('Fixture Schedule', formatPlumbingScheduleCsv(schedule))} style={btnStyle}>
              Copy CSV
            </button>
          </div>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Fixture</th>
                <th style={thStyle}>Room</th>
                <th style={thStyle}>DFU</th>
                <th style={thStyle}>WSFU (C/H)</th>
                <th style={thStyle}>Drain / Vent</th>
                <th style={thStyle}>Supply</th>
              </tr>
            </thead>
            <tbody>
              {schedule.fixtures.map((f) => (
                <tr key={f.nodeId} onClick={() => setSelection({ selectedIds: [f.nodeId] })} style={{ cursor: 'pointer' }}>
                  <td style={tdStyle}>{f.name}</td>
                  <td style={tdStyle}>{f.roomName}</td>
                  <td style={tdStyle}>{f.dfu}</td>
                  <td style={tdStyle}>{f.wsfuCold} / {f.wsfuHot}</td>
                  <td style={tdStyle}>{f.drainSize ?? '-'} / {f.ventSize ?? '-'}</td>
                  <td style={tdStyle}>{f.supplySize ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 2: Loads & Cross-Trade Electrical Coordination */}
      {activeTab === 'loads' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
            <MetricCard title="Building Drain" value={schedule.loads.recommendedBuildingDrain} sub={`${schedule.loads.totalDfu} DFU @ 1/4"/ft`} />
            <MetricCard title="Peak Water Demand" value={`${schedule.loads.peakDemandGpm} GPM`} sub={`${schedule.loads.totalWsfu} WSFU · Cold ${schedule.loads.recommendedColdMain}`} />
            <MetricCard title="Water Heater Rec" value={`${schedule.loads.waterHeaterRecommendation.recommendedTankGal} gal`} sub={`or ${schedule.loads.waterHeaterRecommendation.recommendedTanklessGpm} GPM Tankless`} />
            <MetricCard title="Fuel Gas Load" value={schedule.loads.totalGasBtuh > 0 ? `${Math.round(schedule.loads.totalGasBtuh / 1000)} kBTU/h` : 'All-Electric'} sub={schedule.loads.recommendedGasMain ? `Main: ${schedule.loads.recommendedGasMain}` : 'No gas appliances'} />
          </div>

          <strong>Cross-Trade Electrical Power Coordination (Auto-Breaker Handoff)</strong>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Powered Plumbing Unit</th>
                <th style={thStyle}>Circuit</th>
                <th style={thStyle}>Load</th>
                <th style={thStyle}>Protection</th>
                <th style={thStyle}>Electrical Status</th>
              </tr>
            </thead>
            <tbody>
              {schedule.electricalCoordination.map((c) => (
                <tr key={c.sourceNodeId} onClick={() => setSelection({ selectedIds: [c.sourceNodeId] })} style={{ cursor: 'pointer' }}>
                  <td style={tdStyle}>{c.label}</td>
                  <td style={tdStyle}>{c.voltage}V {c.poles}P {c.breakerAmps}A</td>
                  <td style={tdStyle}>{c.loadVa} VA</td>
                  <td style={tdStyle}>{[c.dedicatedCircuit ? 'Dedicated' : 'Shared', c.gfciRequired ? 'GFCI' : ''].filter(Boolean).join(' · ')}</td>
                  <td style={{ ...tdStyle, color: c.wired ? '#22c55e' : '#f59e0b', fontWeight: 600 }}>
                    {c.wired ? `WIRED (CKT-${c.matchedCircuitNumber ?? '?'})` : 'NEEDS BREAKER'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 3: IPC / UPC / IFGC / NEC 110.26(E) Audit */}
      {activeTab === 'audit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {audit.findings.length === 0 && (
            <div style={{ padding: 12, borderRadius: 8, background: 'rgba(34,197,94,0.14)', border: '1px solid #22c55e' }}>
              0 Errors · 0 Warnings — All IPC/UPC/IFGC/IRC &amp; NEC 110.26(E) checks passed!
            </div>
          )}
          {audit.findings.map((f) => (
            <div
              key={f.id}
              onClick={() => f.nodeIds.length > 0 && setSelection({ selectedIds: f.nodeIds })}
              style={{
                padding: 10,
                borderRadius: 8,
                cursor: f.nodeIds.length > 0 ? 'pointer' : 'default',
                border: `1px solid ${f.severity === 'error' ? '#ef4444' : '#f59e0b'}`,
                background: f.severity === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
              }}
            >
              <div style={{ fontWeight: 600 }}>
                [{f.codeRef}] {f.title}
              </div>
              <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{f.detail}</div>
              <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 4 }}>Fix: {f.suggestedFix}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tab 4: Bones Framing Penetration & Drill Schedule */}
      {activeTab === 'penetrations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, opacity: 0.8 }}>
            Exact stud, sole-plate, and top-plate drill coordinates synced to <code>@pascal-app/plugin-bones</code> framing geometry (IRC R602.6).
          </div>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Member</th>
                <th style={thStyle}>Height AFF</th>
                <th style={thStyle}>Pipe</th>
                <th style={thStyle}>Hole Saw</th>
                <th style={thStyle}>Bore %</th>
                <th style={thStyle}>Nail Plate</th>
                <th style={thStyle}>IRC R602.6</th>
              </tr>
            </thead>
            <tbody>
              {penetrations.map((p) => (
                <tr key={p.id} onClick={() => setSelection({ selectedIds: [p.pipeRunId] })} style={{ cursor: 'pointer' }}>
                  <td style={tdStyle}>{p.memberLabel}</td>
                  <td style={tdStyle}>{Math.round(p.position[1] * 39.37)}&quot;</td>
                  <td style={tdStyle}>{p.pipeSize} {p.material}</td>
                  <td style={tdStyle}><strong>{p.holeSawIn}&quot;</strong></td>
                  <td style={tdStyle}>{p.borePctOfStud}%</td>
                  <td style={tdStyle}>{p.needsNailPlate ? 'Required' : 'No'}</td>
                  <td style={{ ...tdStyle, color: p.codeCompliant ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                    {p.codeCompliant ? 'PASS' : 'OVERSIZE'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 5: Priced BOM Takeoff */}
      {activeTab === 'bom' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label>
              Labor $/hr:{' '}
              <input type="number" value={laborRateUsd} onChange={(e) => setLaborRateUsd(Number(e.target.value) || 0)} style={numInputStyle} />
            </label>
            <label>
              Markup %:{' '}
              <input type="number" value={materialMarkupPct} onChange={(e) => setMaterialMarkupPct(Number(e.target.value) || 0)} style={numInputStyle} />
            </label>
            <label>
              Tax %:{' '}
              <input type="number" value={salesTaxPct} onChange={(e) => setSalesTaxPct(Number(e.target.value) || 0)} style={numInputStyle} />
            </label>
            <button type="button" onClick={() => copyCsv('BOM', formatPlumbingBomCsv(bom))} style={btnStyle}>
              Copy BOM CSV
            </button>
          </div>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Item</th>
                <th style={thStyle}>Qty</th>
                <th style={thStyle}>Material</th>
                <th style={thStyle}>Labor</th>
                <th style={thStyle}>Total</th>
              </tr>
            </thead>
            <tbody>
              {bom.lines.map((l, idx) => (
                <tr key={`${l.item}_${idx}`}>
                  <td style={tdStyle}>{l.category}</td>
                  <td style={tdStyle}>{l.item}</td>
                  <td style={tdStyle}>{l.quantity} {l.unit}</td>
                  <td style={tdStyle}>${l.materialUsd.toFixed(2)}</td>
                  <td style={tdStyle}>${l.laborUsd.toFixed(2)} ({l.laborHours}h)</td>
                  <td style={tdStyle}><strong>${l.totalUsd.toFixed(2)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 700 }}>
            Grand Total: ${bom.grandTotalUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
      )}

      {/* Tab 6: 3D PEX Manifold & Wet-Wall Cutaway */}
      {activeTab === 'manifold' && (
        <ManifoldCutawayView
          manifoldKind={((firstManifold?.manifoldKind as ManifoldKind) || 'pex-homerun')}
          portCount={typeof firstManifold?.portCount === 'number' ? firstManifold.portCount : 12}
          viewMode={manifoldViewMode}
          ports={[]}
          onChangeViewMode={setManifoldViewMode}
        />
      )}
    </div>
  )
}

function MetricCard({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,0.14))' }}>
      <div style={{ fontSize: 10, opacity: 0.72 }}>{title}</div>
      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 11, opacity: 0.8 }}>{sub}</div>
    </div>
  )
}

const tableStyle = { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11 }
const thStyle = { textAlign: 'left' as const, padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.16)', opacity: 0.8 }
const tdStyle = { padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }
const btnStyle = { padding: '4px 9px', borderRadius: 6, border: '1px solid rgba(56,189,248,0.5)', background: 'rgba(56,189,248,0.16)', color: 'inherit', cursor: 'pointer', fontSize: 11 }
const numInputStyle = { width: 58, padding: '3px 5px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: 'inherit', fontSize: 11 }
