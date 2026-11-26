# Architecture Guide (`@kruschdev/pascal-plugin-plumbing`)

## Layered Subpath Architecture

- **`src/ipc/*` (`./ipc`)**: Pure framework-free TypeScript implementing IPC 2021, UPC 2021, IFGC 2021, and IRC 2021 plumbing tables, DFU/WSFU/Hunter's Curve/Hazen-Williams/IFGC sizing, gravity-sloped 3D DWV & obstacle-aware supply routing, `@pascal-app/plugin-bones` framing penetration & wet-wall analysis, `WeakMap`-memoized compliance auditing, schedules, and priced BOMs.
- **`src/cad/*` (`./cad`)**: Editor-free, React-free Three.js procedural builders for 47 clean-room MIT plumbing CAD models plus the swept sloped pipe-run builder (`buildPipeRunCad` with 3D framing bore collars and galvanized nail plates) and interactive 3D PEX Manifold & 2x6 Wet-Wall Cutaway (`buildWiredManifoldCutawayCad`).
- **`src/nodes/*` (`./render`)**: Four Pascal Plugin API v1 node definitions (`plumbing:equipment`, `plumbing:manifold`, `plumbing:fixture`, `plumbing:pipe-run`) with Zod v4 schemas, 3D builders, 2D floorplan symbols, snapping ports, and parametric inspector schemas.
- **`src/agent-tools.ts` & `src/agent-operations.ts` (`./agent-tools`, `./agent-operations`)**: Eight pure Zod `E-016` agent tools and headless scene operations executable from MCP servers, detached runtimes, or live chat in a single undo step.
- **`src/ui/*` (`.`)**: Isolated Zustand UI store (`store.ts`), left-rail `EditorHostPanel` (`plumbing-panel.tsx`), selected-node `InspectorExtension` (`inspector-card.tsx`), 6-tab split-pane `EditorHostView` (`schedule-view.tsx` + `manifold-cutaway-view.tsx`), and chat cards (`chat-card.tsx`).

## Cross-Trade MEP Coordination

1. **Trade-Priority Order**: `1. Structural -> 2. Plumbing -> 3. HVAC -> 4. Electrical`.
2. **Bones Framing**: Reads `bones:framing` (`16"`/`24"` OC, wall thickness) and `bones:service` (`water-heater`, `water-entry`, `sewer-exit`) with zero hard dependency on `@pascal-app/plugin-bones`.
3. **Electrical Power Handoff**: Every powered plumbing node emits a pure JSON `electricalDemand` payload (`voltage`, `poles`, `breakerAmps`, `loadVa`, `dedicatedCircuit`, `gfciRequired`, `loadCategory`, `label`). `@kruschdev/pascal-plugin-electrical` reads this payload automatically during auto-populate to assign breakers and route 3D power runs back to each unit.
