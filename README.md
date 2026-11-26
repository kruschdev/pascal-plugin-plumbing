# Pascal Plugin Plumbing (`@kruschdev/pascal-plugin-plumbing`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Pascal Plugin API v1](https://img.shields.io/badge/Pascal_Plugin_API-v1-38bdf8.svg)](https://github.com/pascalorg/editor)
[![3D CAD Models](https://img.shields.io/badge/MIT_3D_CAD_Models-47_.glb-10b981.svg)](./docs/CAD-CATALOG.md)

An open-source, MIT-licensed **Residential and Light-Commercial IPC / UPC / IFGC / IRC Plumbing** plugin for [Pascal Editor](https://github.com/pascalorg/editor).

I built this as a standalone external plugin implementing Pascal's full Plugin API v1 contract (`E-014`, `E-016`, `E-017`) so it installs cleanly alongside `@pascal-app/plugin-bones` and `@kruschdev/pascal-plugin-electrical` without requiring upstream core merges.

## Core Capabilities

1. **One-Click IPC/UPC Auto-Populate & Bones Interop**: Scans Pascal room zones, placed Pascal bathroom/kitchen/laundry fixtures, and optional `@pascal-app/plugin-bones` `bones:framing` and `bones:service` (`water-heater`, `water-entry`, `sewer-exit`) anchors to place mechanical equipment, PEX home-run manifolds (or trunk-and-branch copper/PEX), wet-wall fixture rough-ins, frost-proof hose bibbs with anti-siphon vacuum breakers, gravity-sloped DWV drains, 3" roof vent stacks, dry re-vents (`>= 6"` above flood-level rim), optional IFGC fuel gas, and 4" rigid aluminum dryer vents.
2. **Priority #2 MEP Right-of-Way & Gravity DWV Routing**: Plumbing holds first MEP right-of-way (`1. Structural -> 2. Plumbing -> 3. HVAC -> 4. Electrical`) with true monotonic downward gravity pitch (`1/4"/ft` for `<= 2-1/2"`, `1/8"/ft` minimum for `>= 3"`), automatic detours around structural beams and columns (`structural:beam`, `structural:column`, `beam`, `column`; `stair`, `window`, and `door` openings are not yet extracted as 3D obstacles), and enforcement of **NEC 110.26(E) Dedicated Electrical Space** above electrical panels and transformers.
3. **Bones Framing Penetration Solver & 3D Bore Visualization**: Computes the exact 3D `(x, y, z)` crossing of every `16"` or `24"` OC wall stud, sole plate, and double top plate (honoring Priority #1 `structural:assembly` `2x6` overrides; `IRC R502.8` floor-joist boring is not modeled), renders 3D bore-hole collars and galvanized steel nail plates (`IRC R602.6` / `IPC 305.6`) right on pipe runs, and generates a live **Framing Drill List** with exact hole-saw diameters and `% of stud depth`.
4. **Automatic Cross-Trade Electrical Power Coordination**: Every powered plumbing unit (electric/HPWH water heater, tankless gas ignition/blower, sump pump, sewage ejector, recirc pump, water softener, dishwasher, garbage disposal, clothes washer, bidet) publishes a standardized `electricalDemand` payload (`voltage`, `poles`, `breakerAmps`, `loadVa`, `dedicatedCircuit`, `gfciRequired`). When `@kruschdev/pascal-plugin-electrical` runs in the same scene, Electrical automatically allocates the dedicated breakers on the panelboard and routes 3D power runs straight to each plumbing (and future HVAC) unit.
5. **47 Clean-Room MIT 3D CAD Models & Interactive 3D PEX Manifold Cutaway**: Includes 47 procedural `.glb` models across 6 categories plus an interactive **3D PEX Manifold & 2x6 Wet-Wall Cutaway** view (`2x6 Wet-Wall & 3" Stack Cutaway`, `Manifold Cover Off`, `Steel Enclosure Closed`) inside the 6-tab split-pane `Plumbing Schedule` view.
6. **Live Fixture Schedule, DFU/WSFU/Gas Load Calc, IPC/IFGC Audit, and Priced BOM Takeoff**: Calculates `IPC Table 709.1` / `710.1` DFU drain sizing, Modified Hunter's Curve peak GPM, Hazen-Williams head loss and velocity limits (`<= 5 ft/s` hot copper, `<= 8 ft/s` cold/PEX), `IFGC Table 402.4` longest-length fuel-gas sizing, `IRC M1502.4` dryer vent effective length, and live labor/markup/tax BOM exports (CSV).

> **Drafting and engineering aid, not stamped engineering.** Always verify calculations, pipe sizing, and local AHJ amendments with a licensed plumbing engineer or master plumber before construction.

## Package Entrypoints

| Entrypoint | Export | Boundary Guarantee |
|---|---|---|
| `.` | `plumbingPlugin`, `plumbingHostPanel`, `plumbingScheduleView`, `plumbingChatExtension` | Full editor integration (`EditorHostPanel`, 6-tab `EditorHostView`, `InspectorExtension`, chat cards) |
| `./render` | `plumbingRenderPlugin` | Editor-free read-only viewer manifest (verified by `bun run check:render`) |
| `./cad` | `PLUMBING_CAD_CATALOG`, `buildPlumbingCadPart`, `buildWiredManifoldCutawayCad`, `buildEquipmentCad`, `buildFixtureCad`, `buildFittingCad`, `buildPipeRunCad` | Editor-free, React-free Three.js CAD part builders for all 47 plumbing models |
| `./ipc` | Pure IPC/UPC/IFGC/IRC sizing, gravity DWV & supply routing, Bones penetration solver, audit, schedule, and BOM functions | Framework-free TypeScript (zero React, Three.js, or `@pascal-app/*`) |
| `./agent-tools` | `plumbingAgentTools` (`PluginAgentTools`, `E-016`) | Pure Zod-only contracts (8 tools + skill) |
| `./agent-operations` | `plumbingAgentOperations` (`AgentOperations`, `E-016`) | Pure scene operations runnable on MCP, detached runtime, or live chat |

## Quick Start in a Pascal Host

```ts
import { extendPluginDiscovery } from '@pascal-app/core'
import { registerEditorHostPanel, registerEditorHostView } from '@pascal-app/editor'
import {
  plumbingHostPanel,
  plumbingPlugin,
  plumbingScheduleView,
} from '@kruschdev/pascal-plugin-plumbing'

extendPluginDiscovery(async () => [plumbingPlugin])
registerEditorHostPanel(plumbingHostPanel)
registerEditorHostView(plumbingScheduleView)
```

## Development and Verification

```bash
bun install
bun run check          # tsc --noEmit + bun test src + 5/5 entry boundary gates + dist/ build
bun run export:cad     # Regenerate all 47 binary .glb models in assets/cad/
```
