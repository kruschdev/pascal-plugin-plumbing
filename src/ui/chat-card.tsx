'use client'

/**
 * Persisted ChatToolCard for `krusch:plumbing` (`PluginChatExtension`).
 */

import type { ChatToolCardProps } from '@pascal-app/editor'
import { PLUMBING_SCHEDULE_VIEW_ID } from './plumbing-panel'

export default function PlumbingChatCard({ toolName, output, state, actions }: ChatToolCardProps) {
  const data = output?.data as Record<string, unknown> | undefined
  const findings = Array.isArray(data?.findings)
    ? (data.findings as Array<{ id: string; title: string; codeRef: string; nodeIds?: string[] }>)
    : []
  const scheduleObj = data?.schedule as
    | {
        fixtures?: unknown[]
        loads?: { totalDfu?: number; peakDemandGpm?: number; recommendedBuildingDrain?: string }
      }
    | undefined
  const loadsObj = (data?.loads ?? scheduleObj?.loads) as
    | {
        totalDfu?: number
        totalWsfu?: number
        peakDemandGpm?: number
        recommendedBuildingDrain?: string
        recommendedVentStack?: string
      }
    | undefined
  const autoSummary = typeof data?.summary === 'string' ? data.summary : null
  const bomObj = data?.bom as { grandTotalUsd?: number; totalLaborHours?: number } | undefined
  const penetrations = Array.isArray(data?.penetrations) ? data.penetrations : null
  const routedNodeId = typeof data?.nodeId === 'string' ? data.nodeId : null
  const lengthFt = typeof data?.lengthFt === 'number' ? data.lengthFt : null
  const slopeInPerFt = typeof data?.slopeInPerFt === 'number' ? data.slopeInPerFt : null

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        border: '1px solid var(--border, rgba(255,255,255,0.16))',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
        <span>{toolName}</span>
        <span style={{ fontSize: 11, opacity: 0.75 }}>{state}</span>
      </div>
      {output?.text && <div style={{ opacity: 0.85 }}>{output.text}</div>}

      {/* Summary for plumbing_autopopulate */}
      {autoSummary && (
        <div style={{ fontSize: 11, opacity: 0.9 }}>
          <strong>Auto-Populate:</strong> {autoSummary}
        </div>
      )}

      {/* Summary for plumbing_calculate_loads */}
      {!scheduleObj && loadsObj && (
        <div style={{ fontSize: 11 }}>
          <strong>Loads:</strong> {loadsObj.totalDfu ?? 0} DFU · {loadsObj.totalWsfu ?? 0} WSFU ({loadsObj.peakDemandGpm ?? 0} GPM) · Drain{' '}
          {loadsObj.recommendedBuildingDrain ?? '-'} · Stack {loadsObj.recommendedVentStack ?? '-'}
        </div>
      )}

      {/* Summary for plumbing_generate_schedule */}
      {(scheduleObj || bomObj) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11 }}>
          {scheduleObj?.loads && (
            <div>
              <strong>Schedule:</strong> {scheduleObj.fixtures?.length ?? 0} fixtures · {scheduleObj.loads.totalDfu ?? 0} DFU ·{' '}
              {scheduleObj.loads.peakDemandGpm ?? 0} GPM · Drain {scheduleObj.loads.recommendedBuildingDrain ?? '-'}
            </div>
          )}
          {bomObj && typeof bomObj.grandTotalUsd === 'number' && (
            <div>
              <strong>Estimated BOM:</strong> ${bomObj.grandTotalUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })} (
              {bomObj.totalLaborHours ?? 0} labor hrs)
            </div>
          )}
          {penetrations && (
            <div>
              <strong>Framing Drill List:</strong> {penetrations.length} stud/plate penetration(s)
            </div>
          )}
        </div>
      )}

      {/* Summary for plumbing_route_pipe */}
      {lengthFt !== null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
          <span>
            <strong>Routed Pipe:</strong> {lengthFt} ft
            {slopeInPerFt !== null && slopeInPerFt > 0 ? ` · ${slopeInPerFt}"/ft slope` : ''}
            {penetrations ? ` · ${penetrations.length} bore(s)` : ''}
          </span>
          {routedNodeId && (
            <button
              type="button"
              onClick={() => actions.select([routedNodeId])}
              style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: 11 }}
            >
              Select
            </button>
          )}
        </div>
      )}

      {/* Summary for plumbing_audit_ipc */}
      {findings.slice(0, 4).map((f) => (
        <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
          <span>
            <strong>{f.codeRef}</strong>: {f.title}
          </span>
          {f.nodeIds && f.nodeIds.length > 0 && (
            <button
              type="button"
              onClick={() => actions.select(f.nodeIds!)}
              style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: 11 }}
            >
              Select
            </button>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          type="button"
          onClick={() => actions.openView(PLUMBING_SCHEDULE_VIEW_ID, { beside: true })}
          style={{
            padding: '4px 8px',
            borderRadius: 5,
            border: '1px solid rgba(37,99,235,0.55)',
            background: 'rgba(37,99,235,0.18)',
            color: 'inherit',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          Open Plumbing Schedule
        </button>
      </div>
    </div>
  )
}
