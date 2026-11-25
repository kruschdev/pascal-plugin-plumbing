import { describe, expect, test } from 'bun:test'
import { plumbingAgentOperations } from '../agent-operations'
import { plumbingAgentTools } from '../agent-tools'
import {
  PLUMBING_PLUGIN_ID,
  plumbingChatExtension,
  plumbingHostPanel,
  plumbingPlugin,
  plumbingRenderPlugin,
  plumbingScheduleView,
} from '../index'
import {
  PlumbingEquipmentNode,
  PlumbingFixtureNode,
  PlumbingManifoldNode,
  PlumbingPipeRunNode,
} from '../render'

describe('Pascal Plugin API v1 Contracts (`krusch:plumbing`)', () => {
  test('plugin manifests and render manifest share id, apiVersion, and 4 plumbing:* node kinds', () => {
    expect(plumbingPlugin.id).toBe(PLUMBING_PLUGIN_ID)
    expect(plumbingRenderPlugin.id).toBe(PLUMBING_PLUGIN_ID)
    expect(plumbingPlugin.apiVersion).toBe(1)
    expect(plumbingPlugin.nodes?.length).toBe(4)
    expect(plumbingRenderPlugin.nodes?.length).toBe(4)
    expect(plumbingHostPanel.pluginId).toBe(PLUMBING_PLUGIN_ID)
    expect(plumbingScheduleView.pluginId).toBe(PLUMBING_PLUGIN_ID)
    expect(plumbingChatExtension.pluginId).toBe(PLUMBING_PLUGIN_ID)
  })

  test('Zod v4 schemas round-trip all 4 plumbing:* node kinds cleanly', () => {
    expect(PlumbingEquipmentNode.parse({ id: 'plumbeq_1', type: 'plumbing:equipment' }).equipmentKind).toBe(
      'water-heater-tank-electric',
    )
    expect(PlumbingManifoldNode.parse({ id: 'plumbman_1', type: 'plumbing:manifold' }).portCount).toBe(12)
    expect(PlumbingFixtureNode.parse({ id: 'plumbfix_1', type: 'plumbing:fixture' }).fixtureKind).toBe('lavatory')
    expect(
      PlumbingPipeRunNode.parse({
        id: 'plumbpipe_1',
        type: 'plumbing:pipe-run',
        path: [[0, 0, 0], [1, 0, 0]],
      }).system,
    ).toBe('cold-water')
  })

  test('E-016 agent tools & operations execute full headless autopopulate + load + audit workflow', () => {
    expect(plumbingAgentTools.tools.length).toBe(8)
    const scene = {
      level_0: { id: 'level_0', type: 'level' },
      w1: { id: 'w1', type: 'wall', parentId: 'level_0', start: [0, 0], end: [6, 0], thickness: 0.165, height: 2.6 },
    } as Record<string, unknown>

    const pop = plumbingAgentOperations.plumbing_autopopulate(
      scene as never,
      { includeFuelGas: true },
      { activeLevelId: 'level_0' },
    )
    expect(pop.changes?.create?.length).toBeGreaterThan(10)
    expect((pop.result.audit as { errorCount: number }).errorCount).toBe(0)

    const nextNodes: Record<string, unknown> = { ...scene }
    for (const item of pop.changes?.create ?? []) {
      const n = item.node as { id: string }
      nextNodes[n.id] = n
    }

    const loads = plumbingAgentOperations.plumbing_calculate_loads(nextNodes as never, {})
    expect(loads.result.loads.totalDfu).toBeGreaterThan(0)
    expect(loads.result.electricalCoordination.length).toBeGreaterThan(0)

    const audit = plumbingAgentOperations.plumbing_audit_ipc(nextNodes as never, {})
    expect(audit.result.errorCount).toBe(0)
  })
})
