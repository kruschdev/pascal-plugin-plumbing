import { describe, expect, test } from 'bun:test'
import { auditScenePlumbing } from '../ipc/audit'
import type { SceneNodeLike } from '../ipc/framing-interop'
import { buildPlumbingBom, formatPlumbingBomCsv } from '../ipc/pricing'
import { buildPlumbingSchedule, formatPlumbingScheduleCsv } from '../ipc/schedule'

describe('IPC / IFGC / IRC / NEC 110.26(E) Auditor, Schedule & Priced BOM', () => {
  test('flags uphill DWV drain, 2x4 wet wall with 3" pipe, missing gas drip leg, NEC 110.26(E) clash, and unwired WH', () => {
    const nodes: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level' },
      wall_thin: { id: 'wall_thin', type: 'wall', parentId: 'level_0', start: [0, 0], end: [4, 0], thickness: 0.114, height: 2.6 },
      panel_1: { id: 'panel_1', type: 'electrical:panel', name: 'MDP-1', parentId: 'level_0', position: [2, 1.52, 0], width: 0.42, height: 0.92, depth: 0.16 },
      wh_1: {
        id: 'wh_1',
        type: 'plumbing:equipment',
        name: 'Electric WH',
        parentId: 'level_0',
        equipmentKind: 'water-heater-tank-electric',
        position: [0.5, 0, 0.5],
        hasTpDischarge: false,
        hasDrainPan: true,
        hasExpansionTank: true,
      },
      bibb_1: {
        id: 'bibb_1',
        type: 'plumbing:fixture',
        name: 'Outdoor Bibb',
        parentId: 'level_0',
        fixtureKind: 'hose-bibb',
        position: [0, 0.45, 0],
        hasVacuumBreaker: false,
      },
      pipe_uphill: {
        id: 'pipe_uphill',
        type: 'plumbing:pipe-run',
        name: 'Bad Uphill Drain',
        parentId: 'level_0',
        system: 'dwv-drain',
        material: 'pvc-dwv',
        nominalSize: '3"',
        wallId: 'wall_thin',
        path: [
          [0, 0.2, 0],
          [3, 0.4, 0], // Uphill!
        ],
        hasCleanout: false,
        isHorizontalSanTee: true,
      },
      pipe_over_panel: {
        id: 'pipe_over_panel',
        type: 'plumbing:pipe-run',
        name: 'Cold Over Panel',
        parentId: 'level_0',
        system: 'cold-water',
        material: 'pex-a',
        nominalSize: '3/4"',
        path: [
          [1, 2.3, 0],
          [3, 2.3, 0], // Passes directly over panel_1 at x=2, y=1.52..3.35!
        ],
      },
      pipe_gas_bad: {
        id: 'pipe_gas_bad',
        type: 'plumbing:pipe-run',
        name: 'Undersized Gas',
        parentId: 'level_0',
        system: 'fuel-gas',
        material: 'black-iron',
        nominalSize: '1/2"',
        gasBtuh: 180000,
        path: [
          [0, 0.5, 2],
          [15, 0.5, 2],
        ],
        hasSedimentTrap: false,
        hasShutoffWithin6Ft: false,
      },
    }

    const audit = auditScenePlumbing(nodes)
    const refs = audit.findings.map((f) => f.codeRef)
    expect(refs).toContain('IPC 704.1')
    expect(refs).toContain('IPC Table 706.3')
    expect(refs).toContain('IPC 504.6')
    expect(refs).toContain('IPC 608.15.4.2')
    expect(refs).toContain('IRC R602.6 / Wet Wall')
    expect(refs).toContain('NEC 110.26(E)')
    expect(refs).toContain('IFGC 408.4')
    expect(refs).toContain('IFGC 409.5')
    expect(refs).toContain('NEC 210 / Cross-Trade Power')

    // WeakMap memoization returns exact same object identity
    expect(auditScenePlumbing(nodes)).toBe(audit)

    const sched = buildPlumbingSchedule(nodes)
    expect(formatPlumbingScheduleCsv(sched)).toContain('Outdoor Bibb')
    const bom = buildPlumbingBom(nodes, { laborRateUsd: 120, materialMarkupPct: 10, salesTaxPct: 8 })
    expect(bom.grandTotalUsd).toBeGreaterThan(500)
    expect(formatPlumbingBomCsv(bom)).toContain('Grand Total')
  })
})
