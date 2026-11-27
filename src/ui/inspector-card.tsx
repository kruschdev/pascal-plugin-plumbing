'use client'

/**
 * InspectorExtension card for `plumbing:*` nodes:
 * Shows live NOT TO CODE / COMPLIANT status, DFU/WSFU/slope/velocity/framing-penetration metrics,
 * and cross-trade Electrical Power Demand info.
 */

import type { AnyNode } from '@pascal-app/core'
import { openEditorView, useScene } from '@pascal-app/editor'
import { useMemo } from 'react'
import { auditScenePlumbing } from '../ipc/audit'
import {
  type SceneNodeLike,
  type Vec3,
  computePipeFramingPenetrations,
  extractBonesPlumbingContext,
  resolveNodeLevelId,
} from '../ipc/framing-interop'
import { extractWallSegments, measureDrainPathSlope, polylineLengthM } from '../ipc/routing'
import { resolveNodeElectricalDemand } from '../ipc/schedule'
import { METERS_TO_FEET, type PipeMaterial, type PipeNominalSize, round2 } from '../ipc/tables'
import { PLUMBING_SCHEDULE_VIEW_ID } from './plumbing-panel'
import { usePlumbingUi } from './store'

export default function PlumbingInspectorCard({ node }: { node?: AnyNode }) {
  const nodes = useScene((s) => s.nodes) as unknown as Readonly<Record<string, SceneNodeLike>>
  const codeEdition = usePlumbingUi((s) => s.codeEdition)
  const occupancy = usePlumbingUi((s) => s.occupancy)
  const setActiveTab = usePlumbingUi((s) => s.setActiveTab)
  const setSelectedManifoldId = usePlumbingUi((s) => s.setSelectedManifoldId)

  const audit = useMemo(
    () => auditScenePlumbing(nodes, { codeEdition, occupancy }),
    [nodes, codeEdition, occupancy],
  )
  const raw = node as unknown as SceneNodeLike | undefined
  const nodeFindings = useMemo(
    () => (raw ? audit.findings.filter((f) => f.nodeIds.includes(raw.id)) : []),
    [audit, raw],
  )

  const pipeMetrics = useMemo(() => {
    if (!raw || raw.type !== 'plumbing:pipe-run' || !Array.isArray(raw.path)) return null
    const path = raw.path as ReadonlyArray<Vec3>
    const lengthFt = round2(polylineLengthM(path) * METERS_TO_FEET)
    const slope = raw.system === 'dwv-drain' ? measureDrainPathSlope(path) : null
    const lvlId = resolveNodeLevelId(nodes, raw)
    const walls = extractWallSegments(nodes, lvlId)
    const bones = extractBonesPlumbingContext(nodes, lvlId)
    const pens = computePipeFramingPenetrations({
      pipeRunId: raw.id,
      path,
      pipeSize: (raw.nominalSize as PipeNominalSize) || '1/2"',
      material: (raw.material as PipeMaterial) || 'pex-a',
      walls,
      bonesContext: bones,
    })
    return { lengthFt, slope, pens }
  }, [nodes, raw])

  if (!raw) return null

  const openTab = (tab: 'audit' | 'penetrations' | 'manifold') => {
    setActiveTab(tab)
    openEditorView(PLUMBING_SCHEDULE_VIEW_ID, { beside: true })
  }

  const demand = resolveNodeElectricalDemand(raw)

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
      <div
        style={{
          padding: '6px 8px',
          borderRadius: 6,
          background: nodeFindings.some((f) => f.severity === 'error')
            ? 'rgba(239,68,68,0.18)'
            : nodeFindings.length > 0
              ? 'rgba(245,158,11,0.18)'
              : 'rgba(34,197,94,0.15)',
          border: `1px solid ${
            nodeFindings.some((f) => f.severity === 'error')
              ? '#ef4444'
              : nodeFindings.length > 0
                ? '#f59e0b'
                : '#22c55e'
          }`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontWeight: 600,
          fontSize: 11,
        }}
      >
        <span>
          {nodeFindings.some((f) => f.severity === 'error')
            ? `NOT TO CODE (${nodeFindings.length})`
            : nodeFindings.length > 0
              ? `WARNINGS (${nodeFindings.length})`
              : `${codeEdition} COMPLIANT`}
        </span>
        <button
          type="button"
          onClick={() => openTab('audit')}
          style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: 11 }}
        >
          Audit
        </button>
      </div>

      {pipeMetrics && (
        <>
          <Row label="System / Size" value={`${String(raw.system)} · ${String(raw.nominalSize)} ${String(raw.material)}`} />
          <Row label="Run Length" value={`${pipeMetrics.lengthFt} ft`} />
          {pipeMetrics.slope && (
            <Row
              label="Measured DWV Slope"
              value={`${pipeMetrics.slope.overallSlopeInPerFt}"/ft`}
              warn={pipeMetrics.slope.hasUphillSegment}
            />
          )}
          <Row label="Framing Penetrations" value={`${pipeMetrics.pens.length} stud/plate bore(s)`} />
          {pipeMetrics.pens.length > 0 && (
            <button type="button" onClick={() => openTab('penetrations')} style={linkBtnStyle}>
              View Drill Schedule &amp; Hole-Saw Sizes
            </button>
          )}
        </>
      )}

      {raw.type === 'plumbing:fixture' && (
        <>
          <Row label="DFU / WSFU" value={`${String(raw.dfu ?? 0)} DFU · ${String(raw.wsfuTotal ?? 0)} WSFU`} />
          <Row label="Drain / Vent / Supply" value={`${String(raw.drainSize ?? '-')} / ${String(raw.ventSize ?? '-')} / ${String(raw.supplySize ?? '-')}`} />
        </>
      )}

      {raw.type === 'plumbing:manifold' && (
        <>
          <Row label="Manifold" value={`${String(raw.manifoldKind)} (${String(raw.portCount ?? 12)} ports)`} />
          <button
            type="button"
            onClick={() => {
              setSelectedManifoldId(raw.id)
              openTab('manifold')
            }}
            style={linkBtnStyle}
          >
            Open 3D Manifold &amp; Wet-Wall Cutaway
          </button>
        </>
      )}

      {demand?.required && (
        <div style={{ padding: 6, borderRadius: 6, background: 'rgba(245,158,11,0.12)', fontSize: 11 }}>
          <strong>Electrical Coordination:</strong> {demand.voltage}V {demand.poles}P {demand.breakerAmps}A ({demand.loadVa} VA
          {demand.gfciRequired ? ', GFCI' : ''})
        </div>
      )}

      {nodeFindings.slice(0, 3).map((f) => (
        <div key={f.id} style={{ fontSize: 11, opacity: 0.9 }}>
          <strong>{f.codeRef}:</strong> {f.title}
        </div>
      ))}
    </div>
  )
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
      <span style={{ opacity: 0.78 }}>{label}</span>
      <strong style={{ color: warn ? '#ef4444' : 'inherit' }}>{value}</strong>
    </div>
  )
}

const linkBtnStyle = {
  padding: '4px 8px',
  borderRadius: 5,
  border: '1px solid rgba(56,189,248,0.45)',
  background: 'rgba(56,189,248,0.12)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 11,
}
