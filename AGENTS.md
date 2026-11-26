# Pascal Plugin Plumbing (`AGENTS.md`)

> Standalone MIT Residential and Light-Commercial IPC/UPC/IFGC/IRC Plumbing Plugin for Pascal Editor (`@kruschdev/pascal-plugin-plumbing`, `pluginId: krusch:plumbing`).

## Hazards and Non-Negotiable Invariants

1. **Trade-Priority Right-of-Way**: Plumbing (`plumbing:pipe-run`, gravity DWV) holds Priority #2 MEP right-of-way (`1. Structural -> 2. Plumbing -> 3. HVAC -> 4. Electrical`). Plumbing yields ONLY to Structural (`structural:beam`, `structural:column`, `beam`, `column`, plus `IRC R602.6` wall stud/plate boring limits; note `stair`, `window`, `door`, and `IRC R502.8` floor-joist boring are not yet extracted as 3D obstacles/penetrations) and honors `NEC 110.26(E)` Dedicated Electrical Space above `electrical:panel` and `electrical:transformer` nodes.
2. **Entry Boundary Gates (`bun run check:render`)**:
   - `./render` (`src/render.ts`) MUST remain 100% free of `@pascal-app/editor` and `next` imports.
   - `./cad` (`src/cad/index.ts`) MUST remain 100% free of React and `@pascal-app/editor` imports.
   - `./agent-tools` (`src/agent-tools.ts`) MUST remain pure Zod-only (`E-016` contract purity).
   - `./agent-operations` (`src/agent-operations.ts`) MUST remain headless-pure (zero React/Three/viewer/editor).
   - `./ipc` (`src/ipc/index.ts`) MUST remain pure framework-free TypeScript (zero React, Three.js, or `@pascal-app/*` imports).
3. **Plugin Store Isolation**: Keep all plugin UI state inside `src/ui/store.ts`; never extend Pascal's `useScene`, `useEditor`, or `useViewer` stores.
4. **Geometry Resource Safety**: Allocate fresh PBR `CadMaterialPool` instances per CAD build call so Pascal `<GeometrySystem>` disposal never disposes materials still referenced by sibling meshes.
5. **Engineering Disclaimer**: IPC/UPC/IFGC/IRC calculations, gravity slope routing, code audits, and BOM estimates are deterministic drafting aids and never substitute for licensed PE/master plumber review or local AHJ approval.

## Quick Start

```bash
bun install
bun run check          # tsc --noEmit + bun test src + 5/5 entry boundary gates + dist/ build
bun run export:cad     # Regenerate all 47 binary .glb CAD models in assets/cad/
```
